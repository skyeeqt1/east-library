/**
 * ============================================================================
 *  Admin dashboard types — shared, client-safe (Phase 6, prd.md FR-21)
 * ============================================================================
 *
 * The dashboard's read helpers (`lib/catalog/activity-read.ts`) are marked
 * `import "server-only"`, but their result shapes are also needed by client
 * components (the activity table, toolbar and pagination). This module holds
 * **only types** — no runtime code, no imports — so importing it from a
 * client component compiles away entirely and never drags server-only code
 * into the browser bundle (same discipline as `lib/auth/types.ts` and
 * `lib/validations/*`).
 *
 * Consumed by:
 *   - `lib/catalog/activity-read.ts`    (server — produces these shapes),
 *   - `components/admin/dashboard/*`    (client — renders these shapes).
 */

/* ------------------------------------------------------------------ */
/* URL-bound enums                                                     */
/* ------------------------------------------------------------------ */

/** Activity tabs bound to the `?tab=` URL param (design §5.1). */
export type ActivityTab = "all" | "pending" | "overdue" | "returns" | "fines";

/**
 * Status filter pills bound to `?status=` (design §5.3 "status filter
 * pills"): `all` keeps every row, the rest narrow the union to one
 * StatusPill vocabulary value.
 */
export type ActivityStatus =
  | "all"
  | "pending"
  | "active"
  | "overdue"
  | "returned"
  | "unpaid";

/** Where the Eye action in the Actions column navigates. */
export type ActivityKind = "REQUEST" | "LOAN" | "RETURN" | "FINE";

/* ------------------------------------------------------------------ */
/* Activity feed                                                       */
/* ------------------------------------------------------------------ */

/** One row of the unified borrow-activity feed. */
export interface ActivityRow {
  /** Source-table id (`loan_requests.id` / `loans.id` / `fines.id`). */
  id: string;
  kind: ActivityKind;
  student: {
    name: string;
    studentNumber: string | null;
    courseSection: string | null;
  };
  bookTitle: string;
  bookAuthor: string;
  /** The event that put this row in the feed: human label + ISO instant. */
  event: { label: string; at: string };
  /** `loans.due_date` (YYYY-MM-DD) for LOAN/RETURN rows; null otherwise. */
  dueDate?: string | null;
  /** StatusPill vocabulary: Pending · Active · Overdue · Returned · Unpaid · … */
  status: string;
  /** Queue the Eye action opens (`/admin/requests|loans|penalties`). */
  href?: string;
  /** Integer centavos (R-29) — FINE rows only, format with `formatPeso()`. */
  fine_centavos?: number;
}

/** Paginated slice of the activity feed. */
export interface ActivityPage {
  rows: ActivityRow[];
  /** Rows in the (filtered, capped) merged array — what pagination uses. */
  total: number;
  page: number;
  perPage: number;
  /** A bucket (or the merged array) hit the server-side fetch cap. */
  truncated: boolean;
}

/** Exact tab badge counters for the dashboard tab row (design §4.3). */
export interface ActivityCounts {
  all: number;
  pending: number;
  overdue: number;
  returns: number;
  fines: number;
}

/* ------------------------------------------------------------------ */
/* Stat cards (design §5.2)                                            */
/* ------------------------------------------------------------------ */

/**
 * Week-over-week delta for one stat card — the `StatCard` `delta` prop.
 * `direction: "flat"` is the zero-baseline state (fresh install): the value
 * reads `0%` and the arrow renders as an en-dash in gray (no divide-by-zero,
 * no misleading red/green).
 */
export interface StatDelta {
  value: string;
  direction: "up" | "down" | "flat";
}

/** The three stat cards of design §5.2 with their 14-day trend series. */
export interface DashboardStats {
  /** Total catalog titles (reuses `getCatalogStats()`). */
  totalBooks: number;
  /** Open loans — ACTIVE + OVERDUE statuses (reuses `getLoanCounts()`). */
  activeLoans: number;
  /** Open loans whose due date already passed on the Manila calendar. */
  overdueThisWeek: number;
  /** Percent change vs 7 days ago; flat "0%" when the baseline is zero. */
  deltas: {
    totalBooks: StatDelta;
    activeLoans: StatDelta;
    overdueThisWeek: StatDelta;
  };
  /** 14 Manila-day buckets, oldest → today (design §4.2: 7–30 points). */
  trends: {
    totalBooks: number[];
    activeLoans: number[];
    overdue: number[];
  };
}
