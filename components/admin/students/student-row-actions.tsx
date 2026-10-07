"use client";

import {
  useCallback,
  useState,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";
import { Ban, KeyRound, Pencil, ShieldCheck } from "lucide-react";
import {
  fieldErrorsFromZod,
  resetPasswordSchema,
  updateStudentSchema,
} from "@/lib/validations/auth";
import {
  resetStudentPassword,
  setStudentStatus,
  updateStudent,
} from "@/lib/auth/admin-actions";
import type { ActionResult } from "@/lib/auth/types";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Toast } from "@/components/ui/toast";
import { PasswordField } from "@/components/auth/password-field";

export interface StudentRowActionsStudent {
  id: string;
  fullName: string;
  courseSection: string;
  phone: string | null;
  status: "ACTIVE" | "BLOCKED";
}

const ICON_BUTTON =
  "flex size-9 items-center justify-center rounded-md text-gray-500 transition-colors duration-fast hover:bg-gray-100 hover:text-gray-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500";

/** Human-friendly password for the admin reset dialog (12 chars). */
function generatePassword(): string {
  const alphabet =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

/**
 * Row actions (design §4.4 — ghost icon buttons with `aria-label`s):
 * edit details · block/unblock · reset password (FR-05).
 *
 * Every mutation is a server action guarded by `assertAdmin()`; this component
 * only mirrors the shared Zod schema for instant inline errors.
 */
export function StudentRowActions({ student }: { student: StudentRowActionsStudent }) {
  const router = useRouter();
  const [dialog, setDialog] = useState<"edit" | "status" | "reset" | null>(null);
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const [toast, setToast] = useState<{ tone: "success"; message: string } | null>(
    null,
  );
  const [newPassword, setNewPassword] = useState("");

  const closeToast = useCallback(() => setToast(null), []);

  const openDialog = (next: "edit" | "status" | "reset") => {
    setFieldErrors({});
    setFormError(undefined);
    setDialog(next);
  };

  const closeDialog = () => {
    if (busy) return;
    setDialog(null);
  };

  /** Run a server action and surface the result (shared by all three dialogs). */
  async function run(
    action: () => Promise<ActionResult>,
    successMessage: string,
    form?: HTMLFormElement,
  ): Promise<void> {
    setFieldErrors({});
    setFormError(undefined);
    setBusy(true);
    try {
      const result = await action();
      if (result.ok) {
        setDialog(null);
        form?.reset();
        setNewPassword("");
        setToast({ tone: "success", message: successMessage });
        router.refresh();
      } else {
        setFieldErrors(result.fieldErrors ?? {});
        setFormError(result.error);
      }
    } catch {
      // The action redirected (session ended) — navigation is in flight.
    } finally {
      setBusy(false);
    }
  }

  function handleEditSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const candidate = {
      fullName: String(formData.get("fullName") ?? ""),
      courseSection: String(formData.get("courseSection") ?? ""),
      phone: String(formData.get("phone") ?? ""),
    };
    const parsed = updateStudentSchema.safeParse(candidate);
    if (!parsed.success) {
      setFieldErrors(fieldErrorsFromZod(parsed.error));
      return;
    }
    void run(
      () => updateStudent(student.id, parsed.data),
      "Student details updated.",
      form,
    );
  }

  function handleResetSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const form = event.currentTarget;
    const parsed = resetPasswordSchema.safeParse({ newPassword });
    if (!parsed.success) {
      setFieldErrors(fieldErrorsFromZod(parsed.error));
      return;
    }
    void run(
      () => resetStudentPassword(student.id, parsed.data),
      "Password reset.",
      form,
    );
  }

  function handleStatusSubmit(): void {
    const next = student.status === "BLOCKED" ? "ACTIVE" : "BLOCKED";
    void run(
      () => setStudentStatus(student.id, next),
      next === "BLOCKED"
        ? `${student.fullName} blocked.`
        : `${student.fullName} reactivated.`,
    );
  }

  const blocking = student.status !== "BLOCKED";

  return (
    <>
      <div className="flex items-center justify-end gap-1">
        <button
          type="button"
          aria-label={`Edit ${student.fullName}`}
          title="Edit"
          onClick={() => openDialog("edit")}
          className={ICON_BUTTON}
        >
          <Pencil className="size-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label={
            blocking
              ? `Block ${student.fullName}`
              : `Unblock ${student.fullName}`
          }
          title={blocking ? "Block" : "Unblock"}
          onClick={() => openDialog("status")}
          className={ICON_BUTTON}
        >
          {blocking ? (
            <Ban className="size-4" aria-hidden="true" />
          ) : (
            <ShieldCheck className="size-4" aria-hidden="true" />
          )}
        </button>
        <button
          type="button"
          aria-label={`Reset password for ${student.fullName}`}
          title="Reset password"
          onClick={() => openDialog("reset")}
          className={ICON_BUTTON}
        >
          <KeyRound className="size-4" aria-hidden="true" />
        </button>
      </div>

      {/* Edit details ------------------------------------------------- */}
      <Modal
        open={dialog === "edit"}
        onClose={closeDialog}
        title="Edit student"
        description={`${student.fullName} · student details`}
        footer={
          <>
            <Button variant="secondary" size="md" onClick={closeDialog} disabled={busy}>
              Cancel
            </Button>
            <Button
              size="md"
              type="submit"
              form="edit-student-form"
              loading={busy}
            >
              Save changes
            </Button>
          </>
        }
      >
        <form
          id="edit-student-form"
          onSubmit={handleEditSubmit}
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
            label="Full name"
            name="fullName"
            required
            defaultValue={student.fullName}
            autoComplete="off"
            error={fieldErrors.fullName}
            disabled={busy}
          />
          <Field
            label="Course / Section"
            name="courseSection"
            required
            defaultValue={student.courseSection}
            autoComplete="off"
            error={fieldErrors.courseSection}
            disabled={busy}
          />
          <Field
            label="Phone"
            name="phone"
            type="tel"
            autoComplete="off"
            placeholder="Optional"
            defaultValue={student.phone ?? ""}
            error={fieldErrors.phone}
            disabled={busy}
          />
        </form>
      </Modal>

      {/* Block / unblock ---------------------------------------------- */}
      <Modal
        open={dialog === "status"}
        onClose={closeDialog}
        title={blocking ? "Block account" : "Unblock account"}
        description={
          blocking
            ? `${student.fullName} will not be able to sign in until unblocked. Existing loans are unaffected (R-26).`
            : `${student.fullName} will be able to sign in again.`
        }
        footer={
          <>
            <Button variant="secondary" size="md" onClick={closeDialog} disabled={busy}>
              Cancel
            </Button>
            <Button
              size="md"
              variant={blocking ? "danger" : "primary"}
              onClick={handleStatusSubmit}
              loading={busy}
            >
              {blocking ? "Block account" : "Unblock account"}
            </Button>
          </>
        }
      >
        {formError ? (
          <div
            role="alert"
            className="rounded-md border border-error-500 bg-error-25 px-4 py-3 text-sm font-medium text-error-700"
          >
            {formError}
          </div>
        ) : (
          <p>
            {blocking
              ? "Blocked students are rejected at their next sign-in attempt."
              : "The student signs in with their Student ID as usual."}
          </p>
        )}
      </Modal>

      {/* Reset password ------------------------------------------------ */}
      <Modal
        open={dialog === "reset"}
        onClose={closeDialog}
        title="Reset password"
        description={`Set a new password for ${student.fullName}. There is no email reset flow (E8) — hand it over in person.`}
        footer={
          <>
            <Button variant="secondary" size="md" onClick={closeDialog} disabled={busy}>
              Cancel
            </Button>
            <Button
              size="md"
              type="submit"
              form="reset-password-form"
              loading={busy}
            >
              Reset password
            </Button>
          </>
        }
      >
        <form
          id="reset-password-form"
          onSubmit={handleResetSubmit}
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

          <PasswordField
            label="New password"
            name="newPassword"
            required
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            helper="Minimum 8 characters."
            error={fieldErrors.newPassword}
            disabled={busy}
            trailing={
              <button
                type="button"
                onClick={() => setNewPassword(generatePassword())}
                className="h-7 rounded-md border border-gray-300 bg-white px-2 text-xs font-medium text-gray-700 transition-colors duration-fast hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
              >
                Generate
              </button>
            }
          />
        </form>
      </Modal>

      {toast ? <Toast tone={toast.tone} message={toast.message} onClose={closeToast} /> : null}
    </>
  );
}
