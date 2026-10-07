"use server";

import { revalidatePath } from "next/cache";
import { getServiceClient } from "@/lib/supabase/server";
import { assertAdmin } from "@/lib/auth/guards";
import type { ActionResult } from "@/lib/auth/types";
import {
  createStudentSchema,
  fieldErrorsFromZod,
  resetPasswordSchema,
  studentStatusSchema,
  updateStudentSchema,
  type CreateStudentInput,
  type ResetPasswordInput,
  type StudentStatusInput,
  type UpdateStudentInput,
} from "@/lib/validations/auth";

/**
 * ============================================================================
 *  Admin account management — the ONLY way accounts are created (R-01/R-02)
 * ============================================================================
 *
 * Every action:
 *   1. runs `assertAdmin()` (session → profiles.role → redirect if not ADMIN),
 *   2. re-validates its input with Zod (R-31 — client values are never trusted),
 *   3. mutates through the service-role client (RLS bypass, server-only),
 *   4. writes an `audit_logs` row (R-32), and
 *   5. `revalidatePath`s the students table so the UI refreshes.
 */

const STUDENTS_PATH = "/admin/students";

/** Synthetic auth email for a Student ID (architecture.md §4). */
function studentEmail(studentId: string): string {
  return `${studentId.toLowerCase()}@escr.students`;
}

function optionalOrNull(value: string | undefined): string | null {
  return value && value.length > 0 ? value : null;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/** Best-effort audit trail — never fails an already-committed action (R-32). */
async function writeAudit(
  actorId: string,
  action: string,
  entityId: string | null,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): Promise<void> {
  try {
    const service = getServiceClient();
    await service.from("audit_logs").insert({
      actor_id: actorId,
      action,
      entity_type: "profile",
      entity_id: entityId,
      before,
      after,
    });
  } catch {
    // Missing env / network — the mutation itself already succeeded.
  }
}

/**
 * Create a student account (FR-04, E9).
 *
 * `handle_new_user` (live in Supabase) reads `user_metadata` and creates the
 * `profiles` row — it RAISES when `role` is missing, so metadata is mandatory.
 * We only fall back to a manual insert (ON CONFLICT DO NOTHING) if that row is
 * somehow absent.
 */
export async function createStudent(
  input: CreateStudentInput,
): Promise<ActionResult> {
  const { adminId } = await assertAdmin();

  const parsed = createStudentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsFromZod(parsed.error) };
  }

  const { studentId, fullName, courseSection, phone, tempPassword } =
    parsed.data;
  const service = getServiceClient();

  // E9 — duplicate Student ID → inline form error.
  const { data: existing, error: lookupError } = await service
    .from("profiles")
    .select("id")
    .eq("student_id", studentId)
    .maybeSingle();
  if (lookupError) {
    return {
      ok: false,
      error: "Could not verify the Student ID. Please try again.",
    };
  }
  if (existing) {
    return {
      ok: false,
      fieldErrors: { studentId: "Student ID already exists." },
    };
  }

  const { data: created, error: createError } =
    await service.auth.admin.createUser({
      email: studentEmail(studentId),
      password: tempPassword,
      email_confirm: true,
      user_metadata: {
        role: "STUDENT",
        student_id: studentId,
        full_name: fullName,
        course_section: courseSection,
      },
    });

  if (createError || !created?.user) {
    const message = createError?.message ?? "";
    if (/already|exists/i.test(message)) {
      return {
        ok: false,
        fieldErrors: { studentId: "Student ID already exists." },
      };
    }
    return {
      ok: false,
      error: "Could not create the account. Please try again.",
    };
  }

  const userId = created.user.id;

  // The trigger normally creates the profiles row — top it up with the fields
  // it does not carry (phone, created_by); fall back to a guarded insert.
  const { data: profileRow } = await service
    .from("profiles")
    .select("id")
    .eq("id", userId)
    .maybeSingle();

  if (profileRow) {
    await service
      .from("profiles")
      .update({ phone: optionalOrNull(phone), created_by: adminId })
      .eq("id", userId);
  } else {
    const { error: insertError } = await service.from("profiles").upsert(
      {
        id: userId,
        role: "STUDENT",
        student_id: studentId,
        full_name: fullName,
        course_section: courseSection,
        phone: optionalOrNull(phone),
        created_by: adminId,
      },
      { onConflict: "id", ignoreDuplicates: true },
    );
    if (insertError) {
      // Never leave an orphan auth user behind.
      await service.auth.admin.deleteUser(userId);
      return {
        ok: false,
        error: "Could not create the student profile. Please try again.",
      };
    }
  }

  await writeAudit(adminId, "ACCOUNT_CREATE", userId, null, {
    student_id: studentId,
    full_name: fullName,
    course_section: courseSection,
  });

  revalidatePath(STUDENTS_PATH);
  return { ok: true };
}

/** Edit a student's profile details (FR-05). */
export async function updateStudent(
  id: string,
  input: UpdateStudentInput,
): Promise<ActionResult> {
  const { adminId } = await assertAdmin();

  if (!isUuid(id)) return { ok: false, error: "Student account not found." };

  const parsed = updateStudentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsFromZod(parsed.error) };
  }

  const service = getServiceClient();
  const { data: target, error: lookupError } = await service
    .from("profiles")
    .select("id, role, full_name, course_section, phone")
    .eq("id", id)
    .maybeSingle();
  if (lookupError || !target || target.role !== "STUDENT") {
    return { ok: false, error: "Student account not found." };
  }

  const patch = {
    full_name: parsed.data.fullName,
    course_section: parsed.data.courseSection,
    phone: optionalOrNull(parsed.data.phone),
  };

  const { error } = await service
    .from("profiles")
    .update(patch)
    .eq("id", id)
    .eq("role", "STUDENT");
  if (error) {
    return { ok: false, error: "Could not save the changes. Please try again." };
  }

  await writeAudit(
    adminId,
    "ACCOUNT_UPDATE",
    id,
    {
      full_name: target.full_name,
      course_section: target.course_section,
      phone: target.phone,
    },
    patch,
  );

  revalidatePath(STUDENTS_PATH);
  return { ok: true };
}

/** Block / unblock a student account (FR-05, R-04). */
export async function setStudentStatus(
  id: string,
  status: StudentStatusInput,
): Promise<ActionResult> {
  const { adminId } = await assertAdmin();

  if (!isUuid(id)) return { ok: false, error: "Student account not found." };

  const parsed = studentStatusSchema.safeParse(status);
  if (!parsed.success) {
    return { ok: false, error: "Invalid account status." };
  }

  const service = getServiceClient();
  const { data: target, error: lookupError } = await service
    .from("profiles")
    .select("id, role, status")
    .eq("id", id)
    .maybeSingle();
  if (lookupError || !target || target.role !== "STUDENT") {
    return { ok: false, error: "Student account not found." };
  }

  const { error } = await service
    .from("profiles")
    .update({ status: parsed.data })
    .eq("id", id)
    .eq("role", "STUDENT");
  if (error) {
    return { ok: false, error: "Could not update the status. Please try again." };
  }

  await writeAudit(adminId, "ACCOUNT_BLOCK", id, { status: target.status }, {
    status: parsed.data,
  });

  revalidatePath(STUDENTS_PATH);
  return { ok: true };
}

/** Reset a student's password (FR-05, E8 — no email flow, reset in person). */
export async function resetStudentPassword(
  id: string,
  input: ResetPasswordInput,
): Promise<ActionResult> {
  const { adminId } = await assertAdmin();

  if (!isUuid(id)) return { ok: false, error: "Student account not found." };

  const parsed = resetPasswordSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsFromZod(parsed.error) };
  }

  const service = getServiceClient();
  const { data: target, error: lookupError } = await service
    .from("profiles")
    .select("id, role")
    .eq("id", id)
    .maybeSingle();
  if (lookupError || !target || target.role !== "STUDENT") {
    return { ok: false, error: "Student account not found." };
  }

  const { error } = await service.auth.admin.updateUserById(id, {
    password: parsed.data.newPassword,
  });
  if (error) {
    return {
      ok: false,
      error: "Could not reset the password. Please try again.",
    };
  }

  await writeAudit(adminId, "ACCOUNT_UPDATE", id, null, {
    password_reset: true,
  });

  revalidatePath(STUDENTS_PATH);
  return { ok: true };
}
