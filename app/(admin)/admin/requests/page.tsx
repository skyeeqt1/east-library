import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { ClipboardCheck } from "lucide-react";
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
import { RequestRowActions } from "@/components/admin/requests/request-row-actions";
import { ReleaseBookButton } from "@/components/admin/requests/release-book-button";
import { RequestsPagination } from "@/components/admin/requests/requests-pagination";
import { RequestsToolbar } from "@/components/admin/requests/requests-toolbar";
import {
  REQUESTS_PER_PAGE,
  buildRequestsPath,
  parseRequestsQuery,
} from "@/components/admin/requests/requests-query";
import {
  getDecidedRequests,
  type DecidedRequestRow,
  type DecidedRequestsPage,
} from "@/components/admin/requests/decided-requests";
import {
  getPendingRequests,
  getRequestCounts,
  type PendingRequestsPage,
  type RequestCounts,
} from "@/lib/catalog/requests-read";
import { getCurrentProfile } from "@/lib/auth/guards";
import { cn, formatRelativeTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Borrow Requests" };

/** Session cookie + searchParams are read per request — blocking route. */
export const instant = false;

type SearchParams = Promise<{
  status?: string | string[];
  page?: string | string[];
}>;

/** Friendly status label for decision tabs (badge text, design §2.1). */
const STATUS_LABELS: Record<string, string> = {
  PENDING: "Pending",
  APPROVED: "Approved",
  DECLINED: "Declined",
  CANCELLED: "Cancelled",
  EXPIRED: "Expired",
};

/** Everything the page renders, loaded together (one failed read = error UI). */
interface LoadedRequests {
  counts: RequestCounts;
  pending: PendingRequestsPage | null;
  decided: DecidedRequestsPage | null;
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
 * Admin → Borrow Requests (FR-09…FR-12, rules.md §4 R-10…R-16, §9).
 *
 * Server component reading `searchParams` (status tab, page) with a session
 * guard mirroring the Books page. The **Pending** tab renders the FIFO
 * decision queue (`getPendingRequests` — live availability + inline Approve /
 * Decline per design §5); **Approved / Declined / All** render the
 * cross-student decision feed (`getDecidedRequests`). Every read goes through
 * the cookie-aware anon client — RLS exposes the queue to admins only — and
 * every mutation happens in `lib/admin/request-actions.ts`.
 */
export default async function AdminRequestsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  // Block prerender validation before session/date work (Date.now() in supabase-js / formatRelativeTime).
  await connection();

  const { status, page } = parseRequestsQuery(await searchParams);

  // Profile, counts and rows are independent reads, so all three overlap in
  // one wave; the session gate below still fires before rendering.
  const [me, data] = await Promise.all([
    getCurrentProfile(),
    (async (): Promise<LoadedRequests | null> => {
      try {
        const [counts, pending, decided] = await Promise.all([
          getRequestCounts(),
          status === "pending"
            ? getPendingRequests({ page, perPage: REQUESTS_PER_PAGE })
            : Promise.resolve(null),
          status === "pending"
            ? Promise.resolve(null)
            : getDecidedRequests({
                // "all" = every R-12 state; otherwise one of APPROVED/DECLINED.
                status: status === "all" ? undefined : status.toUpperCase(),
                page,
                perPage: REQUESTS_PER_PAGE,
              }),
        ]);
        return { counts, pending, decided };
      } catch {
        return null; // surface a readable error instead of an empty queue
      }
    })(),
  ]);
  if (!me) redirect("/login");

  const rows = data?.pending?.rows ?? data?.decided?.rows ?? [];
  const total = data?.pending?.total ?? data?.decided?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / REQUESTS_PER_PAGE));
  const onCurrentPage = page > pageCount;
  const showPending = status === "pending";

  const emptyCopy = onCurrentPage
    ? { title: "Nothing on this page.", body: "Return to the first page to see the remaining requests." }
    : showPending
      ? {
          title: "No pending requests — all caught up.",
          body: "New borrow requests appear here the moment a student submits one.",
        }
      : status === "approved"
        ? { title: "No approved requests yet.", body: "Approved requests stay here until the book is released at the desk." }
        : status === "declined"
          ? { title: "No declined requests yet.", body: "Declined requests stay here with their reason for reference." }
          : { title: "No borrow requests yet.", body: "Everything students submit shows up in this queue." };

  return (
    <AppShell
      title="Borrow Requests"
      subtitle="Approve or decline student requests — approval re-checks availability (R-13)."
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
              Could not load borrow requests.
            </p>
            <p className="mt-1 text-sm text-error-700">
              Please try again in a moment.
            </p>
          </div>
        ) : (
          <>
            {/* Tab row from live REQUEST counts (design §4.3 / §5 rhythm) */}
            <RequestsToolbar status={status} counts={data.counts} />

            {rows.length === 0 ? (
              <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-6 py-12 text-center">
                <span
                  className="mx-auto flex size-11 items-center justify-center rounded-full bg-white text-primary-500 shadow-xs"
                  aria-hidden="true"
                >
                  <ClipboardCheck className="size-5" strokeWidth={1.75} />
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
                    href={buildRequestsPath({ status, page: 1 })}
                    className="mt-4"
                  >
                    Back to first page
                  </Button>
                ) : null}
              </div>
            ) : showPending ? (
              /* -------------------- Pending decision desk -------------------- */
              <Table
                minWidth={1040}
                footer={
                  <RequestsPagination
                    page={page}
                    pageCount={pageCount}
                    status={status}
                  />
                }
              >
                <TableHead>
                  <Th>Student</Th>
                  <Th>Book</Th>
                  <Th>Requested</Th>
                  <Th>Availability</Th>
                  <Th className="text-right">Actions</Th>
                </TableHead>
                <TableBody>
                  {(data.pending?.rows ?? []).map((row) => (
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
                        <RelativeTime iso={row.created_at} />
                      </Td>
                      <Td className="whitespace-nowrap">
                        {/* design §5: green "n available" / red "No copies" */}
                        <span
                          className={cn(
                            "inline-flex items-center gap-1.5 text-sm font-medium",
                            row.available_copies > 0
                              ? "text-success-700"
                              : "text-error-700",
                          )}
                        >
                          <span
                            aria-hidden="true"
                            className={cn(
                              "size-1.5 shrink-0 rounded-full",
                              row.available_copies > 0
                                ? "bg-success-500"
                                : "bg-error-500",
                            )}
                          />
                          {row.available_copies > 0
                            ? `${row.available_copies} available`
                            : "No copies available"}
                        </span>
                      </Td>
                      <Td>
                        <RequestRowActions
                          request={{
                            id: row.id,
                            student_name: row.student_name,
                            title: row.title,
                          }}
                        />
                      </Td>
                    </Tr>
                  ))}
                </TableBody>
              </Table>
            ) : (
              /* -------------------- Approved / Declined / All ---------------- */
              <Table
                minWidth={1280}
                footer={
                  <RequestsPagination
                    page={page}
                    pageCount={pageCount}
                    status={status}
                  />
                }
              >
                <TableHead>
                  <Th>Student</Th>
                  <Th>Book</Th>
                  <Th>Requested</Th>
                  <Th>Status</Th>
                  <Th>Decided</Th>
                  <Th>Reason</Th>
                  <Th className="text-right">Actions</Th>
                </TableHead>
                <TableBody>
                  {(data.decided?.rows ?? []).map((row) => (
                    <DecidedRow key={row.id} row={row} />
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

/** One decision-feed row — student, title, relative times, status pill, reason. */
function DecidedRow({ row }: { row: DecidedRequestRow }) {
  return (
    <Tr>
      <Td className="min-w-52">
        <PrimaryCell
          primary={row.student_name}
          secondary={
            <span className="flex items-center gap-1.5">
              <span className="font-mono">{row.student_number ?? "—"}</span>
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
        <RelativeTime iso={row.created_at} />
      </Td>
      <Td>
        {/* design §2.1 map: PENDING=warning · APPROVED=info · DECLINED/CANCELLED/EXPIRED=gray */}
        <Badge tone={toneForStatus(row.status)}>
          {STATUS_LABELS[row.status] ?? row.status}
        </Badge>
      </Td>
      <Td className="whitespace-nowrap text-gray-500">
        {row.decided_at ? <RelativeTime iso={row.decided_at} /> : "—"}
      </Td>
      <Td className="max-w-64 min-w-44">
        {row.decline_reason ? (
          <span className="block text-sm text-gray-700">{row.decline_reason}</span>
        ) : (
          <span className="text-gray-500">—</span>
        )}
      </Td>
      <Td>
        {/* R-14: APPROVED rows await the desk release; the rest have no action. */}
        {row.status === "APPROVED" ? (
          row.loan_id ? (
            <span className="block text-right text-xs text-gray-500">
              Released
            </span>
          ) : (
            <div className="flex justify-end">
              <ReleaseBookButton
                request={{
                  id: row.id,
                  student_name: row.student_name,
                  title: row.title,
                }}
              />
            </div>
          )
        ) : (
          <span className="block text-right text-gray-500">—</span>
        )}
      </Td>
    </Tr>
  );
}
