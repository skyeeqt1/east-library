"use server";

import { revalidatePath } from "next/cache";
import { createClient, getServiceClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/guards";

/**
 * ============================================================================
 *  Student loan mutations — early returns (user request, FR-16 extension)
 * ============================================================================
 *
 * Follows the lib/student/request-actions.ts contract:
 *   1. session + role guard FIRST (`getCurrentProfile()` → must be STUDENT),
 *   2. re-verifies ownership/state in SQL via the `request_loan_return`
 *      SECURITY DEFINER function (migration 0009 — same pattern as
 *      `release_loan` / `record_return` in 0002: state changes live in SQL,
 *      so a direct REST call can never set `returned_at` itself),
 *   3. appends an `audit_logs` row (R-32) via the service-role client,
 *   4. revalidates the student dashboard, "My Borrowed Books" and the admin
 *      Borrowed table (which shows the "Return requested" chip).
 *
 * The flag only signals intent — the librarian still receives the book and
 * confirms the return (condition check + overdue fine) at the desk.
 */

/** Routes whose cached data depends on loan writes. */
const LOAN_PATHS = [
  "/dashboard",
  "/dashboard/loans",
  "/admin/loans",
] as const;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Best-effort audit trail — never fails an already-committed mutation (R-32). */
async function writeAudit(
  actorId: string,
  entityId: string,
  after: Record<string, unknown>,
): Promise<void> {
  try {
    const service = getServiceClient();
    await service.from("audit_logs").insert({
      actor_id: actorId,
      action: "LOAN_RETURN_REQUEST",
      entity_type: "loan",
      entity_id: entityId,
      before: null,
      after,
    });
  } catch {
    // Missing env / network — the mutation itself already succeeded.
  }
}

export interface ReturnRequestResult {
  ok: boolean;
  error?: string;
}

/**
 * Signal intent to return an active loan early (user request: students can
 * return before the due date). Calls `request_loan_return` in SQL, which
 * re-verifies that the loan belongs to the caller, is ACTIVE/OVERDUE and not
 * yet returned — then sets `return_requested_at` (idempotent).
 */
export async function requestLoanReturn(
  loanId: string,
): Promise<ReturnRequestResult> {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "STUDENT") {
    return { ok: false, error: "Not authorized." };
  }
  if (!UUID_PATTERN.test(loanId)) {
    return { ok: false, error: "Book not found in your loans." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("request_loan_return", {
    p_loan_id: loanId,
  });

  if (error) {
    const message = error.message ?? "";
    if (/not your loan|not found/i.test(message)) {
      return { ok: false, error: "This book is not in your borrowed list." };
    }
    if (/already returned/i.test(message)) {
      return { ok: false, error: "This book has already been returned." };
    }
    if (/not active/i.test(message)) {
      return { ok: false, error: "This loan can no longer be returned." };
    }
    return { ok: false, error: "Could not request the return. Please try again." };
  }

  await writeAudit(profile.id, loanId, { return_requested_at: data ?? null });

  for (const path of LOAN_PATHS) revalidatePath(path);
  return { ok: true };
}
