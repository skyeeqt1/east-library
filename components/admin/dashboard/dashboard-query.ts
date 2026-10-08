import type { ActivityStatus, ActivityTab } from "@/lib/catalog/activity-types";

/**
 * URL query helpers for `/admin/dashboard` (Phase 6).
 *
 * Shared by the server page (reading `searchParams`) and the client tabs /
 * search form / status pills / pagination (writing the URL), so both sides
 * always agree on the contract — the mirror of
 * `components/admin/loans/loans-query.ts`.
 *
 *   `/admin/dashboard?tab=all&status=unpaid&q=maria&page=2`
 *
 * - `tab`    — activity tab (design §5.1): `all | pending | overdue |
 *              returns | fines`; default `all` (dropped from the URL).
 * - `status` — status filter pill (design §5.3): `all | pending | active |
 *              overdue | returned | unpaid`; default `all`.
 * - `q`      — free-text search, trimmed + capped at 80 chars.
 * - `page`   — 1-based page over the merged activity feed; default 1.
 *
 * State transitions (enforced by every caller in this folder):
 *   - switching **tab**    → `status = "all"`, `page = 1`, keeps `q`;
 *   - switching **status** → `page = 1`, keeps `tab` + `q`;
 *   - **search submit**    → `page = 1`, keeps `tab` + `status`;
 *   - **page change**      → keeps everything else.
 *
 * This module is deliberately free of `server-only` / "use server" markers
 * so both the server page and the client toolbar can import it (same rule
 * as `lib/validations/*`).
 */

export const DASHBOARD_PATH = "/admin/dashboard";

/** Fixed table page size for the borrow-activity table (design §5.3). */
export const DASHBOARD_PER_PAGE = 10;

/** Activity tabs, in render order (design §5.1). */
export const ACTIVITY_TABS: readonly ActivityTab[] = [
  "all",
  "pending",
  "overdue",
  "returns",
  "fines",
];

/** Status filter pills, in render order (design §5.3). */
export const ACTIVITY_STATUSES: readonly ActivityStatus[] = [
  "all",
  "pending",
  "active",
  "overdue",
  "returned",
  "unpaid",
];

export interface DashboardQuery {
  tab: ActivityTab;
  status: ActivityStatus;
  q: string;
  page: number;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isTab(value: string): value is ActivityTab {
  return (ACTIVITY_TABS as readonly string[]).includes(value);
}

function isStatus(value: string): value is ActivityStatus {
  return (ACTIVITY_STATUSES as readonly string[]).includes(value);
}

/**
 * Sanitize raw Next.js `searchParams` into a typed, safe query.
 * Unknown `tab` / `status` values fall back to `"all"`, `q` is trimmed and
 * capped at 80 chars, non-positive / non-numeric pages become 1.
 */
export function parseDashboardQuery(raw: {
  tab?: string | string[];
  status?: string | string[];
  q?: string | string[];
  page?: string | string[];
}): DashboardQuery {
  const tabValue = first(raw.tab) ?? "";
  const tab: ActivityTab = isTab(tabValue) ? tabValue : "all";

  const statusValue = first(raw.status) ?? "";
  const status: ActivityStatus = isStatus(statusValue) ? statusValue : "all";

  const q = (first(raw.q) ?? "").trim().slice(0, 80);

  const parsedPage = Number.parseInt(first(raw.page) ?? "1", 10);
  const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;

  return { tab, status, q, page };
}

/** Build the canonical `/admin/dashboard?...` URL (default params dropped). */
export function buildDashboardPath(query: Partial<DashboardQuery>): string {
  const params = new URLSearchParams();
  const q = query.q?.trim();
  if (q) params.set("q", q);
  if (query.tab && query.tab !== "all") params.set("tab", query.tab);
  if (query.status && query.status !== "all") params.set("status", query.status);
  if (query.page && query.page > 1) params.set("page", String(query.page));

  const search = params.toString();
  return search ? `${DASHBOARD_PATH}?${search}` : DASHBOARD_PATH;
}
