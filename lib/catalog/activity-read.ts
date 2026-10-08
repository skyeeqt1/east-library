import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getCatalogStats } from "@/lib/catalog/availability";
import { getLoanCounts, manilaToday } from "@/lib/catalog/loans-read";

/**
 * ============================================================================
 *  Admin dashboard reads — server-only helpers (Phase 6, prd.md FR-21)
 * ============================================================================
 *
 * Powers the flagship `/admin/dashboard` screen (design §5):
 *
 *   - `getAdminActivity()`        — the unified "Borrow activity" feed
 *                                   (tab + status + search + pagination),
 *   - `getAdminActivityCounts()`  — the tab badge counters,
 *   - `getAdminDashboardStats()`  — the 3 stat cards (values, week-over-week
 *                                   deltas, 14-day Manila trend series).
 *
 * Plain async functions: **no `"use server"` directive** (same contract as
 * lib/catalog/loans-read.ts / fines-read.ts / availability.ts) — call them
 * from Server Components / route handlers / server actions, never from a
 * client component. Every read goes through the cookie-aware anon client so
 * RLS applies (schema.md §4): `loan_requests` / `loans` / `fines` /
 * `profiles` / `books` are all readable by admins (`is_admin()`), so the
 * dashboard (behind `assertAdmin()` in the admin layout) sees the whole
 * school while a student session would be scoped to its own rows.
 *
 * ## The unified activity feed ("Borrow activity" table)
 *
 * Four buckets are fetched independently (PostgREST cannot OR across
 * embedded resources) and **unioned in JS**, exactly like the v1 approach
 * documented in components/admin/damages/assessable-returns.ts:
 *
 *   - `pending`  — `loan_requests` with status PENDING      (kind REQUEST),
 *   - `overdue`  — open loans past their due date           (kind LOAN),
 *   - `returns`  — loans with `returned_at` NOT NULL        (kind RETURN),
 *   - `fines`    — `fines` rows                            (kind FINE),
 *
 * plus a fifth bucket used only by the `?status=active` filter pill —
 * open loans that are not yet overdue (kind LOAN, status "Active"). Active
 * loans are deliberately **not** part of the default "All activity" union
 * (Phase 6 spec: the union is exactly the four buckets above; the stat card
 * and the Active pill are how current loans surface).
 *
 * Every bucket is capped at `ACTIVITY_FETCH_LIMIT` rows (200, newest first),
 * the merged array is sorted `event.at` desc and capped again at 200 —
 * pagination runs over that merged slice and `truncated` is reported to the
 * UI whenever the cap could have hidden older rows (same disclosure contract
 * as `getAssessableReturns`). Counts come from exact `head: true` count
 * queries instead, so the tab badges stay exact even when the feed is capped.
 *
 * All timestamps are displayed in Asia/Manila (R-30): labels are built from
 * the Manila calendar day, `manilaToday()` gates the overdue bucket, and the
 * dashboard trends bucket events by Manila day.
 */

/* ------------------------------------------------------------------ */
/* Types — defined in the client-safe module, re-exported here so the   */
/* server and client halves of the dashboard agree on one source of      */
/* truth (see lib/catalog/activity-types.ts for why they live there).    */
/* ------------------------------------------------------------------ */

import type {
  ActivityCounts,
  ActivityKind,
  ActivityPage,
  ActivityRow,
  ActivityStatus,
  ActivityTab,
  DashboardStats,
  StatDelta,
} from "@/lib/catalog/activity-types";

export type {
  ActivityCounts,
  ActivityKind,
  ActivityPage,
  ActivityRow,
  ActivityStatus,
  ActivityTab,
  DashboardStats,
  StatDelta,
};

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

/** Safety cap per bucket AND for the merged union (see file header). */
export const ACTIVITY_FETCH_LIMIT = 200;

/** Sparkline window — design §4.2 allows 7–30 points, the spec asks for 14. */
export const ACTIVITY_TREND_DAYS = 14;

/** Cap on the books/loans scans that build the trend series (school scale). */
const TREND_SCAN_LIMIT = 5_000;

const DEFAULT_PER_PAGE = 10;
const MAX_PER_PAGE = 100;

const MANILA_OFFSET_MS = 8 * 3_600_000; // Asia/Manila = UTC+8, no DST (R-30)

/* ------------------------------------------------------------------ */
/* Internal helpers                                                    */
/* ------------------------------------------------------------------ */

function fail(message: string, details?: string): never {
  throw new Error(details ? `${message} (${details})` : message);
}

function clampPage(value: number | undefined): number {
  return Math.max(1, Math.floor(value ?? 1));
}

function clampPerPage(value: number | undefined): number {
  return Math.min(
    MAX_PER_PAGE,
    Math.max(1, Math.floor(value ?? DEFAULT_PER_PAGE)),
  );
}

/** Normalize an embedded PostgREST row: FK embeds arrive object-or-array. */
function embedFirst<T>(value: T | T[] | null | undefined): T | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.length > 0 ? value[0] : null;
  if (typeof value === "object" && Object.keys(value).length === 0) return null;
  return value;
}

/**
 * DB enum → StatusPill vocabulary (design §2.1): PENDING → "Pending",
 * UNPAID → "Unpaid", … Unknown values pass through unchanged so a new
 * status can never crash the dashboard.
 */
const STATUS_LABELS: Record<string, string> = {
  PENDING: "Pending",
  APPROVED: "Approved",
  DECLINED: "Declined",
  CANCELLED: "Cancelled",
  EXPIRED: "Expired",
  ACTIVE: "Active",
  OVERDUE: "Overdue",
  RETURNED: "Returned",
  UNPAID: "Unpaid",
  PAID: "Paid",
  WAIVED: "Waived",
};

function pillStatus(raw: string): string {
  return STATUS_LABELS[raw] ?? raw;
}

/** `?status=` pill → the `ActivityRow.status` it isolates. */
const STATUS_FILTER_LABEL: Record<Exclude<ActivityStatus, "all">, string> = {
  pending: "Pending",
  active: "Active",
  overdue: "Overdue",
  returned: "Returned",
  unpaid: "Unpaid",
};

/** Short Manila date for event labels — "Oct 5" (R-30). */
const eventDateFormatter = new Intl.DateTimeFormat("en-PH", {
  month: "short",
  day: "numeric",
  timeZone: "Asia/Manila",
});

function dateLabel(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "";
  return eventDateFormatter.format(parsed);
}

/** `YYYY-MM-DD` + `n` days (pure date-string maths — no TZ involved). */
function shiftDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Start of the Manila calendar day `dateStr` as epoch ms (R-30). */
function manilaStartMs(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return Date.UTC(y, m - 1, d) - MANILA_OFFSET_MS;
}

/** Case-insensitive hit test over student name/number and title/author. */
function matchesQuery(row: ActivityRow, needle: string): boolean {
  const lower = needle.toLowerCase();
  return (
    row.student.name.toLowerCase().includes(lower) ||
    (row.student.studentNumber ?? "").toLowerCase().includes(lower) ||
    row.bookTitle.toLowerCase().includes(lower) ||
    row.bookAuthor.toLowerCase().includes(lower)
  );
}

/* ------------------------------------------------------------------ */
/* Bucket fetchers (each newest-first, capped at ACTIVITY_FETCH_LIMIT) */
/* ------------------------------------------------------------------ */

type BucketId = "pending" | "overdue" | "returns" | "fines" | "active";

interface BucketResult {
  rows: ActivityRow[];
  /** The bucket returned a full page — older rows may exist below it. */
  hitLimit: boolean;
}

interface ProfileEmbed {
  full_name: string;
  student_id: string | null;
  course_section: string | null;
}
type Embed<T> = T | T[] | null | undefined;

interface JoinedProfileBook {
  id: string;
  created_at: string;
  student: Embed<ProfileEmbed>;
  book: Embed<{ title: string; author: string }>;
}

interface JoinedLoan {
  id: string;
  released_at: string;
  due_date: string;
  returned_at: string | null;
  student: Embed<ProfileEmbed>;
  book: Embed<{ title: string; author: string }>;
}

interface JoinedFine {
  id: string;
  created_at: string;
  amount_centavos: number;
  status: string;
  description: string | null;
  student: Embed<ProfileEmbed>;
  loan: Embed<{ book: Embed<{ title: string; author: string }> }>;
}

function toStudent(embed: Embed<ProfileEmbed>) {
  const student = embedFirst(embed);
  return {
    name: student?.full_name ?? "",
    studentNumber: student?.student_id ?? null,
    courseSection: student?.course_section ?? null,
  };
}

/** 1) PENDING borrow requests — event = request time, status "Pending". */
async function fetchPendingBucket(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<BucketResult> {
  const { data, error } = await supabase
    .from("loan_requests")
    .select(
      `id, created_at,
       student:profiles!loan_requests_student_id_fkey(full_name, student_id, course_section),
       book:books(title, author)`,
    )
    .eq("status", "PENDING")
    .order("created_at", { ascending: false })
    .limit(ACTIVITY_FETCH_LIMIT);
  if (error) fail("Could not load activity.", error.message);

  const rows = ((data ?? []) as unknown as JoinedProfileBook[]).map((row) => ({
    id: row.id,
    kind: "REQUEST" as const,
    student: toStudent(row.student),
    bookTitle: embedFirst(row.book)?.title ?? "",
    bookAuthor: embedFirst(row.book)?.author ?? "",
    event: { label: `Requested ${dateLabel(row.created_at)}`, at: row.created_at },
    status: "Pending",
    href: "/admin/requests",
  }));
  return { rows, hitLimit: rows.length >= ACTIVITY_FETCH_LIMIT };
}

/** Shared loan mapping for the overdue / active / returns buckets. */
function mapLoanRow(
  row: JoinedLoan,
  kind: ActivityKind,
  status: string,
  eventAt: string,
  eventPrefix: string,
): ActivityRow {
  const book = embedFirst(row.book);
  return {
    id: row.id,
    kind,
    student: toStudent(row.student),
    bookTitle: book?.title ?? "",
    bookAuthor: book?.author ?? "",
    event: { label: `${eventPrefix} ${dateLabel(eventAt)}`, at: eventAt },
    dueDate: row.due_date,
    status,
    href: "/admin/loans",
  };
}

const LOAN_SELECT = `id, released_at, due_date, returned_at,
   student:profiles!loans_student_id_fkey(full_name, student_id, course_section),
   book:books(title, author)`;

/** 2) Open loans past their due date (Manila) — status "Overdue". */
async function fetchOverdueBucket(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<BucketResult> {
  const { data, error } = await supabase
    .from("loans")
    .select(LOAN_SELECT)
    .is("returned_at", null)
    .lt("due_date", manilaToday())
    .order("released_at", { ascending: false })
    .limit(ACTIVITY_FETCH_LIMIT);
  if (error) fail("Could not load activity.", error.message);

  const rows = ((data ?? []) as unknown as JoinedLoan[]).map((row) =>
    mapLoanRow(row, "LOAN", "Overdue", row.released_at, "Released"),
  );
  return { rows, hitLimit: rows.length >= ACTIVITY_FETCH_LIMIT };
}

/** 3) Returned loans, newest return first — status "Returned". */
async function fetchReturnsBucket(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<BucketResult> {
  const { data, error } = await supabase
    .from("loans")
    .select(LOAN_SELECT)
    .not("returned_at", "is", null)
    .order("returned_at", { ascending: false })
    .limit(ACTIVITY_FETCH_LIMIT);
  if (error) fail("Could not load activity.", error.message);

  const rows = ((data ?? []) as unknown as JoinedLoan[]).map((row) =>
    mapLoanRow(
      row,
      "RETURN",
      "Returned",
      row.returned_at ?? row.released_at,
      "Returned",
    ),
  );
  return { rows, hitLimit: rows.length >= ACTIVITY_FETCH_LIMIT };
}

/** 4) Fines — event = charge time, amount kept for the ₱ cell (R-29). */
async function fetchFinesBucket(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<BucketResult> {
  const { data, error } = await supabase
    .from("fines")
    .select(
      `id, created_at, amount_centavos, status, description,
       student:profiles!fines_student_id_fkey(full_name, student_id, course_section),
       loan:loans!fines_loan_id_fkey(book:books(title, author))`,
    )
    .order("created_at", { ascending: false })
    .limit(ACTIVITY_FETCH_LIMIT);
  if (error) fail("Could not load activity.", error.message);

  const rows = ((data ?? []) as unknown as JoinedFine[]).map((row) => {
    const book = embedFirst(embedFirst(row.loan)?.book);
    return {
      id: row.id,
      kind: "FINE" as const,
      student: toStudent(row.student),
      bookTitle: book?.title ?? "Manual adjustment",
      bookAuthor: book?.author ?? row.description ?? "",
      event: { label: `Charged ${dateLabel(row.created_at)}`, at: row.created_at },
      status: pillStatus(row.status),
      href: "/admin/penalties",
      fine_centavos: Number(row.amount_centavos ?? 0),
    };
  });
  return { rows, hitLimit: rows.length >= ACTIVITY_FETCH_LIMIT };
}

/** 5) Open loans that are NOT yet overdue — only for `?status=active`. */
async function fetchActiveBucket(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<BucketResult> {
  const { data, error } = await supabase
    .from("loans")
    .select(LOAN_SELECT)
    .is("returned_at", null)
    .gte("due_date", manilaToday())
    .order("released_at", { ascending: false })
    .limit(ACTIVITY_FETCH_LIMIT);
  if (error) fail("Could not load activity.", error.message);

  const rows = ((data ?? []) as unknown as JoinedLoan[]).map((row) =>
    mapLoanRow(row, "LOAN", "Active", row.released_at, "Released"),
  );
  return { rows, hitLimit: rows.length >= ACTIVITY_FETCH_LIMIT };
}

const BUCKET_FETCHERS: Record<
  BucketId,
  (
    supabase: Awaited<ReturnType<typeof createClient>>,
  ) => Promise<BucketResult>
> = {
  pending: fetchPendingBucket,
  overdue: fetchOverdueBucket,
  returns: fetchReturnsBucket,
  fines: fetchFinesBucket,
  active: fetchActiveBucket,
};

/* ------------------------------------------------------------------ */
/* Activity feed                                                       */
/* ------------------------------------------------------------------ */

const BUCKETS_BY_TAB: Record<ActivityTab, BucketId[]> = {
  all: ["pending", "overdue", "returns", "fines"],
  pending: ["pending"],
  overdue: ["overdue"],
  returns: ["returns"],
  fines: ["fines"],
};

/**
 * Which buckets feed a (tab, status) pair:
 *
 * - `tab` picks the base set (all → the four Phase 6 buckets);
 * - a status pill narrows it — each pill maps to exactly one bucket
 *   (`active` is special: its rows only exist in the ACTIVE bucket, which is
 *   only reachable from the All tab; every other combination honestly
 *   yields an empty page);
 * - so `?tab=overdue&status=returned` short-circuits to zero rows instead
 *   of fetching data the filter would discard anyway.
 */
function selectBuckets(tab: ActivityTab, status: ActivityStatus): BucketId[] {
  const base = BUCKETS_BY_TAB[tab];
  if (status === "all") return base;
  if (status === "active") return tab === "all" ? ["active"] : [];
  const wanted: BucketId[] =
    status === "pending"
      ? ["pending"]
      : status === "overdue"
        ? ["overdue"]
        : status === "returned"
          ? ["returns"]
          : ["fines"];
  return base.filter((bucket) => wanted.includes(bucket));
}

/**
 * Borrow-activity feed for the admin dashboard table (design §5.3).
 *
 * - `tab`    → `'all' | 'pending' | 'overdue' | 'returns' | 'fines'`
 *              (the union and single-bucket views described in the file
 *              header); `status` → one StatusPill filter pill; `q` →
 *              case-insensitive match over student name / number and book
 *              title / author across the merged rows;
 * - ordering: unified `event.at` desc (ISO timestamps, same offset format,
 *   so the numeric parse is the tie-safe comparison);
 * - `page` is 1-based over the merged, capped array, `perPage` clamped
 *   1–100 (default 10);
 * - `truncated: true` means a bucket or the merged union hit
 *   `ACTIVITY_FETCH_LIMIT` — the UI must disclose that older rows are not
 *   listed (counts stay exact, see `getAdminActivityCounts`).
 *
 * Throws on database errors so a failed read surfaces as the page's error
 * state instead of a silently empty table.
 */
export async function getAdminActivity(
  opts: {
    tab: ActivityTab;
    q?: string;
    status?: ActivityStatus;
    page?: number;
    perPage?: number;
  },
): Promise<ActivityPage> {
  const page = clampPage(opts.page);
  const perPage = clampPerPage(opts.perPage);
  const status: ActivityStatus = opts.status ?? "all";
  const query = opts.q?.trim();

  const buckets = selectBuckets(opts.tab, status);
  if (buckets.length === 0) {
    return { rows: [], total: 0, page, perPage, truncated: false };
  }

  const supabase = await createClient();
  const fetched = await Promise.all(
    buckets.map((bucket) => BUCKET_FETCHERS[bucket](supabase)),
  );

  let rows = fetched.flatMap((bucket) => bucket.rows);

  // Status pills narrow the union (buckets other than `fines` already
  // carry a single status, so this is a cheap no-op for them).
  if (status !== "all") {
    const label = STATUS_FILTER_LABEL[status];
    rows = rows.filter((row) => row.status === label);
  }
  if (query) {
    rows = rows.filter((row) => matchesQuery(row, query));
  }

  rows.sort(
    (a, b) => Date.parse(b.event.at) - Date.parse(a.event.at),
  );

  // Cap the merged union; disclose whenever the cap could hide rows.
  let truncated = fetched.some((bucket) => bucket.hitLimit);
  if (rows.length > ACTIVITY_FETCH_LIMIT) {
    rows = rows.slice(0, ACTIVITY_FETCH_LIMIT);
    truncated = true;
  }

  const from = (page - 1) * perPage;
  return {
    rows: rows.slice(from, from + perPage),
    total: rows.length,
    page,
    perPage,
    truncated,
  };
}

/* ------------------------------------------------------------------ */
/* Tab badge counts (exact — head-count queries, never capped)         */
/* ------------------------------------------------------------------ */

/**
 * Exact counters for the tab row (design §4.3 "Pending requests (12)").
 * Each bucket is a `head: true` count with the same predicate as its
 * fetcher, so badges agree with the feed (and stay exact even when the
 * feed itself is capped at 200 rows — the page discloses the cap).
 *
 * `all` = pending + overdue + returns + fines (the four union buckets;
 * active loans are intentionally excluded, matching `getAdminActivity`).
 */
export async function getAdminActivityCounts(): Promise<ActivityCounts> {
  const supabase = await createClient();
  const today = manilaToday();

  const [pending, overdue, returns, fines] = await Promise.all([
    supabase
      .from("loan_requests")
      .select("id", { count: "exact", head: true })
      .eq("status", "PENDING"),
    supabase
      .from("loans")
      .select("id", { count: "exact", head: true })
      .is("returned_at", null)
      .lt("due_date", today),
    supabase
      .from("loans")
      .select("id", { count: "exact", head: true })
      .not("returned_at", "is", null),
    supabase.from("fines").select("id", { count: "exact", head: true }),
  ]);
  if (pending.error) fail("Could not load activity counts.", pending.error.message);
  if (overdue.error) fail("Could not load activity counts.", overdue.error.message);
  if (returns.error) fail("Could not load activity counts.", returns.error.message);
  if (fines.error) fail("Could not load activity counts.", fines.error.message);

  const p = pending.count ?? 0;
  const o = overdue.count ?? 0;
  const r = returns.count ?? 0;
  const f = fines.count ?? 0;

  return { all: p + o + r + f, pending: p, overdue: o, returns: r, fines: f };
}

/* ------------------------------------------------------------------ */
/* Stat cards (design §5.2)                                            */
/* ------------------------------------------------------------------ */

/**
 * Week-over-week percent change with an explicit **flat** state — the
 * zero baseline (fresh install) must never divide by zero: `previous <= 0`
 * always yields `0% / flat`, and equal values round to `0% / flat`.
 * Rounded to one decimal ("2.4%") per design §4.2.
 */
function deltaOf(current: number, previous: number): StatDelta {
  if (previous <= 0) return { value: "0%", direction: "flat" };
  const pct = Math.round(((current - previous) / previous) * 1000) / 10;
  if (pct > 0) return { value: `${pct}%`, direction: "up" };
  if (pct < 0) return { value: `${Math.abs(pct)}%`, direction: "down" };
  return { value: "0%", direction: "flat" };
}

/**
 * The three stat cards of design §5.2 — values, deltas vs 7 days ago and
 * 14-point Manila-day trend arrays for the sparklines.
 *
 * Values reuse the existing tile helpers where a stored predicate already
 * exists (`getCatalogStats()` for titles, `getLoanCounts()` for open loans);
 * the trends and `overdueThisWeek` are computed point-in-time from two
 * capped scans (books `created_at`, loans `released_at/returned_at/
 * due_date`) bucketed by **Manila day** (R-30):
 *
 *   - `totalBooks` trend  — cumulative titles created before that day's end
 *     (flat/rising by construction — a flat line at 0 on a fresh install);
 *   - `activeLoans` trend — loans released before the day's end and not yet
 *     returned by it (point-in-time "books out");
 *   - `overdue` trend     — that day's active loans whose `due_date` was
 *     already in the past; `overdueThisWeek` is today's bucket.
 *
 * `deltas` compare the current value against the trend value 7 days ago
 * (`trends[x][TREND_DAYS - 8]`); at the zero baseline every trend point is
 * 0, so each delta is `0%` / `flat` — no division by zero anywhere.
 */
export async function getAdminDashboardStats(): Promise<DashboardStats> {
  const supabase = await createClient();
  const today = manilaToday();

  // Manila day buckets, oldest → today.
  const days: string[] = [];
  for (let i = ACTIVITY_TREND_DAYS - 1; i >= 0; i -= 1) {
    days.push(shiftDays(today, -i));
  }
  const windowStartIso = new Date(manilaStartMs(days[0])).toISOString();
  const endTodayIso = new Date(manilaStartMs(shiftDays(today, 1))).toISOString();

  const [catalog, loanCounts, booksRes, openRes, returnedRes] =
    await Promise.all([
      getCatalogStats(),
      getLoanCounts(),
      supabase
        .from("books")
        .select("created_at")
        .order("created_at", { ascending: true })
        .limit(TREND_SCAN_LIMIT),
      supabase
        .from("loans")
        .select("released_at, returned_at, due_date")
        .is("returned_at", null)
        .lt("released_at", endTodayIso)
        .limit(TREND_SCAN_LIMIT),
      supabase
        .from("loans")
        .select("released_at, returned_at, due_date")
        .not("returned_at", "is", null)
        .gte("returned_at", windowStartIso)
        .limit(TREND_SCAN_LIMIT),
    ]);
  if (booksRes.error) {
    fail("Could not load dashboard stats.", booksRes.error.message);
  }
  if (openRes.error) {
    fail("Could not load dashboard stats.", openRes.error.message);
  }
  if (returnedRes.error) {
    fail("Could not load dashboard stats.", returnedRes.error.message);
  }

  interface LoanScan {
    released_at: string;
    returned_at: string | null;
    due_date: string;
  }
  const loans = [
    ...((openRes.data ?? []) as LoanScan[]),
    ...((returnedRes.data ?? []) as LoanScan[]),
  ];
  const books = (booksRes.data ?? []) as { created_at: string }[];

  const totalBooksTrend: number[] = [];
  const activeLoansTrend: number[] = [];
  const overdueTrend: number[] = [];

  for (let i = 0; i < days.length; i += 1) {
    // Point-in-time evaluation at the END of this Manila day.
    const endMs = manilaStartMs(shiftDays(days[i], 1));

    let active = 0;
    let overdue = 0;
    for (const loan of loans) {
      if (Date.parse(loan.released_at) >= endMs) continue;
      if (loan.returned_at && Date.parse(loan.returned_at) < endMs) continue;
      active += 1;
      if (loan.due_date < days[i]) overdue += 1;
    }
    activeLoansTrend.push(active);
    overdueTrend.push(overdue);

    let titles = 0;
    for (const book of books) {
      if (Date.parse(book.created_at) < endMs) titles += 1;
    }
    totalBooksTrend.push(titles);
  }

  const totalBooks = catalog.totalTitles;
  const activeLoans = loanCounts.active + loanCounts.overdue;
  const overdueThisWeek = overdueTrend[ACTIVITY_TREND_DAYS - 1];
  const weekAgo = ACTIVITY_TREND_DAYS - 8; // 7 days before "today"

  return {
    totalBooks,
    activeLoans,
    overdueThisWeek,
    deltas: {
      totalBooks: deltaOf(totalBooks, totalBooksTrend[weekAgo]),
      activeLoans: deltaOf(activeLoans, activeLoansTrend[weekAgo]),
      overdueThisWeek: deltaOf(overdueThisWeek, overdueTrend[weekAgo]),
    },
    trends: {
      totalBooks: totalBooksTrend,
      activeLoans: activeLoansTrend,
      overdue: overdueTrend,
    },
  };
}
