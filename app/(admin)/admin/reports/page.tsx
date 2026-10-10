import type { Metadata } from "next";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Activity, BookOpen, CircleAlert, History, Library, Receipt } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { StatCard } from "@/components/ui/stat-card";
import {
  PrimaryCell,
  Table,
  TableBody,
  TableHead,
  Td,
  Th,
  Tr,
} from "@/components/ui/table";
import {
  ReportBarList,
  ReportEmptyState,
  ReportSection,
  formatDayLabel,
} from "@/components/admin/reports/report-sections";
import { ReportsTabs } from "@/components/admin/reports/reports-tabs";
import { ExportReportButton } from "@/components/admin/reports/export-report-button";
import { PrintButton } from "@/components/admin/reports/print-button";
import { parseReportsQuery } from "@/components/admin/reports/reports-query";
import {
  getCirculationReport,
  getCollectionsReport,
  REPORT_TREND_DAYS,
  type CirculationReport,
  type CollectionsReport,
} from "@/lib/catalog/reports-read";
import { manilaToday } from "@/lib/catalog/loans-read";
import { getCurrentProfile } from "@/lib/auth/guards";
import { formatPeso, formatRelativeTime } from "@/lib/utils";
import type { FineType } from "@/lib/validations/fine";

export const metadata: Metadata = { title: "Reports" };

/** Session cookie + searchParams are read per request — blocking route. */
export const instant = false;

type SearchParams = Promise<{
  tab?: string | string[];
}>;

/** Distinct type chips (design §2.1): OVERDUE/LOST = error text, DAMAGE = warning. */
const FINE_TYPE_CHIPS: Record<FineType, { label: string; tone: BadgeTone }> = {
  OVERDUE: { label: "Overdue", tone: "error" },
  DAMAGE: { label: "Damage", tone: "warning" },
  LOST: { label: "Lost book", tone: "error" },
};

/** "2026-10-08" → "October 8, 2026" for the header's as-of line (R-30). */
const asOfFormatter = new Intl.DateTimeFormat("en-PH", {
  month: "long",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

function formatAsOf(date: string): string {
  const ms = Date.parse(`${date}T00:00:00Z`);
  return Number.isNaN(ms) ? date : asOfFormatter.format(ms);
}

/** Title + absolute timestamp behind the relative time (design §4.4 meta). */
function RelativeTime({ iso }: { iso: string }) {
  return (
    <time dateTime={iso} title={new Date(iso).toLocaleString("en-PH")}>
      {formatRelativeTime(iso)}
    </time>
  );
}

/** Copy → tone for `loans.condition_on_return` (schema.md §2.5). */
function conditionBadge(condition: string | null): ReactNode {
  if (!condition) return <span className="text-xs text-gray-500">—</span>;
  const damaged = condition === "DAMAGED";
  return <Badge tone={damaged ? "warning" : "success"}>{damaged ? "Damaged" : "Good"}</Badge>;
}

/* ------------------------------------------------------------------ */
/* Circulation tab                                                     */
/* ------------------------------------------------------------------ */

/**
 * Circulation report: 4 stat cards → 14-day release trend → top borrowed →
 * recent returns (design §5 rhythm, stat strip matching the penalties
 * page's 1 → 2 → 4 grid).
 *
 * Every figure comes from `getCirculationReport()` (lib/catalog/reports-read)
 * — this component only lays out what the server already computed, so it
 * renders entirely on the server with no client JS.
 */
function CirculationView({ report }: { report: CirculationReport }) {
  const { stats, releaseTrend, activeTrend, overdueTrend, returnedTrend, requestsTrend, topBorrowed, recentReturns, truncated } = report;

  const releaseTotal = releaseTrend.reduce((sum, day) => sum + day.count, 0);
  const hasAnyLoanActivity =
    releaseTotal > 0 ||
    activeTrend.some((count) => count > 0) ||
    returnedTrend.some((count) => count > 0);

  const windowFrom = releaseTrend[0]?.date ?? "";
  const windowTo = releaseTrend[releaseTrend.length - 1]?.date ?? "";

  // Scan-cap disclosures (same treatment as the dashboard's activity note).
  const notes: string[] = [];
  if (truncated.loans) {
    notes.push(
      "Only the most recent 2,000 circulation records feed the trend, rankings and returns below — the stat cards stay exact.",
    );
  }
  if (truncated.requests) {
    notes.push(
      "Request counters cover the most recent 1,000 requests.",
    );
  }

  return (
    <>
      {/* Stat strip — open loans · overdue · returns · requests (§4.2) */}
      <section
        aria-label="Circulation metrics"
        className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4"
      >
        <StatCard
          title="Books out"
          subtitle="Open right now (ACTIVE + OVERDUE)"
          value={stats.activeLoans}
          data={activeTrend}
        />
        <StatCard
          title="Overdue now"
          subtitle="Past the due date (daily sweep, R-18)"
          value={stats.overdueNow}
          valueClassName={stats.overdueNow > 0 ? "text-error-700" : undefined}
          data={overdueTrend}
        />
        <StatCard
          title="Returned this month"
          subtitle="Current Manila month to date (R-30)"
          value={stats.returnedThisMonth}
          data={returnedTrend}
        />
        <StatCard
          title="Requests this month"
          subtitle={`${stats.requestsPendingThisMonth} pending · ${stats.requestsApprovedThisMonth} approved`}
          value={stats.requestsThisMonth}
          data={requestsTrend}
        />
      </section>

      {notes.length > 0 ? (
        <p className="text-xs text-gray-500">{notes.join(" ")}</p>
      ) : null}

      <ReportSection
        id="loans-over-time"
        title="Borrowing over time"
        description={`Books released per day · last ${REPORT_TREND_DAYS} Manila days (${formatDayLabel(windowFrom)} – ${formatDayLabel(windowTo)}, R-30)`}
      >
        {releaseTotal === 0 ? (
          <ReportEmptyState
            icon={Activity}
            title={hasAnyLoanActivity ? `No releases in the last ${REPORT_TREND_DAYS} days.` : "No books borrowed yet."}
            body={
              hasAnyLoanActivity
                ? "Books out are still counted in the cards above; new releases appear here as a daily trend."
                : "The daily trend starts moving the moment a book is released to a student."
            }
          />
        ) : (
          <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-xs">
            <ReportBarList
              ariaLabel={`Books released per day over the last ${REPORT_TREND_DAYS} Manila days`}
              rows={releaseTrend.map((day) => ({
                label: formatDayLabel(day.date),
                value: String(day.count),
                count: day.count,
              }))}
            />
          </div>
        )}
      </ReportSection>

      <ReportSection
        id="top-borrowed"
        title="Top borrowed books"
        description="Most-borrowed titles by borrow count (top 10)"
      >
        {topBorrowed.length === 0 ? (
          <ReportEmptyState
            icon={BookOpen}
            title="No borrow history yet."
            body="The most-borrowed titles appear here as soon as books start circulating."
          />
        ) : (
          <Table minWidth={640}>
            <TableHead>
              <Th className="w-20">Rank</Th>
              <Th>Title</Th>
              <Th className="w-32 text-right">Borrows</Th>
            </TableHead>
            <TableBody>
              {topBorrowed.map((row) => (
                <Tr key={row.book_id}>
                  <Td className="tabular-nums text-gray-500">{row.rank}</Td>
                  <Td className="min-w-72">
                    <PrimaryCell primary={row.title} secondary={row.author} />
                  </Td>
                  <Td className="text-right">
                    <span className="font-semibold tabular-nums text-gray-900">
                      {row.borrow_count}
                    </span>
                  </Td>
                </Tr>
              ))}
            </TableBody>
          </Table>
        )}
      </ReportSection>

      <ReportSection
        id="recent-returns"
        title="Recent returns"
        description="The last 10 returns — who brought what back, and how it came back"
      >
        {recentReturns.length === 0 ? (
          <ReportEmptyState
            icon={History}
            title="No returns recorded yet."
            body="Returned books appear here with their return date, condition and days late."
          />
        ) : (
          <Table minWidth={960}>
            <TableHead>
              <Th>Student</Th>
              <Th>Book</Th>
              <Th>Returned</Th>
              <Th>Condition</Th>
              <Th className="text-right">Punctuality</Th>
            </TableHead>
            <TableBody>
              {recentReturns.map((row) => (
                <Tr key={row.id}>
                  <Td className="min-w-52">
                    <PrimaryCell
                      primary={row.student_name || "—"}
                      secondary={
                        <span className="font-mono">
                          {row.student_number ?? "—"}
                        </span>
                      }
                    />
                  </Td>
                  <Td className="min-w-56">
                    <PrimaryCell primary={row.title} secondary={row.author} />
                  </Td>
                  <Td className="whitespace-nowrap text-gray-500">
                    <RelativeTime iso={row.returned_at} />
                  </Td>
                  <Td className="whitespace-nowrap">
                    {conditionBadge(row.condition_on_return)}
                  </Td>
                  <Td className="whitespace-nowrap text-right">
                    {row.days_late === null ? (
                      <span className="text-xs text-gray-500">On time</span>
                    ) : (
                      <span className="text-xs font-medium text-error-700">
                        {row.days_late}{" "}
                        {row.days_late === 1 ? "day" : "days"} late
                      </span>
                    )}
                  </Td>
                </Tr>
              ))}
            </TableBody>
          </Table>
        )}
      </ReportSection>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Collections tab                                                     */
/* ------------------------------------------------------------------ */

/** One cell of the matrix rendered as "count + ₱ total" (R-29). */
function MatrixCell({ count, total_centavos }: { count: number; total_centavos: number }) {
  return (
    <span className="flex flex-col items-end">
      <span className="font-semibold tabular-nums text-gray-900">{count}</span>
      <span className="text-xs text-gray-500">{formatPeso(total_centavos)}</span>
    </span>
  );
}

/**
 * Collections report: 4 stat cards → inventory by category → fines matrix
 * (type × status) → largest unpaid balances. Same layout contract as
 * `CirculationView` — server-rendered, no client JS.
 */
function CollectionsView({ report }: { report: CollectionsReport }) {
  const { stats, fineCounts, categories, fineSummary, topUnpaid, truncated } = report;

  const hasFines = fineSummary.some((row) => row.count > 0);
  const statusTotals: Record<
    "UNPAID" | "PAID" | "WAIVED",
    { count: number; total_centavos: number }
  > = {
    UNPAID: { count: 0, total_centavos: 0 },
    PAID: { count: 0, total_centavos: 0 },
    WAIVED: { count: 0, total_centavos: 0 },
  };
  const grandTotal = { count: 0, total_centavos: 0 };
  for (const row of fineSummary) {
    statusTotals.UNPAID.count += row.unpaid.count;
    statusTotals.UNPAID.total_centavos += row.unpaid.total_centavos;
    statusTotals.PAID.count += row.paid.count;
    statusTotals.PAID.total_centavos += row.paid.total_centavos;
    statusTotals.WAIVED.count += row.waived.count;
    statusTotals.WAIVED.total_centavos += row.waived.total_centavos;
    grandTotal.count += row.count;
    grandTotal.total_centavos += row.total_centavos;
  }

  const notes: string[] = [];
  if (truncated.books) {
    notes.push(
      "Only the most recent 2,000 titles are counted in the inventory figures.",
    );
  }
  if (truncated.fines) {
    notes.push(
      "The fines breakdown and balances cover the most recent 2,000 charges — the unpaid-total card stays exact.",
    );
  }

  return (
    <>
      {/* Stat strip — titles · copies · available · money owed (§4.2) */}
      <section
        aria-label="Collection metrics"
        className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4"
      >
        <StatCard
          title="Titles"
          subtitle="Distinct books in the catalog"
          value={stats.titles}
          data={[]}
        />
        <StatCard
          title="Total copies"
          subtitle="Physical copies across every title"
          value={stats.totalCopies}
          data={[]}
        />
        <StatCard
          title="Available copies"
          subtitle="Copies on the shelf right now"
          value={stats.availableCopies}
          data={[]}
        />
        <StatCard
          title="Unpaid fines total"
          subtitle={`${fineCounts.unpaidCount} outstanding · ${fineCounts.studentsWithFines} ${
            fineCounts.studentsWithFines === 1 ? "student" : "students"
          } blocked (R-25)`}
          value={formatPeso(fineCounts.unpaidTotal_centavos)}
          valueClassName={
            fineCounts.unpaidTotal_centavos > 0 ? "text-error-700" : undefined
          }
          data={[]}
        />
      </section>

      {notes.length > 0 ? (
        <p className="text-xs text-gray-500">{notes.join(" ")}</p>
      ) : null}

      <ReportSection
        id="inventory-by-category"
        title="Inventory by category"
        description="Bar = total copies · sublabel = titles and copies currently available"
      >
        {categories.length === 0 ? (
          <ReportEmptyState
            icon={Library}
            title="No books in the catalog yet."
            body="Add titles in the catalog and their copies are grouped by category here."
          />
        ) : (
          <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-xs">
            <ReportBarList
              ariaLabel="Total copies per catalog category"
              rows={categories.map((category) => ({
                label: category.category,
                sublabel: `${category.titles} ${
                  category.titles === 1 ? "title" : "titles"
                } · ${category.available} available`,
                value: String(category.copies),
                count: category.copies,
              }))}
            />
          </div>
        )}
      </ReportSection>

      <ReportSection
        id="fines-summary"
        title="Fines summary"
        description="Charges grouped by type and status · counts with ₱ totals (R-29)"
      >
        {!hasFines ? (
          <ReportEmptyState
            icon={Receipt}
            title="No fines recorded yet."
            body="Overdue and damage charges appear here grouped by type and status."
          />
        ) : (
          <Table minWidth={880}>
            <TableHead>
              <Th>Type</Th>
              <Th className="text-right">Unpaid</Th>
              <Th className="text-right">Paid</Th>
              <Th className="text-right">Waived</Th>
              <Th className="text-right">Total</Th>
            </TableHead>
            <TableBody>
              {fineSummary.map((row) => {
                const chip = FINE_TYPE_CHIPS[row.type];
                return (
                  <Tr key={row.type}>
                    <Td className="whitespace-nowrap">
                      <Badge tone={chip.tone}>{chip.label}</Badge>
                    </Td>
                    <Td className="whitespace-nowrap text-right">
                      <MatrixCell {...row.unpaid} />
                    </Td>
                    <Td className="whitespace-nowrap text-right">
                      <MatrixCell {...row.paid} />
                    </Td>
                    <Td className="whitespace-nowrap text-right">
                      <MatrixCell {...row.waived} />
                    </Td>
                    <Td className="whitespace-nowrap text-right">
                      <MatrixCell
                        count={row.count}
                        total_centavos={row.total_centavos}
                      />
                    </Td>
                  </Tr>
                );
              })}
              <Tr className="bg-gray-50">
                <Td className="whitespace-nowrap font-medium text-gray-900">
                  All types
                </Td>
                <Td className="whitespace-nowrap text-right">
                  <MatrixCell {...statusTotals.UNPAID} />
                </Td>
                <Td className="whitespace-nowrap text-right">
                  <MatrixCell {...statusTotals.PAID} />
                </Td>
                <Td className="whitespace-nowrap text-right">
                  <MatrixCell {...statusTotals.WAIVED} />
                </Td>
                <Td className="whitespace-nowrap text-right">
                  <MatrixCell {...grandTotal} />
                </Td>
              </Tr>
            </TableBody>
          </Table>
        )}
      </ReportSection>

      <ReportSection
        id="fines-by-student"
        title="Largest unpaid balances"
        description="Top 10 students by outstanding balance (R-27)"
      >
        {topUnpaid.length === 0 ? (
          <ReportEmptyState
            icon={CircleAlert}
            title="No unpaid fines — every balance is settled."
            body="Students carrying a balance appear here, ranked by the amount they owe."
          />
        ) : (
          <Table minWidth={760}>
            <TableHead>
              <Th>Student</Th>
              <Th>Course / section</Th>
              <Th className="text-right">Unpaid fines</Th>
              <Th className="text-right">Balance</Th>
            </TableHead>
            <TableBody>
              {topUnpaid.map((row) => (
                <Tr key={row.student_id}>
                  <Td className="min-w-52">
                    <PrimaryCell
                      primary={row.student_name || "—"}
                      secondary={
                        <span className="font-mono">
                          {row.student_number ?? "—"}
                        </span>
                      }
                    />
                  </Td>
                  <Td className="whitespace-nowrap text-gray-500">
                    {row.course_section ?? "—"}
                  </Td>
                  <Td className="text-right tabular-nums">
                    {row.unpaid_count}
                  </Td>
                  <Td className="whitespace-nowrap text-right">
                    <span className="font-semibold text-gray-900">
                      {formatPeso(row.balance_centavos)}
                    </span>
                  </Td>
                </Tr>
              ))}
            </TableBody>
          </Table>
        )}
      </ReportSection>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

/** What the active tab loaded (only the chosen tab's reads ever run). */
type LoadedReport =
  | { tab: "circulation"; report: CirculationReport }
  | { tab: "collections"; report: CollectionsReport };

/**
 * Admin → Reports (prd.md FR-23, L67; architecture.md `reports/` =
 * "Circulation & collections reports", milestone 8 "Reports/export").
 *
 * Server component reading `searchParams` (`?tab=`) behind the session
 * guard shared by every admin page, in the design §5 rhythm: header →
 * tabs → stat cards → sections. The tab row is URL state
 * (components/admin/reports/reports-query.ts), so back/forward and deep
 * links reproduce the exact report — and **only the active tab's reads run**:
 * one parallel wave of 3 queries
 * (lib/catalog/reports-read.ts), all through the cookie-aware anon client
 * so RLS applies (schema.md §4).
 *
 * Every section has a designed empty state, so a fresh install (all
 * business tables at 0) still renders a composed page. The header carries
 * the print + CSV actions (FR-23: "CSV + print export"); the CSV streams
 * from `/admin/reports/export` with `assertAdmin()` in the route handler.
 */
export default async function AdminReportsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  // Block prerender validation before session/date work (Date.now() in supabase-js / formatRelativeTime).
  await connection();

  const { tab } = parseReportsQuery(await searchParams);

  // The profile read and the active tab's report don't depend on each other,
  // so they overlap in one wave; the session gate below still fires before
  // rendering.
  const [me, data] = await Promise.all([
    getCurrentProfile(),
    (async (): Promise<LoadedReport | null> => {
      try {
        return tab === "circulation"
          ? { tab, report: await getCirculationReport() }
          : { tab, report: await getCollectionsReport() };
      } catch {
        return null; // surface a readable error instead of an empty report
      }
    })(),
  ]);
  if (!me) redirect("/login");

  return (
    <AppShell
      title="Reports"
      subtitle={`As of ${formatAsOf(manilaToday())} · Asia/Manila (R-30)`}
      navVariant="admin"
      user={{ name: me.full_name, id: me.student_id ?? "LIBRARIAN" }}
      actions={
        <>
          <PrintButton />
          <ExportReportButton label="Export CSV" />
        </>
      }
    >
      {/* escr-landing-page: auto-marker cascades all content blocks */}
      <div className="escr-landing-page flex flex-col gap-6">
        {/* Tab row under the header (design §5.1) — switches URL state */}
        <ReportsTabs tab={tab} />

        {data === null ? (
          <div
            role="alert"
            className="rounded-lg border border-error-500 bg-error-25 px-6 py-10 text-center"
          >
            <p className="text-sm font-medium text-error-700">
              Could not load the report.
            </p>
            <p className="mt-1 text-sm text-error-700">
              Please try again in a moment.
            </p>
          </div>
        ) : data.tab === "circulation" ? (
          <CirculationView report={data.report} />
        ) : (
          <CollectionsView report={data.report} />
        )}
      </div>
    </AppShell>
  );
}
