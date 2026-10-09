/**
 * URL query helpers for `/admin/reports` (Phase 8b, prd.md FR-23).
 *
 * Shared by the server page (reading `searchParams`) and the client tab row
 * (writing the URL), so both sides always agree on the contract — the
 * mirror of `components/admin/dashboard/dashboard-query.ts`.
 *
 *   `/admin/reports?tab=collections`
 *
 * - `tab` — which report set is on screen: `circulation | collections`
 *   (architecture.md `reports/` = "Circulation & collections reports").
 *   Default `circulation`, dropped from the URL.
 *
 * The tab is deliberately **URL state** (not `useState`): back/forward and
 * deep links reproduce the exact report, and only the active tab's reads
 * run on the server (3 parallel queries per tab — see
 * lib/catalog/reports-read.ts).
 *
 * This module is free of `server-only` / "use server" markers so the server
 * page and the client tabs can both import it (same rule as
 * `lib/validations/*`).
 */

export const REPORTS_PATH = "/admin/reports";

/** Report tabs, in render order (design §5.1 rhythm). */
export const REPORT_TABS = ["circulation", "collections"] as const;

export type ReportTab = (typeof REPORT_TABS)[number];

export interface ReportsQuery {
  tab: ReportTab;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isTab(value: string): value is ReportTab {
  return (REPORT_TABS as readonly string[]).includes(value);
}

/**
 * Sanitize raw Next.js `searchParams` into a typed, safe query.
 * Unknown / repeated `tab` values fall back to `"circulation"`.
 */
export function parseReportsQuery(raw: {
  tab?: string | string[];
}): ReportsQuery {
  const tabValue = first(raw.tab) ?? "";
  const tab: ReportTab = isTab(tabValue) ? tabValue : "circulation";
  return { tab };
}

/** Build the canonical `/admin/reports?...` URL (default tab dropped). */
export function buildReportsPath(query: Partial<ReportsQuery>): string {
  const params = new URLSearchParams();
  if (query.tab && query.tab !== "circulation") params.set("tab", query.tab);
  const search = params.toString();
  return search ? `${REPORTS_PATH}?${search}` : REPORTS_PATH;
}
