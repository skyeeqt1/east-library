import { isLoanStatus, type LoanStatus } from "@/lib/validations/loan";

/**
 * URL query helpers for `/admin/loans` (Phase 4 UI).
 *
 * Shared by the server page (reading `searchParams`) and the client tabs /
 * search form / pagination (writing the URL), so both sides always agree on
 * the contract — the mirror of `components/admin/requests/requests-query.ts`.
 *
 * `status` mirrors `LOAN_STATUSES` (lib/validations/loan.ts): the default tab
 * is `ACTIVE`, `?status=OVERDUE` is the late shelf and `?status=RETURNED` is
 * the return history.
 */

export const LOANS_PATH = "/admin/loans";

/** Fixed table page size (Phase 4 spec — 25/page, footer select disabled). */
export const LOANS_PER_PAGE = 25;

/** Tab states — exactly `LOAN_STATUSES`. */
export type LoansStatusFilter = LoanStatus;

export interface LoansQuery {
  status: LoansStatusFilter;
  q: string;
  page: number;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Sanitize raw Next.js `searchParams` into a typed, safe query (default: ACTIVE). */
export function parseLoansQuery(raw: {
  status?: string | string[];
  q?: string | string[];
  page?: string | string[];
}): LoansQuery {
  const statusValue = (first(raw.status) ?? "").toUpperCase();
  const status: LoansStatusFilter = isLoanStatus(statusValue)
    ? statusValue
    : "ACTIVE";

  const q = (first(raw.q) ?? "").trim().slice(0, 80);

  const parsedPage = Number.parseInt(first(raw.page) ?? "1", 10);
  const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;

  return { status, q, page };
}

/** Build the canonical `/admin/loans?...` URL (empty params are dropped). */
export function buildLoansPath(query: Partial<LoansQuery>): string {
  const params = new URLSearchParams();
  const q = query.q?.trim();
  if (q) params.set("q", q);
  if (query.status && query.status !== "ACTIVE") params.set("status", query.status);
  if (query.page && query.page > 1) params.set("page", String(query.page));

  const search = params.toString();
  return search ? `${LOANS_PATH}?${search}` : LOANS_PATH;
}
