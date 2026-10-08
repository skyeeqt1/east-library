"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { assertAdmin } from "@/lib/auth/guards";
import { fieldErrorsFromZod } from "@/lib/validations/auth";
import { daysSince } from "@/lib/catalog/loans-read";
import {
  LOAN_MESSAGES,
  releaseLoanSchema,
  returnLoanSchema,
  type LoanActionResult,
  type ReleaseCandidates,
  type ReleaseLoanResult,
  type ReturnLoanResult,
} from "@/lib/validations/loan";
import type { RequestStatus } from "@/lib/validations/request";

/**
 * ============================================================================
 *  Admin loan actions — release / return (Phase 4, rules.md §5, FR-14..FR-16)
 * ============================================================================
 *
 * Every action follows lib/admin/request-actions.ts:
 *   1. `assertAdmin()` FIRST (session → profiles.role → redirect when not
 *      ADMIN; §9 matrix: "Approve / decline / release" and "Mark return" are
 *      ADMIN-only, R-31 / E10),
 *   2. re-validates input with Zod (client values are never trusted, R-31),
 *   3. pre-checks the state machine (§10) so the user gets a *specific*
 *      message before any database write,
 *   4. calls the **existing SQL function** via `supabase.rpc(...)` —
 *      `release_loan(p_request_id, p_copy_id)` / `record_return(p_loan_id,
 *      p_condition)` are the single source of truth: atomicity, the due date
 *      (R-14/R-17: `current_date + 7`, never computed here), the copy flip
 *      (R-07), fine finalization (R-18/R-20 exact-day upsert, R-21 unique per
 *      loan+type) and the audit row (R-32) all live in SQL (R-31). The calls
 *      go through the **cookie-aware anon client**, so `auth.uid()` is the
 *      signed-in admin and the functions' own `is_admin()` gate applies —
 *      no service-role bypass anywhere in this file,
 *   5. maps SQL exceptions to `{ ok:false, error }` by extracting the
 *      `RAISE EXCEPTION` text (PostgREST prefixes the SQLSTATE, e.g.
 *      `P0001: admin only`), and
 *   6. revalidates the admin queue / loans tables and the student dashboards.
 *
 * ⛔  NO `renewLoan` — v1 loans are not renewable (R-17, `allow_renewals =
 *     false`). No TS-side due-date or fine computation for writes (R-14/R-20):
 *     `daysSince()` below only *reports* figures after SQL already wrote them.
 */

/** Routes whose cached data depends on loan writes (admin + student, §9). */
const LOAN_PATHS = [
  "/admin/requests",
  "/admin/loans",
  "/dashboard/loans",
  "/dashboard",
] as const;

function revalidateLoanPaths(): void {
  for (const path of LOAN_PATHS) revalidatePath(path);
}

/**
 * Extract the user-facing text from a PostgREST/Supabase RPC error.
 *
 * Shapes seen in the wild (verified in the Phase 4 smoke test):
 *   - `P0001: Request not found or not approved.`  → RAISE EXCEPTION text
 *   - `Error: P0001: admin only`                   → supabase-js wrapper
 *   - `permission denied for function release_loan` (42501, no prefix)
 * The SQLSTATE (`XXXXX: `) and any `Error: ` wrapper are stripped so the UI
 * shows exactly what `RAISE EXCEPTION` said; anything unmappable falls back
 * to `fallback`.
 */
function extractSqlErrorMessage(
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
/* Release (R-14 / R-17, §10: APPROVED → loan)                          */
/* ------------------------------------------------------------------ */

/**
 * Hand an approved request over to the student: flips exactly one AVAILABLE
 * copy to ON_LOAN, creates the loan with `due_date = current_date + 7`
 * (computed **in SQL**, R-14/R-17) and links the request — all inside the
 * live `release_loan()` function (atomic, audited, admin-gated).
 *
 * Pre-checks (deterministic messages before the RPC):
 *   - request missing                        → 'Request not found.'
 *   - status PENDING                         → 'Approve the request first.'
 *   - status DECLINED / CANCELLED / EXPIRED  → the matching string below
 *   - status APPROVED but `loan_id` set      → 'This request has already been
 *                                               released.' (R-15 / E6: one
 *                                               decision, one release)
 *   - copy missing / other book / not AVAILABLE
 *                                            → 'No copies available — request
 *                                               cannot be approved.' (the exact
 *                                               R-13/E1 string `release_loan`
 *                                               itself raises)
 *
 * On success the audit row was already written by SQL (R-32) — nothing is
 * double-logged here. Returns `{ ok:true, data:{ loanId } }`.
 */
export async function releaseLoan(
  input: unknown,
): Promise<LoanActionResult<ReleaseLoanResult>> {
  await assertAdmin();

  const parsed = releaseLoanSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsFromZod(parsed.error) };
  }
  const { requestId, copyId } = parsed.data;

  const supabase = await createClient();

  /* ---- pre-check the request state machine (§10) ------------------ */
  const { data: request, error: lookupError } = await supabase
    .from("loan_requests")
    .select("id, status, book_id, loan_id")
    .eq("id", requestId)
    .maybeSingle();
  if (lookupError) {
    return { ok: false, error: LOAN_MESSAGES.loadRequestFailed };
  }
  if (!request) return { ok: false, error: LOAN_MESSAGES.requestNotFound };

  if (request.status !== "APPROVED") {
    switch (request.status) {
      case "PENDING":
        return { ok: false, error: LOAN_MESSAGES.needsApproval };
      case "DECLINED":
        return { ok: false, error: LOAN_MESSAGES.wasDeclined };
      case "CANCELLED":
        return { ok: false, error: LOAN_MESSAGES.wasCancelled };
      case "EXPIRED":
        return { ok: false, error: LOAN_MESSAGES.wasExpired };
      default:
        return { ok: false, error: LOAN_MESSAGES.notApproved };
    }
  }
  if (request.loan_id) {
    // R-15 / E6: an APPROVED request links to at most one loan.
    return { ok: false, error: LOAN_MESSAGES.alreadyReleased };
  }

  /* ---- pre-check the physical copy (R-07 / R-13 / E1) ------------- */
  const { data: copy, error: copyError } = await supabase
    .from("book_copies")
    .select("id, book_id, status")
    .eq("id", copyId)
    .maybeSingle();
  if (copyError) {
    return { ok: false, error: LOAN_MESSAGES.loadRequestFailed };
  }
  if (
    !copy ||
    copy.book_id !== request.book_id ||
    copy.status !== "AVAILABLE"
  ) {
    // Wrong book's copy, already out, damaged or gone — the RPC would raise
    // the same R-13/E1 string, so the pre-check just gets there first.
    return { ok: false, error: LOAN_MESSAGES.noCopies };
  }

  /* ---- the single source of truth: release_loan() in SQL ---------- */
  const { data: loanId, error: rpcError } = await supabase.rpc(
    "release_loan",
    { p_request_id: requestId, p_copy_id: copyId },
  );
  if (rpcError || !loanId) {
    return {
      ok: false,
      error: extractSqlErrorMessage(rpcError, LOAN_MESSAGES.releaseFailed),
    };
  }

  // Audit: written by release_loan() itself (R-32) — do NOT write again.
  revalidateLoanPaths();
  return { ok: true, data: { loanId: String(loanId) } };
}

/* ------------------------------------------------------------------ */
/* Return (R-20 / R-18 / E2, §10: → RETURNED)                           */
/* ------------------------------------------------------------------ */

/**
 * Record a desk return: `record_return(p_loan_id, p_condition)` closes the
 * loan (`RETURNED` + `returned_at` + condition), flips the copy
 * (GOOD → AVAILABLE, else DAMAGED — R-07/R-23) and, when `due_date` has
 * passed, **finalizes the exact-day OVERDUE fine** via the same idempotent
 * upsert as the daily sweep (R-18/R-20/R-21, E7). A DAMAGED condition does
 * NOT create the DAMAGE fine — that is Phase 5's `assess_damage()` (R-22/R-23);
 * this action only reports the copy state change.
 *
 * Pre-checks:
 *   - loan missing        → 'Loan not found.'
 *   - `returned_at` set   → 'This loan is already returned.' (E6: the second
 *                            admin loses cleanly; SQL raises the same guard
 *                            with row lock as the race backstop)
 *
 * Success data:
 *   - `daysLate`    — exact-day count (0 on time, E2) taken from the OVERDUE
 *                     fine when present so it always matches R-20;
 *   - `fineAmount`  — the OVERDUE fine in integer centavos (R-29 — format
 *                     with `formatPeso()` in the UI), 0 on time;
 *   - `fineCreated` — an OVERDUE fine row now exists for this loan (written
 *                     by `record_return`, or already upserted by today's
 *                     sweep — same idempotent row, R-21/E7).
 */
export async function returnLoan(
  input: unknown,
): Promise<LoanActionResult<ReturnLoanResult>> {
  await assertAdmin();

  const parsed = returnLoanSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsFromZod(parsed.error) };
  }
  const { loanId, condition } = parsed.data;

  const supabase = await createClient();

  /* ---- pre-check the loan (E6: already returned loses cleanly) ----- */
  const { data: loan, error: lookupError } = await supabase
    .from("loans")
    .select("id, returned_at, due_date, status")
    .eq("id", loanId)
    .maybeSingle();
  if (lookupError) {
    return { ok: false, error: LOAN_MESSAGES.loadLoanFailed };
  }
  if (!loan) return { ok: false, error: LOAN_MESSAGES.loanNotFound };
  if (loan.returned_at) {
    return { ok: false, error: LOAN_MESSAGES.alreadyReturned };
  }

  /* ---- the single source of truth: record_return() in SQL ---------- */
  const { data: returnedId, error: rpcError } = await supabase.rpc(
    "record_return",
    { p_loan_id: loanId, p_condition: condition },
  );
  if (rpcError || !returnedId) {
    return {
      ok: false,
      error: extractSqlErrorMessage(rpcError, LOAN_MESSAGES.returnFailed),
    };
  }

  /* ---- report what SQL finalized (display only — R-18/R-20) -------- */
  const { data: fine } = await supabase
    .from("fines")
    .select("amount_centavos, days_late, status, created_at")
    .eq("loan_id", loanId)
    .eq("type", "OVERDUE")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const computedLate = daysSince(loan.due_date);
  const daysLate =
    fine && fine.days_late !== null && fine.days_late !== undefined
      ? Number(fine.days_late)
      : computedLate > 0
        ? computedLate
        : 0;

  revalidateLoanPaths();
  return {
    ok: true,
    data: {
      loanId,
      daysLate,
      fineAmount: fine ? Number(fine.amount_centavos ?? 0) : 0,
      fineCreated: Boolean(fine),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Release modal data                                                   */
/* ------------------------------------------------------------------ */

/**
 * Everything the Release modal needs for one request (server helper, not a
 * state change): the APPROVED request's book (title/author) plus every
 * AVAILABLE copy of that book (`id` + `barcode`) so the admin picks which
 * physical copy is handed over (R-07 — availability is per copy).
 *
 * Returns `null` when the id is not a UUID or the request no longer exists —
 * the modal renders "Request not found." The request's `status` is included
 * so a PENDING request shows 'Approve the request first.' instead of a copy
 * picker (R-12/R-14: approval precedes release). `assertAdmin()` gates it
 * (§9 matrix: release is ADMIN-only).
 */
export async function getReleaseCandidates(
  requestId: string,
): Promise<ReleaseCandidates | null> {
  await assertAdmin();

  const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_PATTERN.test(requestId)) return null;

  const supabase = await createClient();

  const { data: request, error } = await supabase
    .from("loan_requests")
    .select(
      "id, status, book_id, book:books(title, author)",
    )
    .eq("id", requestId)
    .maybeSingle();
  if (error) return null;
  if (!request) return null;

  interface JoinedRequest {
    id: string;
    status: string;
    book_id: string;
    book: { title: string; author: string } | { title: string; author: string }[] | null;
  }
  const joined = request as unknown as JoinedRequest;
  const book = Array.isArray(joined.book) ? joined.book[0] : joined.book;

  const { data: copies, error: copiesError } = await supabase
    .from("book_copies")
    .select("id, barcode")
    .eq("book_id", joined.book_id)
    .eq("status", "AVAILABLE")
    .order("barcode", { ascending: true, nullsFirst: false });
  if (copiesError) return null;

  return {
    requestId: joined.id,
    status: joined.status as RequestStatus,
    bookId: joined.book_id,
    title: book?.title ?? "",
    author: book?.author ?? "",
    copies: (copies ?? []).map((copy) => ({
      id: (copy as { id: string }).id,
      barcode: (copy as { barcode: string | null }).barcode ?? null,
    })),
  };
}
