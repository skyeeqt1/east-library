import type { Metadata } from "next";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/ui/stat-card";
import { ActivityTable } from "@/components/admin/dashboard/activity-table";
import { DashboardPagination } from "@/components/admin/dashboard/dashboard-pagination";
import {
  DashboardTabs,
  DashboardToolbar,
} from "@/components/admin/dashboard/dashboard-toolbar";
import { ExportReportButton } from "@/components/admin/reports/export-report-button";
import {
  DASHBOARD_PER_PAGE,
  buildDashboardPath,
  parseDashboardQuery,
} from "@/components/admin/dashboard/dashboard-query";
import {
  getAdminActivity,
  getAdminActivityCounts,
  getAdminDashboardStats,
} from "@/lib/catalog/activity-read";
import type { ActivityStatus, ActivityTab } from "@/lib/catalog/activity-types";
import { getCurrentProfile } from "@/lib/auth/guards";

export const metadata: Metadata = {
  title: "Library Dashboard",
};

/** Session cookie + searchParams are read per request — blocking route. */
export const instant = false;

type SearchParams = Promise<{
  tab?: string | string[];
  status?: string | string[];
  q?: string | string[];
  page?: string | string[];
}>;

/** Everything the page renders, loaded together (one failed read = error UI). */
interface LoadedDashboard {
  counts: Awaited<ReturnType<typeof getAdminActivityCounts>>;
  activity: Awaited<ReturnType<typeof getAdminActivity>>;
  stats: Awaited<ReturnType<typeof getAdminDashboardStats>>;
}

/** Singular tab word for empty-state copy — "pending" → "pending requests". */
const TAB_COPY: Record<
  ActivityTab,
  { label: string; body: string }
> = {
  all: {
    label: "activity",
    body: "Borrow activity will appear here as students request books.",
  },
  pending: {
    label: "pending requests",
    body: "New borrow requests land here the moment a student submits one.",
  },
  overdue: {
    label: "overdue activity",
    body: "Loans that pass their due date show up here automatically.",
  },
  returns: {
    label: "returns",
    body: "Finished loans are archived here with their return details.",
  },
  fines: {
    label: "fines",
    body: "Charges from overdue returns and damage assessments appear here.",
  },
};

/** Pill noun for empty-state copy — "active" → "active loans". */
const STATUS_COPY: Record<Exclude<ActivityStatus, "all">, string> = {
  pending: "pending requests",
  active: "active loans",
  overdue: "overdue loans",
  returned: "returned loans",
  unpaid: "unpaid fines",
};

/**
 * Pick the empty-state copy + CTA for the current URL state — priority
 * mirrors the other admin tables (rules of thumb: first explain the
 * *interaction* that emptied the page, then the filters, then the data):
 *
 *   1. out-of-range page  → escape hatch back to page 1,
 *   2. `q` search         → clear search,
 *   3. status pill        → show all statuses,
 *   4. single tab         → view all activity,
 *   5. fresh install (no titles, no filters) → create-books CTA,
 *   6. default            → the "no activity yet" baseline.
 */
function emptyState(opts: {
  onCurrentPage: boolean;
  q: string;
  status: ActivityStatus;
  tab: ActivityTab;
  totalBooks: number;
}): { title: string; body: string; action?: ReactNode } {
  const path = (overrides: Parameters<typeof buildDashboardPath>[0]) =>
    buildDashboardPath({ tab: opts.tab, status: opts.status, q: opts.q, ...overrides });

  if (opts.onCurrentPage) {
    return {
      title: "Nothing on this page.",
      body: "Return to the first page to see the rest of the activity.",
      action: (
        <Button variant="secondary" size="md" href={path({ page: 1 })}>
          Back to first page
        </Button>
      ),
    };
  }
  if (opts.q) {
    return {
      title: "No activity matches your search.",
      body: "Try a student name or number, or a book title or author.",
      action: (
        <Button variant="secondary" size="md" href={path({ q: "", page: 1 })}>
          Clear search
        </Button>
      ),
    };
  }
  if (opts.status !== "all") {
    return {
      title: `No ${STATUS_COPY[opts.status]} to show.`,
      body:
        opts.tab === "all"
          ? "Nothing with that status right now — try another pill."
          : `No ${STATUS_COPY[opts.status]} on this tab. Try another status pill or the All activity tab.`,
      action: (
        <Button
          variant="secondary"
          size="md"
          href={path({ status: "all", page: 1 })}
        >
          Show all statuses
        </Button>
      ),
    };
  }
  if (opts.tab !== "all") {
    return {
      title: `No ${TAB_COPY[opts.tab].label} yet.`,
      body: TAB_COPY[opts.tab].body,
      action: (
        <Button variant="secondary" size="md" href={path({ tab: "all", page: 1 })}>
          View all activity
        </Button>
      ),
    };
  }
  if (opts.totalBooks === 0) {
    return {
      title: "No activity yet.",
      body: "Borrow activity will appear here as students request books. Create books in the catalog to get started.",
      action: <Button size="md" href="/admin/books">Create books</Button>,
    };
  }
  return {
    title: "No activity yet.",
    body: "Borrow activity will appear here as students request books.",
  };
}

/**
 * Admin dashboard — FR-21 / design §5.
 *
 * Server component reading `searchParams` (tab, status pill, search `q`,
 * page) behind the session guard shared by every admin page. Three reads
 * run in parallel through the cookie-aware anon client (RLS applies,
 * schema.md §4):
 *
 *   - `getAdminActivityCounts()` — exact tab badge counters,
 *   - `getAdminActivity()`       — the paginated "Borrow activity" union
 *                                  (lib/catalog/activity-read.ts),
 *   - `getAdminDashboardStats()`  — the 3 stat cards + 14-day trends.
 *
 * Page rhythm per design §5: header → tabs → stat cards → toolbar →
 * table → pagination. Chrome (search + ⌘K, status pills, selection,
 * pagination) lives in `components/admin/dashboard/*` and writes only the
 * URL, so back/forward and deep links always reproduce the same view.
 */
export default async function AdminDashboardPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  // Block prerender validation before session/date work (Date.now() in supabase-js / formatRelativeTime).
  await connection();

  const { tab, status, q, page } = parseDashboardQuery(await searchParams);

  const me = await getCurrentProfile();
  if (!me) redirect("/login");

  let data: LoadedDashboard | null = null;
  try {
    const [counts, activity, stats] = await Promise.all([
      getAdminActivityCounts(),
      getAdminActivity({
        tab,
        q: q || undefined,
        status,
        page,
        perPage: DASHBOARD_PER_PAGE,
      }),
      getAdminDashboardStats(),
    ]);
    data = { counts, activity, stats };
  } catch {
    data = null; // surface a readable error instead of an empty table
  }

  const rows = data?.activity.rows ?? [];
  const total = data?.activity.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / DASHBOARD_PER_PAGE));
  const onCurrentPage = page > pageCount;
  const empty = emptyState({
    onCurrentPage,
    q,
    status,
    tab,
    totalBooks: data?.stats.totalBooks ?? 0,
  });

  return (
    <AppShell
      title="Library Dashboard"
      navVariant="admin"
      user={{ name: me.full_name, id: me.student_id ?? "LIBRARIAN" }}
      actions={
        <>
          <Button variant="secondary" size="md" href="/dashboard">
            Switch dashboard
          </Button>
          {/* CSV download (FR-23) — a plain link, so `next/link` prefetch
              never fires for a file response. */}
          <ExportReportButton />
        </>
      }
    >
      <div className="flex flex-col gap-6">
        {data === null ? (
          <div
            role="alert"
            className="rounded-lg border border-error-500 bg-error-25 px-6 py-10 text-center"
          >
            <p className="text-sm font-medium text-error-700">
              Could not load the dashboard.
            </p>
            <p className="mt-1 text-sm text-error-700">
              Please try again in a moment.
            </p>
          </div>
        ) : (
          <>
            {/* Tab row with live counts (design §5.1) */}
            <DashboardTabs tab={tab} counts={data.counts} q={q} />

            {/* Three stat cards with deltas + 14-day sparklines (design §5.2) */}
            <section
              aria-label="Key metrics"
              className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3"
            >
              <StatCard
                title="Total books"
                value={data.stats.totalBooks}
                delta={data.stats.deltas.totalBooks}
                data={data.stats.trends.totalBooks}
              />
              <StatCard
                title="Active loans"
                value={data.stats.activeLoans}
                delta={data.stats.deltas.activeLoans}
                data={data.stats.trends.activeLoans}
              />
              <StatCard
                title="Overdue this week"
                value={data.stats.overdueThisWeek}
                delta={data.stats.deltas.overdueThisWeek}
                valueClassName={
                  data.stats.overdueThisWeek > 0 ? "text-error-700" : undefined
                }
                data={data.stats.trends.overdue}
              />
            </section>

            {/* Borrow activity section: search + ⌘K, status pills, count (§5.3) */}
            <section aria-labelledby="borrow-activity-heading">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
                <h2
                  id="borrow-activity-heading"
                  className="text-lg font-semibold text-gray-900"
                >
                  Borrow activity
                </h2>
              </div>

              <div className="mb-4">
                <DashboardToolbar
                  tab={tab}
                  status={status}
                  q={q}
                  total={total}
                  truncated={data.activity.truncated}
                />
              </div>

              <ActivityTable
                rows={rows}
                empty={empty}
                footer={
                  <DashboardPagination
                    page={page}
                    pageCount={pageCount}
                    tab={tab}
                    status={status}
                    q={q}
                  />
                }
              />
            </section>
          </>
        )}
      </div>
    </AppShell>
  );
}
