"use server";

import { revalidatePath } from "next/cache";
import { createClient, getServiceClient } from "@/lib/supabase/server";
import { assertAdmin } from "@/lib/auth/guards";
import { fieldErrorsFromZod } from "@/lib/validations/auth";
import {
  declineRequestSchema,
  type RequestActionResult,
} from "@/lib/validations/request";

/**
 * ============================================================================
 *  Admin request decisions — approve / decline (Phase 3, rules.md §4)
 * ============================================================================
 *
 * Every action follows lib/auth/admin-actions.ts + lib/admin/book-actions.ts:
 *   1. `assertAdmin()` FIRST (session → profiles.role → redirect when not
 *      ADMIN; §9 matrix: "Approve / decline" is ADMIN-only, R-31/E10),
 *   2. re-validates input with Zod where a payload exists,
 *   3. enforces the state machine (§10: PENDING → APPROVED | DECLINED) with a
 *      **conditional UPDATE ... WHERE status = 'PENDING'** so exactly one
 *      admin wins (R-15 / E6 — first write wins, loser sees "already
 *      decided"), re-checks availability at the moment of approval
 *      (R-13 / E1 / US-3),
 *   4. writes through the cookie-aware anon client (RLS: admin full CRUD on
 *      `loan_requests`, schema.md §4), and
 *   5. appends an `audit_logs` row via the **service-role client** (R-32 —
 *      `audit_logs` has no client INSERT policy) and revalidates the queue
 *      + the student's "My Requests" page.
 *
 * ⚠️  PHASE 3 STOPS AT `status = 'APPROVED'` (decided_at / decided_by set).
 *     Approval does NOT create a loan, does NOT flip a copy to ON_LOAN and
 *     does NOT link `loan_id` — that is the Release step (R-14), Phase 4.
 *     `release_loan()` in Supabase remains the only loan-creating code path
 *     (R-11: no request ever becomes a loan without an admin release).
 *
 * ⚠️  R-16 expiry (PENDING > 3 days → EXPIRED) is handled by the daily
 *     `run_overdue_sweep()` cron job in Supabase — no duplicate helper is
 *     exposed here (see Phase 3 report).
 */

/** Admin queue + the student's own request list both show decisions. */
const REQUEST_PATHS = ["/admin/requests", "/dashboard/requests"] as const;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

function revalidateRequestPaths(): void {
  for (const path of REQUEST_PATHS) revalidatePath(path);
}

/** Best-effort audit trail — never fails an already-committed mutation (R-32). */
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
 * Approve a PENDING request (FR-11, US-3, R-12/R-13/R-15).
 *
 * Order of checks:
 *   1. `assertAdmin()`                                            (§9 matrix)
 *   2. request exists, `status = 'PENDING'` else
 *      'This request has already been decided.'                   (R-15 / E6)
 *   3. **availability re-check right now** via `book_availability`:
 *      `available_copies > 0` (view quirk-safe: a 0-copy title reports 0, so
 *      the JS `> 0` test is correct) else
 *      'No copies available — request cannot be approved.'        (R-13 / E1)
 *      → the request STAYS PENDING (US-3 acceptance)
 *   4. conditional UPDATE `WHERE status = 'PENDING'` setting
 *      `status = 'APPROVED'`, `decided_at = now()`, `decided_by = admin`;
 *      0 rows affected → another admin decided first → same
 *      'already decided' error (R-15 / E6 atomic, first write wins)
 *
 * Phase 3 deliberately stops here: no `loans` row, no copy flip (R-14 /
 * Phase 4 Release does that).
 */
export async function approveRequest(
  requestId: string,
): Promise<RequestActionResult<{ id: string }>> {
  const { adminId } = await assertAdmin();
  if (!isUuid(requestId)) return { ok: false, error: "Request not found." };

  const supabase = await createClient();

  const { data: request, error: lookupError } = await supabase
    .from("loan_requests")
    .select("id, student_id, book_id, status")
    .eq("id", requestId)
    .maybeSingle();
  if (lookupError) {
    return { ok: false, error: "Could not load the request. Please try again." };
  }
  if (!request) return { ok: false, error: "Request not found." };
  if (request.status !== "PENDING") {
    // R-15 / E6 — each request is decided exactly once.
    return { ok: false, error: "This request has already been decided." };
  }

  // R-13 / E1 / US-3 — re-verify availability at the MOMENT of approval.
  const { data: availability, error: availabilityError } = await supabase
    .from("book_availability")
    .select("available_copies")
    .eq("book_id", request.book_id)
    .maybeSingle();
  if (availabilityError) {
    return { ok: false, error: "Could not verify availability. Please try again." };
  }
  const available = Number(
    (availability as { available_copies: number } | null)?.available_copies ?? 0,
  );
  if (!(available > 0)) {
    // Request remains PENDING (US-3) — nothing was written above.
    return { ok: false, error: "No copies available — request cannot be approved." };
  }

  // R-15 / E6 — single-decision rule enforced atomically: only a row that is
  // still PENDING may flip, so a concurrent admin's identical UPDATE loses.
  const { data: decided, error: updateError } = await supabase
    .from("loan_requests")
    .update({
      status: "APPROVED",
      decided_at: new Date().toISOString(),
      decided_by: adminId,
    })
    .eq("id", requestId)
    .eq("status", "PENDING")
    .select("id")
    .maybeSingle();
  if (updateError) {
    return { ok: false, error: "Could not approve the request. Please try again." };
  }
  if (!decided) {
    return { ok: false, error: "This request has already been decided." };
  }

  await writeAudit(adminId, "REQUEST_APPROVE", requestId, {
    status: "PENDING",
    student_id: request.student_id,
    book_id: request.book_id,
  }, {
    status: "APPROVED",
    student_id: request.student_id,
    book_id: request.book_id,
  });

  revalidateRequestPaths();
  return { ok: true, data: { id: requestId } };
}

/**
 * Decline a PENDING request with an optional reason (FR-12, R-12 DECLINED —
 * "optional `decline_reason` stored. No penalty.").
 *
 * Same guards as `approveRequest`: admin-only, PENDING-only, conditional
 * UPDATE (R-15 / E6). An empty form reason is stored as `NULL`.
 */
export async function declineRequest(
  input: unknown,
): Promise<RequestActionResult<{ id: string }>> {
  const { adminId } = await assertAdmin();

  const parsed = declineRequestSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsFromZod(parsed.error) };
  }
  const { requestId } = parsed.data;
  const reason = parsed.data.reason?.trim();
  if (!isUuid(requestId)) return { ok: false, error: "Request not found." };

  const supabase = await createClient();

  const { data: request, error: lookupError } = await supabase
    .from("loan_requests")
    .select("id, student_id, book_id, status")
    .eq("id", requestId)
    .maybeSingle();
  if (lookupError) {
    return { ok: false, error: "Could not load the request. Please try again." };
  }
  if (!request) return { ok: false, error: "Request not found." };
  if (request.status !== "PENDING") {
    // R-15 / E6 — decided exactly once.
    return { ok: false, error: "This request has already been decided." };
  }

  const { data: decided, error: updateError } = await supabase
    .from("loan_requests")
    .update({
      status: "DECLINED",
      decline_reason: reason && reason.length > 0 ? reason : null,
      decided_at: new Date().toISOString(),
      decided_by: adminId,
    })
    .eq("id", requestId)
    .eq("status", "PENDING")
    .select("id")
    .maybeSingle();
  if (updateError) {
    return { ok: false, error: "Could not decline the request. Please try again." };
  }
  if (!decided) {
    return { ok: false, error: "This request has already been decided." };
  }

  await writeAudit(adminId, "REQUEST_DECLINE", requestId, {
    status: "PENDING",
    student_id: request.student_id,
    book_id: request.book_id,
  }, {
    status: "DECLINED",
    student_id: request.student_id,
    book_id: request.book_id,
    decline_reason: reason && reason.length > 0 ? reason : null,
  });

  revalidateRequestPaths();
  return { ok: true, data: { id: requestId } };
}
