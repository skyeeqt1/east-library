import type { Metadata } from "next";
import { Library } from "lucide-react";
import { LoginForm } from "@/components/auth/login-form";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to the ESCR Library with your Student ID or library account.",
};

/**
 * Public login route (FR-01). No sign-up / register link exists anywhere —
 * accounts are created by the library (R-01). Auth wiring: the form submits a
 * server action which sets the Supabase session cookie; middleware then
 * routes by role (FR-03).
 */
export default function LoginPage() {
  return (
    <div className="flex min-h-screen bg-white">
      {/* Branding panel */}
      <aside
        className="hidden w-1/2 flex-col justify-between bg-primary-700 p-12 text-white lg:flex"
        aria-hidden="true"
      >
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-lg bg-white/15">
            <Library className="size-6" strokeWidth={1.75} />
          </span>
          <span className="flex flex-col">
            <span className="text-lg font-semibold tracking-tight">ESCR</span>
            <span className="text-sm text-primary-100">Library</span>
          </span>
        </div>

        <div className="max-w-md">
          <p className="text-4xl font-semibold leading-tight tracking-tight">
            Borrow, track, and return — all in one place.
          </p>
          <p className="mt-4 text-base text-primary-100">
            Request books, watch your due dates, and keep an eye on your
            balance. Loans run for 7 days.
          </p>
        </div>

        <p className="text-sm text-primary-100">
          East Systems Colleges of Rizal
        </p>
      </aside>

      {/* Sign-in panel */}
      <main className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-[400px]">
          <div className="mb-10 flex items-center gap-3 lg:hidden">
            <span
              className="flex size-9 items-center justify-center rounded-lg bg-primary-500 text-white"
              aria-hidden="true"
            >
              <Library className="size-5" strokeWidth={1.75} />
            </span>
            <span className="flex flex-col">
              <span className="text-base font-semibold tracking-tight text-gray-900">
                ESCR
              </span>
              <span className="text-xs text-gray-500">Library</span>
            </span>
          </div>

          <h1 className="text-2xl font-semibold tracking-tight text-gray-900">
            Sign in
          </h1>
          <p className="mt-2 text-sm text-gray-500">
            Use your ESCR Student ID or your library account email.
          </p>

          <div className="mt-8">
            <LoginForm />
          </div>
        </div>
      </main>
    </div>
  );
}
