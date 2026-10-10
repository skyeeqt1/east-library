import { z } from "zod";

/**
 * ============================================================================
 *  Loan lifecycle validation & shared types (Phase 4 — rules.md §5, FR-14..FR-16)
 * ============================================================================
 *
 * Shapes:
 *   releaseLoanSchema — admin hands a specific physical copy to the student
 *                       (R-14: release creates the loan and starts the clock).
 *   returnLoanSchema  — admin marks a loan returned, with the condition the
 *                       copy came back in (R-20: SQL finalizes the fine).
 *
 * Both server actions parse `unknown` with these schemas before touching the
 * database — client values are never trusted (R-31), mirroring
 * lib/validations/request.ts / lib/validations/book.ts.
 *
 * Money never appears in a write schema: amounts are computed exclusively in
 * SQL (R-18/R-20) and always carried as integer centavos (R-29) — the UI
 * formats them with `formatPeso()` from lib/utils.ts.
 *
 * This module is deliberately free of `server-only` / "use server" markers so
 * server actions, server components **and** client form code can import the
 * schemas, result types and error strings.
 */

/* ------------------------------------------------------------------ */
/* Schemas                                                             */
/* ------------------------------------------------------------------ */

/**
 * Release an APPROVED request against one specific AVAILABLE copy (R-14).
 * `requestId` is the approved `loan_requests.id`; `copyId` is the physical
 * `book_copies.id` the admin is handing over.
 */
export const releaseLoanSchema = z.object({
  requestId: z.string().uuid(),
  copyId: z.string().uuid(),
});

/**
 * Record a desk return (FR-15, R-20). `condition` is what the copy looks like
 * in the admin's hand: GOOD flips it back to AVAILABLE, DAMAGED pulls it from
 * circulation (R-07 / R-23 — the DAMAGE fine itself is Phase 5's
 * `assess_damage`).
 */
export const returnLoanSchema = z.object({
  loanId: z.string().uuid(),
  condition: z.enum(["GOOD", "DAMAGED"]),
});

/**
 * Mark an open loan's book as LOST (user request, FR-18 extension): closes
 * the loan with condition LOST, flags the copy LOST and charges a LOST fine
 * at the book's replacement value — all inside `mark_loan_lost()` in SQL
 * (migration 0010). Admin-only, amount never accepted from the client (R-29).
 */
export const markLostSchema = z.object({
  loanId: z.string().uuid(),
});

/** Parsed (DB-ready) release payload. */
export type ReleaseLoanInput = z.infer<typeof releaseLoanSchema>;
/** Parsed (DB-ready) return payload. */
export type ReturnLoanInput = z.infer<typeof returnLoanSchema>;
/** Parsed (DB-ready) mark-lost payload. */
export type MarkLostInput = z.infer<typeof markLostSchema>;

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

/** `loans.status` values — schema.md §2.5 / rules.md §10. */
export const LOAN_STATUSES = ["ACTIVE", "OVERDUE", "RETURNED"] as const;

export type LoanStatus = (typeof LOAN_STATUSES)[number];

/** Type guard for a `loans.status` string. */
export function isLoanStatus(value: string): value is LoanStatus {
  return (LOAN_STATUSES as readonly string[]).includes(value);
}

/** `condition_on_return` / `record_return.p_condition` values (R-20, R-23). */
export const LOAN_CONDITIONS = ["GOOD", "DAMAGED"] as const;

export type LoanCondition = (typeof LOAN_CONDITIONS)[number];

/**
 * Result shape returned by every Phase 4 server action — the same union
 * pattern as `RequestActionResult` (lib/validations/request.ts):
 *   success → `{ ok: true, data }`
 *   failure → `{ ok: false, error?, fieldErrors? }`
 */
export type LoanActionResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error?: string; fieldErrors?: Record<string, string> };

/** `data` returned by a successful `releaseLoan` — the new loan's id. */
export interface ReleaseLoanResult {
  loanId: string;
}

/**
 * `data` returned by a successful `returnLoan`.
 *
 * - `daysLate`     — exact-day count finalized by SQL (0 for an on-time
 *                    return, E2); taken from the OVERDUE fine when one exists
 *                    so TS never disagrees with R-20.
 * - `fineAmount`   — OVERDUE fine in **integer centavos** (R-29) — 0 on time.
 * - `fineCreated`  — true when an OVERDUE fine row exists for this loan after
 *                    the call (created by `record_return`, or already upserted
 *                    by the daily sweep — both are the same idempotent row,
 *                    R-18/E7). Signals the UI to surface the penalty.
 */
export interface ReturnLoanResult {
  loanId: string;
  daysLate: number;
  fineAmount: number;
  fineCreated: boolean;
}

/**
 * `data` returned by a successful `markLoanLost` — the closed loan's id plus
 * the LOST fine in **integer centavos** (R-29), read back from SQL after the
 * write (TS never computes the amount, R-14/R-29).
 */
export interface MarkLostResult {
  loanId: string;
  fineAmount: number;
}

/**
 * One APPROVED request ready for the Release modal: the book being handed
 * over plus every AVAILABLE copy of it, so the admin can pick which physical
 * copy leaves the desk (R-07 — availability is per copy).
 *
 * `status` is included so the modal can gate itself (PENDING → "Approve the
 * request first." instead of a copy picker).
 */
export interface ReleaseCandidates {
  requestId: string;
  status: string;
  bookId: string;
  title: string;
  author: string;
  copies: Array<{ id: string; barcode: string | null }>;
}

/* ------------------------------------------------------------------ */
/* User-facing messages (exact strings used by the server actions)     */
/* ------------------------------------------------------------------ */

/**
 * Exact error strings surfaced by lib/admin/loan-actions.ts. Kept here so the
 * UI task can reference them without importing a "use server" module.
 */
export const LOAN_MESSAGES = {
  /** Request id not in the table (bad id / already gone). */
  requestNotFound: "Request not found.",
  /** `loan_requests.status = 'PENDING'` — approve is still owed first (R-12). */
  needsApproval: "Approve the request first.",
  /** APPROVED request that already produced a loan (R-15 / E6, one decision). */
  alreadyReleased: "This request has already been released.",
  /** `status = 'DECLINED'`. */
  wasDeclined: "This request was declined.",
  /** `status = 'CANCELLED'` (withdrawn by the student while PENDING). */
  wasCancelled: "This request was cancelled by the student.",
  /** `status = 'EXPIRED'` (R-16 cron). */
  wasExpired: "This request has expired.",
  /** Any other non-APPROVED status. */
  notApproved: "This request has not been approved yet.",
  /**
   * Chosen copy missing / of another book / not AVAILABLE — the exact
   * R-13/E1 string also raised by `release_loan()` in SQL (byte-identical,
   * em dash U+2014).
   */
  noCopies: "No copies available — request cannot be approved.",
  /** Return: loan id not in the table. */
  loanNotFound: "Loan not found.",
  /** Return: `returned_at` already set (E6 — second admin loses). */
  alreadyReturned: "This loan is already returned.",
  /** Read/pre-check failed before any write. */
  loadRequestFailed: "Could not load the request. Please try again.",
  loadLoanFailed: "Could not load the loan. Please try again.",
  /** RPC failed for an unexpected reason (mapped SQL text wins when present). */
  releaseFailed: "Could not release the loan. Please try again.",
  returnFailed: "Could not record the return. Please try again.",
  markLostFailed: "Could not mark the book as lost. Please try again.",
  /** Mark lost: the book has no `replacement_value_centavos` (SQL guard). */
  noReplacementValue: "This book has no replacement value set.",
} as const;
