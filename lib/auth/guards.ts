import "server-only";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { parseProfileRow, type ProfileRow } from "@/lib/auth/types";

/**
 * Session + role guards used by server components and server actions
 * (rules.md §9 — server actions re-verify roles before every mutation).
 *
 * Both helpers read `profiles` through the cookie-aware anon client, so RLS
 * applies: a user can always read **their own row**, and an admin can read
 * every row (defense in depth — no service-role client involved, E10).
 */

/** The signed-in user's profile row, or null when signed out / unreadable. */
export async function getCurrentProfile(): Promise<ProfileRow | null> {
  const supabase = await createClient();

  // Local JWT verification (cached JWKS) instead of getUser()'s per-request
  // network round-trip — the profiles read below is the authoritative check.
  const { data: claimData } = await supabase.auth.getClaims();
  const userId = claimData?.claims?.sub;
  if (!userId) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();

  if (error) return null;
  return parseProfileRow(data);
}

export interface AdminContext {
  /** The authenticated admin's `profiles.id` (audit actor). */
  adminId: string;
}

/**
 * Hard server-side admin gate (R-03, R-31).
 *
 * - no session            → /login
 * - profile ≠ ADMIN       → /dashboard  (students never reach admin code, E10)
 *
 * Throws NEXT_REDIRECT on failure — that is intentional: server actions
 * propagate it to the client, which performs the navigation.
 */
export async function assertAdmin(): Promise<AdminContext> {
  const supabase = await createClient();

  // Local JWT verification (see getCurrentProfile). The fresh profiles read
  // below stays: it is the authoritative admin gate (R-03, R-31).
  const { data: claimData } = await supabase.auth.getClaims();
  const userId = claimData?.claims?.sub;
  if (!userId) redirect("/login");

  const { data, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  if (error || data?.role !== "ADMIN") redirect("/dashboard");

  return { adminId: userId };
}
