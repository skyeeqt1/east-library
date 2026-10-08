import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ArrowRight, ClipboardList, History } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { getStudentRequests } from "@/lib/catalog/requests-read";
import { getCurrentProfile } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { formatPeso, formatRelativeTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Dashboard" };

/** Session cookie is read per request — blocking route. */
export const instant = false;

const DUE_SOON_DAYS = 3;

/** Everything the page renders, loaded together (one failed read = error UI). */
interface DashboardData {
  /** Open loans (ACTIVE | OVERDUE) — Phase 4/5 keep this at 0 for now. */
  booksOut: number;
  /** Loans due within `DUE_SOON_DAYS`, in Asia/Manila (R-30). */
  dueSoon: number;
  /** Unpaid balance in centavos (R-27 — always computed). */
  balanceCentavos: number;
  /** Newest PENDING requests — the mini feed under the hero cards. */
  pending: Awaited<ReturnType<typeof getStudentRequests>>;
}

/** Today's business date in Asia/Manila as `YYYY-MM-DD` (R-30). */
function manilaToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(
    new Date(),
  );
}

/** `YYYY-MM-DD` + n days via UTC math (no local-timezone drift). */
function plusDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  const yy = shifted.getUTCFullYear();
  const mm = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(shifted.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** First name for the greeting banner ("Hello, Maria!"). */
function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}

/**
 * Student dashboard (US-6 / FR-22, design §6) — greeting banner + three
 * hero cards ("Books out" · "Due soon" · "Balance ₱"), a pending-request
 * mini-feed, and a recent-activity fallback.
 *
 * Loan counters read the real `loans` table (ACTIVE | OVERDUE, due dates
 * evaluated in Asia/Manila) — they correctly report **0** until Phase 4/5
 * release books; the balance comes from the computed `student_balances` view
 * (R-27, RLS-scoped query filtered to the signed-in student).
 */
export default async function StudentDashboardPage() {
  const me = await getCurrentProfile();
  if (!me) redirect("/login");

  let data: DashboardData | null = null;
  try {
    const supabase = await createClient();
    const today = manilaToday();
    const dueCutoff = plusDays(today, DUE_SOON_DAYS);

    const [outRes, dueRes, balanceRes, pending] = await Promise.all([
      // Open loans = ACTIVE or OVERDUE (returned loans never count).
      supabase
        .from("loans")
        .select("id", { count: "exact", head: true })
        .eq("student_id", me.id)
        .in("status", ["ACTIVE", "OVERDUE"]),
      // Due within 3 days — due today through +3 (R-30: date-only column).
      supabase
        .from("loans")
        .select("id", { count: "exact", head: true })
        .eq("student_id", me.id)
        .in("status", ["ACTIVE", "OVERDUE"])
        .gte("due_date", today)
        .lte("due_date", dueCutoff),
      // R-27 — computed unpaid balance for this student only.
      supabase
        .from("student_balances")
        .select("balance_centavos")
        .eq("student_id", me.id)
        .maybeSingle(),
      getStudentRequests(me.id, {
        status: "PENDING",
        page: 1,
        perPage: 5,
      }),
    ]);
    if (outRes.error) throw new Error(outRes.error.message);
    if (dueRes.error) throw new Error(dueRes.error.message);

    data = {
      booksOut: outRes.count ?? 0,
      dueSoon: dueRes.count ?? 0,
      balanceCentavos:
        (!balanceRes.error && balanceRes.data
          ? (balanceRes.data as { balance_centavos: number }).balance_centavos
          : 0) ?? 0,
      pending,
    };
  } catch {
    data = null; // surface a readable error instead of fake zeros
  }

  const balance = data?.balanceCentavos ?? 0;
  const identity = [me.student_id, me.course_section]
    .filter((value): value is string => Boolean(value))
    .join(" · ");

  return (
    <AppShell
      title="Dashboard"
      navVariant="student"
      user={{ name: me.full_name, id: me.student_id ?? me.role }}
    >
      <div className="flex flex-col gap-6">
        {/* Greeting banner — design §6 */}
        <div className="rounded-lg bg-primary-600 bg-linear-to-r from-primary-500 to-primary-700 px-6 py-8 text-white shadow-xs">
          <p className="text-2xl font-semibold tracking-tight">
            Hello, {firstName(me.full_name)}!
          </p>
          {identity ? (
            <p className="mt-1 text-sm text-primary-100">{identity}</p>
          ) : null}
        </div>

        {data === null ? (
          <div
            role="alert"
            className="rounded-lg border border-error-500 bg-error-25 px-6 py-10 text-center"
          >
            <p className="text-sm font-medium text-error-700">
              Could not load your dashboard.
            </p>
            <p className="mt-1 text-sm text-error-700">
              Please try again in a moment.
            </p>
          </div>
        ) : (
          <>
            {/* Three hero cards — prd US-6 (design §4.2 grid: 1 → 2 → 3) */}
            <section
              aria-label="Your library at a glance"
              className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3"
            >
              <StatCard title="Books out" value={data.booksOut} data={[]} />
              <StatCard
                title="Due soon"
                value={data.dueSoon}
                data={[]}
              />
              <StatCard
                title="Balance ₱"
                value={formatPeso(balance)}
                valueClassName={
                  balance > 0 ? "text-error-700" : "text-success-700"
                }
                data={[]}
              />
            </section>

            {/* Pending requests mini-feed — design §6 */}
            <section aria-labelledby="pending-requests-heading">
              <div className="mb-4 flex items-center justify-between gap-4">
                <h2
                  id="pending-requests-heading"
                  className="text-lg font-semibold text-gray-900"
                >
                  Pending requests
                </h2>
                <Button variant="secondary" size="sm" href="/dashboard/requests">
                  View all
                  <ArrowRight className="size-4" aria-hidden="true" />
                </Button>
              </div>

              {data.pending.rows.length === 0 ? (
                <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-6 py-8 text-center">
                  <p className="text-sm font-semibold text-gray-900">
                    No pending requests.
                  </p>
                  <p className="mx-auto mt-1 max-w-md text-sm text-gray-500">
                    Request a book from the catalog and it will wait here for
                    the library&apos;s approval.
                  </p>
                  <Button size="sm" href="/dashboard/catalog" className="mt-4">
                    Browse catalog
                  </Button>
                </div>
              ) : (
                <Card padded={false}>
                  <ul className="divide-y divide-gray-100 p-0">
                    {data.pending.rows.map((request) => (
                      <li key={request.id}>
                        <a
                          href="/dashboard/requests"
                          className="flex items-center justify-between gap-4 px-5 py-4 transition-colors duration-fast hover:bg-gray-25 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary-500"
                        >
                          <span className="flex min-w-0 items-center gap-3">
                            <span
                              aria-hidden="true"
                              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-25 text-primary-700"
                            >
                              <ClipboardList className="size-4" strokeWidth={1.75} />
                            </span>
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-medium text-gray-900">
                                {request.title}
                              </span>
                              <span className="block text-xs text-gray-500">
                                Requested {formatRelativeTime(request.created_at)} ·
                                awaiting approval
                              </span>
                            </span>
                          </span>
                          <ArrowRight
                            className="size-4 shrink-0 text-gray-400"
                            aria-hidden="true"
                          />
                        </a>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
            </section>

            {/* Recent activity — Phase 4/5 wire real loan history */}
            <section aria-labelledby="recent-activity-heading">
              <h2
                id="recent-activity-heading"
                className="mb-4 text-lg font-semibold text-gray-900"
              >
                Recent activity
              </h2>
              <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-6 py-8 text-center">
                <span
                  className="mx-auto flex size-11 items-center justify-center rounded-full bg-white text-primary-500 shadow-xs"
                  aria-hidden="true"
                >
                  <History className="size-5" strokeWidth={1.75} />
                </span>
                <p className="mt-4 text-sm font-semibold text-gray-900">
                  No recent activity yet.
                </p>
                <p className="mx-auto mt-1 max-w-md text-sm text-gray-500">
                  Books you borrow and return will appear here with their due
                  dates.
                </p>
              </div>
            </section>
          </>
        )}
      </div>
    </AppShell>
  );
}
