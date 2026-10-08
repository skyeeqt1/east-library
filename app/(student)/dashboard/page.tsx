import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  ArrowRight,
  BookOpen,
  CircleAlert,
  CircleCheck,
  ClipboardList,
  History,
  TriangleAlert,
} from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Badge, toneForStatus } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { DashboardLoanCard } from "@/components/student/dashboard-loan-card";
import {
  CountdownChip,
  countdownFor,
  withOwedAmount,
} from "@/components/student/countdown-chip";
import {
  getStudentLoans,
  type StudentLoanRow,
} from "@/lib/catalog/loans-read";
import { getBlockingNotices } from "@/lib/catalog/fines-read";
import { getCurrentProfile } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { cn, formatPeso, formatRelativeTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Dashboard" };

/** Session cookie is read per request — blocking route. */
export const instant = false;

/** One row of the request mini-feed (pending, or approved awaiting pickup). */
interface FeedRow {
  id: string;
  status: "PENDING" | "APPROVED";
  title: string;
  created_at: string;
}

/** Everything the page renders, loaded together (one failed read = error UI). */
interface DashboardData {
  /** Open loans (ACTIVE + OVERDUE), most urgent first — §6 "My active loans". */
  openLoans: StudentLoanRow[];
  /** Exact open-loan count behind the "Books out" hero card. */
  openTotal: number;
  /** Newest RETURNED loans — the "Recent activity" section. */
  returnedLoans: StudentLoanRow[];
  /** Unpaid balance in centavos (R-27 — always computed). */
  balanceCentavos: number;
  /** PENDING requests + APPROVED-but-unreleased requests (the mini feed). */
  feed: FeedRow[];
  /** R-25 blocking banners — unpaid OVERDUE / DAMAGE notices (Phase 5). */
  notices: string[];
}

/** "Oct 15, 2026" for banner due dates (Manila, R-30). */
const DATE_FORMAT = new Intl.DateTimeFormat("en-PH", {
  dateStyle: "medium",
  timeZone: "Asia/Manila",
});

function formatDate(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : DATE_FORMAT.format(parsed);
}

/** "Oct 15" for the Due card subtitle ("Next: Oct 15"). */
const DAY_FORMAT = new Intl.DateTimeFormat("en-PH", {
  month: "short",
  day: "numeric",
  timeZone: "Asia/Manila",
});

function formatNextDue(isoDate: string): string {
  const parsed = new Date(isoDate);
  return Number.isNaN(parsed.getTime()) ? isoDate : DAY_FORMAT.format(parsed);
}

/** First name for the greeting banner ("Hello, Maria!"). */
function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}

/** Avatar initials for the greeting banner (decorative — aria-hidden). */
function initialsOf(fullName: string): string {
  return fullName
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/** Raw joined row from the mini-feed query (FK embed arrives object-or-array). */
interface JoinedFeedRow {
  id: string;
  status: string;
  loan_id: string | null;
  created_at: string;
  book: { title: string } | { title: string }[] | null;
}

function embedTitle(book: JoinedFeedRow["book"]): string {
  if (book === null) return "";
  return Array.isArray(book) ? (book[0]?.title ?? "") : book.title;
}

/** Due-soon / overdue banner copy — rules.md §11 / §12 (US-6). */
interface DueBanner {
  tone: "warning" | "error";
  text: string;
}

/**
 * Rules.md §12 notification banners, derived from the most urgent open loan:
 *
 *   overdue         → red banner + running ₱ balance (the sweep's figure;
 *                     ₱0.00 on day one is honest — "fines update daily")
 *   due today / ≤1d → warning banner naming the title and the due date
 *                     ("Due tomorrow — return {title} by {date} to avoid a fine.")
 *   otherwise       → no banner
 */
function bannerFor(urgent: StudentLoanRow | null, balance: number): DueBanner | null {
  if (!urgent) return null;
  const due = formatDate(urgent.due_date);

  if (urgent.days_late !== undefined && urgent.days_late > 0) {
    return {
      tone: "error",
      text:
        balance > 0
          ? `Overdue — return ${urgent.title} (due ${due}) now to stop more charges. You owe ${formatPeso(balance)}.`
          : `Overdue — return ${urgent.title} (due ${due}) now. You owe ${formatPeso(0)} — fines update daily.`,
    };
  }
  if (urgent.days_remaining === 0) {
    return {
      tone: "warning",
      text: `Due today — return ${urgent.title} by ${due} to avoid a fine.`,
    };
  }
  if (urgent.days_remaining === 1) {
    return {
      tone: "warning",
      text: `Due tomorrow — return ${urgent.title} by ${due} to avoid a fine.`,
    };
  }
  return null;
}

/**
 * Student dashboard (US-6 / FR-22, design §6) — greeting banner + R-25
 * blocking notices + due/overdue awareness banner + three hero cards +
 * "My active loans" countdown cards + pending-request feed + recent activity.
 *
 * Loan data comes from `getStudentLoans()` (Phase 4): the open listing feeds
 * "Books out" (total), the "Due soon" hero countdown (row 0 = earliest due
 * date, most urgent first) and the "My active loans" cards; the returned
 * listing feeds "Recent activity". The balance comes from the computed
 * `student_balances` view (R-27), and the feed mixes PENDING requests with
 * APPROVED requests that have not been released yet (loan_id NULL — awaiting
 * pickup).
 */
export default async function StudentDashboardPage() {
  const me = await getCurrentProfile();
  if (!me) redirect("/login");

  let data: DashboardData | null = null;
  try {
    const supabase = await createClient();

    const [openListing, returnedListing, balanceRes, requestsRes] =
      await Promise.all([
        getStudentLoans(me.id, { page: 1, perPage: 10 }),
        getStudentLoans(me.id, { status: "RETURNED", page: 1, perPage: 3 }),
        // R-27 — computed unpaid balance for this student only.
        supabase
          .from("student_balances")
          .select("balance_centavos")
          .eq("student_id", me.id)
          .maybeSingle(),
        // Mini-feed: PENDING + APPROVED awaiting pickup (released rows dropped
        // below — their loan exists, so the desk hand-over already happened).
        supabase
          .from("loan_requests")
          .select("id, status, loan_id, created_at, book:books(title)")
          .eq("student_id", me.id)
          .in("status", ["PENDING", "APPROVED"])
          .order("created_at", { ascending: false })
          .limit(20),
      ]);
    if (requestsRes.error) throw new Error(requestsRes.error.message);

    // R-25 blocking banners (Phase 5): best-effort — if this read fails the
    // banners are skipped, while the hard block still applies server-side in
    // getRequestEligibility (R-31).
    let notices: string[] = [];
    try {
      notices = await getBlockingNotices(me.id);
    } catch {
      notices = [];
    }

    const feed: FeedRow[] = ((requestsRes.data ?? []) as unknown as JoinedFeedRow[])
      .filter((row) => !(row.status === "APPROVED" && row.loan_id !== null))
      .slice(0, 5)
      .map((row) => ({
        id: row.id,
        status: row.status === "APPROVED" ? "APPROVED" : "PENDING",
        title: embedTitle(row.book),
        created_at: row.created_at,
      }));

    data = {
      openLoans: openListing.rows,
      openTotal: openListing.total,
      returnedLoans: returnedListing.rows,
      balanceCentavos:
        (!balanceRes.error && balanceRes.data
          ? (balanceRes.data as { balance_centavos: number }).balance_centavos
          : 0) ?? 0,
      feed,
      notices,
    };
  } catch {
    data = null; // surface a readable error instead of fake zeros
  }

  const balance = data?.balanceCentavos ?? 0;
  const urgent = data?.openLoans[0] ?? null;
  const banner = data === null ? null : bannerFor(urgent, balance);

  // Hero "Due soon" — the design §6 countdown chip on the most urgent loan.
  const dueCountdown = urgent
    ? withOwedAmount(countdownFor(urgent), urgent.fine)
    : null;
  const nextDue = urgent?.due_date ?? null;

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
        {/* Greeting banner — design §6: soft violet gradient + avatar */}
        <div className="flex items-center justify-between gap-4 rounded-lg bg-primary-600 bg-linear-to-r from-primary-500 to-primary-700 px-6 py-8 text-white shadow-xs">
          <div className="min-w-0">
            <p className="text-2xl font-semibold tracking-tight">
              Hello, {firstName(me.full_name)}!
            </p>
            {identity ? (
              <p className="mt-1 text-sm text-primary-100">{identity}</p>
            ) : null}
          </div>
          <span
            aria-hidden="true"
            className="flex size-12 shrink-0 items-center justify-center rounded-full bg-white/20 text-base font-semibold text-white"
          >
            {initialsOf(me.full_name)}
          </span>
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
            {/* R-25 balance banners (Phase 5) — unpaid OVERDUE / DAMAGE lines
                complement (never replace) the server-side request block */}
            {data.notices.length > 0 ? (
              <div role="status" className="flex flex-col gap-2">
                {data.notices.map((notice) => (
                  <div
                    key={notice}
                    className="flex items-start gap-3 rounded-lg border border-error-500/30 bg-error-25 px-4 py-3 text-sm font-medium text-error-700"
                  >
                    <CircleAlert
                      className="mt-0.5 size-5 shrink-0 text-error-500"
                      aria-hidden="true"
                    />
                    <p>{notice}</p>
                  </div>
                ))}
              </div>
            ) : null}

            {/* rules §12: red overdue banner (with running ₱) · warning
                "due in ≤ 1 day" banner naming the title and due date */}
            {banner ? (
              <div
                role="status"
                className={cn(
                  "flex items-start gap-3 rounded-lg border px-4 py-3 text-sm font-medium",
                  banner.tone === "error"
                    ? "border-error-500/30 bg-error-25 text-error-700"
                    : "border-warning-500/30 bg-warning-25 text-warning-700",
                )}
              >
                <TriangleAlert
                  className={cn(
                    "mt-0.5 size-5 shrink-0",
                    banner.tone === "error"
                      ? "text-error-500"
                      : "text-warning-500",
                  )}
                  aria-hidden="true"
                />
                <p>{banner.text}</p>
              </div>
            ) : null}

            {/* Three hero cards — prd US-6 (design §4.2 grid: 1 → 2 → 3) */}
            <section
              aria-label="Your library at a glance"
              className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3"
            >
              <StatCard
                title="Books out"
                value={data.openTotal}
                data={[]}
              />
              <StatCard
                title="Due soon"
                value={
                  dueCountdown ? (
                    <CountdownChip countdown={dueCountdown} className="text-base" />
                  ) : (
                    "—"
                  )
                }
                subtitle={
                  nextDue
                    ? `Next: ${formatNextDue(nextDue)}`
                    : "No books out right now"
                }
                data={[]}
              />
              <StatCard
                title="Balance ₱"
                value={formatPeso(balance)}
                valueClassName={
                  balance > 0 ? "text-error-700" : "text-success-700"
                }
                trailing={
                  balance > 0 ? undefined : (
                    <span className="flex items-center gap-1 text-success-700">
                      <CircleCheck className="size-5" aria-hidden="true" />
                      <span className="sr-only">All settled</span>
                    </span>
                  )
                }
                data={[]}
              />
            </section>

            {/* My active loans — design §6 countdown cards */}
            <section aria-labelledby="active-loans-heading">
              <div className="mb-4 flex items-center justify-between gap-4">
                <h2
                  id="active-loans-heading"
                  className="text-lg font-semibold text-gray-900"
                >
                  My active loans
                </h2>
                {data.openLoans.length > 0 ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    href="/dashboard/loans"
                  >
                    View all
                    <ArrowRight className="size-4" aria-hidden="true" />
                  </Button>
                ) : null}
              </div>

              {data.openLoans.length === 0 ? (
                <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-6 py-8 text-center">
                  <span
                    className="mx-auto flex size-11 items-center justify-center rounded-full bg-white text-primary-500 shadow-xs"
                    aria-hidden="true"
                  >
                    <BookOpen className="size-5" strokeWidth={1.75} />
                  </span>
                  <p className="mt-4 text-sm font-semibold text-gray-900">
                    No books checked out.
                  </p>
                  <p className="mx-auto mt-1 max-w-md text-sm text-gray-500">
                    Browse the catalog and request a title — approved books
                    appear here with their countdowns.
                  </p>
                  <Button size="sm" href="/dashboard/catalog" className="mt-4">
                    Browse catalog
                  </Button>
                </div>
              ) : (
                <ul className="flex list-none flex-col gap-4 p-0">
                  {data.openLoans.slice(0, 5).map((row) => (
                    <li key={row.id}>
                      <DashboardLoanCard row={row} />
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Request mini-feed — pending + approved awaiting pickup */}
            <section aria-labelledby="requests-heading">
              <div className="mb-4 flex items-center justify-between gap-4">
                <h2
                  id="requests-heading"
                  className="text-lg font-semibold text-gray-900"
                >
                  Pending requests
                </h2>
                <Button variant="secondary" size="sm" href="/dashboard/requests">
                  View all
                  <ArrowRight className="size-4" aria-hidden="true" />
                </Button>
              </div>

              {data.feed.length === 0 ? (
                <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-6 py-8 text-center">
                  <p className="text-sm font-semibold text-gray-900">
                    No requests yet.
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
                    {data.feed.map((request) => (
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
                                {request.status === "APPROVED" ? (
                                  "Approved — pick up at the library desk."
                                ) : (
                                  <>
                                    Requested {formatRelativeTime(request.created_at)} ·
                                    awaiting approval
                                  </>
                                )}
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

            {/* Recent activity — newest returns (history tab has the rest) */}
            <section aria-labelledby="recent-activity-heading">
              <h2
                id="recent-activity-heading"
                className="mb-4 text-lg font-semibold text-gray-900"
              >
                Recent activity
              </h2>
              {data.returnedLoans.length === 0 ? (
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
              ) : (
                <Card padded={false}>
                  <ul className="divide-y divide-gray-100 p-0">
                    {data.returnedLoans.map((row) => (
                      <li
                        key={row.id}
                        className="flex items-center justify-between gap-4 px-5 py-4"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-gray-900">
                            {row.title}
                          </p>
                          <p className="text-xs text-gray-500">
                            Returned {formatDate(row.returned_at ?? row.released_at)}
                            {row.condition_on_return === "DAMAGED"
                              ? " · Condition: Damaged"
                              : null}
                          </p>
                        </div>
                        <Badge tone={toneForStatus(row.status)}>
                          {row.status === "RETURNED" ? "Returned" : row.status}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
            </section>
          </>
        )}
      </div>
    </AppShell>
  );
}
