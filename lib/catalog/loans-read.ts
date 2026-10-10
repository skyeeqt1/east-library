import "server-only";

import { createClient } from "@/lib/supabase/server";
import { isLoanStatus, type LoanStatus } from "@/lib/validations/loan";

/**
 * ============================================================================
 *  Loan reads + Manila day math — server-only helpers (Phase 4)
 * ============================================================================
 *
 * rules.md §5 (R-14..R-21), §9 matrix (students read own loans only),
 * §10 loan state machine, prd.md FR-14..FR-16 / US-4.
 *
 * Plain async functions: **no `"use server"` directive** (same contract as
 * lib/catalog/availability.ts and lib/catalog/requests-read.ts) — call them
 * from Server Components, route handlers or server actions, never from a
 * client component. Every read goes through the cookie-aware anon client so
 * RLS applies (schema.md §4):
 *   - `loans` policy    → `student_id = auth.uid() or is_admin()`
 *   - `fines` policy    → `student_id = auth.uid() or is_admin()`
 *   - `profiles` policy → own row (students) / all rows (admins)
 * so a student session can never see another student's loans (§9 matrix),
 * while the admin dashboard sees everything.
 *
 * ## Day math (R-30 / R-19 / R-20)
 *
 * All day counts are **date-only diffs computed from ISO date strings** in
 * Asia/Manila — never `Date` arithmetic on timestamps, which is where
 * timezone bugs come from:
 *
 *   - `manilaToday()`     → today's `YYYY-MM-DD` in Asia/Manila,
 *   - `daysUntil(dateStr)`→ `dateStr − today` (positive = future / days left),
 *   - `daysSince(dateStr)`→ `today − dateStr` (positive = past / days late),
 *   - `toManilaDate(iso)` → an ISO *timestamp* rendered as its Manila date
 *                           (e.g. a `returned_at` near midnight UTC).
 *
 * Both helpers subtract parsed `YYYY-MM-DD` values as `Date.UTC(...)` ms, so
 * no local timezone or DST can shift the result.
 *
 * ## Writes are NOT here (R-14 / R-18 / R-20 / R-31)
 *
 * `due_date` is set exclusively by `release_loan()` in SQL; fines are
 * finalized exclusively by `record_return()` + the daily `run_overdue_sweep()`
 * cron. These helpers only *display* what SQL computed.
 */

/* ------------------------------------------------------------------ */
/* Manila day math (R-30)                                              */
/* ------------------------------------------------------------------ */

const DAY_MS = 86_400_000;
const MANILA_OFFSET_MS = 8 * 3_600_000; // Asia/Manila = UTC+8, no DST (R-30)

const manilaDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Manila",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** `YYYY-MM-DD` for the Manila calendar day containing `instant`. */
function manilaDateOf(instant: Date): string {
  try {
    return manilaDateFormatter.format(instant);
  } catch {
    // Runtime without full ICU — Manila is fixed UTC+8, so shift manually.
    return new Date(instant.getTime() + MANILA_OFFSET_MS)
      .toISOString()
      .slice(0, 10);
  }
}

/**
 * Today's date in Asia/Manila as `YYYY-MM-DD` (R-30: business dates are
 * always evaluated in Manila, never in the server's local zone).
 */
export function manilaToday(): string {
  return manilaDateOf(new Date());
}

/**
 * Parse the date part of an ISO date-only (`2026-10-08`) or ISO timestamp
 * (`2026-10-08T16:30:00Z`) into UTC-midnight ms. Deliberately **ignores** the
 * time component: `due_date` is a `date` column and must never gain hours.
 */
function dayNumber(dateStr: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr);
  if (!match) return Number.NaN;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

/** Whole-day diff `to − from` for two `YYYY-MM-DD` strings (no TZ involved). */
function dayDiff(from: string, to: string): number {
  const a = dayNumber(from);
  const b = dayNumber(to);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / DAY_MS);
}

/**
 * Days until `dateStr` relative to today (Manila): positive = still in the
 * future, 0 = due today, negative = already past. `due_date − today` (R-19).
 */
export function daysUntil(dateStr: string): number {
  return dayDiff(manilaToday(), dateStr);
}

/**
 * Days since `dateStr` relative to today (Manila): positive = `dateStr` is in
 * the past (the "days late" figure), 0 = today, negative = future (R-19/R-20).
 */
export function daysSince(dateStr: string): number {
  return dayDiff(dateStr, manilaToday());
}

/**
 * Render an ISO **timestamp** as its Manila calendar date (`YYYY-MM-DD`) —
 * used for `returned_at` so a return at 00:30 Manila counts as that Manila
 * day, not the previous UTC day (R-30).
 */
export function toManilaDate(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  return manilaDateOf(new Date(ms));
}

/** `[startIso, endIso)` covering the current Manila month (for counts). */
function manilaMonthRange(): { startIso: string; endIso: string } {
  const [year, month] = manilaToday().split("-").map(Number);
  // Manila 1st 00:00 == UTC 1st 00:00 − 8h.
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

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

/**
 * One row of the admin loans table (Phase 4 UI). Profile / book / copy fields
 * come from the PostgREST joins; `days_remaining` / `days_late` are computed
 * in JS from the Manila day helpers (undefined when not applicable).
 */
export interface AdminLoanRow {
  id: string;
  student_id: string;
  student_number: string | null;
  student_name: string;
  course_section: string | null;
  book_id: string;
  title: string;
  author: string;
  barcode: string | null;
  /** Book's replacement value (centavos, R-08) — the Mark-lost charge basis. */
  replacement_value_centavos: number;
  released_at: string;
  due_date: string;
  returned_at: string | null;
  /** Student tapped "Return book" — shown as a "Return requested" chip in
   *  the Borrowed table (migration 0009). */
  return_requested_at: string | null;
  status: LoanStatus;
  /** Whole days left on an open loan (due_date − today); absent when past due
   *  or when the loan is already RETURNED. */
  days_remaining?: number;
  /** Whole days late (today − due_date, positive only). For RETURNED loans it
   *  is measured against the Manila date of `returned_at` (the exact figure
   *  R-20 finalized), never "today − due" which would keep growing. */
  days_late?: number;
}

/** Paginated admin loans listing. */
export interface AdminLoansPage {
  rows: AdminLoanRow[];
  total: number;
  page: number;
  perPage: number;
}

/** One of *your* loans with book fields + owed fine (US-4 student view). */
export interface StudentLoanRow {
  id: string;
  book_id: string;
  title: string;
  author: string;
  barcode: string | null;
  released_at: string;
  due_date: string;
  returned_at: string | null;
  /** Student tapped "Return book" (early-return signal, migration 0009) —
   *  the desk still confirms receipt via the normal return flow. */
  return_requested_at: string | null;
  condition_on_return: string | null;
  status: LoanStatus;
  days_remaining?: number;
  days_late?: number;
  /**
   * Latest OVERDUE fine on this loan (R-21: at most one), already summed by
   * SQL — integer **centavos** (R-29), format with `formatPeso()` in the UI.
   * `null` when the loan has no overdue fine (on-time return, E2).
   */
  fine: { amount_centavos: number; days_late: number | null; status: string } | null;
}

/** Paginated student loans listing ("My Loans"). */
export interface StudentLoansPage {
  rows: StudentLoanRow[];
  total: number;
  page: number;
  perPage: number;
}

/** Admin dashboard tiles (Phase 4b). */
export interface LoanCounts {
  /** Open loans still marked `ACTIVE` (not yet flagged OVERDUE). */
  active: number;
  /** Open loans flagged `OVERDUE` by the daily sweep (R-18). */
  overdue: number;
  /** Open loans due today (Manila) — "due today" tile. */
  dueToday: number;
  /** Open loans with 0–3 days remaining (includes dueToday; excludes
   *  overdue). */
  dueSoon: number;
  /** Loans returned during the current Manila month (status RETURNED). */
  returnedThisMonth: number;
}

/** Student hero card ("Due soonest" — Phase 3b dashboard). */
export interface DueSoonest {
  /** Open loans (ACTIVE + OVERDUE) held by the student. */
  activeCount: number;
  /** Open loans with 0–3 days remaining (same window as `LoanCounts.dueSoon`). */
  dueSoonCount: number;
  /** Earliest `due_date` among open loans, or null when none are out. */
  nextDueDate: string | null;
}

/* ------------------------------------------------------------------ */
/* Internal helpers                                                    */
/* ------------------------------------------------------------------ */

const DEFAULT_PER_PAGE = 25;
const MAX_PER_PAGE = 100;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

function clampPage(value: number | undefined, fallback: number): number {
  return Math.max(1, Math.floor(value ?? fallback));
}

function fail(message: string, details?: string): never {
  throw new Error(details ? `${message} (${details})` : message);
}

/** PostgREST 416/PGRST103 on a range past the last row (see requests-read). */
function isEmptyPageError(error: { code?: string } | null): boolean {
  return error?.code === "PGRST103";
}

/** Narrow a loose PostgREST status to `LoanStatus` (unknown → ACTIVE). */
function toLoanStatus(value: unknown): LoanStatus {
  return typeof value === "string" && isLoanStatus(value) ? value : "ACTIVE";
}

/**
 * Normalize an embedded PostgREST row: FK embeds arrive as a to-one object at
 * runtime but the untyped supabase-js generics infer an array — accept both.
 */
function embedFirst<T>(value: T | T[] | null | undefined): T | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.length > 0 ? value[0] : null;
  return value;
}

/**
 * A loan's overdue fine rows arrive unfiltered inside the embed (PostgREST
 * boolean logic cannot span embedded resources reliably) — pick the **latest
 * OVERDUE row** here (R-21 guarantees at most one, but ordering keeps it
 * deterministic if a DAMAGE fine shares the loan).
 */
function pickLatestOverdueFine(
  fines: unknown,
): { amount_centavos: number; days_late: number | null; status: string } | null {
  const list = Array.isArray(fines) ? fines : fines ? [fines] : [];
  const overdue = list.filter(
    (row): row is { type: string; amount_centavos: number; days_late: number | null; status: string; created_at: string | null } =>
      typeof row === "object" &&
      row !== null &&
      (row as { type?: unknown }).type === "OVERDUE",
  );
  if (overdue.length === 0) return null;
  overdue.sort((a, b) =>
    String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")),
  );
  const latest = overdue[0];
  return {
    amount_centavos: Number(latest.amount_centavos ?? 0),
    days_late:
      latest.days_late === null || latest.days_late === undefined
        ? null
        : Number(latest.days_late),
    status: String(latest.status ?? "UNPAID"),
  };
}

/**
 * `days_remaining` / `days_late` for one loan row (Manila date-only math).
 *
 * Open loan:   from due_date vs today.
 * RETURNED:    days_late measured at `returned_at`'s Manila date (R-20 — the
 *              figure the fine was finalized to); never "grows" after return.
 */
function computeDayFields(
  dueDate: string,
  status: LoanStatus,
  returnedAt: string | null,
): Pick<AdminLoanRow, "days_remaining" | "days_late"> {
  if (status === "RETURNED") {
    if (!returnedAt) return {};
    const late = dayDiff(dueDate, toManilaDate(returnedAt));
    return late > 0 ? { days_late: late } : {};
  }
  const remaining = daysUntil(dueDate);
  if (remaining >= 0) return { days_remaining: remaining };
  return { days_late: -remaining };
}

/* ------------------------------------------------------------------ */
/* Admin listing                                                       */
/* ------------------------------------------------------------------ */

/** PostgREST `or=(…)` term over the given columns — same escaping rules as
 *  `searchFilter` in lib/catalog/availability.ts: the value is emitted
 *  **double-quoted with the `%` wildcards inside** (`ilike."%term%"`) so
 *  commas/dots/parens/spaces in the term stay literal, LIKE wildcards are
 *  escaped, and embedded `"` cannot close the literal early. */
function ilikeOr(columns: string[], query: string): string {
  const cleaned = query.replace(/"/g, "'").replace(/\s+/g, " ").trim();
  const escaped = cleaned.replace(/[\\%_]/g, (char) => `\\${char}`);
  return columns
    .map((column) => `${column}.ilike."%${escaped}%"`)
    .join(",");
}

/**
 * Resolve a free-text `q` to id sets (students → `profiles.id`, titles →
 * `books.id`, barcodes → `book_copies.id`) so the main loans query can filter
 * with a flat `or=(student_id.in.(…),book_id.in.(…),copy_id.in.(…))` —
 * PostgREST cannot OR across embedded resources, and this keeps one round
 * trip per entity instead of loading the whole table.
 */
async function resolveSearchIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  q: string,
): Promise<{ studentIds: string[]; bookIds: string[]; copyIds: string[] }> {
  const [students, books, copies] = await Promise.all([
    supabase
      .from("profiles")
      .select("id")
      .or(ilikeOr(["full_name", "student_id", "course_section"], q))
      .limit(200),
    supabase
      .from("books")
      .select("id")
      .or(ilikeOr(["title", "author"], q))
      .limit(200),
    supabase
      .from("book_copies")
      .select("id")
      .or(ilikeOr(["barcode"], q))
      .limit(200),
  ]);
  if (students.error) fail("Could not search students.", students.error.message);
  if (books.error) fail("Could not search titles.", books.error.message);
  if (copies.error) fail("Could not search copies.", copies.error.message);

  return {
    studentIds: (students.data ?? []).map((row) => (row as { id: string }).id),
    bookIds: (books.data ?? []).map((row) => (row as { id: string }).id),
    copyIds: (copies.data ?? []).map((row) => (row as { id: string }).id),
  };
}

/**
 * Admin loans table (Phase 4 UI).
 *
 * - `status` omitted  → open loans (`ACTIVE` + `OVERDUE` — the working set);
 * - `status` given    → exactly that tab (e.g. `'RETURNED'` = history);
 * - `q`               → ILIKE over student name / student number / course,
 *                       book title / author, copy barcode (resolved to ids,
 *                       see `resolveSearchIds`);
 * - ordering: **due_date ASC**, which puts every past-due loan first (an
 *   OVERDUE loan always has `due_date < today`, and a not-yet-swept ACTIVE
 *   loan past due sits beside them — both are "late"), then nearest due date;
 *   the RETURNED history tab uses returned_at DESC (most recent first);
 * - `page` is 1-based, `perPage` clamped 1–100 (default 25).
 *
 * `days_remaining` / `days_late` are computed in JS with the Manila helpers.
 * Throws on database errors so a failed read surfaces instead of an empty
 * table.
 */
export async function getAdminActiveLoans(
  opts: {
    status?: LoanStatus;
    q?: string;
    page?: number;
    perPage?: number;
  } = {},
): Promise<AdminLoansPage> {
  const page = clampPage(opts.page, 1);
  const perPage = Math.min(
    MAX_PER_PAGE,
    Math.max(1, Math.floor(opts.perPage ?? DEFAULT_PER_PAGE)),
  );
  const query = opts.q?.trim();
  const isHistory = opts.status === "RETURNED";

  const supabase = await createClient();

  let orFilter: string | null = null;
  if (query) {
    const { studentIds, bookIds, copyIds } = await resolveSearchIds(
      supabase,
      query,
    );
    if (studentIds.length === 0 && bookIds.length === 0 && copyIds.length === 0) {
      // Nothing matches any entity — short-circuit to an honest empty page.
      return { rows: [], total: 0, page, perPage };
    }
    const parts: string[] = [];
    if (studentIds.length > 0) parts.push(`student_id.in.(${studentIds.join(",")})`);
    if (bookIds.length > 0) parts.push(`book_id.in.(${bookIds.join(",")})`);
    if (copyIds.length > 0) parts.push(`copy_id.in.(${copyIds.join(",")})`);
    orFilter = parts.join(",");
  }

  let builder = supabase
    .from("loans")
    .select(
      `id, student_id, book_id, copy_id, released_at, due_date, returned_at, return_requested_at, status,
       student:profiles!loans_student_id_fkey(full_name, student_id, course_section),
       book:books(title, author, replacement_value_centavos),
       copy:book_copies!loans_copy_id_fkey(barcode)`,
      { count: "exact" },
    );
  if (opts.status === undefined) {
    builder = builder.in("status", ["ACTIVE", "OVERDUE"]);
  } else {
    builder = builder.eq("status", opts.status);
  }
  if (orFilter) builder = builder.or(orFilter);

  const from = (page - 1) * perPage;
  let { data, error, count } = await builder
    .order(isHistory ? "returned_at" : "due_date", {
      ascending: !isHistory,
    })
    .order("released_at", { ascending: true })
    .range(from, from + perPage - 1);

  if (isEmptyPageError(error)) {
    const retry = await builder.range(0, perPage - 1);
    if (retry.error) fail("Could not load loans.", retry.error.message);
    data = [];
    count = retry.count;
    error = null;
  }
  if (error) fail("Could not load loans.", error.message);

  interface JoinedRow {
    id: string;
    student_id: string;
    book_id: string;
    copy_id: string;
    released_at: string;
    due_date: string;
    returned_at: string | null;
    return_requested_at: string | null;
    status: string;
    student:
      | { full_name: string; student_id: string | null; course_section: string | null }
      | { full_name: string; student_id: string | null; course_section: string | null }[]
      | null;
    book: { title: string; author: string; replacement_value_centavos: number } | { title: string; author: string; replacement_value_centavos: number }[] | null;
    copy: { barcode: string | null } | { barcode: string | null }[] | null;
  }

  const rows: AdminLoanRow[] = ((data ?? []) as unknown as JoinedRow[]).map(
    (row) => {
      const student = embedFirst(row.student);
      const book = embedFirst(row.book);
      const copy = embedFirst(row.copy);
      const status = toLoanStatus(row.status);
      return {
        id: row.id,
        student_id: row.student_id,
        student_number: student?.student_id ?? null,
        student_name: student?.full_name ?? "",
        course_section: student?.course_section ?? null,
        book_id: row.book_id,
        title: book?.title ?? "",
        author: book?.author ?? "",
        barcode: copy?.barcode ?? null,
        replacement_value_centavos: Number(book?.replacement_value_centavos ?? 0),
        released_at: row.released_at,
        due_date: row.due_date,
        returned_at: row.returned_at,
        return_requested_at: row.return_requested_at ?? null,
        status,
        ...computeDayFields(row.due_date, status, row.returned_at),
      };
    },
  );

  return { rows, total: count ?? rows.length, page, perPage };
}

/* ------------------------------------------------------------------ */
/* Student listing — "My Loans" (§9: own rows only, enforced by RLS)    */
/* ------------------------------------------------------------------ */

/**
 * One student's loans with title/author/barcode plus the owed OVERDUE fine.
 *
 * - `status` omitted → open loans (`ACTIVE` + `OVERDUE`); `RETURNED` gives
 *   the history tab;
 * - ordering: due_date ASC for open loans (most urgent first), returned_at
 *   DESC for history;
 * - RLS is the authority on visibility (schema.md §4): a **student session
 *   only ever receives its own rows**, even when `studentId` names someone
 *   else — the filter and the policy both have to pass (§9 matrix). An admin
 *   session may inspect any student's loans.
 *
 * The `fines` embed is an unfiltered LEFT JOIN; the latest OVERDUE row is
 * picked in JS (`pickLatestOverdueFine`) because PostgREST cannot reliably
 * filter inside an embedded to-many without changing the parent match.
 */
export async function getStudentLoans(
  studentId: string,
  opts: { status?: LoanStatus; page?: number; perPage?: number } = {},
): Promise<StudentLoansPage> {
  const page = clampPage(opts.page, 1);
  const perPage = Math.min(
    MAX_PER_PAGE,
    Math.max(1, Math.floor(opts.perPage ?? DEFAULT_PER_PAGE)),
  );
  if (!isUuid(studentId)) {
    return { rows: [], total: 0, page, perPage };
  }

  const isHistory = opts.status === "RETURNED";
  const supabase = await createClient();

  let builder = supabase
    .from("loans")
    .select(
      `id, book_id, copy_id, released_at, due_date, returned_at,
       return_requested_at, condition_on_return, status,
       book:books(title, author),
       copy:book_copies!loans_copy_id_fkey(barcode),
       fines(type, amount_centavos, days_late, status, created_at)`,
      { count: "exact" },
    )
    .eq("student_id", studentId);
  if (opts.status === undefined) {
    builder = builder.in("status", ["ACTIVE", "OVERDUE"]);
  } else {
    builder = builder.eq("status", opts.status);
  }

  const from = (page - 1) * perPage;
  let { data, error, count } = await builder
    .order(isHistory ? "returned_at" : "due_date", {
      ascending: !isHistory,
    })
    .order("released_at", { ascending: true })
    .range(from, from + perPage - 1);

  if (isEmptyPageError(error)) {
    const retry = await builder.range(0, perPage - 1);
    if (retry.error) fail("Could not load your loans.", retry.error.message);
    data = [];
    count = retry.count;
    error = null;
  }
  if (error) fail("Could not load your loans.", error.message);

  interface JoinedRow {
    id: string;
    book_id: string;
    released_at: string;
    due_date: string;
    returned_at: string | null;
    return_requested_at: string | null;
    condition_on_return: string | null;
    status: string;
    book: { title: string; author: string } | { title: string; author: string }[] | null;
    copy: { barcode: string | null } | { barcode: string | null }[] | null;
    fines: unknown;
  }

  const rows: StudentLoanRow[] = ((data ?? []) as unknown as JoinedRow[]).map(
    (row) => {
      const book = embedFirst(row.book);
      const copy = embedFirst(row.copy);
      const status = toLoanStatus(row.status);
      return {
        id: row.id,
        book_id: row.book_id,
        title: book?.title ?? "",
        author: book?.author ?? "",
        barcode: copy?.barcode ?? null,
        released_at: row.released_at,
        due_date: row.due_date,
        returned_at: row.returned_at,
        return_requested_at: row.return_requested_at ?? null,
        condition_on_return: row.condition_on_return,
        status,
        ...computeDayFields(row.due_date, status, row.returned_at),
        fine: pickLatestOverdueFine(row.fines),
      };
    },
  );

  return { rows, total: count ?? rows.length, page, perPage };
}

/* ------------------------------------------------------------------ */
/* Counts                                                              */
/* ------------------------------------------------------------------ */

/**
 * Admin dashboard numbers (Phase 4b tiles):
 *
 * - `active`             — open loans with status ACTIVE;
 * - `overdue`            — open loans flagged OVERDUE (R-18 sweep);
 * - `dueToday`           — open loans due today (Manila);
 * - `dueSoon`            — open loans with 0–3 days remaining — includes
 *                           `dueToday`, excludes overdue (disjoint tiles);
 * - `returnedThisMonth`  — RETURNED loans whose `returned_at` falls in the
 *                           current **Manila** month (boundaries converted to
 *                           UTC instants, R-30).
 *
 * All reads run through the cookie-aware client: RLS scopes them for a
 * student session (own rows) and exposes the full book for an admin — the
 * admin dashboard page is already behind `assertAdmin()` / middleware (E10).
 */
export async function getLoanCounts(): Promise<LoanCounts> {
  const supabase = await createClient();
  const today = manilaToday();
  const soonLimit = (() => {
    const [y, m, d] = today.split("-").map(Number);
    return manilaDateOf(new Date(Date.UTC(y, m - 1, d + 3)));
  })();
  const { startIso, endIso } = manilaMonthRange();

  const [active, overdue, dueToday, dueSoon, returned] = await Promise.all([
    supabase
      .from("loans")
      .select("id", { count: "exact", head: true })
      .eq("status", "ACTIVE"),
    supabase
      .from("loans")
      .select("id", { count: "exact", head: true })
      .eq("status", "OVERDUE"),
    supabase
      .from("loans")
      .select("id", { count: "exact", head: true })
      .is("returned_at", null)
      .eq("due_date", today),
    supabase
      .from("loans")
      .select("id", { count: "exact", head: true })
      .is("returned_at", null)
      .gte("due_date", today)
      .lte("due_date", soonLimit),
    supabase
      .from("loans")
      .select("id", { count: "exact", head: true })
      .eq("status", "RETURNED")
      .gte("returned_at", startIso)
      .lt("returned_at", endIso),
  ]);

  if (active.error) fail("Could not load loan counts.", active.error.message);
  if (overdue.error) fail("Could not load loan counts.", overdue.error.message);
  if (dueToday.error) fail("Could not load loan counts.", dueToday.error.message);
  if (dueSoon.error) fail("Could not load loan counts.", dueSoon.error.message);
  if (returned.error) fail("Could not load loan counts.", returned.error.message);

  return {
    active: active.count ?? 0,
    overdue: overdue.count ?? 0,
    dueToday: dueToday.count ?? 0,
    dueSoon: dueSoon.count ?? 0,
    returnedThisMonth: returned.count ?? 0,
  };
}

/**
 * Student hero-card numbers (Phase 3b dashboard): how many books are out,
 * how many are due within 3 days (same window as `LoanCounts.dueSoon`), and
 * the earliest due date — the anchor for the "Due in ≤ 1 day" banner (§12)
 * and the red overdue banner. RLS scopes the read to the caller's own loans.
 */
export async function getDueSoonest(studentId: string): Promise<DueSoonest> {
  const empty: DueSoonest = { activeCount: 0, dueSoonCount: 0, nextDueDate: null };
  if (!isUuid(studentId)) return empty;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("loans")
    .select("due_date")
    .eq("student_id", studentId)
    .is("returned_at", null)
    .order("due_date", { ascending: true });
  if (error) fail("Could not load your loans.", error.message);

  const dueDates = (data ?? [])
    .map((row) => (row as { due_date: string }).due_date)
    .filter(Boolean);
  if (dueDates.length === 0) return empty;

  const today = manilaToday();
  const soonLimit = (() => {
    const [y, m, d] = today.split("-").map(Number);
    return manilaDateOf(new Date(Date.UTC(y, m - 1, d + 3)));
  })();

  return {
    activeCount: dueDates.length,
    dueSoonCount: dueDates.filter((due) => due >= today && due <= soonLimit)
      .length,
    nextDueDate: dueDates[0],
  };
}
