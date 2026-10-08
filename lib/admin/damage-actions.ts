"use server";

import { assertAdmin } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { fieldErrorsFromZod } from "@/lib/validations/auth";
import {
  FINE_MESSAGES,
  assessDamageSchema,
  resolveDamageSchema,
  type AssessDamageResult,
  type FineActionResult,
  type ResolveDamageResult,
} from "@/lib/validations/fine";
import {
  extractSqlErrorMessage,
  revalidateFinePaths,
  settleFinePayment,
  writeFineAudit,
} from "@/lib/admin/fine-shared";

/**
 * ============================================================================
 *  Admin damage actions — assess / resolve (Phase 5, rules.md §6)
 * ============================================================================
 *
 * Same contract as lib/admin/fine-actions.ts / loan-actions.ts:
 * `assertAdmin()` first (§9 matrix: damage workflow is ADMIN-only), Zod
 * re-validation (R-31), state-machine pre-checks for specific messages, then
 * the database write through the cookie-aware anon client (RLS: "admin
 * manages damage reports" / "admin manages fines", schema.md §4) plus the
 * `audit_logs` append via the service client (R-32).
 *
 * ⛔  NO delete of `damage_reports` (R-22: accountability history) and no
 *     amount editing — `assessed_value_centavos` / `amount_centavos` are
 *     derived from the book's `replacement_value_centavos` in SQL (R-08/R-22)
 *     and only reported back here for display (R-29 centavos → `formatPeso()`).
 */

/* ------------------------------------------------------------------ */
/* Assess (R-08 / R-21 / R-22 / R-23, FR-18)                            */
/* ------------------------------------------------------------------ */

/**
 * Record a damage assessment on a loan already returned as DAMAGED: calls
 * the **existing SQL function** `assess_damage(p_loan_id, p_description,
 * p_photo_url)` via `supabase.rpc(...)` — the single source of truth. SQL
 * (in one transaction) derives the charge from the book's replacement value
 * (R-08/R-22 — the client never sends an amount), inserts the `damage_reports`
 * row, upserts the UNPAID DAMAGE fine (unique per loan+type, R-21) and writes
 * the `DAMAGE_ASSESS` audit row (R-32). The RPC runs through the anon client,
 * so `auth.uid()` is the signed-in admin and the function's own `is_admin()`
 * gate applies — no service-role bypass.
 *
 * Pre-checks (deterministic messages, matching the SQL guards byte-for-byte):
 *   - loan missing or not a DAMAGED return
 *      (returned_at null / status ≠ RETURNED / condition ≠ DAMAGED)
 *                           → 'Only books returned as DAMAGED can be assessed.'
 *   - damage report exists  → 'Damage already assessed for this loan.'
 *                             (R-21 — SQL raises the same string as the race
 *                             backstop, so a concurrent admin loses cleanly)
 *
 * Success: the report id returned by SQL plus the DAMAGE fine's id + amount
 * (re-read from the row — display only, R-29). Audit is written by SQL;
 * nothing is double-logged here.
 */
export async function assessDamage(
  input: unknown,
): Promise<FineActionResult<AssessDamageResult>> {
  await assertAdmin();

  const parsed = assessDamageSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsFromZod(parsed.error) };
  }
  const { loanId, description, photoUrl } = parsed.data;

  const supabase = await createClient();

  /* ---- pre-check the loan state machine (R-23 / E5) ---------------- */
  const { data: loan, error: lookupError } = await supabase
    .from("loans")
    .select("id, returned_at, status, condition_on_return")
    .eq("id", loanId)
    .maybeSingle();
  if (lookupError) {
    return { ok: false, error: FINE_MESSAGES.loadLoanFailed };
  }
  if (!loan) return { ok: false, error: FINE_MESSAGES.loanNotFound };
  if (
    !loan.returned_at ||
    loan.status !== "RETURNED" ||
    loan.condition_on_return !== "DAMAGED"
  ) {
    return { ok: false, error: FINE_MESSAGES.notDamagedReturn };
  }

  /* ---- pre-check R-21: one assessment per loan ---------------------- */
  const { count: reportCount, error: reportError } = await supabase
    .from("damage_reports")
    .select("id", { count: "exact", head: true })
    .eq("loan_id", loanId);
  if (reportError) {
    return { ok: false, error: FINE_MESSAGES.loadDamageFailed };
  }
  if ((reportCount ?? 0) > 0) {
    return { ok: false, error: FINE_MESSAGES.alreadyAssessed };
  }

  /* ---- the single source of truth: assess_damage() in SQL ----------- */
  const { data: damageId, error: rpcError } = await supabase.rpc(
    "assess_damage",
    {
      p_loan_id: loanId,
      p_description: description,
      p_photo_url: photoUrl ?? null,
    },
  );
  if (rpcError || !damageId) {
    return {
      ok: false,
      error: extractSqlErrorMessage(rpcError, FINE_MESSAGES.assessFailed),
    };
  }

  /* ---- report what SQL created (display only — R-08/R-22) ----------- */
  const { data: fine, error: fineError } = await supabase
    .from("fines")
    .select("id, amount_centavos")
    .eq("loan_id", loanId)
    .eq("type", "DAMAGE")
    .maybeSingle();
  if (fineError || !fine) {
    // Unreachable in practice: assess_damage() inserts the DAMAGE fine in the
    // same transaction as the report (the conflict-do-nothing branch still
    // leaves a pre-existing row). If it ever happens the report exists and is
    // resolvable via resolveDamage() — surface the generic failure so the
    // admin retries / checks the damages queue.
    return { ok: false, error: FINE_MESSAGES.assessFailed };
  }

  revalidateFinePaths();
  return {
    ok: true,
    data: {
      damageId: String(damageId),
      fineId: String(fine.id),
      fineAmount: Number(fine.amount_centavos ?? 0),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Resolve (R-23, FR-18)                                                */
/* ------------------------------------------------------------------ */

/**
 * Resolve a damage report (R-23): the student either replaced the book
 * (`REPLACEMENT`) or paid its value (`PAYMENT`). Four steps, deliberately
 * ordered so every failure is recoverable and a race converges:
 *
 *   1. settle the loan's DAMAGE fine **if still UNPAID** (shared
 *      `settleFinePayment()`: conditional `WHERE status = 'UNPAID'` → method
 *      `REPLACEMENT` | `CASH`, `FINE_PAY` audit; already-settled → skip, the
 *      historic method/status is reported as-is; no DAMAGE fine → proceed
 *      with nulls — R-21 says one per loan, not ≥ 1);
 *   2. flip the physical copy back to circulation — `AVAILABLE` in **both**
 *      resolutions (interpretation note: R-23 returns the copy to circulation
 *      once the student has replaced or paid, regardless of which way;
 *      idempotent under concurrent resolves);
 *   3. the **decision point last**: conditional UPDATE
 *      `damage_reports SET status = 'RESOLVED' WHERE status = 'PENDING'` —
 *      exactly one admin wins (E6), the loser gets
 *      'This damage report has already been resolved.'. Because it is last,
 *      a mid-sequence failure leaves the report PENDING, so a retry simply
 *      re-runs steps 1–2 (both idempotent: the fine settle skips a PAID row,
 *      the copy flip is a re-set);
 *   4. `DAMAGE_RESOLVE` audit (R-32) + revalidation.
 *
 * ⛔  No `damage_reports` delete — the RESOLVED row is the accountability
 *     history (R-22).
 */
export async function resolveDamage(
  input: unknown,
): Promise<FineActionResult<ResolveDamageResult>> {
  const { adminId } = await assertAdmin();

  const parsed = resolveDamageSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsFromZod(parsed.error) };
  }
  const { damageId, resolution } = parsed.data;
  const method = resolution === "REPLACEMENT" ? "REPLACEMENT" : "CASH";

  const supabase = await createClient();

  /* ---- pre-check the report (E6-style single decision) -------------- */
  const { data: report, error: lookupError } = await supabase
    .from("damage_reports")
    .select("id, loan_id, copy_id, status")
    .eq("id", damageId)
    .maybeSingle();
  if (lookupError) {
    return { ok: false, error: FINE_MESSAGES.loadDamageFailed };
  }
  if (!report) return { ok: false, error: FINE_MESSAGES.damageReportNotFound };
  if (report.status !== "PENDING") {
    return { ok: false, error: FINE_MESSAGES.alreadyResolved };
  }
  const copyId = String(report.copy_id);
  const loanId = String(report.loan_id);

  /* ---- 1. settle the DAMAGE fine if it is still UNPAID -------------- */
  const settle = await settleFinePayment(
    supabase,
    { loanId },
    { kind: "PAY", method },
    adminId,
  );
  if (!settle.ok && settle.code === "db") {
    // Report is still PENDING — a retry re-runs from here.
    return { ok: false, error: FINE_MESSAGES.resolveFailed };
  }
  const fine = settle.ok ? settle.result : null;

  /* ---- 2. return the copy to circulation (both resolutions) --------- */
  const { data: copy, error: copyError } = await supabase
    .from("book_copies")
    .update({ status: "AVAILABLE" })
    .eq("id", copyId)
    .select("id, status")
    .maybeSingle();
  if (copyError || !copy) {
    return { ok: false, error: FINE_MESSAGES.resolveFailed };
  }

  /* ---- 3. the decision: PENDING → RESOLVED (first write wins) ------- */
  const { data: resolved, error: resolveError } = await supabase
    .from("damage_reports")
    .update({
      status: "RESOLVED",
      resolved_at: new Date().toISOString(),
    })
    .eq("id", damageId)
    .eq("status", "PENDING")
    .select("id")
    .maybeSingle();
  if (resolveError) {
    return { ok: false, error: FINE_MESSAGES.resolveFailed };
  }
  if (!resolved) {
    // A concurrent admin resolved it first; steps 1–2 converged to the same
    // end state (fine settled once, copy AVAILABLE).
    return { ok: false, error: FINE_MESSAGES.alreadyResolved };
  }

  /* ---- 4. audit (R-32) — FINE_PAY was written by the settle helper -- */
  await writeFineAudit(
    adminId,
    "DAMAGE_RESOLVE",
    "damage_report",
    damageId,
    { status: "PENDING", loan_id: loanId, copy_id: copyId },
    {
      status: "RESOLVED",
      resolution,
      loan_id: loanId,
      copy_id: copyId,
      fine_id: fine?.fineId ?? null,
      fine_status: fine?.status ?? null,
    },
  );

  revalidateFinePaths();
  return {
    ok: true,
    data: {
      damageId,
      fineId: fine?.fineId ?? null,
      fineStatus: fine?.status ?? null,
      paidMethod: fine?.paidMethod ?? null,
      copyId,
      copyStatus: "AVAILABLE",
    },
  };
}
