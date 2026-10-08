import "server-only";

import { createClient } from "@/lib/supabase/server";
import {
  isRequestStatus,
  type RequestStatus,
} from "@/lib/validations/request";

/**
 * ============================================================================
 *  Borrow-request reads + eligibility — server-only helpers (Phase 3)
 * ============================================================================
 *
 * rules.md §4 (R-10…R-16), §3 R-09 / R-25, prd.md FR-09…FR-13, US-2/US-3.
 *
 * Plain async functions: **no `"use server"` directive** (same contract as
 * lib/catalog/availability.ts) — call them from Server Components, route
 * handlers or server actions, never from a client component. Every read goes
 * through the cookie-aware anon client so RLS applies (schema.md §4):
 * students see only their own `loan_requests`, admins see the whole queue.
 *
 * ## Eligibility: TS implementation vs the `can_request` SQL functions
 *
 * `getRequestEligibility` re-implements R-09/R-25 **in TypeScript** against
 * `profiles` / `fines` (via `student_balances`) / `loan_requests` / `loans` /
 * `book_availability` / `settings`, returning the exact user-facing message
 * instead of an exception. Reasons for choosing TS over
 * `rpc('assert_can_request')`:
 *
 *   1. typed, per-condition messages without parsing `raise exception` text;
 *   2. `settings` are read fresh (max_pending_requests / max_active_loans /
 *      block_on_unpaid_fines), so admin changes apply immediately (R-31);
 *   3. the same helper powers both the read-only UI gate (disabled Request
 *      button — US-2/US-7) and the server action's defense-in-depth re-check;
 *   4. `assert_can_request` has known bugs (documented in the Phase 3 report):
 *      its R-09.5 branch raises 'Request limit reached.' (copy-paste of the
 *      pending-cap message) and it ignores the `block_on_unpaid_fines`
 *      setting. The RPC is still cross-checked in the smoke test.
 *
 * `submitBookRequest` (lib/student/request-actions.ts) calls this helper
 * before every INSERT — R-25's "server action re-verifies" (defense in depth).
 */

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

/** Outcome of the R-09 / R-25 eligibility check. */
export interface EligibilityResult {
  eligible: boolean;
  /** User-facing reason when `eligible` is false (exact spec strings). */
  reason?: string;
}

/** One of the student's requests joined with its title (US-2 "My Requests"). */
export interface StudentRequestRow {
  id: string;
  book_id: string;
  title: string;
  author: string;
  status: RequestStatus;
  decline_reason: string | null;
  created_at: string;
  decided_at: string | null;
  /** `loan_requests.loan_id` — set once the book is released at the desk
   *  (R-14); feeds the third "Released" step of the design §6 stepper. */
  loan_id: string | null;
  /** `loans.released_at` for the linked loan (null until release). */
  released_at: string | null;
}

/** Paginated student request listing. */
export interface StudentRequestsPage {
  rows: StudentRequestRow[];
  total: number;
  page: number;
  perPage: number;
}

/** One PENDING row of the admin queue, enriched for the decision table. */
export interface PendingRequestRow {
  id: string;
  student_id: string;
  book_id: string;
  /** `profiles.full_name` of the requester. */
  student_name: string;
  /** `profiles.student_id` (ESCR Student ID — R-02). */
  student_number: string | null;
  course_section: string | null;
  title: string;
  author: string;
  /** From `book_availability` at read time (R-07/R-13 context for Approve). */
  available_copies: number;
  created_at: string;
}

/** Paginated admin queue (ordered oldest-first — FIFO desk). */
export interface PendingRequestsPage {
  rows: PendingRequestRow[];
  total: number;
  page: number;
  perPage: number;
}

/** Tab counters for the admin requests page. */
export interface RequestCounts {
  pending: number;
  approved: number;
  declined: number;
  total: number;
}

/* ------------------------------------------------------------------ */
/* User-facing messages (exact strings from rules.md / prd.md)         */
/* ------------------------------------------------------------------ */

export const REQUEST_MESSAGES = {
  /** R-25 / FR-20 / US-7 — unpaid balance hard-blocks new requests. */
  blockedBalance: "Settle pending balance at the library to request new books.",
  /** R-10 / US-2 — an open PENDING request already exists for this book. */
  alreadyRequested: "Already requested.",
  /** R-09.4 — pending requests >= settings.max_pending_requests. */
  requestLimit: "Request limit reached.",
  /** R-09.5 — active loans >= settings.max_active_loans (see report: SQL
   *  `assert_can_request` wrongly reuses 'Request limit reached.' here). */
  loanLimit: "Loan limit reached.",
  /** R-09.6 — book has no AVAILABLE copy right now. */
  noCopies: "No copies available.",
  /** R-09.1 / R-04 — profile.status = 'BLOCKED'. */
  accountBlocked: "This account is blocked. Contact the library.",
  /** Fallback (profile row missing / unknown failure — SQL defense message). */
  cannotRequest: "You cannot request this book.",
} as const;

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

/**
 * PostgREST answers a `range()` past the last row with 416/PGRST103 instead
 * of an empty page. Re-run from offset 0 to learn the exact total (same
 * pattern as `getBooksWithAvailability` in lib/catalog/availability.ts).
 */
function isEmptyPageError(error: { code?: string } | null): boolean {
  return error?.code === "PGRST103";
}

/** Narrow a loose PostgREST row to a `RequestStatus` (unknown → PENDING). */
function toStatus(value: unknown): RequestStatus {
  return typeof value === "string" && isRequestStatus(value)
    ? value
    : "PENDING";
}

/** Settings values arrive as `jsonb` (number | string | boolean). */
function settingInt(raw: unknown, fallback: number): number {
  const value =
    typeof raw === "number"
      ? raw
      : typeof raw === "string"
        ? Number.parseInt(raw, 10)
        : Number.NaN;
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function settingBool(raw: unknown, fallback: boolean): boolean {
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "string") {
    if (raw.toLowerCase() === "true") return true;
    if (raw.toLowerCase() === "false") return false;
  }
  return fallback;
}

/**
 * Normalize an embedded PostgREST row. FK embeds (`book:books(...)`,
 * `student:profiles!...`) arrive as a **to-one object** at runtime, but the
 * untyped supabase-js generics infer an array (no schema info) — accept both
 * shapes so the mapping stays correct either way.
 */
function embedFirst<T>(value: T | T[] | null | undefined): T | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.length > 0 ? value[0] : null;
  return value;
}

/* ------------------------------------------------------------------ */
/* Eligibility (R-09, R-25)                                            */
/* ------------------------------------------------------------------ */

/**
 * Can `studentId` submit a NEW request for `bookId` right now?
 *
 * Conditions are evaluated in R-09 order (1 status → 2 fines → 3 duplicate →
 * 4 pending cap → 5 loan cap → 6 availability), each returning the **exact**
 * user-facing message from prd.md / rules.md on failure. Thresholds come from
 * `settings` (rules §1: max_pending_requests = 3, max_active_loans = 3,
 * block_on_unpaid_fines = true — defaults applied when a row is missing).
 *
 * Throws only when the underlying reads fail (same contract as the catalog
 * read helpers); every business-rule rejection is a normal `{ eligible:false }`.
 */
export async function getRequestEligibility(
  studentId: string,
  bookId: string,
): Promise<EligibilityResult> {
  if (!isUuid(studentId) || !isUuid(bookId)) {
    return { eligible: false, reason: REQUEST_MESSAGES.cannotRequest };
  }

  const supabase = await createClient();

  // One parallel batch — every read is independent (R-31: server-side truth).
  const [profileRes, settingsRes, balanceRes, dupRes, pendingRes, loansRes, availabilityRes] =
    await Promise.all([
      // R-09.1 — profile must exist and be ACTIVE (R-04)
      supabase.from("profiles").select("status").eq("id", studentId).maybeSingle(),
      // rules §1 — thresholds + hard-block switch
      supabase
        .from("settings")
        .select("key, value")
        .in("key", ["max_pending_requests", "max_active_loans", "block_on_unpaid_fines"]),
      // R-27 — balance is always computed from UNPAID fines, never cached
      supabase
        .from("student_balances")
        .select("balance_centavos, unpaid_count")
        .eq("student_id", studentId)
        .maybeSingle(),
      // R-10 — existing PENDING request for this exact (student, book)
      supabase
        .from("loan_requests")
        .select("id", { count: "exact", head: true })
        .eq("student_id", studentId)
        .eq("book_id", bookId)
        .eq("status", "PENDING"),
      // R-09.4 — total PENDING requests
      supabase
        .from("loan_requests")
        .select("id", { count: "exact", head: true })
        .eq("student_id", studentId)
        .eq("status", "PENDING"),
      // R-09.5 — active loans (not yet returned, incl. OVERDUE per R-26)
      supabase
        .from("loans")
        .select("id", { count: "exact", head: true })
        .eq("student_id", studentId)
        .is("returned_at", null),
      // R-09.6 — ≥1 AVAILABLE copy (view quirk: 0-copy titles report 0 too,
      // so `available_copies > 0` is correct for both cases)
      supabase
        .from("book_availability")
        .select("available_copies")
        .eq("book_id", bookId)
        .maybeSingle(),
    ]);

  if (profileRes.error) fail("Could not verify the account status.", profileRes.error.message);
  if (settingsRes.error) fail("Could not read the request settings.", settingsRes.error.message);
  if (balanceRes.error) fail("Could not verify the account balance.", balanceRes.error.message);
  if (dupRes.error) fail("Could not check existing requests.", dupRes.error.message);
  if (pendingRes.error) fail("Could not count pending requests.", pendingRes.error.message);
  if (loansRes.error) fail("Could not count active loans.", loansRes.error.message);
  if (availabilityRes.error) fail("Could not check availability.", availabilityRes.error.message);

  // R-09.1 — profile must exist and be ACTIVE (R-04)
  const status = (profileRes.data as { status: string } | null)?.status;
  if (!status) return { eligible: false, reason: REQUEST_MESSAGES.cannotRequest };
  if (status !== "ACTIVE") {
    return { eligible: false, reason: REQUEST_MESSAGES.accountBlocked };
  }

  // rules §1 settings (defaults match the seeded values)
  const settings = new Map<string, unknown>();
  for (const row of (settingsRes.data ?? []) as { key: string; value: unknown }[]) {
    settings.set(row.key, row.value);
  }
  const maxPending = settingInt(settings.get("max_pending_requests"), 3);
  const maxLoans = settingInt(settings.get("max_active_loans"), 3);
  const blockOnUnpaidFines = settingBool(settings.get("block_on_unpaid_fines"), true);

  // R-09.2 / R-25 / FR-20 / US-7 — hard block while any fine is UNPAID
  if (blockOnUnpaidFines) {
    const balance = balanceRes.data as
      | { balance_centavos: number; unpaid_count: number }
      | null;
    if (balance && (balance.unpaid_count > 0 || balance.balance_centavos > 0)) {
      return { eligible: false, reason: REQUEST_MESSAGES.blockedBalance };
    }
  }

  // R-09.3 / R-10 / US-2 — one open request per (student, book)
  if ((dupRes.count ?? 0) > 0) {
    return { eligible: false, reason: REQUEST_MESSAGES.alreadyRequested };
  }

  // R-09.4 — pending-request cap
  if ((pendingRes.count ?? 0) >= maxPending) {
    return { eligible: false, reason: REQUEST_MESSAGES.requestLimit };
  }

  // R-09.5 — active-loan cap
  if ((loansRes.count ?? 0) >= maxLoans) {
    return { eligible: false, reason: REQUEST_MESSAGES.loanLimit };
  }

  // R-09.6 — at least one AVAILABLE copy right now (R-07, view-derived)
  const available = Number(
    (availabilityRes.data as { available_copies: number } | null)?.available_copies ?? 0,
  );
  if (!(available > 0)) {
    return { eligible: false, reason: REQUEST_MESSAGES.noCopies };
  }

  return { eligible: true };
}

/* ------------------------------------------------------------------ */
/* Student listing — "My Requests" (US-2 / FR-09, FR-13)               */
/* ------------------------------------------------------------------ */

/**
 * The signed-in student's requests (RLS restricts rows to `auth.uid()` or
 * admins — schema.md §4), newest first, titles merged from `books`.
 *
 * `status` filters to one R-12 state (admin tab / UI filter); `page` is
 * 1-based, `perPage` clamped to 1–100 (default 25).
 */
export async function getStudentRequests(
  studentId: string,
  opts: { status?: RequestStatus; page?: number; perPage?: number } = {},
): Promise<StudentRequestsPage> {
  const page = clampPage(opts.page, 1);
  const perPage = Math.min(MAX_PER_PAGE, Math.max(1, Math.floor(opts.perPage ?? DEFAULT_PER_PAGE)));
  const from = (page - 1) * perPage;

  const supabase = await createClient();

  let builder = supabase
    .from("loan_requests")
    .select(
      "id, book_id, status, decline_reason, created_at, decided_at, loan_id, book:books(title, author)",
      { count: "exact" },
    )
    .eq("student_id", studentId);
  if (opts.status) builder = builder.eq("status", opts.status);

  let { data, error, count } = await builder
    .order("created_at", { ascending: false })
    .range(from, from + perPage - 1);

  if (isEmptyPageError(error)) {
    const retry = await builder.range(0, perPage - 1);
    if (retry.error) fail("Could not load your requests.", retry.error.message);
    data = [];
    count = retry.count;
    error = null;
  }
  if (error) fail("Could not load your requests.", error.message);

  interface JoinedRow {
    id: string;
    book_id: string;
    status: string;
    decline_reason: string | null;
    created_at: string;
    decided_at: string | null;
    loan_id: string | null;
    book: { title: string; author: string } | { title: string; author: string }[] | null;
  }

  const rows: StudentRequestRow[] = ((data ?? []) as unknown as JoinedRow[]).map(
    (row) => {
      const book = embedFirst(row.book);
      return {
        id: row.id,
        book_id: row.book_id,
        title: book?.title ?? "",
        author: book?.author ?? "",
        status: toStatus(row.status),
        decline_reason: row.decline_reason,
        created_at: row.created_at,
        decided_at: row.decided_at,
        loan_id: row.loan_id ?? null,
        released_at: null as string | null,
      };
    },
  );

  // Design §6 "Released" step: resolve the linked loan's `released_at` in one
  // batched read (same merge style as getPendingRequests' availability pass).
  // RLS scopes `loans` to the caller's own rows, so this can never leak.
  const loanIds = rows
    .map((row) => row.loan_id)
    .filter((value): value is string => value !== null);
  if (loanIds.length > 0) {
    const loans = await supabase.from("loans").select("id, released_at").in("id", loanIds);
    if (loans.error) fail("Could not load your requests.", loans.error.message);
    const releasedByLoan = new Map(
      ((loans.data ?? []) as { id: string; released_at: string | null }[]).map(
        (loan) => [loan.id, loan.released_at ?? null],
      ),
    );
    for (const row of rows) {
      row.released_at = row.loan_id ? (releasedByLoan.get(row.loan_id) ?? null) : null;
    }
  }

  return { rows, total: count ?? rows.length, page, perPage };
}

/* ------------------------------------------------------------------ */
/* Admin queue (§9 matrix: admin sees all; FR-11/FR-12, E1/E6)         */
/* ------------------------------------------------------------------ */

/**
 * PENDING requests oldest-first (FIFO), joined with the requester's profile
 * (`full_name`, `student_id`, `course_section`) and the title, plus the
 * **current** `available_copies` from `book_availability` so the queue can
 * show "3 copies free" / "No copies" and gate the Approve button (R-13
 * context — the server action still re-checks at the moment of approval).
 *
 * Reads go through the cookie-aware client: RLS exposes the queue to admins
 * only (schema.md §4 — `student_id = auth.uid() or is_admin()`).
 */
export async function getPendingRequests(
  opts: { page?: number; perPage?: number } = {},
): Promise<PendingRequestsPage> {
  const page = clampPage(opts.page, 1);
  const perPage = Math.min(MAX_PER_PAGE, Math.max(1, Math.floor(opts.perPage ?? DEFAULT_PER_PAGE)));
  const from = (page - 1) * perPage;

  const supabase = await createClient();

  const builder = supabase
    .from("loan_requests")
    .select(
      `id, student_id, book_id, created_at,
       student:profiles!loan_requests_student_id_fkey(full_name, student_id, course_section),
       book:books(title, author)`,
      { count: "exact" },
    )
    .eq("status", "PENDING");

  let { data, error, count } = await builder
    .order("created_at", { ascending: true })
    .range(from, from + perPage - 1);

  if (isEmptyPageError(error)) {
    const retry = await builder.range(0, perPage - 1);
    if (retry.error) fail("Could not load the request queue.", retry.error.message);
    data = [];
    count = retry.count;
    error = null;
  }
  if (error) fail("Could not load the request queue.", error.message);

  interface JoinedRow {
    id: string;
    student_id: string;
    book_id: string;
    created_at: string;
    student:
      | { full_name: string; student_id: string | null; course_section: string | null }
      | { full_name: string; student_id: string | null; course_section: string | null }[]
      | null;
    book: { title: string; author: string } | { title: string; author: string }[] | null;
  }

  const joined = (data ?? []) as unknown as JoinedRow[];
  const rows: PendingRequestRow[] = joined.map((row) => {
    const student = embedFirst(row.student);
    const book = embedFirst(row.book);
    return {
      id: row.id,
      student_id: row.student_id,
      book_id: row.book_id,
      student_name: student?.full_name ?? "",
      student_number: student?.student_id ?? null,
      course_section: student?.course_section ?? null,
      title: book?.title ?? "",
      author: book?.author ?? "",
      available_copies: 0, // merged below (R-07 — never a stored counter)
      created_at: row.created_at,
    };
  });

  // Batch-fetch live availability for the page's titles (same merge style as
  // lib/catalog/availability.ts — one extra query, no per-row fan-out).
  if (rows.length > 0) {
    const { data: availability, error: availabilityError } = await supabase
      .from("book_availability")
      .select("book_id, available_copies")
      .in(
        "book_id",
        rows.map((row) => row.book_id),
      );
    if (availabilityError) {
      fail("Could not load availability.", availabilityError.message);
    }
    const byId = new Map<string, number>();
    for (const entry of (availability ?? []) as { book_id: string; available_copies: number }[]) {
      byId.set(entry.book_id, Number(entry.available_copies));
    }
    for (const row of rows) {
      row.available_copies = byId.get(row.book_id) ?? 0;
    }
  }

  return { rows, total: count ?? rows.length, page, perPage };
}

/* ------------------------------------------------------------------ */
/* Admin tab counters                                                  */
/* ------------------------------------------------------------------ */

/** Headline counts for the admin requests tabs (pending/approved/declined/total). */
export async function getRequestCounts(): Promise<RequestCounts> {
  const supabase = await createClient();

  const [pending, approved, declined, total] = await Promise.all([
    supabase
      .from("loan_requests")
      .select("id", { count: "exact", head: true })
      .eq("status", "PENDING"),
    supabase
      .from("loan_requests")
      .select("id", { count: "exact", head: true })
      .eq("status", "APPROVED"),
    supabase
      .from("loan_requests")
      .select("id", { count: "exact", head: true })
      .eq("status", "DECLINED"),
    supabase.from("loan_requests").select("id", { count: "exact", head: true }),
  ]);

  if (pending.error) fail("Could not load request counts.", pending.error.message);
  if (approved.error) fail("Could not load request counts.", approved.error.message);
  if (declined.error) fail("Could not load request counts.", declined.error.message);
  if (total.error) fail("Could not load request counts.", total.error.message);

  return {
    pending: pending.count ?? 0,
    approved: approved.count ?? 0,
    declined: declined.count ?? 0,
    total: total.count ?? 0,
  };
}
