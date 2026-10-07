import { z } from "zod";

/**
 * Login form schema (FR-01, R-01, R-02).
 *
 * The identifier is either an ESCR Student ID (e.g. "2024-1056") or an admin
 * email — the server action resolves it to a Supabase auth email (see
 * lib/auth/actions.ts). There is deliberately NO signup/registration schema:
 * every account is created by an admin (R-01).
 */
export const loginSchema = z.object({
  identifier: z
    .string()
    .trim()
    .min(1, "Enter your Student ID or email."),
  password: z.string().min(1, "Enter your password."),
});

export type LoginFormInput = z.infer<typeof loginSchema>;

/** Flatten a ZodError into `field -> first message` for form display. */
export function fieldErrorsFromZod(
  error: z.ZodError,
): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "_");
    if (!(key in fieldErrors)) {
      fieldErrors[key] = issue.message;
    }
  }
  return fieldErrors;
}
