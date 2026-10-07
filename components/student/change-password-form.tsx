"use client";

import { useState, type FormEvent } from "react";
import { changePassword, type ChangePasswordState } from "@/lib/auth/actions";
import { Button } from "@/components/ui/button";
import { PasswordField } from "@/components/auth/password-field";

/**
 * Change-password form (FR-06, R-05).
 *
 * The server action re-authenticates with the current password first
 * ("Current password is incorrect." is authoritative) and then calls
 * `auth.updateUser`. Field errors come back keyed by input name; the form is
 * only cleared after a successful change so a rejected attempt never loses
 * what the student typed.
 */
export function ChangePasswordForm() {
  const [state, setState] = useState<ChangePasswordState | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = event.currentTarget;
    setPending(true);
    try {
      const result = await changePassword(null, new FormData(form));
      setState(result);
      if (result.success) form.reset();
    } catch {
      // The action redirected (session ended) — navigation is in flight.
    } finally {
      setPending(false);
    }
  }

  const fieldErrors = state?.fieldErrors ?? {};

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
      {state?.error ? (
        <div
          role="alert"
          aria-live="assertive"
          className="rounded-md border border-error-500 bg-error-25 px-4 py-3 text-sm font-medium text-error-700"
        >
          {state.error}
        </div>
      ) : null}

      {state?.success ? (
        <div
          role="status"
          aria-live="polite"
          className="rounded-md border border-success-500 bg-success-25 px-4 py-3 text-sm font-medium text-success-700"
        >
          Password updated — use it the next time you sign in.
        </div>
      ) : null}

      <PasswordField
        label="Current password"
        name="currentPassword"
        autoComplete="current-password"
        required
        disabled={pending}
        error={fieldErrors.currentPassword}
      />

      <PasswordField
        label="New password"
        name="newPassword"
        autoComplete="new-password"
        required
        disabled={pending}
        helper="Minimum 8 characters."
        error={fieldErrors.newPassword}
      />

      <PasswordField
        label="Confirm new password"
        name="confirmPassword"
        autoComplete="new-password"
        required
        disabled={pending}
        error={fieldErrors.confirmPassword}
      />

      <Button type="submit" size="lg" loading={pending} className="self-start">
        {pending ? "Updating…" : "Change password"}
      </Button>
    </form>
  );
}
