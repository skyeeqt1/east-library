"use server";

import { assertAdmin } from "@/lib/auth/guards";
import { getReleaseCandidates } from "@/lib/admin/loan-actions";
import type { ReleaseCandidates } from "@/lib/validations/loan";

/**
 * Server-action wrapper around `getReleaseCandidates` so the **release-book
 * modal** (a client component) can load an APPROVED request's available
 * copies on open — the mirror of `components/admin/books/detail-action.ts`.
 *
 * `lib/admin/loan-actions.ts` is already a "use server" module, but the
 * client dialog deliberately goes through this wrapper so the phase-3
 * precedent holds: `assertAdmin()` re-verifies the session **and**
 * `profiles.role === 'ADMIN'` first (rules.md §9, R-31) before the read runs
 * on the server, where the cookie-aware Supabase client and RLS live.
 *
 * Returns a plain, serializable `ReleaseCandidates` (or `null` when the id is
 * not a UUID / the request no longer exists) — safe to hand straight to
 * client state; the modal renders the matching gate text
 * (lib/validations/loan.ts `LOAN_MESSAGES`).
 */
export async function fetchReleaseCandidates(
  requestId: string,
): Promise<ReleaseCandidates | null> {
  await assertAdmin();
  return getReleaseCandidates(requestId);
}
