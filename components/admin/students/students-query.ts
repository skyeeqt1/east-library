/**
 * URL query helpers for `/admin/students`.
 *
 * Shared by the server page (reading `searchParams`) and the client toolbar /
 * pagination (writing the URL), so both sides always agree on the contract.
 */

export const STUDENTS_PATH = "/admin/students";

export const STUDENTS_PER_PAGE = 25;

export type StatusFilter = "ALL" | "ACTIVE" | "BLOCKED";

export interface StudentsQuery {
  q: string;
  status: StatusFilter;
  page: number;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Sanitize raw Next.js `searchParams` into a typed, safe query. */
export function parseStudentsQuery(raw: {
  q?: string | string[];
  status?: string | string[];
  page?: string | string[];
}): StudentsQuery {
  const q = (first(raw.q) ?? "").trim().slice(0, 80);
  const statusValue = (first(raw.status) ?? "").toUpperCase();
  const status: StatusFilter =
    statusValue === "ACTIVE" || statusValue === "BLOCKED" ? statusValue : "ALL";

  const parsedPage = Number.parseInt(first(raw.page) ?? "1", 10);
  const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;

  return { q, status, page };
}

/** Build the canonical `/admin/students?...` URL (empty params are dropped). */
export function buildStudentsPath(
  query: Partial<StudentsQuery>,
): string {
  const params = new URLSearchParams();
  const q = query.q?.trim();
  if (q) params.set("q", q);
  if (query.status && query.status !== "ALL") params.set("status", query.status);
  if (query.page && query.page > 1) params.set("page", String(query.page));

  const search = params.toString();
  return search ? `${STUDENTS_PATH}?${search}` : STUDENTS_PATH;
}
