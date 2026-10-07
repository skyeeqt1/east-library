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

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
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

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (error || data?.role !== "ADMIN") redirect("/dashboard");

  return { adminId: user.id };
}
