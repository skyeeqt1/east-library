import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { History } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Card } from "@/components/ui/card";
import { SettingsForm } from "@/components/admin/settings/settings-form";
import { getLibrarySettings, getSettingsAudit, type SettingsAuditRow } from "@/lib/catalog/settings-read";
import { getCurrentProfile } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { SETTING_LABELS, type LibrarySettings } from "@/lib/validations/settings";
import { formatPeso, formatRelativeTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Settings" };

/**
 * Session cookie + settings reads happen per request — blocking route
 * (Cache Components: `instant = false`, same as every other admin page).
 */
export const instant = false;

/** Title + absolute timestamp behind the relative time (design §4.4 meta). */
function RelativeTime({ iso }: { iso: string }) {
  return (
    <time dateTime={iso} title={new Date(iso).toLocaleString("en-PH")}>
      {formatRelativeTime(iso)}
    </time>
  );
}

/** `settings.key` → display label (falls back to the raw key). */
function labelFor(key: string): string {
  return key in SETTING_LABELS
    ? SETTING_LABELS[key as keyof typeof SETTING_LABELS]
    : key;
}

/** Format one before/after snapshot value for the audit summary line. */
function auditValue(key: string, value: unknown): string {
  if (value === undefined || value === null) return "—";
  if (key === "overdue_fee_per_day_centavos") {
    const centavos = Number(value);
    if (Number.isFinite(centavos)) return formatPeso(Math.round(centavos));
  }
  if (typeof value === "boolean") return value ? "On" : "Off";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * One audit row's changes: `Loan period: 7 → 8 · Overdue fee per day:
 * ₱10.00 → ₱12.00`. Keys come from `after` (the new snapshot); a key present
 * only in `before` still renders so a partial snapshot never hides history.
 */
function summarizeChanges(row: SettingsAuditRow): Array<{
  key: string;
  label: string;
  before: string;
  after: string;
}> {
  const before = (row.before ?? {}) as Record<string, unknown>;
  const after = (row.after ?? {}) as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(after), ...Object.keys(before)])];
  return keys.map((key) => ({
    key,
    label: labelFor(key),
    before: auditValue(key, before[key]),
    after: auditValue(key, after[key]),
  }));
}

/**
 * Admin → Settings (Phase 8a — rules.md §1 §8; FR-14…FR-16 / R-29…R-32).
 *
 * Four sections:
 *   1. **Loan & request limits** + 2. **Fines** — rendered inside the single
 *      save-all `SettingsForm` (client), which posts to the
 *      `updateLibrarySettings` server action (R-31 admin re-verification,
 *      R-29/§8 `settings-change` audit row per write);
 *   3. **Admin account** — read-only identity card (name / email / role /
 *      last sign-in) straight from the session;
 *   4. **Recent configuration changes** — the newest `settings-change` audit
 *      rows (R-32), actor names resolved by `getSettingsAudit()` because
 *      `audit_logs.actor_id` has no FK to embed (migration 0005).
 *
 * Sections 3–4 are server components passed as `children` of the client form
 * so the "Save changes" button sits at the very bottom of the page while the
 * read-only content stays on the server. Reads use the cookie-aware anon
 * client so RLS applies (schema §4); nothing here writes.
 */
export default async function AdminSettingsPage() {
  // Block prerender validation before any session/date work — `formatRelativeTime`
  // calls Date.now(), which Next flags as unstable if evaluated in a prerender pass.
  await connection();
  // Profile, session identity (email + last sign-in) and the settings/audit
  // reads are independent — run the three waves concurrently.
  const supabase = await createClient();
  const [me, sessionRes, dataResult] = await Promise.all([
    getCurrentProfile(),
    supabase.auth.getUser(),
    (async () => {
      try {
        return await Promise.all([getLibrarySettings(), getSettingsAudit(10)]);
      } catch {
        return null; // surface a readable error instead of a broken form
      }
    })(),
  ]);
  if (!me) redirect("/login");

  const user = sessionRes.data.user;
  const settings: LibrarySettings | null = dataResult?.[0] ?? null;
  const audit: SettingsAuditRow[] = dataResult?.[1] ?? [];

  const details: Array<{ label: string; value: React.ReactNode }> = [
    { label: "Full name", value: me.full_name },
    { label: "Email", value: user?.email ?? "—" },
    { label: "Role", value: me.role === "ADMIN" ? "Administrator" : "Student" },
    {
      label: "Last sign-in",
      value: user?.last_sign_in_at ? (
        <RelativeTime iso={user.last_sign_in_at} />
      ) : (
        "—"
      ),
    },
  ];

  const accountSection = (
    <section aria-labelledby="admin-account-heading" className="flex flex-col gap-4">
      <h2 id="admin-account-heading" className="text-lg font-semibold text-gray-900">
        Admin account
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
          Account changes are handled by the library desk. Configuration below
          applies to every student, so each save is written to the audit trail
          (R-32).
        </p>
      </Card>
    </section>
  );

  const auditSection = (
    <section aria-labelledby="settings-audit-heading" className="flex flex-col gap-4">
      <h2 id="settings-audit-heading" className="text-lg font-semibold text-gray-900">
        Recent configuration changes
      </h2>
      {audit.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-6 py-10 text-center">
          <span
            className="mx-auto flex size-11 items-center justify-center rounded-full bg-white text-primary-500 shadow-xs"
            aria-hidden="true"
          >
            <History className="size-5" strokeWidth={1.75} />
          </span>
          <p className="mt-4 text-sm font-semibold text-gray-900">
            No configuration changes recorded yet.
          </p>
          <p className="mx-auto mt-1 max-w-md text-sm text-gray-500">
            Every save above stores who changed what, and when (R-32).
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {audit.map((row) => {
            const changes = summarizeChanges(row);
            return (
              <li key={row.id}>
                <Card className="px-5 py-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <p className="text-sm font-medium text-gray-900">
                      {row.actor_name ?? "Unknown actor"}
                    </p>
                    <RelativeTime iso={row.created_at} />
                  </div>
                  <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                    {changes.map((change) => (
                      <li
                        key={change.key}
                        className="text-xs text-gray-600"
                      >
                        <span className="font-medium text-gray-700">
                          {change.label}:
                        </span>{" "}
                        <span className="font-mono">
                          {change.before} → {change.after}
                        </span>
                      </li>
                    ))}
                  </ul>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );

  return (
    <AppShell
      title="Settings"
      subtitle="Library rules §1 configuration — every save is audit-logged (R-31 / R-32)."
      navVariant="admin"
      user={{ name: me.full_name, id: me.student_id ?? "LIBRARIAN" }}
    >
      {/* escr-landing-page: auto-marker cascades all content blocks */}
      <div className="escr-landing-page flex flex-col gap-6">
        {settings === null ? (
          <div
            role="alert"
            className="rounded-lg border border-error-500 bg-error-25 px-6 py-10 text-center"
          >
            <p className="text-sm font-medium text-error-700">
              Could not load the settings.
            </p>
            <p className="mt-1 text-sm text-error-700">
              Please try again in a moment.
            </p>
          </div>
        ) : (
          /* Single save-all form: sections 1–2 + these read-only children,
             with the Save button at the bottom of the page. */
          <SettingsForm initial={settings}>
            {accountSection}
            {auditSection}
          </SettingsForm>
        )}
      </div>
    </AppShell>
  );
}
