import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getFineCounts, type FineCounts } from "@/lib/catalog/fines-read";
import {
  getLoanCounts,
  manilaToday,
  toManilaDate,
} from "@/lib/catalog/loans-read";
import {
  FINE_STATUSES,
  FINE_TYPES,
  isFineStatus,
  isFineType,
  type FineStatus,
  type FineType,
} from "@/lib/validations/fine";

/**
 * ============================================================================
 *  Report reads — server-only helpers (Phase 8b, prd.md FR-23)
 * ============================================================================
 *
 * Powers `/admin/reports` (architecture.md §3 `reports/` = "Circulation &
 * collections reports") and the CSV export at
 * `/admin/reports/export` (FR-23: "export circulation, overdue, and
 * collections reports (CSV + print)"). Two functions, one per tab:
 *
 *   - `getCirculationReport()` — Circulation tab: stat strip + the 14-day
 *                                release trend + top borrowed + recent returns;
 *   - `getCollectionsReport()` — Collections tab: stat strip + inventory by
 *                                 category + fines matrix + top unpaid balances.
 *
 * Plain async functions: **no `"use server"` directive** (the same contract as
 * lib/catalog/loans-read.ts / fines-read.ts / activity-read.ts) — call them
 * from Server Components / route handlers, never from a client component.
 * Every read goes through the cookie-aware anon client so RLS applies
 * (schema.md §4): an admin session sees the whole school, a student session
 * would be scoped to its own rows (the pages are behind `assertAdmin()` — E10).
 *
 * ## Query budget — 3 parallel reads per tab (≤ 3 round-trip groups)
 *
 * Each tab is resolved in ONE `Promise.all` wave so a page render costs a
 * single round trip to PostgREST:
 *
 *   Circulation: `getLoanCounts()` (existing exact head-count helper) ·
 *                capped `loans` scan · capped `loan_requests` scan;
 *   Collections: `getFineCounts()` (existing exact helper — the mandated
 *                unpaid-total card) · capped `books`+copies scan · capped
 *                `fines` scan.
 *
 * Titles / copies / available are derived from the Collections `books` scan
 * instead of calling `getCatalogStats()` as well — the scan already carries
 * every copy's status, so a 4th read would buy nothing but an extra round
 * trip (exact while the scan is under its cap, disclosed when it is not).
 *
 * ## Caps (the `ACTIVITY_FETCH_LIMIT` pattern from activity-read)
 *
 * Scans are capped and **every cap is surfaced to the UI** through the
 * `truncated` flags, exactly like `getAdminActivity().truncated`:
 *
 *   - loans    2 000 newest by `released_at` (feeds trend · top borrowed ·
 *                recent returns),
 *   - requests   1 000 newest by `created_at` (feeds the month counters and
 *                the request trend — fetched from the earlier of the Manila
 *                month start and the 14-day window start so ONE scan covers
 *                both windows),
 *   - books    2 000 newest by `created_at` (inventory totals + categories),
 *   - fines    2 000 newest by `created_at` (matrix + per-student balances).
 *
 * Headline numbers that must stay exact (`active` / `overdue` /
 * `returned this month`, `unpaid total`) always come from the existing
 * head-count helpers, never from a capped scan.
 *
 * ## Manila day maths (R-30)
 *
 * `shiftDays` / `manilaStartMs` / `manilaMonthRange` are the same date-only
 * conventions the other catalog readers use (they keep their copies private),
 * so a day bucket, a month boundary and a `due_date` comparison are computed
 * identically everywhere: `YYYY-MM-DD` strings, UTC-midnight arithmetic, no
 * server-local timezone anywhere.
 */

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

/** Sparkline / bar-list window — 14 Manila days (design §4.2 / Phase 6). */
export const REPORT_TREND_DAYS = 14;

/** Rows kept in every "top N" list (spec: top 10). */
export const REPORT_TOP_LIMIT = 10;

/** Safety cap per scan (school scale — see the file header). */
export const LOANS_SCAN_LIMIT = 2_000;
export const REQUESTS_SCAN_LIMIT = 1_000;
export const BOOKS_SCAN_LIMIT = 2_000;
export const FINES_SCAN_LIMIT = 2_000;

const MANILA_OFFSET_MS = 8 * 3_600_000; // Asia/Manila = UTC+8, no DST (R-30)

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

/** One day of a trend series (`YYYY-MM-DD`, oldest → today). */
export interface ReportTrendPoint {
  date: string;
  count: number;
}

/** One row of the "Top borrowed books" table. */
export interface TopBorrowedRow {
  /** 1-based rank after sorting by borrow count. */
  rank: number;
  book_id: string;
  title: string;
  author: string;
  /** Loans of this title in the (capped) scan — all-time while untruncated. */
  borrow_count: number;
}

/** One row of the "Recent returns" table. */
export interface RecentReturnRow {
  id: string;
  student_name: string;
  student_number: string | null;
  title: string;
  author: string;
  returned_at: string;
  /** `GOOD` | `DAMAGED` (schema.md §2.5), null when unset. */
  condition_on_return: string | null;
  /**
   * Manila **date-string** days between `due_date` and the return (R-19/R-20
   * date-only maths); `null` when returned on or before the due date.
   */
  days_late: number | null;
}

/** Circulation tab headline numbers (the 4 StatCards). */
export interface CirculationStats {
  /** Open loans (ACTIVE + OVERDUE) — the dashboard's "Active loans". */
  activeLoans: number;
  /** Open loans flagged OVERDUE by the daily sweep (R-18). */
  overdueNow: number;
  /** Loans returned during the current Manila month (R-30). */
  returnedThisMonth: number;
  /** Borrow requests created during the current Manila month. */
  requestsThisMonth: number;
  /** Of those, still `PENDING`. */
  requestsPendingThisMonth: number;
  /** Of those, `APPROVED`. */
  requestsApprovedThisMonth: number;
}

export interface CirculationReport {
  stats: CirculationStats;
  /** Loans released per Manila day — the "Loans over time" bar list. */
  releaseTrend: ReportTrendPoint[];
  /** Point-in-time open loans per Manila day (sparkline, card 1). */
  activeTrend: number[];
  /** Point-in-time overdue loans per Manila day (sparkline, card 2). */
  overdueTrend: number[];
  /** Returns per Manila day (sparkline, card 3). */
  returnedTrend: number[];
  /** Requests created per Manila day (sparkline, card 4). */
  requestsTrend: number[];
  topBorrowed: TopBorrowedRow[];
  recentReturns: RecentReturnRow[];
  /** Scan hit its cap — the UI must disclose it (see the file header). */
  truncated: { loans: boolean; requests: boolean };
}

/** One "Inventory by category" bar row. */
export interface CategoryStat {
  category: string;
  titles: number;
  copies: number;
  available: number;
}

/** One cell of the fines matrix (count + total in integer centavos, R-29). */
export interface FineSummaryCell {
  count: number;
  total_centavos: number;
}

/** One type row (OVERDUE / DAMAGE) of the fines summary matrix. */
export interface FineSummaryRow {
  type: FineType;
  unpaid: FineSummaryCell;
  paid: FineSummaryCell;
  waived: FineSummaryCell;
  /** Rows of this type across every status (matrix row total). */
  count: number;
  total_centavos: number;
}

/** One row of the "Fines by student" top-unpaid table. */
export interface UnpaidStudentRow {
  student_id: string;
  student_name: string;
  student_number: string | null;
  course_section: string | null;
  unpaid_count: number;
  balance_centavos: number;
}

export interface CollectionsReport {
  /** Titles / copies / available derived from the (capped) books scan. */
  stats: { titles: number; totalCopies: number; availableCopies: number };
  /** Exact headline helpers from `getFineCounts()` (uncapped). */
  fineCounts: FineCounts;
  categories: CategoryStat[];
  /** 2 rows (OVERDUE · DAMAGE) × 3 status cells, always present. */
  fineSummary: FineSummaryRow[];
  topUnpaid: UnpaidStudentRow[];
  /** Scan hit its cap — the UI must disclose it (see the file header). */
  truncated: { books: boolean; fines: boolean };
}

/* ------------------------------------------------------------------ */
/* Manila day maths (R-30 — same conventions as loans-read/activity-read) */
/* ------------------------------------------------------------------ */

/** `YYYY-MM-DD` + `n` days (pure date-string maths — no timezone involved). */
function shiftDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Start of the Manila calendar day `dateStr` as epoch ms (R-30). */
function manilaStartMs(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return Date.UTC(y, m - 1, d) - MANILA_OFFSET_MS;
}

/** `[startIso, endIso)` covering the current Manila month (R-30 boundaries). */
function manilaMonthRange(): { startIso: string; endIso: string } {
  const [year, month] = manilaToday().split("-").map(Number);
  const start = Date.UTC(year, month - 1, 1) - MANILA_OFFSET_MS;
  const end =
    month === 12
      ? Date.UTC(year + 1, 0, 1) - MANILA_OFFSET_MS
      : Date.UTC(year, month, 1) - MANILA_OFFSET_MS;
  return {
    startIso: new Date(start).toISOString(),
    endIso: new Date(end).toISOString(),
  };
}

/**
 * Days between a loan's Manila `due_date` and the day it came back —
 * `null` when the return was on time. Pure `YYYY-MM-DD` string maths
 * (R-19/R-20): both dates are compared as date strings first, then as
 * UTC-midnight instants, so neither the server timezone nor a time-of-day
 * component can change the answer.
 */
function daysLate(dueDate: string, returnedAt: string): number | null {
  const returnedDate = toManilaDate(returnedAt);
  if (!returnedDate || returnedDate <= dueDate) return null;

  const diff =
    Date.parse(`${returnedDate}T00:00:00Z`) - Date.parse(`${dueDate}T00:00:00Z`);
  if (!Number.isFinite(diff)) return null;
  return Math.round(diff / 86_400_000);
}

/* ------------------------------------------------------------------ */
/* Internal helpers                                                    */
/* ------------------------------------------------------------------ */

function fail(message: string, details?: string): never {
  throw new Error(details ? `${message} (${details})` : message);
}

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Normalize an embedded PostgREST row: FK embeds arrive object-or-array. */
function embedFirst<T>(value: T | T[] | null | undefined): T | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.length > 0 ? value[0] : null;
  if (typeof value === "object" && Object.keys(value).length === 0) return null;
  return value;
}

/* ------------------------------------------------------------------ */
/* Circulation report                                                  */
/* ------------------------------------------------------------------ */

const LOAN_SELECT = `id, released_at, due_date, returned_at,
       condition_on_return, book_id,
       student:profiles!loans_student_id_fkey(full_name, student_id),
       book:books(title, author)`;

interface ScannedLoan {
  id: string;
  released_at: string;
  due_date: string;
  returned_at: string | null;
  condition_on_return: string | null;
  book_id: string;
  student: { full_name: string; student_id: string | null } | null;
  book: { title: string; author: string } | null;
}

interface ScannedRequest {
  created_at: string;
  status: string;
}

/**
 * The Circulation tab: 4 stat cards, the 14-day release trend, the top-10
 * borrowed titles and the last 10 returns — everything one tab needs in
 * ONE parallel wave of 3 reads (see the file header).
 *
 * - stat numbers come from `getLoanCounts()` (exact head counts: open loans =
 *   ACTIVE + OVERDUE, overdue = the sweep's OVERDUE flag, returns bounded by
 *   the current **Manila** month) plus the month-filtered request scan;
 * - the request scan starts at the earlier of the Manila month start and the
 *   14-day window start, so ONE capped read serves both the month counters
 *   and the request sparkline;
 * - the loans scan is ordered **newest first**, which guarantees the 14-day
 *   window is always inside the cap (the trend stays exact even when the cap
 *   binds) while "top borrowed" and "recent returns" become "…among the most
 *   recent 2 000 loans" — disclosed through `truncated.loans`;
 * - `days_late` on a return is computed from Manila **date strings**
 *   (`returned date − due_date`, R-19/R-20) — no timestamp arithmetic, no
 *   timezone drift.
 *
 * Throws on database errors so a failed read surfaces as the page's error
 * state instead of an empty-looking report.
 */
export async function getCirculationReport(): Promise<CirculationReport> {
  const supabase = await createClient();
  const today = manilaToday();

  // Manila day buckets, oldest → today (same construction as activity-read).
  const days: string[] = [];
  for (let i = REPORT_TREND_DAYS - 1; i >= 0; i -= 1) {
    days.push(shiftDays(today, -i));
  }
  const windowStartMs = manilaStartMs(days[0]);
  const windowStartIso = new Date(windowStartMs).toISOString();
  const { startIso: monthStartIso, endIso: monthEndIso } = manilaMonthRange();
  const monthStartMs = Date.parse(monthStartIso);
  const monthEndMs = Date.parse(monthEndIso);
  // One request scan covering BOTH windows: the earlier of the two starts.
  const requestsFromIso =
    windowStartMs < monthStartMs ? windowStartIso : monthStartIso;

  const [loanCounts, loansRes, requestsRes] = await Promise.all([
    getLoanCounts(),
    supabase
      .from("loans")
      .select(LOAN_SELECT)
      .order("released_at", { ascending: false })
      .limit(LOANS_SCAN_LIMIT),
    supabase
      .from("loan_requests")
      .select("created_at, status")
      .gte("created_at", requestsFromIso)
      .order("created_at", { ascending: false })
      .limit(REQUESTS_SCAN_LIMIT),
  ]);
  if (loansRes.error) {
    fail("Could not load the circulation report.", loansRes.error.message);
  }
  if (requestsRes.error) {
    fail("Could not load the circulation report.", requestsRes.error.message);
  }

  const loans = (loansRes.data ?? []) as unknown as ScannedLoan[];
  const requests = (requestsRes.data ?? []) as unknown as ScannedRequest[];

  /* ---- 14-day series (Manila day buckets, oldest → today) ---------- */
  const releaseTrend: ReportTrendPoint[] = [];
  const activeTrend: number[] = [];
  const overdueTrend: number[] = [];
  const returnedTrend: number[] = [];
  const requestsTrend: number[] = [];

  for (let i = 0; i < days.length; i += 1) {
    const day = days[i];
    // Point-in-time evaluation at the END of this Manila day.
    const endMs = manilaStartMs(shiftDays(day, 1));

    let released = 0;
    let active = 0;
    let overdue = 0;
    let returned = 0;
    for (const loan of loans) {
      const releasedMs = Date.parse(loan.released_at);
      if (releasedMs < endMs && toManilaDate(loan.released_at) === day) {
        released += 1;
      }
      if (releasedMs < endMs) {
        if (!loan.returned_at || Date.parse(loan.returned_at) >= endMs) {
          active += 1;
          if (loan.due_date < day) overdue += 1;
        }
      }
      if (loan.returned_at && toManilaDate(loan.returned_at) === day) {
        returned += 1;
      }
    }

    releaseTrend.push({ date: day, count: released });
    activeTrend.push(active);
    overdueTrend.push(overdue);
    returnedTrend.push(returned);
    requestsTrend.push(
      requests.filter((row) => toManilaDate(row.created_at) === day).length,
    );
  }

  /* ---- Top borrowed books (all-time within the scan, top 10) -------- */
  const byBook = new Map<
    string,
    { title: string; author: string; borrow_count: number }
  >();
  for (const loan of loans) {
    const entry = byBook.get(loan.book_id) ?? {
      title: loan.book?.title ?? "",
      author: loan.book?.author ?? "",
      borrow_count: 0,
    };
    entry.borrow_count += 1;
    byBook.set(loan.book_id, entry);
  }
  const topBorrowed: TopBorrowedRow[] = [...byBook.entries()]
    .map(([book_id, entry]) => ({ book_id, ...entry }))
    .sort(
      (a, b) =>
        b.borrow_count - a.borrow_count || a.title.localeCompare(b.title),
    )
    .slice(0, REPORT_TOP_LIMIT)
    .map((row, index) => ({ ...row, rank: index + 1 }));

  /* ---- Recent returns (last 10 by returned_at, newest first) ------- */
  const returnedLoans = loans.filter(
    (loan): loan is ScannedLoan & { returned_at: string } =>
      typeof loan.returned_at === "string" && loan.returned_at.length > 0,
  );
  returnedLoans.sort(
    (a, b) => Date.parse(b.returned_at) - Date.parse(a.returned_at),
  );
  const recentReturns: RecentReturnRow[] = returnedLoans
    .slice(0, REPORT_TOP_LIMIT)
    .map((loan) => ({
      id: loan.id,
      student_name: embedFirst(loan.student)?.full_name ?? "",
      student_number: embedFirst(loan.student)?.student_id ?? null,
      title: loan.book?.title ?? "",
      author: loan.book?.author ?? "",
      returned_at: loan.returned_at,
      condition_on_return: loan.condition_on_return,
      days_late: daysLate(loan.due_date, loan.returned_at),
    }));

  /* ---- Requests this Manila month (from the same scan) -------------- */
  let requestsThisMonth = 0;
  let requestsPendingThisMonth = 0;
  let requestsApprovedThisMonth = 0;
  for (const row of requests) {
    const createdMs = Date.parse(row.created_at);
    if (createdMs < monthStartMs || createdMs >= monthEndMs) continue;
    requestsThisMonth += 1;
    if (row.status === "PENDING") requestsPendingThisMonth += 1;
    else if (row.status === "APPROVED") requestsApprovedThisMonth += 1;
  }

  return {
    stats: {
      // Open loans = ACTIVE + OVERDUE — the same figure the dashboard's
      // "Active loans" card shows (getAdminDashboardStats).
      activeLoans: loanCounts.active + loanCounts.overdue,
      overdueNow: loanCounts.overdue,
      returnedThisMonth: loanCounts.returnedThisMonth,
      requestsThisMonth,
      requestsPendingThisMonth,
      requestsApprovedThisMonth,
    },
    releaseTrend,
    activeTrend,
    overdueTrend,
    returnedTrend,
    requestsTrend,
    topBorrowed,
    recentReturns,
    truncated: {
      loans: loans.length >= LOANS_SCAN_LIMIT,
      requests: requests.length >= REQUESTS_SCAN_LIMIT,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Collections report                                                  */
/* ------------------------------------------------------------------ */

const BOOK_SELECT = "id, category, book_copies(status)";
const FINE_SELECT = `type, status, amount_centavos, student_id,
       student:profiles!fines_student_id_fkey(full_name, student_id, course_section)`;

interface ScannedBook {
  id: string;
  category: string | null;
  book_copies: { status: string }[] | { status: string } | null;
}

interface ScannedFine {
  type: string;
  status: string;
  amount_centavos: number;
  student_id: string;
  student: {
    full_name: string;
    student_id: string | null;
    course_section: string | null;
  } | null;
}

/** `books.category` is nullable (schema.md §2.2) — group nulls together. */
const UNCATEGORIZED = "Uncategorized";

/**
 * The Collections tab: 4 stat cards, the category bar list, the fines
 * matrix (type × status) and the top-10 unpaid balances — ONE parallel wave
 * of 3 reads (see the file header).
 *
 * - the headline unpaid total / paid / waived / blocked-student counters
 *   come from `getFineCounts()` (exact — never a capped scan);
 * - titles / copies / available are summed from the same `books` scan that
 *   builds the category bars (each book embeds its copies' statuses), so the
 *   cards and the bars can never disagree; exact while under
 *   `BOOKS_SCAN_LIMIT`, disclosed when the cap binds;
 * - the fines scan carries the student embed, so the matrix (2 types × 3
 *   statuses) and the per-student unpaid balances are both aggregated from
 *   ONE read — no second round trip for names;
 * - cells are zero-initialised for **every** (type, status) pair, so a fresh
 *   install renders a complete all-zero matrix instead of missing rows.
 *
 * Throws on database errors so a failed read surfaces as the page's error
 * state instead of an empty-looking report.
 */
export async function getCollectionsReport(): Promise<CollectionsReport> {
  const supabase = await createClient();

  const [fineCounts, booksRes, finesRes] = await Promise.all([
    getFineCounts(),
    supabase
      .from("books")
      .select(BOOK_SELECT)
      .order("created_at", { ascending: false })
      .limit(BOOKS_SCAN_LIMIT),
    supabase
      .from("fines")
      .select(FINE_SELECT)
      .order("created_at", { ascending: false })
      .limit(FINES_SCAN_LIMIT),
  ]);
  if (booksRes.error) {
    fail("Could not load the collections report.", booksRes.error.message);
  }
  if (finesRes.error) {
    fail("Could not load the collections report.", finesRes.error.message);
  }

  const books = (booksRes.data ?? []) as unknown as ScannedBook[];
  const fines = (finesRes.data ?? []) as unknown as ScannedFine[];

  /* ---- Inventory totals + per-category bars (one scan) -------------- */
  const byCategory = new Map<
    string,
    { titles: number; copies: number; available: number }
  >();
  let totalCopies = 0;
  let availableCopies = 0;

  for (const book of books) {
    const label = book.category?.trim() || UNCATEGORIZED;
    const entry = byCategory.get(label) ?? {
      titles: 0,
      copies: 0,
      available: 0,
    };
    entry.titles += 1;

    const copies = Array.isArray(book.book_copies)
      ? book.book_copies
      : book.book_copies
        ? [book.book_copies]
        : [];
    for (const copy of copies) {
      entry.copies += 1;
      totalCopies += 1;
      if (copy.status === "AVAILABLE") {
        entry.available += 1;
        availableCopies += 1;
      }
    }
    byCategory.set(label, entry);
  }

  const categories: CategoryStat[] = [...byCategory.entries()]
    .map(([category, entry]) => ({ category, ...entry }))
    .sort(
      (a, b) =>
        b.copies - a.copies ||
        b.titles - a.titles ||
        a.category.localeCompare(b.category),
    );

  /* ---- Fines matrix: every (type, status) cell, zero-initialised ---- */
  const cells = new Map<string, FineSummaryCell>();
  for (const type of FINE_TYPES) {
    for (const status of FINE_STATUSES) {
      cells.set(`${type}:${status}`, { count: 0, total_centavos: 0 });
    }
  }
  const cellFor = (type: FineType, status: FineStatus): FineSummaryCell => {
    const cell = cells.get(`${type}:${status}`);
    // Always present — FINE_TYPES × FINE_STATUSES filled every slot above.
    return cell ?? { count: 0, total_centavos: 0 };
  };

  /* ---- Top unpaid balances per student (top 10) --------------------- */
  const byStudent = new Map<
    string,
    {
      student_name: string;
      student_number: string | null;
      course_section: string | null;
      unpaid_count: number;
      balance_centavos: number;
    }
  >();

  for (const fine of fines) {
    const type: FineType = isFineType(fine.type) ? fine.type : "OVERDUE";
    const status: FineStatus = isFineStatus(fine.status) ? fine.status : "UNPAID";
    const amount = toNumber(fine.amount_centavos);
    const cell = cellFor(type, status);
    cell.count += 1;
    cell.total_centavos += amount;

    if (status !== "UNPAID") continue;
    const profile = embedFirst(fine.student);
    const entry = byStudent.get(fine.student_id) ?? {
      student_name: profile?.full_name ?? "",
      student_number: profile?.student_id ?? null,
      course_section: profile?.course_section ?? null,
      unpaid_count: 0,
      balance_centavos: 0,
    };
    entry.unpaid_count += 1;
    entry.balance_centavos += amount;
    byStudent.set(fine.student_id, entry);
  }

  const fineSummary: FineSummaryRow[] = FINE_TYPES.map((type) => {
    const unpaid = cellFor(type, "UNPAID");
    const paid = cellFor(type, "PAID");
    const waived = cellFor(type, "WAIVED");
    return {
      type,
      unpaid: { ...unpaid },
      paid: { ...paid },
      waived: { ...waived },
      count: unpaid.count + paid.count + waived.count,
      total_centavos: unpaid.total_centavos + paid.total_centavos + waived.total_centavos,
    };
  });

  const topUnpaid: UnpaidStudentRow[] = [...byStudent.entries()]
    .map(([student_id, entry]) => ({ student_id, ...entry }))
    .sort(
      (a, b) =>
        b.balance_centavos - a.balance_centavos ||
        b.unpaid_count - a.unpaid_count ||
        a.student_name.localeCompare(b.student_name),
    )
    .slice(0, REPORT_TOP_LIMIT);

  return {
    stats: {
      titles: books.length,
      totalCopies,
      availableCopies,
    },
    fineCounts,
    categories,
    fineSummary,
    topUnpaid,
    truncated: {
      books: books.length >= BOOKS_SCAN_LIMIT,
      fines: fines.length >= FINES_SCAN_LIMIT,
    },
  };
}
