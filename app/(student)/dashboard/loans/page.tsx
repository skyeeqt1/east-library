import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { BookOpen } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { LoanCard } from "@/components/student/loan-card";
import { LoanStatusTabs } from "@/components/student/loan-status-tabs";
import { StudentPagination } from "@/components/student/pagination";
import {
  STUDENT_LOANS_PER_PAGE,
  STUDENT_LOANS_PATH,
  buildStudentLoansPath,
  parseStudentLoansQuery,
  toStudentLoanStatus,
} from "@/components/student/loans-query";
import { getStudentLoans } from "@/lib/catalog/loans-read";
import { getCurrentProfile } from "@/lib/auth/guards";

export const metadata: Metadata = { title: "My Borrowed Books" };

/** Session cookie + searchParams are read per request — blocking route. */
export const instant = false;

type SearchParams = Promise<{
  status?: string | string[];
  page?: string | string[];
}>;

/**
 * Student → My Loans (US-4 / FR-22, rules.md §5, design §6).
 *
 * Two tabs driven by the URL: **Active & due** (open loans — ACTIVE +
 * OVERDUE together, most urgent first) and **History** (RETURNED, newest
 * first). Rows arrive as **countdown cards**, not a table: cover initials,
 * title/author/barcode, Released, a big Due date with the design §6 chip
 * (green >3 days · orange 1–3 · red due-today/overdue) and the live ₱ owed.
 *
 * Reads go through `getStudentLoans` — RLS scopes the query to the
 * signed-in student (schema.md §4), so this page can never leak another
 * student's loans (rules.md §9). Mutations stay admin-only: nothing on this
 * page writes.
 */
export default async function StudentLoansPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  // Block prerender validation before session/date work (Date.now() in supabase-js / formatRelativeTime).
  await connection();

  const { status, page } = parseStudentLoansQuery(await searchParams);

  const me = await getCurrentProfile();
  if (!me) redirect("/login");

  let listing: Awaited<ReturnType<typeof getStudentLoans>> | null = null;
  try {
    listing = await getStudentLoans(me.id, {
      status: toStudentLoanStatus(status),
      page,
      perPage: STUDENT_LOANS_PER_PAGE,
    });
  } catch {
    listing = null; // surface a readable error instead of an empty list
  }

  const rows = listing?.rows ?? [];
  const total = listing?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / STUDENT_LOANS_PER_PAGE));
  const onCurrentPage = page > pageCount;

  const emptyCopy =
    status === "returned"
      ? { title: "No borrowing history yet." }
      : { title: "No books checked out. Browse the catalog to request one." };

  return (
    <AppShell
      title="My Borrowed Books"
      subtitle="Your checked-out books, their countdowns and anything you owe."
      navVariant="student"
      user={{ name: me.full_name, id: me.student_id ?? me.role }}
    >
      {/* escr-landing-page: auto-marker cascades all content blocks */}
      <div className="escr-landing-page flex flex-col gap-6">
        <LoanStatusTabs status={status} />

        {listing === null ? (
          <div
            role="alert"
            className="rounded-lg border border-error-500 bg-error-25 px-6 py-10 text-center"
          >
            <p className="text-sm font-medium text-error-700">
              Could not load your borrowed books.
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
              <BookOpen className="size-5" strokeWidth={1.75} />
            </span>
            <p className="mt-4 text-base font-semibold text-gray-900">
              {onCurrentPage ? "Nothing on this page." : emptyCopy.title}
            </p>
            <p className="mx-auto mt-1 max-w-md text-sm text-gray-500">
              {onCurrentPage
                ? "Return to the first page to see the rest."
                : status === "returned"
                  ? "Books you return will be archived here with their return dates."
                  : "Every approved request you pick up shows up here with its due date."}
            </p>
            {onCurrentPage ? (
              <Button
                variant="secondary"
                size="md"
                href={buildStudentLoansPath({ status, page: 1 })}
                className="mt-4"
              >
                Back to first page
              </Button>
            ) : status === "returned" ? (
              <Button
                variant="secondary"
                size="md"
                href={STUDENT_LOANS_PATH}
                className="mt-4"
              >
                Show checked-out books
              </Button>
            ) : (
              <Button size="md" href="/dashboard/catalog" className="mt-4">
                Browse catalog
              </Button>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {/* Countdown cards — design §6 (one per loan, most urgent first) */}
            <ul className="flex list-none flex-col gap-4 p-0">
              {rows.map((row) => (
                <li key={row.id}>
                  <LoanCard row={row} />
                </li>
              ))}
            </ul>

            {pageCount > 1 ? (
              <StudentPagination
                basePath={STUDENT_LOANS_PATH}
                query={status === "open" ? {} : { status }}
                page={page}
                pageCount={pageCount}
                label="Borrowed books pagination"
              />
            ) : null}
          </div>
        )}
      </div>
    </AppShell>
  );
}
