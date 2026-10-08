import "server-only";

import { createClient } from "@/lib/supabase/server";
import { manilaToday } from "@/lib/catalog/loans-read";
import { formatPeso } from "@/lib/utils";
import {
  isDamageReportStatus,
  isFineStatus,
  isFineType,
  type DamageReportStatus,
  type FineStatus,
  type FineType,
} from "@/lib/validations/fine";

/**
 * ============================================================================
 *  Fine, balance & damage reads — server-only helpers (Phase 5)
 * ============================================================================
 *
 * rules.md §5 (R-18…R-21), §6 (R-22…R-24), §7 (R-25…R-28), §9 matrix,
 * prd.md FR-17…FR-20 / US-4 / US-5 / US-7, schema.md §2.6/§2.7 + §7.3.
 *
 * Plain async functions: **no `"use server"` directive** (same contract as
 * lib/catalog/loans-read.ts / requests-read.ts) — call them from Server
 * Components, route handlers or server actions, never from a client component.
 * Every read goes through the cookie-aware anon client so RLS applies
 * (schema.md §4):
 *   - `fines` policy          → `student_id = auth.uid() or is_admin()`
 *   - `damage_reports` policy → `student_id = auth.uid() or is_admin()`
 *   - `profiles` policy       → own row (students) / all rows (admins)
 *   - `student_balances` view → `security_invoker = true` (migration 0006), so
 *                               it inherits exactly the fines/profiles rules.
 * A student session therefore only ever sees its **own** fines (§9 matrix:
 * "View own loans, requests, fines"), while the admin queue sees everything.
 *
 * ## Writes are NOT here (R-18 / R-22 / R-28 / R-31)
 *
 * Fine amounts are computed exclusively in SQL (`run_overdue_sweep()`,
 * `record_return()`, `assess_damage()`) and never edited by TS — R-29 centavos
 * in, `formatPeso()` out at the UI layer. Settlements live in
 * lib/admin/fine-actions.ts / lib/admin/damage-actions.ts.
 *
 * ## Balance (R-27)
 *
 * `getStudentBalance()` always reads the `student_balances` view — a stored
 * SUM over UNPAID fines, computed at read time, never cached.
 */

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

/** One row of the student "My Penalties" list (Phase 5b UI). */
export interface StudentFineRow {
  id: string;
  type: FineType;
  description: string | null;
  days_late: number | null;
  /** Integer centavos (R-29) — format with `formatPeso()`. */
  amount_centavos: number;
  status: FineStatus;
  paid_method: string | null;
  created_at: string;
  paid_at: string | null;
  /** Book context from `loans → books`; null/empty when the fine has no
   *  loan (admin-created adjustment, `loan_id IS NULL`). */
  book_title: string | null;
  book_author: string | null;
}

/** Paginated student fines listing. */
export interface StudentFinesPage {
  rows: StudentFineRow[];
  total: number;
  page: number;
  perPage: number;
}

/** R-27 balance: always computed from UNPAID fines via the view. */
export interface StudentBalance {
  balance_centavos: number;
  unpaid_count: number;
}

/** One row of the admin penalties queue (Phase 5b UI). */
export interface AdminFineRow {
  id: string;
  student_id: string;
  loan_id: string | null;
  type: FineType;
  description: string | null;
  days_late: number | null;
  /** Integer centavos (R-29) — amounts are never editable (R-29/R-31). */
  amount_centavos: number;
  status: FineStatus;
  paid_method: string | null;
  created_at: string;
  paid_at: string | null;
  waived_at: string | null;
  waive_reason: string | null;
  /* — student context (profiles) — */
  student_name: string;
  student_number: string | null;
  course_section: string | null;
  /* — book context (loans → books) — */
  book_title: string | null;
  book_author: string | null;
}

/** Paginated admin fines queue. */
export interface AdminFinesPage {
  rows: AdminFineRow[];
  total: number;
  page: number;
  perPage: number;
}

/** Admin dashboard / penalties headline numbers. */
export interface FineCounts {
  /** Sum of **all** UNPAID fines (R-27 balance across the school). */
  unpaidTotal_centavos: number;
  /** Number of UNPAID fine rows. */
  unpaidCount: number;
  /** Sum of fines settled with `paid_at` inside the current Manila month. */
  paidThisMonth_centavos: number;
  /** Sum of fines waived with `waived_at` inside the current Manila month. */
  waivedThisMonth_centavos: number;
  /** Students with ≥ 1 UNPAID fine — the R-25 blocking population. */
  studentsWithFines: number;
}

/** One damage assessment (R-22/R-23) with student, book, loan and fine state. */
export interface DamageReportRow {
  id: string;
  loan_id: string;
  student_id: string;
  book_id: string;
  copy_id: string;
  description: string;
  photo_url: string | null;
  /** Assessed value in integer centavos (R-29) — equal to the book's
   *  `replacement_value_centavos` at assessment time (R-22, set by SQL). */
  assessed_value_centavos: number;
  status: DamageReportStatus;
  created_at: string;
  resolved_at: string | null;
  /* — student context — */
  student_name: string;
  student_number: string | null;
  course_section: string | null;
  /* — book context — */
  title: string;
  author: string;
  /* — loan context (due / released / returned) — */
  released_at: string | null;
  due_date: string | null;
  returned_at: string | null;
  /** Status of this loan's DAMAGE fine (one-to-one via `uq_fine_per_loan`,
   *  R-21) — `null` when no DAMAGE fine exists yet. */
  fine_status: FineStatus | null;
}

/** Paginated damage reports listing. */
export interface DamageReportsPage {
  rows: DamageReportRow[];
  total: number;
  page: number;
  perPage: number;
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

function clampPerPage(value: number | undefined): number {
  return Math.min(MAX_PER_PAGE, Math.max(1, Math.floor(value ?? DEFAULT_PER_PAGE)));
}

function fail(message: string, details?: string): never {
  throw new Error(details ? `${message} (${details})` : message);
}

/** PostgREST 416/PGRST103 on a range past the last row (see loans-read). */
function isEmptyPageError(error: { code?: string } | null): boolean {
  return error?.code === "PGRST103";
}

/** Normalize an embedded PostgREST row: FK embeds arrive as a to-one object
 *  at runtime but the untyped supabase-js generics infer an array — accept
 *  both (and treat `{}` / `undefined` from a NULL FK as "absent"). */
function embedFirst<T>(value: T | T[] | null | undefined): T | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.length > 0 ? value[0] : null;
  if (typeof value === "object" && Object.keys(value).length === 0) return null;
  return value;
}

/** Narrow a loose PostgREST status to `FineStatus` (unknown → UNPAID). */
function toFineStatus(value: unknown): FineStatus {
  return typeof value === "string" && isFineStatus(value) ? value : "UNPAID";
}

/** Narrow a loose PostgREST type to `FineType` (unknown → OVERDUE). */
function toFineType(value: unknown): FineType {
  return typeof value === "string" && isFineType(value) ? value : "OVERDUE";
}

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** `[startIso, endIso)` covering the current Manila month (R-30 boundaries:
 *  Manila 1st 00:00 == UTC 1st 00:00 − 8h). Same maths as `manilaMonthRange`
 *  in lib/catalog/loans-read.ts (kept private there). */
function manilaMonthRange(): { startIso: string; endIso: string } {
  const MANILA_OFFSET_MS = 8 * 3_600_000; // Asia/Manila = UTC+8, no DST
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

/** PostgREST `or=(…)` term over the given columns — same escaping rules as
 *  `ilikeOr` in lib/catalog/loans-read.ts: emitted double-quoted with the `%`
 *  wildcards inside so commas/parens/spaces stay literal and LIKE wildcards
 *  are escaped. */
function ilikeOr(columns: string[], query: string): string {
  const cleaned = query.replace(/"/g, "'").replace(/\s+/g, " ").trim();
  const escaped = cleaned.replace(/[\\%_]/g, (char) => `\\${char}`);
  return columns
    .map((column) => `${column}.ilike."%${escaped}%"`)
    .join(",");
}

/* ------------------------------------------------------------------ */
/* Student listing — "My Penalties" (§9: own rows only, enforced by RLS) */
/* ------------------------------------------------------------------ */

const STUDENT_FINE_SELECT = `id, type, description, days_late, amount_centavos,
       status, paid_method, created_at, paid_at,
       loan:loans!fines_loan_id_fkey(book:books(title, author))`;

/**
 * One student's fines (OVERDUE + DAMAGE), newest first, with the borrowed
 * book's title/author for context (nullable — `loan_id IS NULL` for manual
 * adjustments, schema.md §2.6).
 *
 * - `status` omitted → every fine; pass `'UNPAID'` / `'PAID'` / `'WAIVED'`
 *   for tabs;
 * - `page` is 1-based, `perPage` clamped 1–100 (default 25);
 * - RLS is the authority on visibility: a **student session only ever
 *   receives its own rows**, even when `studentId` names someone else (the
 *   filter and the policy both have to pass — §9 matrix).
 */
export async function getStudentFines(
  studentId: string,
  opts: { status?: FineStatus; page?: number; perPage?: number } = {},
): Promise<StudentFinesPage> {
  const page = clampPage(opts.page, 1);
  const perPage = clampPerPage(opts.perPage);
  if (!isUuid(studentId)) return { rows: [], total: 0, page, perPage };

  const supabase = await createClient();

  let builder = supabase
    .from("fines")
    .select(STUDENT_FINE_SELECT, { count: "exact" })
    .eq("student_id", studentId);
  if (opts.status) builder = builder.eq("status", opts.status);

  const from = (page - 1) * perPage;
  let { data, error, count } = await builder
    .order("created_at", { ascending: false })
    .range(from, from + perPage - 1);

  if (isEmptyPageError(error)) {
    const retry = await builder.range(0, perPage - 1);
    if (retry.error) fail("Could not load your fines.", retry.error.message);
    data = [];
    count = retry.count;
    error = null;
  }
  if (error) fail("Could not load your fines.", error.message);

  interface JoinedRow {
    id: string;
    type: string;
    description: string | null;
    days_late: number | null;
    amount_centavos: number;
    status: string;
    paid_method: string | null;
    created_at: string;
    paid_at: string | null;
    loan:
      | { book: { title: string; author: string } | { title: string; author: string }[] | null }
      | { book: { title: string; author: string } | { title: string; author: string }[] | null }[]
      | null;
  }

  const rows: StudentFineRow[] = ((data ?? []) as unknown as JoinedRow[]).map(
    (row) => {
      const loan = embedFirst(row.loan);
      const book = loan ? embedFirst(loan.book) : null;
      return {
        id: row.id,
        type: toFineType(row.type),
        description: row.description,
        days_late: row.days_late === null || row.days_late === undefined ? null : Number(row.days_late),
        amount_centavos: toNumber(row.amount_centavos),
        status: toFineStatus(row.status),
        paid_method: row.paid_method,
        created_at: row.created_at,
        paid_at: row.paid_at,
        book_title: book?.title ?? null,
        book_author: book?.author ?? null,
      };
    },
  );

  return { rows, total: count ?? rows.length, page, perPage };
}

/* ------------------------------------------------------------------ */
/* Balance (R-27)                                                      */
/* ------------------------------------------------------------------ */

/**
 * The student's outstanding balance from the `student_balances` view —
 * `SUM(amount_centavos) WHERE status = 'UNPAID'` computed at read time,
 * **never cached** (R-27). The view is `security_invoker = true` (migration
 * 0006), so a student session reads only its own row and an admin session
 * reads any student's; a missing/invisible row yields zeros.
 */
export async function getStudentBalance(studentId: string): Promise<StudentBalance> {
  const empty: StudentBalance = { balance_centavos: 0, unpaid_count: 0 };
  if (!isUuid(studentId)) return empty;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("student_balances")
    .select("balance_centavos, unpaid_count")
    .eq("student_id", studentId)
    .maybeSingle();
  if (error) fail("Could not load the balance.", error.message);
  if (!data) return empty;

  return {
    balance_centavos: toNumber((data as { balance_centavos: unknown }).balance_centavos),
    unpaid_count: toNumber((data as { unpaid_count: unknown }).unpaid_count),
  };
}

/* ------------------------------------------------------------------ */
/* Admin queue — penalties table (§9 matrix: admin sees all)            */
/* ------------------------------------------------------------------ */

const ADMIN_FINE_SELECT = `id, student_id, loan_id, type, description, days_late,
       amount_centavos, status, paid_method, created_at, paid_at, waived_at,
       waive_reason,
       student:profiles!fines_student_id_fkey(full_name, student_id, course_section),
       loan:loans!fines_loan_id_fkey(book:books(title, author))`;

/**
 * Resolve a free-text `q` to a PostgREST `or=(…)` filter over `fines`:
 * student matches → `student_id.in.(…)`, book-title matches → the ids of
 * loans of those books → `loan_id.in.(…)` (PostgREST cannot OR across
 * embedded resources). Returns `null` when nothing matches any entity, which
 * the caller short-circuits to an honest empty page.
 */
async function resolveFineSearchFilter(
  supabase: Awaited<ReturnType<typeof createClient>>,
  query: string,
): Promise<string | null> {
  const [students, books] = await Promise.all([
    supabase
      .from("profiles")
      .select("id")
      .or(ilikeOr(["full_name", "student_id", "course_section"], query))
      .limit(200),
    supabase
      .from("books")
      .select("id")
      .or(ilikeOr(["title", "author"], query))
      .limit(200),
  ]);
  if (students.error) fail("Could not search students.", students.error.message);
  if (books.error) fail("Could not search titles.", books.error.message);

  const studentIds = (students.data ?? []).map((row) => (row as { id: string }).id);
  const bookIds = (books.data ?? []).map((row) => (row as { id: string }).id);

  let loanIds: string[] = [];
  if (bookIds.length > 0) {
    const loans = await supabase
      .from("loans")
      .select("id")
      .in("book_id", bookIds)
      .limit(500);
    if (loans.error) fail("Could not search loans.", loans.error.message);
    loanIds = (loans.data ?? []).map((row) => (row as { id: string }).id);
  }

  const parts: string[] = [];
  if (studentIds.length > 0) parts.push(`student_id.in.(${studentIds.join(",")})`);
  if (loanIds.length > 0) parts.push(`loan_id.in.(${loanIds.join(",")})`);
  if (parts.length === 0) return null;
  return parts.join(",");
}

/** Map a raw joined fines row to `AdminFineRow`. */
function mapAdminFine(row: Record<string, unknown>): AdminFineRow {
  interface JoinedRow {
    id: string;
    student_id: string;
    loan_id: string | null;
    type: string;
    description: string | null;
    days_late: number | null;
    amount_centavos: number;
    status: string;
    paid_method: string | null;
    created_at: string;
    paid_at: string | null;
    waived_at: string | null;
    waive_reason: string | null;
    student:
      | { full_name: string; student_id: string | null; course_section: string | null }
      | { full_name: string; student_id: string | null; course_section: string | null }[]
      | null;
    loan:
      | { book: { title: string; author: string } | { title: string; author: string }[] | null }
      | { book: { title: string; author: string } | { title: string; author: string }[] | null }[]
      | null;
  }
  const joined = row as unknown as JoinedRow;
  const student = embedFirst(joined.student);
  const loan = embedFirst(joined.loan);
  const book = loan ? embedFirst(loan.book) : null;
  return {
    id: joined.id,
    student_id: joined.student_id,
    loan_id: joined.loan_id,
    type: toFineType(joined.type),
    description: joined.description,
    days_late:
      joined.days_late === null || joined.days_late === undefined
        ? null
        : Number(joined.days_late),
    amount_centavos: toNumber(joined.amount_centavos),
    status: toFineStatus(joined.status),
    paid_method: joined.paid_method,
    created_at: joined.created_at,
    paid_at: joined.paid_at,
    waived_at: joined.waived_at,
    waive_reason: joined.waive_reason,
    student_name: student?.full_name ?? "",
    student_number: student?.student_id ?? null,
    course_section: student?.course_section ?? null,
    book_title: book?.title ?? null,
    book_author: book?.author ?? null,
  };
}

/**
 * Admin penalties queue (Phase 5b UI).
 *
 * - `status` omitted → `'UNPAID'` (the working set — what needs collecting);
 *   `'all'` lists every fine with **UNPAID first**, then settled rows —
 *   both blocks ordered `created_at DESC` (each block is a real PostgREST
 *   range, so pagination stays exact across the boundary);
 * - `type` → `'OVERDUE'` | `'DAMAGE'` (R-18 / R-22 tab);
 * - `q`    → ILIKE over student name / number / course and book title /
 *            author (resolved to id sets, see `resolveFineSearchFilter`);
 * - row-level shape: fine fields + student fields + book context. Per-student
 *   balances are **not** repeated on each row — read `getStudentBalance()`
 *   for the drawer/detail view (keeps the queue one query per page);
 * - `page` is 1-based, `perPage` clamped 1–100 (default 25).
 *
 * Throws on database errors so a failed read surfaces instead of an empty
 * table.
 */
export async function getAdminFines(
  opts: {
    status?: FineStatus | "all";
    type?: FineType;
    q?: string;
    page?: number;
    perPage?: number;
  } = {},
): Promise<AdminFinesPage> {
  const page = clampPage(opts.page, 1);
  const perPage = clampPerPage(opts.perPage);
  const status: FineStatus | "all" = opts.status ?? "UNPAID";
  const query = opts.q?.trim();

  const supabase = await createClient();

  let orFilter: string | null = null;
  if (query) {
    orFilter = await resolveFineSearchFilter(supabase, query);
    if (orFilter === null) {
      // Nothing matches any entity — short-circuit to an honest empty page.
      return { rows: [], total: 0, page, perPage };
    }
  }

  const from = (page - 1) * perPage;
  const to = from + perPage - 1;

  /* ---- single-status tab: one ordered page -------------------------- */
  if (status !== "all") {
    let builder = supabase
      .from("fines")
      .select(ADMIN_FINE_SELECT, { count: "exact" })
      .eq("status", status);
    if (opts.type) builder = builder.eq("type", opts.type);
    if (orFilter) builder = builder.or(orFilter);
    let { data, error, count } = await builder
      .order("created_at", { ascending: false })
      .range(from, to);
    if (isEmptyPageError(error)) {
      const retry = await builder.range(0, perPage - 1);
      if (retry.error) fail("Could not load fines.", retry.error.message);
      data = [];
      count = retry.count;
      error = null;
    }
    if (error) fail("Could not load fines.", error.message);
    return {
      rows: ((data ?? []) as Record<string, unknown>[]).map(mapAdminFine),
      total: count ?? 0,
      page,
      perPage,
    };
  }

  /* ---- 'all' tab: UNPAID block first, then settled ------------------ */
  const countBuilder = (statusFilter?: FineStatus) => {
    let builder = supabase
      .from("fines")
      .select("id", { count: "exact", head: true });
    if (statusFilter) builder = builder.eq("status", statusFilter);
    if (opts.type) builder = builder.eq("type", opts.type);
    if (orFilter) builder = builder.or(orFilter);
    return builder;
  };
  const [totalRes, unpaidRes] = await Promise.all([
    countBuilder(),
    countBuilder("UNPAID"),
  ]);
  if (totalRes.error) fail("Could not load fines.", totalRes.error.message);
  if (unpaidRes.error) fail("Could not load fines.", unpaidRes.error.message);
  const total = totalRes.count ?? 0;
  const unpaidCount = unpaidRes.count ?? 0;

  // Window [from, to] split at the unpaid/settled boundary; each side is
  // fetched with its own PostgREST range (offsets shifted for block 2).
  const blockFrom1 = from;
  const blockTo1 = Math.min(to, unpaidCount - 1);
  const blockFrom2 = Math.max(from, unpaidCount);
  const blockTo2 = Math.min(to, total - 1);

  const fetchBlock = async (
    block: "UNPAID" | "SETTLED",
    rangeFrom: number,
    rangeTo: number,
  ): Promise<Record<string, unknown>[]> => {
    let builder = supabase
      .from("fines")
      .select(ADMIN_FINE_SELECT, { count: "exact" });
    builder =
      block === "UNPAID"
        ? builder.eq("status", "UNPAID")
        : builder.in("status", ["PAID", "WAIVED"]);
    if (opts.type) builder = builder.eq("type", opts.type);
    if (orFilter) builder = builder.or(orFilter);
    const { data, error } = await builder
      .order("created_at", { ascending: false })
      .range(rangeFrom, rangeTo);
    if (error) {
      if (isEmptyPageError(error)) return [];
      fail("Could not load fines.", error.message);
    }
    return (data ?? []) as Record<string, unknown>[];
  };

  const [block1, block2] = await Promise.all([
    blockFrom1 <= blockTo1
      ? fetchBlock("UNPAID", blockFrom1, blockTo1)
      : Promise.resolve([]),
    blockFrom2 <= blockTo2
      ? fetchBlock("SETTLED", blockFrom2 - unpaidCount, blockTo2 - unpaidCount)
      : Promise.resolve([]),
  ]);

  return {
    rows: [...block1, ...block2].map(mapAdminFine),
    total,
    page,
    perPage,
  };
}

/* ------------------------------------------------------------------ */
/* Counts (admin dashboard tiles)                                      */
/* ------------------------------------------------------------------ */

/**
 * Penalty headline numbers (Phase 5b tiles):
 *
 * - `unpaidTotal_centavos` / `unpaidCount` — every UNPAID fine right now
 *   (R-27 school-wide balance);
 * - `paidThisMonth_centavos` — fines settled during the current **Manila**
 *   month (`paid_at` boundary, R-30);
 * - `waivedThisMonth_centavos` — fines waived this Manila month (`waived_at`);
 * - `studentsWithFines` — students with ≥ 1 UNPAID fine (the population the
 *   R-25 hard block currently applies to).
 *
 * All reads run through the cookie-aware client: an admin session sees the
 * whole school, a student session is RLS-scoped to its own rows (the function
 * is called from admin pages behind `assertAdmin()` / middleware — E10).
 */
export async function getFineCounts(): Promise<FineCounts> {
  const supabase = await createClient();
  const { startIso, endIso } = manilaMonthRange();

  const [unpaid, paid, waived, students] = await Promise.all([
    supabase.from("fines").select("amount_centavos").eq("status", "UNPAID"),
    supabase
      .from("fines")
      .select("amount_centavos")
      .eq("status", "PAID")
      .gte("paid_at", startIso)
      .lt("paid_at", endIso),
    supabase
      .from("fines")
      .select("amount_centavos")
      .eq("status", "WAIVED")
      .gte("waived_at", startIso)
      .lt("waived_at", endIso),
    supabase
      .from("student_balances")
      .select("student_id", { count: "exact", head: true })
      .gt("unpaid_count", 0),
  ]);
  if (unpaid.error) fail("Could not load fine counts.", unpaid.error.message);
  if (paid.error) fail("Could not load fine counts.", paid.error.message);
  if (waived.error) fail("Could not load fine counts.", waived.error.message);
  if (students.error) fail("Could not load fine counts.", students.error.message);

  const sumAmounts = (rows: unknown): number =>
    (rows as { amount_centavos: unknown }[] | null ?? []).reduce(
      (total, row) => total + toNumber(row.amount_centavos),
      0,
    );

  const unpaidRows = unpaid.data ?? [];

  return {
    unpaidTotal_centavos: sumAmounts(unpaidRows),
    unpaidCount: unpaidRows.length,
    paidThisMonth_centavos: sumAmounts(paid.data),
    waivedThisMonth_centavos: sumAmounts(waived.data),
    studentsWithFines: students.count ?? 0,
  };
}

/* ------------------------------------------------------------------ */
/* Damage reports — admin damages queue (R-22 / R-23)                  */
/* ------------------------------------------------------------------ */

const DAMAGE_REPORT_SELECT = `id, loan_id, student_id, book_id, copy_id,
       description, photo_url, assessed_value_centavos, status, created_at,
       resolved_at,
       student:profiles!damage_reports_student_id_fkey(full_name, student_id, course_section),
       book:books(title, author),
       loan:loans!damage_reports_loan_id_fkey(released_at, due_date, returned_at,
                                               fines(type, status))`;

/**
 * Damage assessments with the accountable student, the book, the loan's
 * due/return dates and **the loan's DAMAGE fine status** (one-to-one via the
 * `uq_fine_per_loan` partial index, R-21 — the embedded `fines` rows are
 * filtered to `type = 'DAMAGE'` here because PostgREST cannot filter inside
 * an embedded to-many).
 *
 * - `status` omitted → `'PENDING'` (the work queue); pass `'RESOLVED'` for
 *   history or `'all'` for everything; newest first;
 * - `page` is 1-based, `perPage` clamped 1–100 (default 25).
 */
export async function getDamageReports(
  opts: { status?: DamageReportStatus | "all"; page?: number; perPage?: number } = {},
): Promise<DamageReportsPage> {
  const page = clampPage(opts.page, 1);
  const perPage = clampPerPage(opts.perPage);
  const status: DamageReportStatus | "all" = opts.status ?? "PENDING";

  const supabase = await createClient();

  let builder = supabase
    .from("damage_reports")
    .select(DAMAGE_REPORT_SELECT, { count: "exact" });
  if (status !== "all") builder = builder.eq("status", status);

  const from = (page - 1) * perPage;
  let { data, error, count } = await builder
    .order("created_at", { ascending: false })
    .range(from, from + perPage - 1);

  if (isEmptyPageError(error)) {
    const retry = await builder.range(0, perPage - 1);
    if (retry.error) fail("Could not load damage reports.", retry.error.message);
    data = [];
    count = retry.count;
    error = null;
  }
  if (error) fail("Could not load damage reports.", error.message);

  interface JoinedRow {
    id: string;
    loan_id: string;
    student_id: string;
    book_id: string;
    copy_id: string;
    description: string;
    photo_url: string | null;
    assessed_value_centavos: number;
    status: string;
    created_at: string;
    resolved_at: string | null;
    student:
      | { full_name: string; student_id: string | null; course_section: string | null }
      | { full_name: string; student_id: string | null; course_section: string | null }[]
      | null;
    book: { title: string; author: string } | { title: string; author: string }[] | null;
    loan:
      | {
          released_at: string | null;
          due_date: string | null;
          returned_at: string | null;
          fines: unknown;
        }
      | {
          released_at: string | null;
          due_date: string | null;
          returned_at: string | null;
          fines: unknown;
        }[]
      | null;
  }

  const rows: DamageReportRow[] = ((data ?? []) as unknown as JoinedRow[]).map(
    (row) => {
      const student = embedFirst(row.student);
      const book = embedFirst(row.book);
      const loan = embedFirst(row.loan);
      const fines = Array.isArray(loan?.fines)
        ? loan.fines
        : loan?.fines
          ? [loan.fines]
          : [];
      const damageFine = fines.find(
        (fine) =>
          typeof fine === "object" &&
          fine !== null &&
          (fine as { type?: unknown }).type === "DAMAGE",
      ) as { status?: unknown } | undefined;
      return {
        id: row.id,
        loan_id: row.loan_id,
        student_id: row.student_id,
        book_id: row.book_id,
        copy_id: row.copy_id,
        description: row.description,
        photo_url: row.photo_url,
        assessed_value_centavos: toNumber(row.assessed_value_centavos),
        status:
          typeof row.status === "string" && isDamageReportStatus(row.status)
            ? row.status
            : "PENDING",
        created_at: row.created_at,
        resolved_at: row.resolved_at,
        student_name: student?.full_name ?? "",
        student_number: student?.student_id ?? null,
        course_section: student?.course_section ?? null,
        title: book?.title ?? "",
        author: book?.author ?? "",
        released_at: loan?.released_at ?? null,
        due_date: loan?.due_date ?? null,
        returned_at: loan?.returned_at ?? null,
        fine_status: damageFine?.status
          ? toFineStatus(damageFine.status)
          : null,
      };
    },
  );

  return { rows, total: count ?? rows.length, page, perPage };
}

/* ------------------------------------------------------------------ */
/* Return-flow handoff helper                                          */
/* ------------------------------------------------------------------ */

/**
 * Does this loan already have a `damage_reports` row? (`loan_id` is UNIQUE —
 * one assessment per loan, schema.md §2.7 / R-21.)
 *
 * Used by the Phase 4 return-modal handoff ("book returned as DAMAGED →
 * assess damage next") to decide between "Assess damage" and "Already
 * assessed". Returns `false` for a non-UUID id or an unreadable row so the
 * caller can render the default affordance.
 */
export async function hasDamageReport(loanId: string): Promise<boolean> {
  if (!isUuid(loanId)) return false;
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("damage_reports")
    .select("id", { count: "exact", head: true })
    .eq("loan_id", loanId);
  if (error) fail("Could not load the damage report.", error.message);
  return (count ?? 0) > 0;
}

/* ------------------------------------------------------------------ */
/* Blocking notices — R-25 student banners (Phase 5b adoption)         */
/* ------------------------------------------------------------------ */

/**
 * User-facing balance banners for one student's catalog/dashboard, in
 * priority order:
 *
 *   1. unpaid OVERDUE → "You have an overdue fine: ₱X — settle it at the
 *      library to borrow again."
 *   2. unpaid DAMAGE  → "You must replace or pay for a damaged book (₱X)
 *      before requesting new books."
 *
 * `[]` when the student owes nothing. `X` is `formatPeso(sum)` of the
 * relevant UNPAID fines (R-29 — centavos in, peso string out). Messages are
 * aggregated per type so the banner shows ONE overdue line and ONE damage
 * line no matter how many fines are open.
 *
 * RLS applies: a student session only ever aggregates **its own** fines (the
 * same `student_id = auth.uid()` policy), while an admin session may render
 * the notices for any student. The strings complement — never replace — the
 * hard block in `getRequestEligibility` (R-25): requests are rejected
 * server-side regardless of what the banner shows.
 */
export async function getBlockingNotices(studentId: string): Promise<string[]> {
  if (!isUuid(studentId)) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("fines")
    .select("type, amount_centavos")
    .eq("student_id", studentId)
    .eq("status", "UNPAID");
  if (error) fail("Could not load your fines.", error.message);

  let overdueCentavos = 0;
  let damageCentavos = 0;
  for (const row of (data ?? []) as { type: string; amount_centavos: unknown }[]) {
    const amount = toNumber(row.amount_centavos);
    if (row.type === "DAMAGE") damageCentavos += amount;
    else overdueCentavos += amount;
  }

  const notices: string[] = [];
  if (overdueCentavos > 0) {
    notices.push(
      `You have an overdue fine: ${formatPeso(overdueCentavos)} — settle it at the library to borrow again.`,
    );
  }
  if (damageCentavos > 0) {
    notices.push(
      `You must replace or pay for a damaged book (${formatPeso(damageCentavos)}) before requesting new books.`,
    );
  }
  return notices;
}
