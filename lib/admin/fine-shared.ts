import "server-only";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServiceClient } from "@/lib/supabase/server";
import {
  FINE_PAYMENT_METHODS,
  isFineStatus,
  type FinePaymentMethod,
  type FineStatus,
} from "@/lib/validations/fine";

/**
 * ============================================================================
 *  Shared fine helpers — server-ONLY (Phase 5, rules.md §5–§7)
 * ============================================================================
 *
 * ⚠️  This module is deliberately NOT a `"use server"` module. Server actions
 *     (lib/admin/fine-actions.ts, lib/admin/damage-actions.ts) import the
 *     helpers below, but nothing here is exported from a "use server" file —
 *     doing so would register every export as a publicly invokable server
 *     action. `import "server-only"` additionally makes any client-component
 *     import a build-time error.
 *
 * Contents:
 *   - `FINE_PATHS` / `revalidateFinePaths()` — the routes whose cached data a
 *     fine or damage write invalidates (admin queues + student dashboards);
 *   - `extractSqlErrorMessage()` — PostgREST error → exact `RAISE EXCEPTION`
 *     text (same behaviour as lib/admin/loan-actions.ts);
 *   - `writeFineAudit()` — best-effort `audit_logs` append through the
 *     **service-role client** (R-32: `audit_logs` has no client INSERT
 *     policy, schema.md §4);
 *   - `settleFinePayment()` — the ONE code path for UNPAID → PAID / WAIVED
 *     (§10 fine state machine), shared by record payment, waiver and the
 *     automatic settlement inside damage resolution.
 *
 * R-28 / R-29 / R-31: the system RECORDS settlements, it does not collect;
 * amounts are never read from a client payload, never edited, and fines are
 * never deleted — there is intentionally no update path for
 * `amount_centavos`, no DELETE helper for `fines`, and no DELETE for
 * `damage_reports` anywhere in this module.
 */

/* ------------------------------------------------------------------ */
/* Revalidation                                                        */
/* ------------------------------------------------------------------ */

/** Routes whose cached data depends on fine / damage writes:
 *  admin queues, the student's penalties list, and the two pages that show
 *  balance banners / eligibility (R-25, R-27). */
export const FINE_PATHS = [
  "/admin/penalties",
  "/admin/damages",
  "/dashboard/penalties",
  "/dashboard",
  "/dashboard/catalog",
] as const;

export function revalidateFinePaths(): void {
  for (const path of FINE_PATHS) revalidatePath(path);
}

/* ------------------------------------------------------------------ */
/* SQL error text                                                      */
/* ------------------------------------------------------------------ */

/**
 * Extract the user-facing text from a PostgREST/Supabase error.
 *
 * Shapes seen in the wild (verified in the Phase 4 smoke test):
 *   - `P0001: Damage already assessed for this loan.` → RAISE EXCEPTION text
 *   - `Error: P0001: admin only`                      → supabase-js wrapper
 *   - `permission denied for function assess_damage`  → no prefix
 * The SQLSTATE (`XXXXX: `) and any `Error: ` wrapper are stripped so the UI
 * shows exactly what `RAISE EXCEPTION` said; anything unmappable falls back
 * to `fallback`.
 */
export function extractSqlErrorMessage(
  error: { message?: string } | null | undefined,
  fallback: string,
): string {
  let message = (error?.message ?? "").trim();
  message = message.replace(/^Error:\s*/i, "").trim();
  // SQLSTATE codes are exactly 5 chars (P0001, 42501, 23505, …).
  if (/^[A-Z0-9]{5}:\s/.test(message)) {
    message = message.replace(/^[A-Z0-9]{5}:\s*/, "").trim();
  }
  return message.length > 0 ? message : fallback;
}

/* ------------------------------------------------------------------ */
/* Audit trail (R-32)                                                  */
/* ------------------------------------------------------------------ */

/**
 * Best-effort `audit_logs` append via the service-role client — `audit_logs`
 * is append-only with **no client INSERT policy** (schema.md §4), so the
 * cookie-aware anon client cannot write it. Mirrors `writeAudit` in
 * lib/admin/request-actions.ts: a failed audit never rolls back an
 * already-committed mutation, but it is logged for diagnosis.
 */
export async function writeFineAudit(
  actorId: string,
  action: string,
  entityType: string,
  entityId: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): Promise<void> {
  try {
    const service = getServiceClient();
    const { error } = await service.from("audit_logs").insert({
      actor_id: actorId,
      action,
      entity_type: entityType,
      entity_id: entityId,
      before,
      after,
    });
    if (error) console.error("audit_logs insert failed:", error.message);
  } catch (cause) {
    // Missing env / network — the mutation itself already succeeded.
    console.error("audit_logs insert failed:", cause);
  }
}

/* ------------------------------------------------------------------ */
/* Settlement — §10 state machine: UNPAID → PAID | WAIVED              */
/* ------------------------------------------------------------------ */

/** How an UNPAID fine is being settled (R-28: cash/replacement received,
 *  or R-24 waiver with its mandatory written reason). */
export type SettleFineMode =
  | { kind: "PAY"; method: FinePaymentMethod }
  | { kind: "WAIVE"; reason: string };

/** What `settleFinePayment()` found / did. */
export interface SettleFineResult {
  fineId: string;
  /** The fine's loan (null for manual/admin fines) — lets callers reach the
   *  physical copy (e.g. record payment returning a DAMAGED/LOST copy to
   *  circulation, mirroring resolveDamage). */
  loanId: string | null;
  /** Row status AFTER the call: `"PAID"`, `"WAIVED"`, or the pre-existing
   *  settled status when `wasUnpaid` is false. */
  status: FineStatus;
  paidMethod: FinePaymentMethod | null;
  amountCentavos: number;
  /** true when THIS call performed the UNPAID → settled transition (and
   *  therefore wrote the FINE_PAY / FINE_WAIVE audit row). False when the
   *  fine was already settled — no write, no duplicate audit. */
  wasUnpaid: boolean;
}

export type SettleFineOutcome =
  | { ok: true; result: SettleFineResult }
  /** No such fine (bad id, or the loan has no DAMAGE fine). */
  | { ok: false; code: "not_found" }
  /** Lookup or UPDATE failed — raw message kept for diagnostics; callers map
   *  it to their own user-facing fallback (constraints/RLS never surface raw). */
  | { ok: false; code: "db"; message: string };

/**
 * Settle one fine — the single write path behind record payment (R-28),
 * waiver (R-24) and the automatic settlement during damage resolution (R-23).
 *
 * Look up:
 *   - `{ fineId }`  → any fine (overdue, damage, admin adjustment);
 *   - `{ loanId }`  → that loan's DAMAGE fine (unique per loan+type, R-21) —
 *     `not_found` when the loan has none.
 *
 * Guarantees:
 *   - **conditional UPDATE `WHERE status = 'UNPAID'`** — exactly one writer
 *     wins (R-15/E6 pattern); the loser re-reads the winner's row and reports
 *     `wasUnpaid: false`, never a double settlement;
 *   - the **amount is read from the row, never from the caller** — R-29/R-31;
 *   - `payment_needs_method` / `waiver_needs_reason` DB constraints are
 *     satisfied here (method always set for PAID, reason always set for
 *     WAIVED — Zod has already enforced non-empty, backstopped by SQL);
 *   - one `FINE_PAY` / `FINE_WAIVE` audit row per successful transition
 *     (R-32), written via the service client after the row flipped.
 *
 * ⛔  Never edits `amount_centavos`, never deletes the row (R-29/R-31).
 */
export async function settleFinePayment(
  supabase: SupabaseClient,
  target: { fineId: string } | { loanId: string },
  mode: SettleFineMode,
  adminId: string,
): Promise<SettleFineOutcome> {
  /* ---- 1. locate the fine ------------------------------------------ */
  let lookup = supabase
    .from("fines")
    .select("id, student_id, loan_id, status, amount_centavos, paid_method");
  lookup =
    "fineId" in target
      ? lookup.eq("id", target.fineId)
      : lookup.eq("loan_id", target.loanId).eq("type", "DAMAGE");
  const { data: fine, error: lookupError } = await lookup.maybeSingle();
  if (lookupError) return { ok: false, code: "db", message: lookupError.message };
  if (!fine) return { ok: false, code: "not_found" };

  const fineId = String(fine.id);
  const fineLoanId =
    fine.loan_id === null || fine.loan_id === undefined
      ? null
      : String(fine.loan_id);
  const amountCentavos = Number(fine.amount_centavos ?? 0);
  const rowStatus: FineStatus = isFineStatus(String(fine.status))
    ? (String(fine.status) as FineStatus)
    : "UNPAID";
  const rowMethod = FINE_PAYMENT_METHODS.includes(
    String(fine.paid_method) as FinePaymentMethod,
  )
    ? (String(fine.paid_method) as FinePaymentMethod)
    : null;

  const alreadySettled: SettleFineOutcome = {
    ok: true,
    result: {
      fineId,
      loanId: fineLoanId,
      status: rowStatus,
      paidMethod: rowMethod,
      amountCentavos,
      wasUnpaid: false,
    },
  };

  if (rowStatus !== "UNPAID") return alreadySettled;

  /* ---- 2. conditional settlement (E6: first write wins) ------------- */
  const now = new Date().toISOString();
  const patch =
    mode.kind === "PAY"
      ? {
          status: "PAID",
          paid_method: mode.method,
          paid_at: now,
          received_by: adminId,
        }
      : {
          status: "WAIVED",
          waived_at: now,
          waived_by: adminId,
          waive_reason: mode.reason,
        };

  const { data: updated, error: updateError } = await supabase
    .from("fines")
    .update(patch)
    .eq("id", fineId)
    .eq("status", "UNPAID") // ← the race guard: only an UNPAID row may flip
    .select("id, status, paid_method, amount_centavos")
    .maybeSingle();
  if (updateError) return { ok: false, code: "db", message: updateError.message };

  if (!updated) {
    // Another writer settled it between our read and our UPDATE — adopt the
    // winner's outcome (no write, no duplicate audit).
    const { data: winner, error: rereadError } = await supabase
      .from("fines")
      .select("id, status, amount_centavos, paid_method")
      .eq("id", fineId)
      .maybeSingle();
    if (rereadError) return { ok: false, code: "db", message: rereadError.message };
    if (!winner) return { ok: false, code: "not_found" };
    const winnerStatus: FineStatus = isFineStatus(String(winner.status))
      ? (String(winner.status) as FineStatus)
      : "UNPAID";
    return {
      ok: true,
      result: {
        fineId,
        loanId: fineLoanId,
        status: winnerStatus,
        paidMethod: FINE_PAYMENT_METHODS.includes(
          String(winner.paid_method) as FinePaymentMethod,
        )
          ? (String(winner.paid_method) as FinePaymentMethod)
          : null,
        amountCentavos: Number(winner.amount_centavos ?? 0),
        wasUnpaid: false,
      },
    };
  }

  /* ---- 3. audit the transition (R-32, best-effort) ------------------ */
  const status: FineStatus = mode.kind === "PAY" ? "PAID" : "WAIVED";
  await writeFineAudit(
    adminId,
    mode.kind === "PAY" ? "FINE_PAY" : "FINE_WAIVE",
    "fine",
    fineId,
    { status: "UNPAID", student_id: fine.student_id, amount_centavos: amountCentavos },
    mode.kind === "PAY"
      ? { status, paid_method: mode.method, amount_centavos: amountCentavos }
      : { status, waive_reason: mode.reason, amount_centavos: amountCentavos },
  );

  return {
    ok: true,
    result: {
      fineId,
      loanId: fineLoanId,
      status,
      paidMethod: mode.kind === "PAY" ? mode.method : null,
      amountCentavos,
      wasUnpaid: true,
    },
  };
}
