import type { Metadata } from "next";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { CircleAlert, Receipt } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FineCard } from "@/components/student/fine-card";
import { PenaltyStatusTabs } from "@/components/student/penalty-status-tabs";
import { StudentPagination } from "@/components/student/pagination";
import {
  STUDENT_PENALTIES_PER_PAGE,
  STUDENT_PENALTIES_PATH,
  buildStudentPenaltiesPath,
  parseStudentPenaltiesQuery,
} from "@/components/student/penalties-query";
import {
  getStudentBalance,
  getStudentFines,
  type StudentBalance,
  type StudentFineRow,
} from "@/lib/catalog/fines-read";
import { getCurrentProfile } from "@/lib/auth/guards";
import { cn, formatPeso } from "@/lib/utils";

export const metadata: Metadata = { title: "My Penalties" };

/** Session cookie + searchParams are read per request — blocking route. */
export const instant = false;

type SearchParams = Promise<{
  status?: string | string[];
  page?: string | string[];
}>;

/** Cap per settled-status read (see `getStudentFines` — max 100 per call). */
const HISTORY_FETCH_PER_STATUS = 100;

/** Everything the page renders, loaded together (one failed read = error UI). */
interface LoadedPenalties {
  balance: StudentBalance;
  rows: StudentFineRow[];
  total: number;
  /** History tab: settled rows beyond the fetched window were not scanned. */
  historyTruncated: boolean;
}

/**
 * Student → My Penalties (US-5 / FR-17, rules.md §5, design §6 statement
 * list: type · book · days · amount ₱ · status · payment instructions).
 *
 * Two tabs driven by the URL: **Unpaid** (the R-27 balance broken out row by
 * row — what must be settled) and **History** (paid + waived — what is
 * already behind you). Above them a balance hero card always shows the
 * live `student_balances` figure plus the cash-at-the-desk instructions
 * (prd §9: the system records payments, it never collects money).
 *
 * Reads go through `getStudentBalance` / `getStudentFines` — RLS scopes
 * every query to the signed-in student (schema.md §4), so this page can
 * never show another student's fines (rules.md §9). Nothing here writes:
 * settlements are admin-only (`recordFinePayment`, R-28).
 *
 * History pagination note (v1): `getStudentFines` filters on ONE
 * `FineStatus`, so PAID and WAIVED are fetched separately (≤100 rows each),
 * merged, sorted newest-first and windowed here — students with more than
 * 200 settled fines see the most recent window and a truncation note.
 */
export default async function StudentPenaltiesPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  // Block prerender validation before session/date work (Date.now() in supabase-js / formatRelativeTime).
  await connection();

  const { status, page } = parseStudentPenaltiesQuery(await searchParams);

  const me = await getCurrentProfile();
  if (!me) redirect("/login");

  let data: LoadedPenalties | null = null;
  try {
    if (status === "history") {
      const [balance, paid, waived] = await Promise.all([
        getStudentBalance(me.id),
        getStudentFines(me.id, {
          status: "PAID",
          page: 1,
          perPage: HISTORY_FETCH_PER_STATUS,
        }),
        getStudentFines(me.id, {
          status: "WAIVED",
          page: 1,
          perPage: HISTORY_FETCH_PER_STATUS,
        }),
      ]);
      const merged = [...paid.rows, ...waived.rows].sort((a, b) =>
        b.created_at.localeCompare(a.created_at),
      );
      const from = (page - 1) * STUDENT_PENALTIES_PER_PAGE;
      data = {
        balance,
        rows: merged.slice(from, from + STUDENT_PENALTIES_PER_PAGE),
        total: paid.total + waived.total,
        historyTruncated: paid.total + waived.total > merged.length,
      };
    } else {
      const [balance, fines] = await Promise.all([
        getStudentBalance(me.id),
        getStudentFines(me.id, {
          status: "UNPAID",
          page,
          perPage: STUDENT_PENALTIES_PER_PAGE,
        }),
      ]);
      data = {
        balance,
        rows: fines.rows,
        total: fines.total,
        historyTruncated: false,
      };
    }
  } catch {
    data = null; // surface a readable error instead of an empty statement
  }

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const balance = data?.balance.balance_centavos ?? 0;
  const unpaidCount = data?.balance.unpaid_count ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / STUDENT_PENALTIES_PER_PAGE));
  const onCurrentPage = page > pageCount;

  const emptyCopy =
    status === "history"
      ? {
          title: "Nothing settled yet.",
          body: "Paid and waived fines stay here as your statement history.",
          action: null as ReactNode,
        }
      : {
          title: "No unpaid fines — you're all settled.",
          body: "Any charge the library records shows up here until it is paid at the desk.",
          action: (
            <Button variant="secondary" size="md" href="/dashboard/catalog">
              Browse books
            </Button>
          ) as ReactNode,
        };

  return (
    <AppShell
      title="My Penalties"
      subtitle="Your fines, what you owe, and how to settle them at the desk."
      navVariant="student"
      user={{ name: me.full_name, id: me.student_id ?? me.role }}
    >
      {/* escr-landing-page: auto-marker cascades all content blocks */}
      <div className="escr-landing-page flex flex-col gap-6">
        {/* Balance hero — R-27 computed figure, never cached */}
        <Card aria-labelledby="balance-heading">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="min-w-0">
              <h2
                id="balance-heading"
                className="text-sm font-medium text-gray-500"
              >
                Outstanding balance
              </h2>
              <p
                className={cn(
                  "mt-2 text-4xl font-semibold tracking-tight text-error-700",
                )}
              >
                {formatPeso(balance)}
              </p>
              <p className="mt-1 text-sm text-gray-500">
                {unpaidCount > 0
                  ? `${unpaidCount} unpaid fine${unpaidCount === 1 ? "" : "s"}`
                  : "Nothing owed — keep it that way."}
              </p>
            </div>

            {/* Payment instructions (design §6 — statement + how to pay) */}
            <div className="flex min-w-0 flex-1 items-start gap-2 rounded-md border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700 sm:max-w-md">
              <CircleAlert
                className="mt-0.5 size-4 shrink-0 text-gray-500"
                aria-hidden="true"
              />
              <p>
                Fines are settled <strong>in cash at the library desk</strong> —
                there is no online payment. The librarian records it and your
                balance clears immediately.{" "}
                {balance > 0
                  ? "Until then, new book requests stay blocked."
                  : "You can request books right away."}
              </p>
            </div>
          </div>
        </Card>

        <PenaltyStatusTabs status={status} />

        {data === null ? (
          <div
            role="alert"
            className="rounded-lg border border-error-500 bg-error-25 px-6 py-10 text-center"
          >
            <p className="text-sm font-medium text-error-700">
              Could not load your penalties.
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
              <Receipt className="size-5" strokeWidth={1.75} />
            </span>
            <p className="mt-4 text-base font-semibold text-gray-900">
              {onCurrentPage ? "Nothing on this page." : emptyCopy.title}
            </p>
            <p className="mx-auto mt-1 max-w-md text-sm text-gray-500">
              {onCurrentPage
                ? "Return to the first page to see the remaining fines."
                : emptyCopy.body}
            </p>
            {onCurrentPage ? (
              <Button
                variant="secondary"
                size="md"
                href={buildStudentPenaltiesPath({ status, page: 1 })}
                className="mt-4"
              >
                Back to first page
              </Button>
            ) : (
              emptyCopy.action
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {/* Statement rows — design §6 (newest first) */}
            <ul className="flex list-none flex-col gap-4 p-0">
              {rows.map((row) => (
                <li key={row.id}>
                  <FineCard row={row} />
                </li>
              ))}
            </ul>

            {data.historyTruncated ? (
              <p className="text-xs text-gray-500">
                Showing your most recent {HISTORY_FETCH_PER_STATUS * 2} settled
                fines — ask at the desk for older statements.
              </p>
            ) : null}

            {pageCount > 1 ? (
              <StudentPagination
                basePath={STUDENT_PENALTIES_PATH}
                query={status === "unpaid" ? {} : { status }}
                page={page}
                pageCount={pageCount}
                label="Penalties pagination"
              />
            ) : null}
          </div>
        )}
      </div>
    </AppShell>
  );
}
