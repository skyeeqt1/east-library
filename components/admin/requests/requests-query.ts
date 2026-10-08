/**
 * URL query helpers for `/admin/requests`.
 *
 * Shared by the server page (reading `searchParams`) and the client toolbar /
 * pagination (writing the URL), so both sides always agree on the contract —
 * the mirror of `components/admin/students/students-query.ts`.
 */

export const REQUESTS_PATH = "/admin/requests";

export const REQUESTS_PER_PAGE = 25;

/**
 * Tab states for the queue. `pending` is the default desk view; `approved` /
 * `declined` read the decision feed; `all` shows every R-12 state.
 */
export type RequestsStatusFilter = "pending" | "approved" | "declined" | "all";

export interface RequestsQuery {
  status: RequestsStatusFilter;
  page: number;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

const STATUS_FILTERS: readonly RequestsStatusFilter[] = [
  "pending",
  "approved",
  "declined",
  "all",
];

/** Sanitize raw Next.js `searchParams` into a typed, safe query (default: pending). */
export function parseRequestsQuery(raw: {
  status?: string | string[];
  page?: string | string[];
}): RequestsQuery {
  const statusValue = (first(raw.status) ?? "").toLowerCase();
  const status: RequestsStatusFilter = STATUS_FILTERS.includes(
    statusValue as RequestsStatusFilter,
  )
    ? (statusValue as RequestsStatusFilter)
    : "pending";

  const parsedPage = Number.parseInt(first(raw.page) ?? "1", 10);
  const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;

  return { status, page };
}

/** Build the canonical `/admin/requests?...` URL (empty params are dropped). */
export function buildRequestsPath(query: Partial<RequestsQuery>): string {
  const params = new URLSearchParams();
  if (query.status && query.status !== "pending") params.set("status", query.status);
  if (query.page && query.page > 1) params.set("page", String(query.page));

  const search = params.toString();
  return search ? `${REQUESTS_PATH}?${search}` : REQUESTS_PATH;
}
