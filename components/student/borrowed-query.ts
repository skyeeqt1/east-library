import type { LoanStatus } from "@/lib/validations/borrowed";

/**
 * URL query helpers for `/dashboard/borrowed` (student "My Loans").
 *
 * Shared by the server page (reading `searchParams`) and the client tab pills
 * (writing the URL), so both sides agree on the contract — the mirror of
 * `components/student/requests-query.ts`.
 *
 * Tab filter → read-helper mapping (lib/catalog/borrowed-read.ts):
 *   `open`     → `status` **omitted** → `getStudentLoans` returns ACTIVE +
 *                OVERDUE together (the checked-out set, due_date ASC);
 *   `returned` → `status: 'RETURNED'` → the history tab (returned_at DESC).
 */

export const STUDENT_BORROWED_PATH = "/dashboard/borrowed";

/** Card pages show fewer rows than admin tables — countdown cards are tall. */
export const STUDENT_BORROWED_PER_PAGE = 10;

export type StudentBorrowedFilter = "open" | "returned";

export interface StudentBorrowedQuery {
  status: StudentBorrowedFilter;
  page: number;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Sanitize raw Next.js `searchParams` into a typed, safe query (default: open). */
export function parseStudentBorrowedQuery(raw: {
  status?: string | string[];
  page?: string | string[];
}): StudentBorrowedQuery {
  const statusValue = (first(raw.status) ?? "").toLowerCase();
  const status: StudentBorrowedFilter = statusValue === "returned" ? "returned" : "open";

  const parsedPage = Number.parseInt(first(raw.page) ?? "1", 10);
  const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;

  return { status, page };
}

/** Build the canonical `/dashboard/borrowed?...` URL (empty params dropped). */
export function buildStudentBorrowedPath(
  query: Partial<StudentBorrowedQuery>,
): string {
  const params = new URLSearchParams();
  if (query.status && query.status !== "open") params.set("status", query.status);
  if (query.page && query.page > 1) params.set("page", String(query.page));

  const search = params.toString();
  return search ? `${STUDENT_BORROWED_PATH}?${search}` : STUDENT_BORROWED_PATH;
}

/**
 * Tab filter → the `LoanStatus` argument for `getStudentLoans`.
 * `undefined` is meaningful: it selects open loans (ACTIVE | OVERDUE).
 */
export function toStudentBorrowedStatus(
  filter: StudentBorrowedFilter,
): LoanStatus | undefined {
  return filter === "returned" ? "RETURNED" : undefined;
}
