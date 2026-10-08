import type { RequestStatus } from "@/lib/validations/request";

/**
 * URL query helpers for `/dashboard/requests` (student "My Requests").
 *
 * Shared by the server page (reading `searchParams`) and the client tab pills
 * / pagination (writing the URL), so both sides agree on the contract.
 */

export const STUDENT_REQUESTS_PATH = "/dashboard/requests";

/** Card pages show fewer rows than admin tables — stepper cards are tall. */
export const STUDENT_REQUESTS_PER_PAGE = 10;

/** Tab filters (R-12 states surfaced as pills; CANCELLED/EXPIRED live in "all"). */
export type StudentRequestsStatusFilter =
  | "all"
  | "pending"
  | "approved"
  | "declined";

export interface StudentRequestsQuery {
  status: StudentRequestsStatusFilter;
  page: number;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

const STATUS_FILTERS: readonly StudentRequestsStatusFilter[] = [
  "all",
  "pending",
  "approved",
  "declined",
];

/** Sanitize raw Next.js `searchParams` into a typed, safe query (default: all). */
export function parseStudentRequestsQuery(raw: {
  status?: string | string[];
  page?: string | string[];
}): StudentRequestsQuery {
  const statusValue = (first(raw.status) ?? "").toLowerCase();
  const status: StudentRequestsStatusFilter = STATUS_FILTERS.includes(
    statusValue as StudentRequestsStatusFilter,
  )
    ? (statusValue as StudentRequestsStatusFilter)
    : "all";

  const parsedPage = Number.parseInt(first(raw.page) ?? "1", 10);
  const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;

  return { status, page };
}

/** Build the canonical `/dashboard/requests?...` URL (empty params dropped). */
export function buildStudentRequestsPath(
  query: Partial<StudentRequestsQuery>,
): string {
  const params = new URLSearchParams();
  if (query.status && query.status !== "all") params.set("status", query.status);
  if (query.page && query.page > 1) params.set("page", String(query.page));

  const search = params.toString();
  return search ? `${STUDENT_REQUESTS_PATH}?${search}` : STUDENT_REQUESTS_PATH;
}

/** Lowercase tab filter → the `RequestStatus` the read helpers expect. */
export function toRequestStatus(
  filter: StudentRequestsStatusFilter,
): RequestStatus | undefined {
  if (filter === "all") return undefined;
  return filter.toUpperCase() as RequestStatus;
}
