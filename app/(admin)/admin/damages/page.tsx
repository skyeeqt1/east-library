import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Badge, toneForStatus } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  PrimaryCell,
  Table,
  TableBody,
  Td,
  Th,
  TableHead,
  Tr,
} from "@/components/ui/table";
import { AssessButton } from "@/components/admin/damages/assess-button";
import { ResolveButton } from "@/components/admin/damages/resolve-button";
import { DamagesPagination } from "@/components/admin/damages/damages-pagination";
import { DamagesTabs } from "@/components/admin/damages/damages-toolbar";
import {
  DAMAGES_PER_PAGE,
  buildDamagesPath,
  parseDamagesQuery,
  toDamageStatusArg,
  type DamagesStatusFilter,
} from "@/components/admin/damages/damages-query";
import {
  getAssessableReturns,
  type AssessableReturnsPage,
} from "@/components/admin/damages/assessable-returns";
import {
  getDamageReports,
  type DamageReportsPage,
} from "@/lib/catalog/fines-read";
import { getCurrentProfile } from "@/lib/auth/guards";
import { formatPeso, formatRelativeTime } from "@/lib/utils";
import type { FineStatus } from "@/lib/validations/fine";

export const metadata: Metadata = { title: "Damaged Books" };

/** Session cookie + searchParams are read per request — blocking route. */
export const instant = false;

type SearchParams = Promise<{
  status?: string | string[];
  page?: string | string[];
}>;

/** Friendly badge text per `fines.status` (design §2.1 status → color map). */
const FINE_LABELS: Record<FineStatus, string> = {
  UNPAID: "Unpaid",
  PAID: "Paid",
  WAIVED: "Waived",
};

const DATE_FORMAT = new Intl.DateTimeFormat("en-PH", {
  dateStyle: "medium",
  timeZone: "Asia/Manila",
});

/** Date-only or ISO timestamp → Manila medium date ("Oct 8, 2026"). */
function formatDate(value: string | null): string {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : DATE_FORMAT.format(parsed);
}

/** Truncate a long damage description for the cell (full text in `title`). */
function truncate(text: string, max = 100): string {
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

/** Everything the page renders, loaded together (one failed read = error UI). */
interface LoadedDamages {
  reports: DamageReportsPage;
  /** Loans returned as DAMAGED with no report yet — Pending tab only. */
  queue: AssessableReturnsPage | null;
}

/** Title + absolute timestamp behind the relative time (design §4.4 meta). */
function RelativeTime({ iso }: { iso: string }) {
  return (
    <time dateTime={iso} title={new Date(iso).toLocaleString("en-PH")}>
      {formatRelativeTime(iso)}
    </time>
  );
}

/** Empty-state copy per tab (design §4.7 — icon + title + description). */
function emptyCopyFor(
  status: DamagesStatusFilter,
  onCurrentPage: boolean,
): { title: string; body: string } {
  if (onCurrentPage) {
    return {
      title: "Nothing on this page.",
      body: "Return to the first page to see the remaining reports.",
    };
  }
  if (status === "resolved") {
    return {
      title: "No resolved reports yet.",
      body: "Settled reports stay here as the accountability history (R-22).",
    };
  }
  if (status === "all") {
    return {
      title: "No damage reports yet.",
      body: "Assessments saved from the Damages queue appear here.",
    };
  }
  return {
    title: "No damage reports pending.",
    body: "Books returned as DAMAGED show up here until they are assessed and resolved.",
  };
}

/**
 * Admin → Damaged Books (FR-18, rules.md §6 R-22…R-24).
 *
 * Server component reading `searchParams` (status tab, page) with the session
 * guard shared by every admin page. Three tabs (**Pending** · Resolved · All)
 * drive `getDamageReports()`; the Pending tab additionally renders the
 * **"Awaiting assessment"** queue from `getAssessableReturns()` — loans the
 * desk returned as DAMAGED that have no `damage_reports` row yet, so the
 * `assess_damage()` flow always has its `loanId` (R-23 step 1, FR-18).
 *
 * Mutations live in `lib/admin/damage-actions.ts` (`assessDamage`,
 * `resolveDamage`), triggered by the row-level Assess / Resolve buttons.
 * All reads go through the cookie-aware anon client — RLS exposes the queues
 * to admins only (schema.md §4).
 *
 * Page rhythm follows design §5: header → tabs → queue → table → pagination.
 */
export default async function AdminDamagesPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { status, page } = parseDamagesQuery(await searchParams);

  const me = await getCurrentProfile();
  if (!me) redirect("/login");

  let data: LoadedDamages | null = null;
  try {
    const [reports, queue] = await Promise.all([
      getDamageReports({
        status: toDamageStatusArg(status),
        page,
        perPage: DAMAGES_PER_PAGE,
      }),
      status === "pending"
        ? getAssessableReturns({ page: 1, perPage: DAMAGES_PER_PAGE })
        : Promise.resolve(null),
    ]);
    data = { reports, queue };
  } catch {
    data = null; // surface a readable error instead of an empty table
  }

  const rows = data?.reports.rows ?? [];
  const total = data?.reports.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / DAMAGES_PER_PAGE));
  const onCurrentPage = page > pageCount;
  const emptyCopy = emptyCopyFor(status, onCurrentPage);

  const queueRows = data?.queue?.rows ?? [];
  const queueTotal = data?.queue?.total ?? 0;
  const queueTruncated = data?.queue?.truncated ?? false;

  return (
    <AppShell
      title="Damaged Books"
      subtitle="Assess books returned as DAMAGED, then resolve them by replacement or payment (R-22 / R-23)."
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
              Could not load damage reports.
            </p>
            <p className="mt-1 text-sm text-error-700">
              Please try again in a moment.
            </p>
          </div>
        ) : (
          <>
            {/* Tab row (design §4.3 / §5 rhythm) */}
            <DamagesTabs status={status} />

            {/* ---- Pending-only queue: returned DAMAGED, not yet assessed ---- */}
            {status === "pending" && queueRows.length > 0 ? (
              <section aria-labelledby="assess-queue-heading">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <h2
                    id="assess-queue-heading"
                    className="text-lg font-semibold text-gray-900"
                  >
                    Awaiting assessment
                  </h2>
                  <p className="text-xs text-gray-500">
                    {queueTotal > queueRows.length
                      ? `Showing the ${queueRows.length} most recent of ${queueTotal} damaged returns.`
                      : `${queueTotal} damaged return${queueTotal === 1 ? "" : "s"} need assessment.`}
                    {queueTruncated ? " Older rows were not scanned." : ""}
                  </p>
                </div>

                <Table minWidth={980}>
                  <TableHead>
                    <Th>Student</Th>
                    <Th>Book</Th>
                    <Th>Returned</Th>
                    <Th>Status</Th>
                    <Th className="text-right">Actions</Th>
                  </TableHead>
                  <TableBody>
                    {queueRows.map((row) => (
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
                        <Td className="whitespace-nowrap text-gray-500">
                          <RelativeTime iso={row.returned_at} />
                        </Td>
                        <Td>
                          {/* design §2.1: PENDING / awaiting work = warning */}
                          <Badge tone="warning">Awaiting assessment</Badge>
                        </Td>
                        <Td>
                          <div className="flex justify-end">
                            <AssessButton
                              loan={{
                                id: row.id,
                                student_name: row.student_name,
                                student_number: row.student_number,
                                title: row.title,
                                author: row.author,
                                returned_at: row.returned_at,
                                replacement_value_centavos:
                                  row.replacement_value_centavos,
                              }}
                            />
                          </div>
                        </Td>
                      </Tr>
                    ))}
                  </TableBody>
                </Table>
              </section>
            ) : null}

            {/* ---- Damage reports table ------------------------------------ */}
            {rows.length === 0 ? (
              <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-6 py-12 text-center">
                <span
                  className="mx-auto flex size-11 items-center justify-center rounded-full bg-white text-primary-500 shadow-xs"
                  aria-hidden="true"
                >
                  <TriangleAlert className="size-5" strokeWidth={1.75} />
                </span>
                <p className="mt-4 text-base font-semibold text-gray-900">
                  {emptyCopy.title}
                </p>
                <p className="mx-auto mt-1 max-w-md text-sm text-gray-500">
                  {emptyCopy.body}
                </p>
                {onCurrentPage ? (
                  <Button
                    variant="secondary"
                    size="md"
                    href={buildDamagesPath({ status, page: 1 })}
                    className="mt-4"
                  >
                    Back to first page
                  </Button>
                ) : null}
              </div>
            ) : (
              <Table
                minWidth={1440}
                footer={
                  <DamagesPagination
                    page={page}
                    pageCount={pageCount}
                    status={status}
                  />
                }
              >
                <TableHead>
                  <Th>Student</Th>
                  <Th>Book</Th>
                  <Th>Condition</Th>
                  <Th>Damage</Th>
                  <Th>Photo</Th>
                  <Th className="text-right">Assessed value</Th>
                  <Th>Fine</Th>
                  <Th>Reported</Th>
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
                      <Td className="whitespace-nowrap">
                        <span className="block text-sm text-gray-700">
                          Returned {formatDate(row.returned_at)}
                        </span>
                        <span className="block text-xs text-gray-500">
                          Released {formatDate(row.released_at)}
                        </span>
                      </Td>
                      <Td className="max-w-64 min-w-44">
                        {/* Truncated to 100 chars — full text via the title tooltip */}
                        <span
                          className="block text-sm text-gray-700"
                          title={row.description}
                        >
                          {truncate(row.description)}
                        </span>
                      </Td>
                      <Td className="whitespace-nowrap">
                        {row.photo_url ? (
                          // photo_url is a storage path or arbitrary URL —
                          // next/image would need a configured domain per host.
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={row.photo_url}
                            alt={`Damage photo for ${row.title}`}
                            width={40}
                            height={40}
                            loading="lazy"
                            className="size-10 rounded-md border border-gray-200 bg-gray-100 object-cover"
                          />
                        ) : (
                          <span className="text-xs text-gray-500">No photo</span>
                        )}
                      </Td>
                      <Td className="whitespace-nowrap text-right">
                        <span className="text-sm font-semibold text-gray-900">
                          {formatPeso(row.assessed_value_centavos)}
                        </span>
                      </Td>
                      <Td>
                        {/* Loan's DAMAGE fine status (R-21 one-to-one) */}
                        {row.fine_status ? (
                          <Badge tone={toneForStatus(row.fine_status)}>
                            {FINE_LABELS[row.fine_status]}
                          </Badge>
                        ) : (
                          <span className="text-gray-500">—</span>
                        )}
                      </Td>
                      <Td className="whitespace-nowrap text-gray-500">
                        <RelativeTime iso={row.created_at} />
                      </Td>
                      <Td>
                        {row.status === "PENDING" ? (
                          <div className="flex justify-end">
                            <ResolveButton
                              damage={{
                                id: row.id,
                                student_name: row.student_name,
                                student_number: row.student_number,
                                title: row.title,
                                assessed_value_centavos: row.assessed_value_centavos,
                              }}
                            />
                          </div>
                        ) : (
                          <span className="block whitespace-nowrap text-right text-xs text-gray-500">
                            {row.resolved_at ? (
                              <>
                                Resolved{" "}
                                <time
                                  dateTime={row.resolved_at}
                                  title={new Date(row.resolved_at).toLocaleString(
                                    "en-PH",
                                  )}
                                >
                                  {formatDate(row.resolved_at)}
                                </time>
                              </>
                            ) : (
                              "—"
                            )}
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
