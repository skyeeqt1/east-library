import type { FineStatus } from "@/lib/validations/fine";

/**
 * URL query helpers for `/dashboard/penalties` (student "My Penalties").
 *
 * Shared by the server page (reading `searchParams`) and the client tab pills
 * (writing the URL), so both sides agree on the contract — the mirror of
 * `components/student/loans-query.ts`.
 *
 * Tab filter → read-helper mapping (lib/catalog/fines-read.ts):
 *   `unpaid`  → `getStudentFines(studentId, { status: 'UNPAID' })` — the
 *               balance's row-by-row detail (what must be settled, R-27);
 *   `history` → PAID + WAIVED merged (see the page: `getStudentFines` takes
 *               a single `FineStatus`, so the settled set is two reads merged
 *               and paginated in JS — reported as a v1 limitation).
 */

export const STUDENT_PENALTIES_PATH = "/dashboard/penalties";

/** Statement cards are taller than admin table rows — 10/page like loans. */
export const STUDENT_PENALTIES_PER_PAGE = 10;

export type StudentPenaltiesFilter = "unpaid" | "history";

export interface StudentPenaltiesQuery {
  status: StudentPenaltiesFilter;
  page: number;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Sanitize raw Next.js `searchParams` into a typed, safe query (default: unpaid). */
export function parseStudentPenaltiesQuery(raw: {
  status?: string | string[];
  page?: string | string[];
}): StudentPenaltiesQuery {
  const statusValue = (first(raw.status) ?? "").toLowerCase();
  const status: StudentPenaltiesFilter =
    statusValue === "history" ? "history" : "unpaid";

  const parsedPage = Number.parseInt(first(raw.page) ?? "1", 10);
  const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;

  return { status, page };
}

/** Build the canonical `/dashboard/penalties?...` URL (empty params dropped). */
export function buildStudentPenaltiesPath(
  query: Partial<StudentPenaltiesQuery>,
): string {
  const params = new URLSearchParams();
  if (query.status && query.status !== "unpaid") params.set("status", query.status);
  if (query.page && query.page > 1) params.set("page", String(query.page));

  const search = params.toString();
  return search ? `${STUDENT_PENALTIES_PATH}?${search}` : STUDENT_PENALTIES_PATH;
}

/**
 * Tab filter → the `FineStatus` argument for `getStudentFines`.
 * `undefined` is meaningful: the Unpaid tab is the only one that needs an
 * explicit status; the History tab is assembled by the page (PAID + WAIVED).
 */
export function toStudentFineStatus(
  filter: StudentPenaltiesFilter,
): FineStatus | undefined {
  return filter === "history" ? undefined : "UNPAID";
}
