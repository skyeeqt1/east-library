import "server-only";

import { createClient } from "@/lib/supabase/server";
import { isRequestStatus, type RequestStatus } from "@/lib/validations/request";

/**
 * ============================================================================
 *  Decided-request feed — server-only read for /admin/requests (Phase 3 UI)
 * ============================================================================
 *
 * `lib/catalog/requests-read.ts` exposes only `getPendingRequests` for the
 * admin side (the decision queue), so the **Approved / Declined / All** tabs
 * need their own cross-student read. The logic layer is frozen for Phase 3,
 * hence this helper lives beside its page under `components/admin/requests/`
 * (same precedent as `components/admin/books/detail-action.ts`): a plain
 * async function — **no `"use server"`** — imported only from the server
 * component, so the query never leaves the server.
 *
 * Like `lib/catalog/*` reads it goes through the **cookie-aware anon client**
 * so RLS applies (`loan_requests` is `student_id = auth.uid() OR is_admin()`
 * — schema.md §4): only an admin session sees other students' rows, and the
 * admin layout (`assertAdmin`) has already gated the route (rules.md §9).
 *
 * Shape mirrors `PendingRequestRow` plus the decision columns
 * (`status`, `decline_reason`, `decided_at`), ordered **newest first** —
 * decisions are browsed most-recently-decided, unlike the FIFO pending desk.
 */

/** One decided (or, for the All tab, any) request joined with student + title. */
export interface DecidedRequestRow {
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
  status: RequestStatus;
  decline_reason: string | null;
  created_at: string;
  decided_at: string | null;
  /**
   * `loan_requests.loan_id` — set once the book has been released at the desk
   * (R-14 links the request to its loan). `null` on an APPROVED row means
   * **awaiting pickup**, i.e. the row that still offers "Release book".
   */
  loan_id: string | null;
}

/** Paginated decision listing (25/page, mirroring the pending queue). */
export interface DecidedRequestsPage {
  rows: DecidedRequestRow[];
  total: number;
  page: number;
  perPage: number;
}

const DEFAULT_PER_PAGE = 25;
const MAX_PER_PAGE = 100;

function fail(message: string, details?: string): never {
  throw new Error(details ? `${message} (${details})` : message);
}

/** PostgREST answers a range past the last row with 416/PGRST103 (see lib/catalog). */
function isEmptyPageError(error: { code?: string } | null): boolean {
  return error?.code === "PGRST103";
}

/**
 * FK embeds arrive as a to-one object at runtime but as an array in the
 * untyped supabase-js generics — accept both (same helper shape as
 * `embedFirst` in lib/catalog/requests-read.ts).
 */
function embedFirst<T>(value: T | T[] | null | undefined): T | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.length > 0 ? value[0] : null;
  return value;
}

/**
 * Cross-student request feed for the admin's Approved / Declined / All tabs.
 *
 * @param opts.status  One R-12 state (`APPROVED` / `DECLINED` / `CANCELLED` /
 *   `EXPIRED`) — unknown strings are ignored; omit for "All".
 * @param opts.page    1-based page (default 1), `perPage` clamped to 1–100
 *   (default 25).
 *
 * Throws on a database error so a failed read surfaces as the page's error
 * block instead of an empty tab (same contract as `getPendingRequests`).
 */
export async function getDecidedRequests(
  opts: { status?: string; page?: number; perPage?: number } = {},
): Promise<DecidedRequestsPage> {
  const page = Math.max(1, Math.floor(opts.page ?? 1));
  const perPage = Math.min(
    MAX_PER_PAGE,
    Math.max(1, Math.floor(opts.perPage ?? DEFAULT_PER_PAGE)),
  );
  const from = (page - 1) * perPage;

  // Only a real `loan_requests.status` may reach the query builder.
  const status =
    opts.status !== undefined && isRequestStatus(opts.status)
      ? opts.status
      : undefined;

  const supabase = await createClient();

  const builder = supabase
    .from("loan_requests")
    .select(
      `id, student_id, book_id, status, decline_reason, created_at, decided_at, loan_id,
       student:profiles!loan_requests_student_id_fkey(full_name, student_id, course_section),
       book:books(title, author)`,
      { count: "exact" },
    );
  const filtered = status ? builder.eq("status", status) : builder;

  let { data, error, count } = await filtered
    .order("created_at", { ascending: false })
    .range(from, from + perPage - 1);

  if (isEmptyPageError(error)) {
    const retry = await filtered.range(0, perPage - 1);
    if (retry.error) fail("Could not load decided requests.", retry.error.message);
    data = [];
    count = retry.count;
    error = null;
  }
  if (error) fail("Could not load decided requests.", error.message);

  interface JoinedRow {
    id: string;
    student_id: string;
    book_id: string;
    status: string;
    decline_reason: string | null;
    created_at: string;
    decided_at: string | null;
    loan_id: string | null;
    student:
      | { full_name: string; student_id: string | null; course_section: string | null }
      | { full_name: string; student_id: string | null; course_section: string | null }[]
      | null;
    book: { title: string; author: string } | { title: string; author: string }[] | null;
  }

  const rows: DecidedRequestRow[] = ((data ?? []) as unknown as JoinedRow[]).map(
    (row) => {
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
        // Unknown/legacy status strings fall back to PENDING via the guard.
        status: isRequestStatus(row.status) ? row.status : "PENDING",
        decline_reason: row.decline_reason,
        created_at: row.created_at,
        decided_at: row.decided_at,
        loan_id: row.loan_id ?? null,
      };
    },
  );

  return { rows, total: count ?? rows.length, page, perPage };
}
