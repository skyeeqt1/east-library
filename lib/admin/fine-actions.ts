"use server";

import { assertAdmin } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { fieldErrorsFromZod } from "@/lib/validations/auth";
import {
  FINE_MESSAGES,
  recordPaymentSchema,
  waiveFineSchema,
  type FineActionResult,
  type RecordFinePaymentResult,
  type WaiveFineResult,
} from "@/lib/validations/fine";
import { revalidateFinePaths, settleFinePayment } from "@/lib/admin/fine-shared";

/**
 * ============================================================================
 *  Admin fine actions — record payment / waive (Phase 5, rules.md §5–§7)
 * ============================================================================
 *
 * Every action follows lib/admin/loan-actions.ts + request-actions.ts:
 *   1. `assertAdmin()` FIRST (session → profiles.role → redirect when not
 *      ADMIN; §9 matrix: "Settle / waive fines" is ADMIN-only, R-31/E10),
 *   2. re-validates input with Zod (client values are never trusted, R-31 —
 *      and note the payload carries **no amount**: money is SQL-computed and
 *      re-read from the row, R-29/R-31),
 *   3. pre-checks the §10 fine state machine (UNPAID → PAID | WAIVED) so the
 *      user gets a specific message before any write, then performs the
 *      **conditional UPDATE `WHERE status = 'UNPAID'`** via the shared
 *      `settleFinePayment()` helper — exactly one admin wins a race (E6),
 *   4. writes through the cookie-aware anon client (RLS: "admin manages
 *      fines" gives full CRUD on `fines`, schema.md §4) and appends the
 *      `audit_logs` row through the service client (R-32 — no client INSERT
 *      policy on `audit_logs`), then
 *   5. revalidates the penalties / damages queues and student dashboards.
 *
 * ⛔  NO amount editing (R-29: centavos in via SQL only) and NO fine deletion
 *     (R-28: the system records, it does not collect — settled rows are
 *     history). There is intentionally no `editFine` / `deleteFine` action.
 */

/* ------------------------------------------------------------------ */
/* Record payment (R-28, FR-19)                                         */
/* ------------------------------------------------------------------ */

/**
 * Record cash / replacement received for one UNPAID fine (§10: UNPAID →
 * PAID). `method` is what settled it: `CASH` (money at the desk) or
 * `REPLACEMENT` (a replacement copy was handed over — R-22).
 *
 * Pre-checks (deterministic messages before the shared write):
 *   - fine missing            → 'Fine not found.'
 *   - already PAID / WAIVED   → 'This fine has already been settled.' (E6:
 *                                the conditional UPDATE re-checks it, so a
 *                                concurrent admin loses with the same string)
 *
 * The amount is **not** part of the payload and is re-read from the row for
 * the response (R-29 — `formatPeso()` in the UI). Success writes the
 * `FINE_PAY` audit row (R-32) and revalidates the queues.
 */
export async function recordFinePayment(
  input: unknown,
): Promise<FineActionResult<RecordFinePaymentResult>> {
  const { adminId } = await assertAdmin();

  const parsed = recordPaymentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsFromZod(parsed.error) };
  }
  const { fineId, method } = parsed.data;

  const supabase = await createClient();
  const outcome = await settleFinePayment(
    supabase,
    { fineId },
    { kind: "PAY", method },
    adminId,
  );

  if (!outcome.ok) {
    return {
      ok: false,
      error:
        outcome.code === "not_found"
          ? FINE_MESSAGES.fineNotFound
          : FINE_MESSAGES.paymentFailed,
    };
  }
  if (!outcome.result.wasUnpaid) {
    // E6: someone (or a previous attempt) already settled it.
    return { ok: false, error: FINE_MESSAGES.alreadySettled };
  }

  revalidateFinePaths();
  return {
    ok: true,
    data: {
      fineId: outcome.result.fineId,
      status: "PAID",
      paidMethod: method,
      amountCentavos: outcome.result.amountCentavos,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Waive (R-24 / FR-19)                                                 */
/* ------------------------------------------------------------------ */

/**
 * Waive one UNPAID fine (§10: UNPAID → WAIVED). The written `reason` is
 * **mandatory** (R-24 — Zod rejects a missing/short reason with fieldErrors,
 * and the DB `waiver_needs_reason` check backstops it at row level).
 *
 * Pre-checks mirror `recordFinePayment`: missing → 'Fine not found.',
 * already settled → 'This fine has already been settled.' The conditional
 * `WHERE status = 'UNPAID'` UPDATE + `FINE_WAIVE` audit (R-32) run inside
 * the shared `settleFinePayment()` helper.
 *
 * ⛔  A waiver NEVER touches `amount_centavos` — the row keeps its original
 *     amount as history (R-29); it simply stops counting toward the balance
 *     because `student_balances` sums `status = 'UNPAID'` only (R-27).
 */
export async function waiveFine(
  input: unknown,
): Promise<FineActionResult<WaiveFineResult>> {
  const { adminId } = await assertAdmin();

  const parsed = waiveFineSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsFromZod(parsed.error) };
  }
  const { fineId, reason } = parsed.data;

  const supabase = await createClient();
  const outcome = await settleFinePayment(
    supabase,
    { fineId },
    { kind: "WAIVE", reason },
    adminId,
  );

  if (!outcome.ok) {
    return {
      ok: false,
      error:
        outcome.code === "not_found"
          ? FINE_MESSAGES.fineNotFound
          : FINE_MESSAGES.waiveFailed,
    };
  }
  if (!outcome.result.wasUnpaid) {
    return { ok: false, error: FINE_MESSAGES.alreadySettled };
  }

  revalidateFinePaths();
  return {
    ok: true,
    data: { fineId: outcome.result.fineId, status: "WAIVED" },
  };
}
