import type { FineStatus, FineType } from "@/lib/validations/fine";

/**
 * URL query helpers for `/admin/penalties` (Phase 5b UI).
 *
 * Shared by the server page (reading `searchParams`) and the client toolbar /
 * pagination (writing the URL), so both sides always agree on the contract —
 * the mirror of `components/admin/requests/requests-query.ts`.
 *
 * Tab filter → read-helper mapping (lib/catalog/fines-read.ts):
 *   `unpaid` → `status: 'UNPAID'` (the default desk view — what needs collecting)
 *   `paid`   → `status: 'PAID'`
 *   `waived` → `status: 'WAIVED'`
 *   `all`    → `status: 'all'` (UNPAID block first, then settled rows)
 * Type filter → `type: 'OVERDUE' | 'DAMAGE'` (R-18 / R-22), `all` → omitted.
 */

export const PENALTIES_PATH = "/admin/penalties";

/** Fixed table page size (Phase 5 spec — 25/page, footer select disabled). */
export const PENALTIES_PER_PAGE = 25;

/** Tab states for the fines queue. */
export type PenaltiesStatusFilter = "unpaid" | "paid" | "waived" | "all";

/** Type pills — "All types" keeps both R-18 OVERDUE and R-22 DAMAGE rows. */
export type PenaltiesTypeFilter = "all" | "OVERDUE" | "DAMAGE";

export interface PenaltiesQuery {
  status: PenaltiesStatusFilter;
  type: PenaltiesTypeFilter;
  q: string;
  page: number;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

const STATUS_FILTERS: readonly PenaltiesStatusFilter[] = [
  "unpaid",
  "paid",
  "waived",
  "all",
];

/** Sanitize raw Next.js `searchParams` into a typed, safe query (default: unpaid). */
export function parsePenaltiesQuery(raw: {
  status?: string | string[];
  type?: string | string[];
  q?: string | string[];
  page?: string | string[];
}): PenaltiesQuery {
  const statusValue = (first(raw.status) ?? "").toLowerCase();
  const status: PenaltiesStatusFilter = STATUS_FILTERS.includes(
    statusValue as PenaltiesStatusFilter,
  )
    ? (statusValue as PenaltiesStatusFilter)
    : "unpaid";

  const typeValue = (first(raw.type) ?? "").toUpperCase();
  const type: PenaltiesTypeFilter =
    typeValue === "OVERDUE" || typeValue === "DAMAGE" ? typeValue : "all";

  const q = (first(raw.q) ?? "").trim().slice(0, 80);

  const parsedPage = Number.parseInt(first(raw.page) ?? "1", 10);
  const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;

  return { status, type, q, page };
}

/** Build the canonical `/admin/penalties?...` URL (empty params are dropped). */
export function buildPenaltiesPath(query: Partial<PenaltiesQuery>): string {
  const params = new URLSearchParams();
  const q = query.q?.trim();
  if (q) params.set("q", q);
  if (query.status && query.status !== "unpaid") params.set("status", query.status);
  if (query.type && query.type !== "all") params.set("type", query.type);
  if (query.page && query.page > 1) params.set("page", String(query.page));

  const search = params.toString();
  return search ? `${PENALTIES_PATH}?${search}` : PENALTIES_PATH;
}

/**
 * Tab filter → the `status` argument for `getAdminFines`.
 * `"all"` is meaningful (not a FineStatus): it lists every fine with the
 * UNPAID block first.
 */
export function toFineStatusArg(
  filter: PenaltiesStatusFilter,
): FineStatus | "all" {
  if (filter === "all") return "all";
  if (filter === "paid") return "PAID";
  if (filter === "waived") return "WAIVED";
  return "UNPAID";
}

/** Type pill → the `type` argument for `getAdminFines` (`undefined` = no filter). */
export function toFineTypeArg(
  filter: PenaltiesTypeFilter,
): FineType | undefined {
  return filter === "all" ? undefined : filter;
}
