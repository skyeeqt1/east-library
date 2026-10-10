import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { ArrowLeftRight } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Badge, toneForStatus } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/ui/stat-card";
import {
  PrimaryCell,
  Table,
  TableBody,
  Td,
  Th,
  TableHead,
  Tr,
} from "@/components/ui/table";
import { DayChip } from "@/components/admin/loans/day-chip";
import { LoansPagination } from "@/components/admin/loans/loans-pagination";
import { LoansSearch, LoansTabs } from "@/components/admin/loans/loans-toolbar";
import {
  LOANS_PER_PAGE,
  parseLoansQuery,
} from "@/components/admin/loans/loans-query";
import { ReturnButton } from "@/components/admin/loans/return-button";
import { MarkLostButton } from "@/components/admin/loans/mark-lost-button";
import {
  getAdminActiveLoans,
  getLoanCounts,
  type AdminLoansPage,
  type LoanCounts,
} from "@/lib/catalog/loans-read";
import { getCurrentProfile } from "@/lib/auth/guards";
import { formatRelativeTime } from "@/lib/utils";
import type { LoanStatus } from "@/lib/validations/loan";

export const metadata: Metadata = { title: "Borrowed Books" };

/** Session cookie + searchParams are read per request — blocking route. */
export const instant = false;

type SearchParams = Promise<{
  status?: string | string[];
  q?: string | string[];
  page?: string | string[];
}>;

/** Friendly badge text per `loans.status` (design §2.1 status → color map). */
const STATUS_LABELS: Record<LoanStatus, string> = {
  ACTIVE: "Active",
  OVERDUE: "Overdue",
  RETURNED: "Returned",
};

const DATE_FORMAT = new Intl.DateTimeFormat("en-PH", {
  dateStyle: "medium",
  timeZone: "Asia/Manila",
});

/** Date-only or ISO timestamp → Manila medium date ("Oct 8, 2026"). */
function formatDate(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : DATE_FORMAT.format(parsed);
}

/** Everything the page renders, loaded together (one failed read = error UI). */
interface LoadedLoans {
  counts: LoanCounts;
  loans: AdminLoansPage;
}

/** Title + absolute timestamp behind the relative time (design §4.4 meta). */
function RelativeTime({ iso }: { iso: string }) {
  return (
    <time dateTime={iso} title={new Date(iso).toLocaleString("en-PH")}>
      {formatRelativeTime(iso)}
    </time>
  );
}

/**
 * Admin → Loans & Returns (US-4 / FR-14…FR-16, rules.md §5 R-17…R-21).
 *
 * Server component reading `searchParams` (status tab, search `q`, page) with
 * the session guard shared by every admin page. Stats come from
 * `getLoanCounts()`; rows from `getAdminActiveLoans()` — both through the
 * cookie-aware anon client so RLS applies (schema.md §4). Mutations live in
 * `lib/admin/loan-actions.ts` (`returnLoan`), triggered by the row-level
 * "Mark returned" button.
 *
 * Page rhythm follows design §5: header → tabs → stat cards → toolbar →
 * table → pagination.
 */
export default async function AdminLoansPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  // Block prerender validation before session/date work (Date.now() in supabase-js / formatRelativeTime).
  await connection();

  const { status, q, page } = parseLoansQuery(await searchParams);

  // The profile read and the data reads don't depend on each other, so they
  // overlap in one wave; the session gate below still fires before rendering.
  const [me, data] = await Promise.all([
    getCurrentProfile(),
    (async (): Promise<LoadedLoans | null> => {
      try {
        const [counts, loans] = await Promise.all([
          getLoanCounts(),
          getAdminActiveLoans({
            status,
            q: q || undefined,
            page,
            perPage: LOANS_PER_PAGE,
          }),
        ]);
        return { counts, loans };
      } catch {
        return null; // surface a readable error instead of an empty table
      }
    })(),
  ]);
  if (!me) redirect("/login");

  const rows = data?.loans.rows ?? [];
  const total = data?.loans.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / LOANS_PER_PAGE));
  const onCurrentPage = page > pageCount;
  const filtering = q.length > 0;

  const emptyCopy = onCurrentPage
    ? {
        title: "Nothing on this page.",
        body: "Return to the first page to see the rest.",
      }
    : filtering
      ? {
          title: "No borrowed books match your search.",
          body: "Try a student name or number, a copy barcode, or a book title.",
        }
      : status === "ACTIVE"
        ? {
            title: "No books out right now.",
            body: "Books released at the desk appear here until they are returned.",
          }
        : status === "OVERDUE"
          ? {
              title: "Nothing overdue — great job!",
              body: "Books that pass their due date show up here automatically.",
            }
          : {
              title: "No returned books yet.",
              body: "Returned books are archived here with their return details.",
            };

  return (
    <AppShell
      title="Borrowed Books"
      subtitle="Books out for seven days, desk returns and overdue counts (R-17 — due = release + 7 days)."
      navVariant="admin"
      user={{ name: me.full_name, id: me.student_id ?? "LIBRARIAN" }}
    >
      {/* escr-landing-page: auto-marker cascades all content blocks */}
      <div className="escr-landing-page flex flex-col gap-6">
        {data === null ? (
          <div
            role="alert"
            className="rounded-lg border border-error-500 bg-error-25 px-6 py-10 text-center"
          >
            <p className="text-sm font-medium text-error-700">
              Could not load borrowed books.
            </p>
            <p className="mt-1 text-sm text-error-700">
              Please try again in a moment.
            </p>
          </div>
        ) : (
          <>
            {/* Tab row from LOAN_STATUSES (design §4.3 / §5 rhythm) */}
            <LoansTabs status={status} />

            {/* Five live counters (design §4.2 grid: 1 → 2 → 5) */}
            <section
              aria-label="Circulation metrics"
              className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-5"
            >
              <StatCard title="Active" value={data.counts.active} data={[]} />
              <StatCard
                title="Overdue"
                value={data.counts.overdue}
                valueClassName={
                  data.counts.overdue > 0 ? "text-error-700" : undefined
                }
                data={[]}
              />
              <StatCard title="Due today" value={data.counts.dueToday} data={[]} />
              <StatCard
                title="Due soon (≤3d)"
                value={data.counts.dueSoon}
                data={[]}
              />
              <StatCard
                title="Returned this month"
                value={data.counts.returnedThisMonth}
                data={[]}
              />
            </section>

            {/* Free-text search — the read resolves student/book/barcode (§4.4) */}
            <LoansSearch q={q} status={status} />

            {rows.length === 0 ? (
              <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-6 py-12 text-center">
                <span
                  className="mx-auto flex size-11 items-center justify-center rounded-full bg-white text-primary-500 shadow-xs"
                  aria-hidden="true"
                >
                  <ArrowLeftRight className="size-5" strokeWidth={1.75} />
                </span>
                <p className="mt-4 text-base font-semibold text-gray-900">
                  {emptyCopy.title}
                </p>
                <p className="mx-auto mt-1 max-w-md text-sm text-gray-500">
                  {emptyCopy.body}
                </p>
                {onCurrentPage || filtering ? (
                  <Button
                    variant="secondary"
                    size="md"
                    href="/admin/loans"
                    className="mt-4"
                  >
                    {onCurrentPage ? "Back to first page" : "Clear search"}
                  </Button>
                ) : null}
              </div>
            ) : (
              <Table
                minWidth={1180}
                footer={
                  <LoansPagination
                    page={page}
                    pageCount={pageCount}
                    status={status}
                    q={q}
                  />
                }
              >
                <TableHead>
                  <Th>Student</Th>
                  <Th>Book</Th>
                  <Th>Barcode</Th>
                  <Th>Released</Th>
                  <Th>Due</Th>
                  <Th>Status</Th>
                  <Th className="text-right">Actions</Th>
                </TableHead>
                <TableBody>
                  {rows.map((row) => (
                    <Tr key={row.id}>
                      <Td className="min-w-52">
                        <PrimaryCell
                          primary={row.student_name}
                          secondary={
                            <span className="flex items-center gap-1.5">
                              <span className="font-mono">
                                {row.student_number ?? "—"}
                              </span>
                              {row.course_section ? (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span>{row.course_section}</span>
                                </>
                              ) : null}
                            </span>
                          }
                        />
                      </Td>
                      <Td className="min-w-56">
                        <PrimaryCell primary={row.title} secondary={row.author} />
                      </Td>
                      <Td className="whitespace-nowrap font-mono text-xs text-gray-700">
                        {row.barcode ?? "—"}
                      </Td>
                      <Td className="whitespace-nowrap text-gray-500">
                        <span className="block text-sm text-gray-700">
                          {formatDate(row.released_at)}
                        </span>
                        <span className="block text-xs">
                          <RelativeTime iso={row.released_at} />
                        </span>
                      </Td>
                      <Td className="whitespace-nowrap">
                        <span className="block text-sm text-gray-700">
                          {formatDate(row.due_date)}
                        </span>
                        <span className="mt-1 block">
                          <DayChip
                            status={row.status}
                            daysRemaining={row.days_remaining}
                            daysLate={row.days_late}
                          />
                        </span>
                      </Td>
                      <Td>
                        {/* design §2.1: ACTIVE = primary · OVERDUE = error · RETURNED = success */}
                        <Badge tone={toneForStatus(row.status)}>
                          {STATUS_LABELS[row.status]}
                        </Badge>
                        {/* Student tapped "Return book" (migration 0009) —
                            bring-the-desk flag; the librarian still confirms
                            the return via "Mark returned". */}
                        {row.return_requested_at ? (
                          <span className="mt-1.5 inline-flex items-center gap-1.5 rounded-md border border-info-500/30 bg-info-25 px-2 py-0.5 text-xs font-medium text-info-700">
                            <ArrowLeftRight className="size-3 shrink-0" aria-hidden="true" />
                            Return requested
                          </span>
                        ) : null}
                      </Td>
                      <Td>
                        {row.status !== "RETURNED" ? (
                          <div className="flex justify-end gap-2">
                            <ReturnButton
                              loan={{
                                id: row.id,
                                title: row.title,
                                author: row.author,
                                barcode: row.barcode,
                                student_name: row.student_name,
                                student_number: row.student_number,
                                due_date: row.due_date,
                              }}
                            />
                            <MarkLostButton
                              loan={{
                                id: row.id,
                                title: row.title,
                                student_name: row.student_name,
                                student_number: row.student_number,
                                replacement_value_centavos:
                                  row.replacement_value_centavos,
                              }}
                            />
                          </div>
                        ) : (
                          <span className="block text-right text-gray-500">
                            —
                          </span>
                        )}
                      </Td>
                    </Tr>
                  ))}
                </TableBody>
              </Table>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
