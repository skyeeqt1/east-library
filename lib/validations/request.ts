import { z } from "zod";

/**
 * ============================================================================
 *  Borrow request validation & shared types (Phase 3 — rules.md §4, FR-09…FR-13)
 * ============================================================================
 *
 * Shapes:
 *   createRequestSchema  — student submits a request for one catalog title
 *                          (R-11: every borrow starts as a PENDING request).
 *   declineRequestSchema — admin declines with an optional written reason
 *                          (FR-12 / R-12: "optional decline_reason stored").
 *
 * Both server actions parse `unknown` with these schemas before touching the
 * database — client values are never trusted (R-31), mirroring
 * lib/validations/book.ts / lib/validations/auth.ts.
 *
 * This module is deliberately free of `server-only` / "use server" markers so
 * server actions, server components **and** client form code can import the
 * schemas and result types.
 */

/* ------------------------------------------------------------------ */
/* Schemas                                                             */
/* ------------------------------------------------------------------ */

/** Submit a borrow request for a catalog title (FR-09, US-2). */
export const createRequestSchema = z.object({
  bookId: z.string().uuid(),
});

/**
 * Decline a PENDING request (FR-12). The reason is optional — an empty string
 * from the form is accepted and stored as `NULL` (schema.md §2.4).
 */
export const declineRequestSchema = z.object({
  requestId: z.string().uuid(),
  reason: z
    .string()
    .trim()
    .max(300, "Reason must be 300 characters or fewer.")
    .optional()
    .or(z.literal("")),
});

/** Parsed (DB-ready) submit payload. */
export type CreateRequestInput = z.infer<typeof createRequestSchema>;
/** Parsed (DB-ready) decline payload. */
export type DeclineRequestInput = z.infer<typeof declineRequestSchema>;

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

/** `loan_requests.status` values — schema.md §2.4 / rules.md R-12. */
export const REQUEST_STATUSES = [
  "PENDING",
  "APPROVED",
  "DECLINED",
  "CANCELLED",
  "EXPIRED",
] as const;

export type RequestStatus = (typeof REQUEST_STATUSES)[number];

/** Type guard for a `loan_requests.status` string. */
export function isRequestStatus(value: string): value is RequestStatus {
  return (REQUEST_STATUSES as readonly string[]).includes(value);
}

/**
 * Result shape returned by every Phase 3 server action — the same union
 * pattern as `BookActionResult` (lib/admin/book-actions.ts):
 *   success → `{ ok: true, data }`
 *   failure → `{ ok: false, error?, fieldErrors? }`
 */
export type RequestActionResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error?: string; fieldErrors?: Record<string, string> };
