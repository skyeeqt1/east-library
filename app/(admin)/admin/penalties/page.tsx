import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Receipt } from "lucide-react";
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
import { RecordPaymentButton } from "@/components/admin/penalties/record-payment-button";
import { WaiveButton } from "@/components/admin/penalties/waive-button";
import { PenaltiesPagination } from "@/components/admin/penalties/penalties-pagination";
import { PenaltiesToolbar } from "@/components/admin/penalties/penalties-toolbar";
import {
  PENALTIES_PER_PAGE,
  buildPenaltiesPath,
  parsePenaltiesQuery,
  toFineStatusArg,
  toFineTypeArg,
  type PenaltiesStatusFilter,
} from "@/components/admin/penalties/penalties-query";
import {
  getAdminFines,
  getFineCounts,
  type AdminFineRow,
  type AdminFinesPage,
  type FineCounts,
} from "@/lib/catalog/fines-read";
import { getCurrentProfile } from "@/lib/auth/guards";
import { formatPeso, formatRelativeTime } from "@/lib/utils";
import type { FineStatus, FineType } from "@/lib/validations/fine";

export const metadata: Metadata = { title: "Fines & Penalties" };

/** Session cookie + searchParams are read per request — blocking route. */
export const instant = false;

type SearchParams = Promise<{
  status?: string | string[];
  type?: string | string[];
  q?: string | string[];
  page?: string | string[];
}>;

/** Friendly badge text per `fines.status` (design §2.1: UNPAID=error, PAID=success, WAIVED=gray). */
const STATUS_LABELS: Record<FineStatus, string> = {
  UNPAID: "Unpaid",
  PAID: "Paid",
  WAIVED: "Waived",
};

/** Distinct type chips (design §2.1): OVERDUE = error text, DAMAGE = warning text. */
const TYPE_CHIPS: Record<FineType, { label: string; tone: "error" | "warning" }> = {
  OVERDUE: { label: "Overdue", tone: "error" },
  DAMAGE: { label: "Damage", tone: "warning" },
};

/** Everything the page renders, loaded together (one failed read = error UI). */
interface LoadedPenalties {
  counts: FineCounts;
  fines: AdminFinesPage;
}

/** Title + absolute timestamp behind the relative time (design §4.4 meta). */
function RelativeTime({ iso }: { iso: string }) {
  return (
    <time dateTime={iso} title={new Date(iso).toLocaleString("en-PH")}>
      {formatRelativeTime(iso)}
    </time>
  );
}

/** Book context: title + "3 days late" (OVERDUE) or the damage description. */
function contextOf(row: AdminFineRow): { primary: string; secondary: string } {
  const primary = row.book_title ?? "Manual adjustment";
  if (row.type === "OVERDUE" && row.days_late !== null) {
    return {
      primary,
      secondary: `${row.days_late} ${row.days_late === 1 ? "day" : "days"} late`,
    };
  }
  return { primary, secondary: row.description ?? row.book_author ?? "" };
}

/** Empty-state copy per tab (design §4.7 — icon + title + description). */
function emptyCopyFor(
  status: PenaltiesStatusFilter,
  onCurrentPage: boolean,
  filtering: boolean,
): { title: string; body: string } {
  if (onCurrentPage) {
    return {
      title: "Nothing on this page.",
      body: "Return to the first page to see the remaining fines.",
    };
  }
  if (filtering) {
    return {
      title: "No fines match your search.",
      body: "Try a student name or number, a course, or a book title.",
    };
  }
  switch (status) {
    case "paid":
      return {
        title: "No paid fines yet.",
        body: "Payments recorded at the desk are archived here.",
      };
    case "waived":
      return {
        title: "No waived fines yet.",
        body: "Waived fines stay on record with the reason the admin wrote (R-24).",
      };
    case "all":
      return {
        title: "No fines recorded yet.",
        body: "Overdue and damage fines created by the system appear here.",
      };
    default:
      return {
        title: "No unpaid fines — everything is settled.",
        body: "New overdue or damage charges show up here the moment SQL records them.",
      };
  }
}

/**
 * Admin → Fines & Penalties (FR-17…FR-19, rules.md §5/§6/§7 R-17…R-28).
 *
 * Server component reading `searchParams` (status tab, type pill, search `q`,
 * page) with the session guard shared by every admin page. The stat strip
 * comes from `getFineCounts()` (unpaid total/count, collected & waived this
 * Manila month); rows come from `getAdminFines()` — both through the
 * cookie-aware anon client so RLS applies (schema.md §4). Mutations live in
 * `lib/admin/fine-actions.ts` (`recordFinePayment`, `waiveFine`), triggered
 * by the row-level actions (UNPAID rows only — settled rows are history).
 *
 * Page rhythm follows design §5: header → tabs → stat cards → toolbar →
 * table → pagination.
 */
export default async function AdminPenaltiesPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  // Block prerender validation before session/date work (Date.now() in supabase-js / formatRelativeTime).
  await connection();

  const { status, type, q, page } = parsePenaltiesQuery(await searchParams);

  const me = await getCurrentProfile();
  if (!me) redirect("/login");

  let data: LoadedPenalties | null = null;
  try {
    const [counts, fines] = await Promise.all([
      getFineCounts(),
      getAdminFines({
        status: toFineStatusArg(status),
        type: toFineTypeArg(type),
        q: q || undefined,
        page,
        perPage: PENALTIES_PER_PAGE,
      }),
    ]);
    data = { counts, fines };
  } catch {
    data = null; // surface a readable error instead of an empty table
  }

  const rows = data?.fines.rows ?? [];
  const total = data?.fines.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PENALTIES_PER_PAGE));
  const onCurrentPage = page > pageCount;
  const filtering = q.length > 0;
  const emptyCopy = emptyCopyFor(status, onCurrentPage, filtering);

  return (
    <AppShell
      title="Fines & Penalties"
      subtitle="Record payments, waive with a written reason, and keep balances honest (R-24 / R-28)."
      navVariant="admin"
      user={{ name: me.full_name, id: me.student_id ?? "LIBRARIAN" }}
    >
      <div className="flex flex-col gap-6">
        {data === null ? (
          <div
            role="alert"
            className="rounded-lg border border-error-500 bg-error-25 px-6 py-10 text-center"
          >
            <p className="text-sm font-medium text-error-700">
              Could not load fines.
            </p>
            <p className="mt-1 text-sm text-error-700">
              Please try again in a moment.
            </p>
          </div>
        ) : (
          <>
            {/* Stat strip — getFineCounts() (design §4.2 grid: 1 → 2 → 4) */}
            <section
              aria-label="Fine metrics"
              className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4"
            >
              <StatCard
                title="Unpaid total"
                subtitle="Outstanding across every student (R-27)"
                value={formatPeso(data.counts.unpaidTotal_centavos)}
                valueClassName={
                  data.counts.unpaidTotal_centavos > 0 ? "text-error-700" : undefined
                }
                data={[]}
              />
              <StatCard
                title="Unpaid fines"
                subtitle={`${data.counts.studentsWithFines} student${
                  data.counts.studentsWithFines === 1 ? "" : "s"
                } blocked from new requests`}
                value={data.counts.unpaidCount}
                valueClassName={
                  data.counts.unpaidCount > 0 ? "text-error-700" : undefined
                }
                data={[]}
              />
              <StatCard
                title="Collected this month"
                subtitle="Payments recorded in the current month"
                value={formatPeso(data.counts.paidThisMonth_centavos)}
                valueClassName="text-success-700"
                data={[]}
              />
              <StatCard
                title="Waived this month"
                subtitle="Forgiven with a written reason (R-24)"
                value={formatPeso(data.counts.waivedThisMonth_centavos)}
                valueClassName="text-gray-700"
                data={[]}
              />
            </section>

            {/* Status tabs + type pills + search (design §4.3 / §4.4) */}
            <PenaltiesToolbar status={status} type={type} q={q} />

            {rows.length === 0 ? (
              <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-6 py-12 text-center">
                <span
                  className="mx-auto flex size-11 items-center justify-center rounded-full bg-white text-primary-500 shadow-xs"
                  aria-hidden="true"
                >
                  <Receipt className="size-5" strokeWidth={1.75} />
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
                    href={buildPenaltiesPath({ status, type, page: 1 })}
                    className="mt-4"
                  >
                    {onCurrentPage ? "Back to first page" : "Clear search"}
                  </Button>
                ) : null}
              </div>
            ) : (
              <Table
                minWidth={1240}
                footer={
                  <PenaltiesPagination
                    page={page}
                    pageCount={pageCount}
                    status={status}
                    type={type}
                    q={q}
                  />
                }
              >
                <TableHead>
                  <Th>Student</Th>
                  <Th>Type</Th>
                  <Th>Context</Th>
                  <Th className="text-right">Amount</Th>
                  <Th>Status</Th>
                  <Th>Created</Th>
                  <Th className="text-right">Actions</Th>
                </TableHead>
                <TableBody>
                  {rows.map((row) => {
                    const chip = TYPE_CHIPS[row.type];
                    const context = contextOf(row);
                    return (
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
                        <Td className="whitespace-nowrap">
                          {/* design §2.1: OVERDUE = error text · DAMAGE = warning text */}
                          <Badge tone={chip.tone}>{chip.label}</Badge>
                        </Td>
                        <Td className="min-w-56">
                          <PrimaryCell
                            primary={context.primary}
                            secondary={context.secondary}
                          />
                        </Td>
                        <Td className="whitespace-nowrap text-right">
                          <span className="text-sm font-semibold text-gray-900">
                            {formatPeso(row.amount_centavos)}
                          </span>
                        </Td>
                        <Td>
                          {/* design §2.1: UNPAID = error · PAID = success · WAIVED = gray */}
                          <Badge tone={toneForStatus(row.status)}>
                            {STATUS_LABELS[row.status]}
                          </Badge>
                        </Td>
                        <Td className="whitespace-nowrap text-gray-500">
                          <RelativeTime iso={row.created_at} />
                        </Td>
                        <Td>
                          {/* Settlements are only possible while UNPAID (§10 state machine) */}
                          {row.status === "UNPAID" ? (
                            <div className="flex items-center justify-end gap-2">
                              <RecordPaymentButton
                                fine={{
                                  id: row.id,
                                  student_name: row.student_name,
                                  student_number: row.student_number,
                                  type: row.type,
                                  amount_centavos: row.amount_centavos,
                                }}
                              />
                              <WaiveButton
                                fine={{
                                  id: row.id,
                                  student_name: row.student_name,
                                  student_number: row.student_number,
                                  type: row.type,
                                  amount_centavos: row.amount_centavos,
                                }}
                              />
                            </div>
                          ) : (
                            <span className="block text-right text-xs text-gray-500">
                              {row.status === "PAID" && row.paid_at ? (
                                <RelativeTime iso={row.paid_at} />
                              ) : row.status === "WAIVED" && row.waived_at ? (
                                <RelativeTime iso={row.waived_at} />
                              ) : (
                                "—"
                              )}
                            </span>
                          )}
                        </Td>
                      </Tr>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
