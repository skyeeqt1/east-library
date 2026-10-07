"use server";

import { assertAdmin } from "@/lib/auth/guards";
import {
  getBookDetail,
  type BookDetail,
} from "@/lib/catalog/availability";

/**
 * Server-action wrapper around `getBookDetail` so the **edit-book modal**
 * (a client component) can load the title's physical copies on open.
 *
 * `lib/catalog/*` is server-only, so the detail read can never run in the
 * browser — this keeps the round-trip on the server where the cookie-aware
 * Supabase client and RLS live. `assertAdmin()` re-verifies the session and
 * `profiles.role === 'ADMIN'` before any row is read (rules.md §9, R-31),
 * mirroring every mutation in `lib/admin/book-actions.ts`.
 *
 * Returns a plain, serializable `BookDetail` (or `null` when the id no longer
 * exists) — safe to hand straight to client state.
 */
export async function fetchBookDetail(
  bookId: string,
): Promise<BookDetail | null> {
  await assertAdmin();
  return getBookDetail(bookId);
}
