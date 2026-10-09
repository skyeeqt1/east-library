import { connection } from "next/server";
import { assertAdmin } from "@/lib/auth/guards";

/**
 * The role check reads the session cookie on every request, so this segment
 * can never be served from a static prerender (Cache Components: blocking
 * route). Same idea as `export const dynamic = "force-dynamic"`.
 */
export const instant = false;

/**
 * Admin route group — `app/(admin)/admin/*`.
 *
 * Two layers guard these routes:
 *   1. middleware.ts  — UX redirect for non-admins (E10);
 *   2. `assertAdmin()` (this file) — server-side re-verification of the
 *      session AND `profiles.role === 'ADMIN'` before any admin code renders.
 *
 * The check uses the cookie-aware anon client only (own/allowed rows via RLS)
 * — never the service-role key. Non-admins are sent to `/dashboard`.
 */
export default async function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Opt out of prerender validation BEFORE assertAdmin(): supabase-js computes
  // session expiry with Date.now(), which Next flags as an unstable value if
  // evaluated during a static prerender pass (dev "1 Issue" badge).
  await connection();
  await assertAdmin();
  return children;
}
