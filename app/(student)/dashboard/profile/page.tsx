import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ChangePasswordForm } from "@/components/student/change-password-form";
import { getCurrentProfile } from "@/lib/auth/guards";

export const metadata: Metadata = { title: "Profile" };

/** Reads the session cookie — blocking route (not statically prerenderable). */
export const instant = false;

const DATE_FORMAT = new Intl.DateTimeFormat("en-PH", {
  dateStyle: "long",
  timeZone: "Asia/Manila",
});

function formatDate(value: string | null): string {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : DATE_FORMAT.format(parsed);
}

/**
 * Student profile (FR-06, R-05) — read-only account card + change-password
 * form. Reads only the signed-in user's own `profiles` row (RLS-scoped),
 * and the shell uses the student nav variant so admin navigation is never
 * rendered for students.
 */
export default async function StudentProfilePage() {
  const me = await getCurrentProfile();
  if (!me) redirect("/login");

  const details: Array<{ label: string; value: React.ReactNode }> = [
    { label: "Full name", value: me.full_name },
    { label: "Student ID", value: <span className="font-mono">{me.student_id ?? "—"}</span> },
    { label: "Course / Section", value: me.course_section ?? "—" },
    { label: "Role", value: me.role === "ADMIN" ? "Administrator" : "Student" },
    { label: "Phone", value: me.phone ?? "—" },
    { label: "Member since", value: formatDate(me.created_at) },
    {
      label: "Status",
      value: (
        <Badge tone={me.status === "BLOCKED" ? "error" : "success"}>
          {me.status === "BLOCKED" ? "Blocked" : "Active"}
        </Badge>
      ),
    },
  ];

  return (
    <AppShell
      title="Profile"
      subtitle="Your library account details and password"
      navVariant="student"
      user={{ name: me.full_name, id: me.student_id ?? me.role }}
    >
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Read-only account card */}
        <section aria-labelledby="account-details-heading" className="flex flex-col gap-4">
          <h2 id="account-details-heading" className="text-lg font-semibold text-gray-900">
            Account details
          </h2>
          <Card>
            <dl className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              {details.map((item) => (
                <div key={item.label}>
                  <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">
                    {item.label}
                  </dt>
                  <dd className="mt-1 text-sm text-gray-900">{item.value}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-6 border-t border-gray-100 pt-4 text-xs text-gray-500">
              Your Student ID is your username — the library issues all
              passwords (R-05). Contact the library desk to correct any detail.
            </p>
          </Card>
        </section>

        {/* Change password */}
        <section aria-labelledby="change-password-heading" className="flex flex-col gap-4">
          <h2 id="change-password-heading" className="text-lg font-semibold text-gray-900">
            Change password
          </h2>
          <Card>
            <ChangePasswordForm />
          </Card>
        </section>
      </div>
    </AppShell>
  );
}
