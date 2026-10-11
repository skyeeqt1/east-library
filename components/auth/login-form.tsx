"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
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
 * • On success the action returns the role home and we `router.replace`
 *   it (FR-03) — replacing keeps /login out of the back history so
 *   BACK from the dashboard doesn't bounce through middleware.
 * • Failed attempt (FR-03 retry ergonomics): React resets the form when a
 *   server action settles, which also wiped the identifier and dropped focus
 *   to <body>. The identifier is now controlled so it survives; the password
 *   is intentionally left to the reset (a wrong password should never be
 *   retained) and focus lands back on it for an immediate retry.
 * • No sign-up / register / reset link exists anywhere on this page.
 */
export function LoginForm() {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  // Controlled so the reset React runs after the action cannot erase it.
  const [identifier, setIdentifier] = useState("");
  const [state, formAction, pending] = useActionState<LoginState | null, FormData>(
    login,
    null,
  );

  const identifierError = state?.fieldErrors?.identifier;
  const passwordError = state?.fieldErrors?.password;

  // Success: swap the /login history entry for the role home.
  useEffect(() => {
    if (state?.redirect) router.replace(state.redirect);
  }, [state, router]);

  // Failure: put the caret back in the password box (state identity changes
  // exactly once per settled attempt, so this fires per attempt, not render).
  useEffect(() => {
    if (!state?.error || state.redirect) return;
    formRef.current
      ?.querySelector<HTMLInputElement>('input[type="password"]')
      ?.focus();
  }, [state]);

  return (
    <form
      ref={formRef}
      action={formAction}
      noValidate
      className="flex flex-col gap-5"
    >
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
        value={identifier}
        onChange={(event) => setIdentifier(event.target.value)}
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
