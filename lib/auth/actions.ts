"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  fieldErrorsFromZod,
  loginSchema,
} from "@/lib/validations/auth";

/** Generic auth error — never reveals whether the account exists (R-04). */
const GENERIC_LOGIN_ERROR =
  "Invalid credentials. If you don't have an account, contact the library.";

export interface LoginState {
  /** Form-level error (bad credentials, blocked account…). */
  error?: string;
  /** Per-field validation errors, keyed by input `name`. */
  fieldErrors?: Record<string, string>;
}

/**
 * Resolve the login identifier to the Supabase auth email.
 *
 * Students authenticate with their ESCR Student ID and are mapped to a
 * synthetic email (`{student_id}@escr.students`) — architecture.md §4, R-02.
 * Admins sign in with their real email address.
 */
function resolveAuthEmail(identifier: string): string {
  const normalized = identifier.trim().toLowerCase();
  return normalized.includes("@")
    ? normalized
    : `${normalized}@escr.students`;
}

/**
 * Sign in with Student ID (or admin email) + password.
 *
 * TODO(Phase 1): after a successful `signInWithPassword`, verify the profile
 * row: a BLOCKED account (R-04) must be signed out again and rejected with the
 * same generic message. Needs the `profiles` table from the concurrent
 * migrations, so it is intentionally not wired yet.
 */
export async function login(
  _prevState: LoginState | null,
  formData: FormData,
): Promise<LoginState | null> {
  const parsed = loginSchema.safeParse({
    identifier: formData.get("identifier"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFromZod(parsed.error) };
  }

  let authFailed = false;

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: resolveAuthEmail(parsed.data.identifier),
      password: parsed.data.password,
    });
    authFailed = Boolean(error);
  } catch {
    authFailed = true;
  }

  if (authFailed) {
    return { error: GENERIC_LOGIN_ERROR };
  }

  // `redirect` throws NEXT_REDIRECT — keep it outside try/catch so the
  // navigation is not swallowed. middleware.ts routes by role (FR-03).
  redirect("/");
}

/**
 * Sign out and return to the login screen. Safe to call with no session.
 */
export async function signOut(): Promise<void> {
  try {
    const supabase = await createClient();
    await supabase.auth.signOut();
  } catch {
    // Missing env / no session — signing out should always land on /login.
  }
  redirect("/login");
}
