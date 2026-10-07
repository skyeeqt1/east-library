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

/* ------------------------------------------------------------------ */
/* Account management schemas (FR-04 / FR-05 / FR-06, R-02 / R-05)     */
/* ------------------------------------------------------------------ */

const STUDENT_ID_FORMAT =
  "Use 4–14 letters, numbers or dashes — e.g. 2024-1056 or ESCR-2024-1056.";

/**
 * ESCR Student ID — normalized to UPPERCASE (R-02). Accepts both the plain
 * (`2024-1056`) and prefixed (`ESCR-2024-1056`) formats; 4–14 characters,
 * letters / numbers / inner dashes only.
 */
export const studentIdSchema = z
  .string()
  .trim()
  .min(4, STUDENT_ID_FORMAT)
  .max(14, STUDENT_ID_FORMAT)
  .regex(/^[A-Za-z0-9][A-Za-z0-9-]*[A-Za-z0-9]$/, STUDENT_ID_FORMAT)
  .transform((value) => value.toUpperCase());

const fullNameSchema = z
  .string()
  .trim()
  .min(2, "Enter the student's full name.")
  .max(120, "Full name must be 120 characters or fewer.");

const courseSectionSchema = z
  .string()
  .trim()
  .min(1, "Enter the course/section, e.g. BSIT 2A.")
  .max(60, "Course/section must be 60 characters or fewer.");

const phoneSchema = z
  .string()
  .trim()
  .max(30, "Phone number must be 30 characters or fewer.");

/** Initial / reset password — minimum 8 characters (R-05). */
export const tempPasswordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters.")
  .max(72, "Password must be 72 characters or fewer.");

/** Create student account (FR-04, E9). */
export const createStudentSchema = z.object({
  studentId: studentIdSchema,
  fullName: fullNameSchema,
  courseSection: courseSectionSchema,
  phone: phoneSchema.optional(),
  tempPassword: tempPasswordSchema,
});

export type CreateStudentInput = z.input<typeof createStudentSchema>;

/** Edit an existing student (FR-05). */
export const updateStudentSchema = z.object({
  fullName: fullNameSchema,
  courseSection: courseSectionSchema,
  phone: phoneSchema.optional(),
});

export type UpdateStudentInput = z.input<typeof updateStudentSchema>;

/** Block / unblock (FR-05, R-04). */
export const studentStatusSchema = z.enum(["ACTIVE", "BLOCKED"]);

export type StudentStatusInput = z.infer<typeof studentStatusSchema>;

/** Admin password reset (FR-05, E8). */
export const resetPasswordSchema = z.object({
  newPassword: tempPasswordSchema,
});

export type ResetPasswordInput = z.input<typeof resetPasswordSchema>;

/** Student self-service password change (FR-06, R-05). */
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password."),
    newPassword: tempPasswordSchema,
    confirmPassword: z
      .string()
      .min(1, "Confirm your new password."),
  })
  .refine((values) => values.newPassword === values.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  })
  .refine((values) => values.newPassword !== values.currentPassword, {
    message: "New password must be different from the current one.",
    path: ["newPassword"],
  });

export type ChangePasswordInput = z.input<typeof changePasswordSchema>;

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
