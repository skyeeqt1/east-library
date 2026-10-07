"use server";

import { revalidatePath } from "next/cache";
import { createClient, getServiceClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/guards";
import { fieldErrorsFromZod } from "@/lib/validations/auth";
import {
  createRequestSchema,
  type RequestActionResult,
} from "@/lib/validations/request";
import { getRequestEligibility } from "@/lib/catalog/requests-read";

/**
 * ============================================================================
 *  Student borrow-request mutations (Phase 3 — rules.md §4 / §9, FR-09…FR-13)
 * ============================================================================
 *
 * Every action follows the lib/auth/admin-actions.ts +
 * lib/admin/book-actions.ts pattern:
 *   1. session + role guard FIRST (`getCurrentProfile()` → must be STUDENT —
 *      §9 matrix: "Submit/cancel own pending request" is STUDENT, own only),
 *   2. re-validates input with Zod (R-31 — client values are never trusted),
 *   3. re-verifies business rules server-side (R-09/R-25 eligibility inside
 *      `submitBookRequest` — defense in depth; RLS is the second net),
 *   4. writes through the **cookie-aware anon client** so RLS applies
 *      (schema.md §4: students INSERT own rows, UPDATE own PENDING →
 *      CANCELLED only — a student can neither touch another account's
 *      requests nor decide their own),
 *   5. appends an `audit_logs` row (R-32) via the **service-role client**
 *      (`audit_logs` has no client INSERT policy), actor = the student id,
 *      and
 *   6. revalidates the catalog, "My Requests" and the admin queue.
 *
 * Phase 3 stops at the request state machine (rules.md §10): approval is a
 * separate admin action — loans are created in Phase 4 (R-14, release).
 */

/** Routes whose cached data depends on request writes. */
const REQUEST_PATHS = [
  "/dashboard/catalog",
  "/dashboard/requests",
  "/admin/requests",
] as const;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

function revalidateRequestPaths(): void {
  for (const path of REQUEST_PATHS) revalidatePath(path);
}

/**
 * Best-effort audit trail — never fails an already-committed mutation (R-32).
 * Uses the service-role client: `audit_logs` is append-only and intentionally
 * has no client-side INSERT policy (schema.md §4).
 */
async function writeAudit(
  actorId: string,
  action: string,
  entityId: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): Promise<void> {
  try {
    const service = getServiceClient();
    await service.from("audit_logs").insert({
      actor_id: actorId,
      action,
      entity_type: "loan_request",
      entity_id: entityId,
      before,
      after,
    });
  } catch {
    // Missing env / network — the mutation itself already succeeded.
  }
}

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

/**
 * Submit a borrow request — status defaults to PENDING and `expires_at` to
 * `now() + 3 days` in the database (schema.md §2.4; R-11: every borrow
 * begins as a request, never an automatic loan).
 *
 * Guards, in order:
 *   - not signed in / not a STUDENT        → 'Not authorized.'   (§9 matrix)
 *   - Zod failure                          → fieldErrors
 *   - R-09 / R-25 eligibility              → the exact spec reason
 *     (balance → 'Settle pending balance…', duplicate → 'Already requested.',
 *      caps → '… limit reached.', no stock → 'No copies available.', …)
 *   - unique partial index `uq_request_pending` race (R-10, error 23505)
 *     → 'Already requested.'
 *
 * Returns the new request id so the UI can navigate to "My Requests".
 */
export async function submitBookRequest(
  input: unknown,
): Promise<RequestActionResult<{ id: string }>> {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "STUDENT") {
    return { ok: false, error: "Not authorized." };
  }

  const parsed = createRequestSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsFromZod(parsed.error) };
  }
  const { bookId } = parsed.data;

  // R-09 / R-25 — server-side re-verification before the INSERT.
  const eligibility = await getRequestEligibility(profile.id, bookId);
  if (!eligibility.eligible) {
    return { ok: false, error: eligibility.reason ?? "You cannot request this book." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("loan_requests")
    .insert({ student_id: profile.id, book_id: bookId })
    .select("id")
    .single();

  if (error || !data) {
    // R-10 / E9 — the partial unique index beat us to it.
    if (error?.code === "23505") {
      return { ok: false, error: "Already requested." };
    }
    return { ok: false, error: "Could not submit your request. Please try again." };
  }

  await writeAudit(profile.id, "REQUEST_SUBMIT", data.id, null, {
    book_id: bookId,
    status: "PENDING",
  });

  revalidateRequestPaths();
  return { ok: true, data: { id: data.id } };
}

/**
 * Withdraw the student's own request while it is still PENDING (FR-13,
 * R-12 CANCELLED, §9 "own only").
 *
 * The write is a single conditional UPDATE
 * (`id = ? AND student_id = auth.uid() AND status = 'PENDING' → CANCELLED`)
 * — RLS mirrors the same predicate (schema.md §4), so ownership and state
 * are enforced atomically: 0 rows affected means it can no longer be
 * cancelled (already decided / expired / never existed).
 */
export async function cancelOwnRequest(
  requestId: string,
): Promise<RequestActionResult<{ id: string }>> {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "STUDENT") {
    return { ok: false, error: "Not authorized." };
  }
  if (!isUuid(requestId)) {
    return { ok: false, error: "Request not found." };
  }

  const supabase = await createClient();

  // Snapshot for the audit row + a friendly ownership/state pre-check.
  const { data: before, error: lookupError } = await supabase
    .from("loan_requests")
    .select("id, student_id, book_id, status")
    .eq("id", requestId)
    .maybeSingle();
  if (lookupError) {
    return { ok: false, error: "Could not load the request. Please try again." };
  }
  if (
    !before ||
    before.student_id !== profile.id ||
    before.status !== "PENDING"
  ) {
    // R-12: only a PENDING request owned by this student may be cancelled.
    return { ok: false, error: "This request can no longer be cancelled." };
  }

  const { data: updated, error: updateError } = await supabase
    .from("loan_requests")
    .update({ status: "CANCELLED" })
    .eq("id", requestId)
    .eq("student_id", profile.id)
    .eq("status", "PENDING")
    .select("id")
    .maybeSingle();
  if (updateError) {
    return { ok: false, error: "Could not cancel the request. Please try again." };
  }
  if (!updated) {
    // Decided/cancelled between our read and the write (E6-style race).
    return { ok: false, error: "This request can no longer be cancelled." };
  }

  await writeAudit(profile.id, "REQUEST_CANCEL", requestId, {
    status: "PENDING",
    book_id: before.book_id,
  }, {
    status: "CANCELLED",
    book_id: before.book_id,
  });

  revalidateRequestPaths();
  return { ok: true, data: { id: requestId } };
}
