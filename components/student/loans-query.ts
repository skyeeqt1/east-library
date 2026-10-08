import type { LoanStatus } from "@/lib/validations/loan";

/**
 * URL query helpers for `/dashboard/loans` (student "My Loans").
 *
 * Shared by the server page (reading `searchParams`) and the client tab pills
 * (writing the URL), so both sides agree on the contract — the mirror of
 * `components/student/requests-query.ts`.
 *
 * Tab filter → read-helper mapping (lib/catalog/loans-read.ts):
 *   `open`     → `status` **omitted** → `getStudentLoans` returns ACTIVE +
 *                OVERDUE together (the checked-out set, due_date ASC);
 *   `returned` → `status: 'RETURNED'` → the history tab (returned_at DESC).
 */

export const STUDENT_LOANS_PATH = "/dashboard/loans";

/** Card pages show fewer rows than admin tables — countdown cards are tall. */
export const STUDENT_LOANS_PER_PAGE = 10;

export type StudentLoansFilter = "open" | "returned";

export interface StudentLoansQuery {
  status: StudentLoansFilter;
  page: number;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Sanitize raw Next.js `searchParams` into a typed, safe query (default: open). */
export function parseStudentLoansQuery(raw: {
  status?: string | string[];
  page?: string | string[];
}): StudentLoansQuery {
  const statusValue = (first(raw.status) ?? "").toLowerCase();
  const status: StudentLoansFilter = statusValue === "returned" ? "returned" : "open";

  const parsedPage = Number.parseInt(first(raw.page) ?? "1", 10);
  const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;

  return { status, page };
}

/** Build the canonical `/dashboard/loans?...` URL (empty params dropped). */
export function buildStudentLoansPath(
  query: Partial<StudentLoansQuery>,
): string {
  const params = new URLSearchParams();
  if (query.status && query.status !== "open") params.set("status", query.status);
  if (query.page && query.page > 1) params.set("page", String(query.page));

  const search = params.toString();
  return search ? `${STUDENT_LOANS_PATH}?${search}` : STUDENT_LOANS_PATH;
}

/**
 * Tab filter → the `LoanStatus` argument for `getStudentLoans`.
 * `undefined` is meaningful: it selects open loans (ACTIVE | OVERDUE).
 */
export function toStudentLoanStatus(
  filter: StudentLoansFilter,
): LoanStatus | undefined {
  return filter === "returned" ? "RETURNED" : undefined;
}
