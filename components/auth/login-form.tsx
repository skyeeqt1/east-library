"use client";

import { useActionState } from "react";
import { login, type LoginState } from "@/lib/auth/actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/input";
import { PasswordField } from "@/components/auth/password-field";

/**
 * Login form — FR-01 / FR-02 / R-01.
 *
 * • Single identifier field ("Student ID or Email") + password (show/hide).
 * • Zod validation runs inside the server action and echoes field errors.
 * • Generic credentials error (never reveals whether the account exists,
 *   R-04) rendered in an assertive live region; blocked accounts get the
 *   explicit R-04 message.
 * • On success the server action redirects by role (FR-03).
 * • No sign-up / register / reset link exists anywhere on this page.
 */
export function LoginForm() {
  const [state, formAction, pending] = useActionState<LoginState | null, FormData>(
    login,
    null,
  );

  const identifierError = state?.fieldErrors?.identifier;
  const passwordError = state?.fieldErrors?.password;

  return (
    <form action={formAction} noValidate className="flex flex-col gap-5">
      {state?.error ? (
        <div
          role="alert"
          aria-live="assertive"
          className="rounded-md border border-error-500 bg-error-25 px-4 py-3 text-sm font-medium text-error-700"
        >
          {state.error}
        </div>
      ) : null}

      <Field
        label="Student ID or Email"
        name="identifier"
        type="text"
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        placeholder="e.g. 2024-1056"
        required
        error={identifierError}
        disabled={pending}
      />

      <PasswordField
        label="Password"
        name="password"
        autoComplete="current-password"
        required
        error={passwordError}
        disabled={pending}
      />

      <Button type="submit" size="lg" className="w-full" loading={pending}>
        {pending ? "Signing in…" : "Sign In"}
      </Button>

      <p className="text-xs text-gray-500">
        Accounts are created by the library. If you don&apos;t have one, contact
        the library desk — the system has no sign-up.
      </p>
    </form>
  );
}
