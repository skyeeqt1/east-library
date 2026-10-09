import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { ClipboardList } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { RequestCard } from "@/components/student/request-card";
import { RequestStatusTabs } from "@/components/student/request-status-tabs";
import { StudentPagination } from "@/components/student/pagination";
import {
  STUDENT_REQUESTS_PER_PAGE,
  STUDENT_REQUESTS_PATH,
  buildStudentRequestsPath,
  parseStudentRequestsQuery,
  toRequestStatus,
} from "@/components/student/requests-query";
import { getStudentRequests } from "@/lib/catalog/requests-read";
import { getCurrentProfile } from "@/lib/auth/guards";

export const metadata: Metadata = { title: "My Requests" };

/** Session cookie + searchParams are read per request — blocking route. */
export const instant = false;

type SearchParams = Promise<{
  status?: string | string[];
  page?: string | string[];
}>;

/**
 * Student → My Requests (US-2 / FR-13, rules.md §4 R-12, design §6).
 *
 * One **stepper card** per request: Requested → Under review / Approved /
 * Declined (with reason) / Cancelled, timestamps in Asia/Manila (R-30), a
 * status pill on the design §2.1 color map, and a confirm-guarded Cancel for
 * still-PENDING rows. Reads run through `getStudentRequests` — RLS scopes
 * rows to the signed-in student (schema.md §4), so an admin previewing this
 * page sees their own (empty) list.
 */
export default async function StudentRequestsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  // Block prerender validation before session/date work (Date.now() in supabase-js / formatRelativeTime).
  await connection();

  const { status, page } = parseStudentRequestsQuery(await searchParams);

  const me = await getCurrentProfile();
  if (!me) redirect("/login");

  let listing: Awaited<ReturnType<typeof getStudentRequests>> | null = null;
  try {
    listing = await getStudentRequests(me.id, {
      status: toRequestStatus(status),
      page,
      perPage: STUDENT_REQUESTS_PER_PAGE,
    });
  } catch {
    listing = null; // surface a readable error instead of an empty list
  }

  const rows = listing?.rows ?? [];
  const total = listing?.total ?? 0;
  const pageCount = Math.max(
    1,
    Math.ceil(total / STUDENT_REQUESTS_PER_PAGE),
  );

  return (
    <AppShell
      title="My Requests"
      subtitle="Track every borrow request from submission to decision."
      navVariant="student"
      user={{ name: me.full_name, id: me.student_id ?? me.role }}
    >
      {/* escr-landing-page: auto-marker cascades all content blocks */}
      <div className="escr-landing-page flex flex-col gap-6">
        <RequestStatusTabs status={status} />

        {listing === null ? (
          <div
            role="alert"
            className="rounded-lg border border-error-500 bg-error-25 px-6 py-10 text-center"
          >
            <p className="text-sm font-medium text-error-700">
              Could not load your requests.
            </p>
            <p className="mt-1 text-sm text-error-700">
              Please try again in a moment.
            </p>
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-6 py-12 text-center">
            <span
              className="mx-auto flex size-11 items-center justify-center rounded-full bg-white text-primary-500 shadow-xs"
              aria-hidden="true"
            >
              <ClipboardList className="size-5" strokeWidth={1.75} />
            </span>
            <p className="mt-4 text-base font-semibold text-gray-900">
              {total > 0
                ? "Nothing on this page."
                : status === "all"
                  ? "You haven't requested any books yet."
                  : `No ${status} requests.`}
            </p>
            <p className="mx-auto mt-1 max-w-md text-sm text-gray-500">
              {total > 0
                ? "Return to the first page to see the remaining requests."
                : status === "all"
                  ? "Pick a title from the catalog and send a request — the library approves it at the desk."
                  : "Requests move between states as the library reviews them."}
            </p>
            {total > 0 ? (
              <Button
                variant="secondary"
                size="md"
                href={buildStudentRequestsPath({ status, page: 1 })}
                className="mt-4"
              >
                Back to first page
              </Button>
            ) : status === "all" ? (
              <Button size="md" href="/dashboard/catalog" className="mt-4">
                Browse books
              </Button>
            ) : (
              <Button
                variant="secondary"
                size="md"
                href={STUDENT_REQUESTS_PATH}
                className="mt-4"
              >
                Show all requests
              </Button>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {/* Stepper cards — design §6 (one per request, newest first) */}
            <ul className="flex list-none flex-col gap-4 p-0">
              {rows.map((row) => (
                <li key={row.id}>
                  <RequestCard row={row} />
                </li>
              ))}
            </ul>

            {pageCount > 1 ? (
              <StudentPagination
                basePath={STUDENT_REQUESTS_PATH}
                query={status === "all" ? {} : { status }}
                page={page}
                pageCount={pageCount}
                label="Requests pagination"
              />
            ) : null}
          </div>
        )}
      </div>
    </AppShell>
  );
}
