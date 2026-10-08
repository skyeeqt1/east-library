import type { DamageReportStatus } from "@/lib/validations/fine";

/**
 * URL query helpers for `/admin/damages` (Phase 5b UI).
 *
 * Shared by the server page (reading `searchParams`) and the client tabs /
 * pagination (writing the URL), so both sides always agree on the contract —
 * the mirror of `components/admin/penalties/penalties-query.ts`.
 *
 * Tab filter → read-helper mapping (lib/catalog/fines-read.ts):
 *   `pending`  → `status: 'PENDING'` (the work queue — default)
 *   `resolved` → `status: 'RESOLVED'` (history)
 *   `all`      → `status: 'all'`
 */

export const DAMAGES_PATH = "/admin/damages";

/** Fixed table page size (Phase 5 spec — 25/page, footer select disabled). */
export const DAMAGES_PER_PAGE = 25;

/** Tab states for the damage queue. */
export type DamagesStatusFilter = "pending" | "resolved" | "all";

export interface DamagesQuery {
  status: DamagesStatusFilter;
  page: number;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

const STATUS_FILTERS: readonly DamagesStatusFilter[] = [
  "pending",
  "resolved",
  "all",
];

/** Sanitize raw Next.js `searchParams` into a typed, safe query (default: pending). */
export function parseDamagesQuery(raw: {
  status?: string | string[];
  page?: string | string[];
}): DamagesQuery {
  const statusValue = (first(raw.status) ?? "").toLowerCase();
  const status: DamagesStatusFilter = STATUS_FILTERS.includes(
    statusValue as DamagesStatusFilter,
  )
    ? (statusValue as DamagesStatusFilter)
    : "pending";

  const parsedPage = Number.parseInt(first(raw.page) ?? "1", 10);
  const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;

  return { status, page };
}

/** Build the canonical `/admin/damages?...` URL (empty params are dropped). */
export function buildDamagesPath(query: Partial<DamagesQuery>): string {
  const params = new URLSearchParams();
  if (query.status && query.status !== "pending") params.set("status", query.status);
  if (query.page && query.page > 1) params.set("page", String(query.page));

  const search = params.toString();
  return search ? `${DAMAGES_PATH}?${search}` : DAMAGES_PATH;
}

/**
 * Tab filter → the `status` argument for `getDamageReports`.
 * `"all"` is meaningful (not a DamageReportStatus): every report.
 */
export function toDamageStatusArg(
  filter: DamagesStatusFilter,
): DamageReportStatus | "all" {
  if (filter === "all") return "all";
  if (filter === "resolved") return "RESOLVED";
  return "PENDING";
}
