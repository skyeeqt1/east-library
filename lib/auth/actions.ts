"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { parseProfileRow } from "@/lib/auth/types";
import {
  changePasswordSchema,
  fieldErrorsFromZod,
  loginSchema,
} from "@/lib/validations/auth";

/** Generic auth error — never reveals whether the account exists (R-04). */
const GENERIC_LOGIN_ERROR =
  "Invalid credentials. If you don't have an account, contact the library.";

/** R-04: blocked accounts are rejected with a clear, non-generic message. */
const BLOCKED_LOGIN_ERROR =
  "This account has been blocked. Contact the library.";

/** Synthetic auth-email domain for Student IDs (architecture.md §4, R-02). */
const STUDENT_EMAIL_DOMAIN = "@escr.students";

export interface LoginState {
  /** Form-level error (bad credentials, blocked account…). */
  error?: string;
  /** Per-field validation errors, keyed by input `name`. */
  fieldErrors?: Record<string, string>;
}

export interface ChangePasswordState {
  /** Form-level error. */
  error?: string;
  /** Per-field validation errors, keyed by input `name`. */
  fieldErrors?: Record<string, string>;
  /** Set once the password has been updated. */
  success?: boolean;
}

/**
 * Candidate auth emails for a typed-in identifier, in priority order:
 *
 *  1. contains `@`          → used verbatim (admins: librarian@escr.edu.ph)
 *  2. no `@`                → `{id}@escr.students` (student-ID mapping, R-02)
 *  3. no `@`, attempt 2     → the raw input as an email — the wrong-mapping
 *     fallback so an admin can type a plain email prefix (or their Student-ID
 *     shaped login) without knowing the internal convention.
 */
function candidateEmails(identifier: string): string[] {
  const trimmed = identifier.trim();
  if (trimmed.includes("@")) return [trimmed.toLowerCase()];

  const mapped = trimmed.replace(/\s+/g, "").toLowerCase();
  return [`${mapped}${STUDENT_EMAIL_DOMAIN}`, mapped];
}

/**
 * Sign in with Student ID (or admin email) + password.
 *
 * Flow (architecture.md §4):
 *   resolve identifier → synthetic/real email → signInWithPassword →
 *   read `profiles` → reject BLOCKED (R-04) → redirect by role (FR-03).
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

  const supabase = await createClient();
  const candidates = candidateEmails(parsed.data.identifier);

  let signedIn = false;
  for (const email of candidates) {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password: parsed.data.password,
    });
    if (!error) {
      signedIn = true;
      break;
    }
  }

  if (!signedIn) {
    return { error: GENERIC_LOGIN_ERROR };
  }

  // Session cookie is set — now enforce the account state and the role route.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: GENERIC_LOGIN_ERROR };
  }

  let role: "ADMIN" | "STUDENT" = "STUDENT";
  let status: "ACTIVE" | "BLOCKED" = "ACTIVE";
  try {
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .maybeSingle();
    const profile = parseProfileRow(data);
    if (profile) {
      role = profile.role;
      status = profile.status;
    } else {
      // Profiles row unreadable — fall back to the stamped metadata role.
      role = user.user_metadata?.role === "ADMIN" ? "ADMIN" : "STUDENT";
    }
  } catch {
    // Network hiccup: do not lock a valid user out; metadata decides the role.
    role = user.user_metadata?.role === "ADMIN" ? "ADMIN" : "STUDENT";
  }

  if (status === "BLOCKED") {
    // R-04: end the session immediately and reject with the blocked message.
    await supabase.auth.signOut();
    return { error: BLOCKED_LOGIN_ERROR };
  }

  // `redirect` throws NEXT_REDIRECT — keep it outside any try/catch.
  redirect(role === "ADMIN" ? "/admin/dashboard" : "/dashboard");
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

/**
 * Change the signed-in user's own password (FR-06, R-05).
 *
 * Re-authenticates with the current password first (so "Current password is
 * incorrect." is authoritative) and that fresh sign-in also satisfies
 * Supabase's recent-login requirement for sensitive `updateUser` calls.
 */
export async function changePassword(
  _prevState: ChangePasswordState | null,
  formData: FormData,
): Promise<ChangePasswordState> {
  const parsed = changePasswordSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFromZod(parsed.error) };
  }

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user?.email) redirect("/login");

    // 1) Re-authenticate with the current password.
    const { error: reauthError } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: parsed.data.currentPassword,
    });
    if (reauthError) {
      return { fieldErrors: { currentPassword: "Current password is incorrect." } };
    }

    // 2) Apply the new password.
    const { error: updateError } = await supabase.auth.updateUser({
      password: parsed.data.newPassword,
    });
    if (updateError) {
      if (updateError.message.toLowerCase().includes("same")) {
        return {
          fieldErrors: {
            newPassword: "New password must be different from the current one.",
          },
        };
      }
      return { error: "Could not update the password. Please try again." };
    }

    return { success: true };
  } catch (error) {
    // NEXT_REDIRECT (signed out mid-flight) must propagate to the client.
    if (isRedirectError(error)) throw error;
    return { error: "Could not update the password. Please try again." };
  }
}

/** Detect Next.js redirect()/notFound() control-flow errors. */
function isRedirectError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = "digest" in error ? String(error.digest) : "";
  return code.startsWith("NEXT_REDIRECT") || code.startsWith("NEXT_NOT_FOUND");
}
