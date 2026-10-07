"use client";

import {
  useCallback,
  useState,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import {
  createStudentSchema,
  fieldErrorsFromZod,
} from "@/lib/validations/auth";
import { createStudent } from "@/lib/auth/admin-actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Toast } from "@/components/ui/toast";
import { PasswordField } from "@/components/auth/password-field";

/** Human-friendly temporary password (12 chars, unambiguous alphabet). */
function generatePassword(): string {
  const alphabet =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

/**
 * "Create account" primary button (top-right of the Students topbar) that
 * opens the creation modal — the ONLY account-creation path (R-01/R-02).
 *
 * Client validates with the shared Zod schema for instant feedback; the
 * server action re-validates, checks duplicates (E9) and writes the audit row.
 */
export function CreateAccountButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [tempPassword, setTempPassword] = useState("");

  const closeToast = useCallback(() => setNotice(undefined), []);

  const openDialog = () => {
    setFieldErrors({});
    setFormError(undefined);
    setOpen(true);
  };

  const closeDialog = () => {
    if (saving) return;
    setOpen(false);
  };

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);

    const candidate = {
      studentId: String(formData.get("studentId") ?? ""),
      fullName: String(formData.get("fullName") ?? ""),
      courseSection: String(formData.get("courseSection") ?? ""),
      phone: String(formData.get("phone") ?? ""),
      tempPassword,
    };

    const parsed = createStudentSchema.safeParse(candidate);
    if (!parsed.success) {
      setFieldErrors(fieldErrorsFromZod(parsed.error));
      setFormError(undefined);
      return;
    }

    setFieldErrors({});
    setFormError(undefined);
    setSaving(true);
    try {
      const result = await createStudent(parsed.data);
      if (result.ok) {
        form.reset();
        setTempPassword("");
        setOpen(false);
        setNotice("Student account created.");
        router.refresh();
      } else {
        setFieldErrors(result.fieldErrors ?? {});
        setFormError(result.error);
      }
    } catch {
      // The action redirected (session ended) — navigation is in flight.
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button size="md" onClick={openDialog}>
        <UserPlus className="size-4" aria-hidden="true" />
        Create account
      </Button>

      <Modal
        open={open}
        onClose={closeDialog}
        title="Create student account"
        description="The student signs in with their Student ID and this password."
        footer={
          <>
            <Button variant="secondary" size="md" onClick={closeDialog} disabled={saving}>
              Cancel
            </Button>
            <Button
              size="md"
              type="submit"
              form="create-student-form"
              loading={saving}
            >
              Create account
            </Button>
          </>
        }
      >
        <form
          id="create-student-form"
          onSubmit={handleSubmit}
          noValidate
          className="flex flex-col gap-4"
        >
          {formError ? (
            <div
              role="alert"
              className="rounded-md border border-error-500 bg-error-25 px-4 py-3 text-sm font-medium text-error-700"
            >
              {formError}
            </div>
          ) : null}

          <Field
            label="Student ID"
            name="studentId"
            required
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            placeholder="e.g. 2024-1056 or ESCR-2024-1056"
            helper="4–14 letters, numbers or dashes — stored uppercase."
            error={fieldErrors.studentId}
            disabled={saving}
          />

          <Field
            label="Full name"
            name="fullName"
            required
            autoComplete="off"
            placeholder="e.g. Maria Santos"
            error={fieldErrors.fullName}
            disabled={saving}
          />

          <Field
            label="Course / Section"
            name="courseSection"
            required
            autoComplete="off"
            placeholder="e.g. BSIT 2A"
            error={fieldErrors.courseSection}
            disabled={saving}
          />

          <Field
            label="Phone"
            name="phone"
            type="tel"
            autoComplete="off"
            placeholder="Optional"
            helper="Optional — used for in-library contact only."
            error={fieldErrors.phone}
            disabled={saving}
          />

          <PasswordField
            label="Temporary password"
            name="tempPassword"
            required
            autoComplete="new-password"
            value={tempPassword}
            onChange={(event) => setTempPassword(event.target.value)}
            helper="Minimum 8 characters. Write it down — the student signs in with it."
            error={fieldErrors.tempPassword}
            disabled={saving}
            trailing={
              <button
                type="button"
                onClick={() => setTempPassword(generatePassword())}
                className="h-7 rounded-md border border-gray-300 bg-white px-2 text-xs font-medium text-gray-700 transition-colors duration-fast hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
              >
                Generate
              </button>
            }
          />

          {/* Submit lives in the modal footer; hidden submit keeps Enter-to-save. */}
          <button type="submit" className="sr-only" aria-hidden="true" tabIndex={-1}>
            Create account
          </button>
        </form>
      </Modal>

      {notice ? <Toast message={notice} onClose={closeToast} /> : null}
    </>
  );
}
