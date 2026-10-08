import "server-only";

import { createClient } from "@/lib/supabase/server";

/**
 * ============================================================================
 *  Assessable returns — server-only read for /admin/damages (Phase 5b UI)
 * ============================================================================
 *
 * The damage workflow is deliberately **not** automatic on return: Phase 4's
 * `record_return()` only flips the copy to DAMAGED and records
 * `condition_on_return` (rules.md §23 step 1 happens *after* the desk hands
 * the book back), while `assess_damage(p_loan_id, …)` needs the `loanId` of a
 * RETURNED + DAMAGED loan that has **no `damage_reports` row yet** (R-21: one
 * assessment per loan, `damage_reports.loan_id` UNIQUE).
 *
 * `lib/catalog/fines-read.ts` only lists *existing* reports
 * (`getDamageReports`) and asks about a single loan (`hasDamageReport`), so
 * this helper supplies the missing **work queue**: loans returned as DAMAGED
 * that still await an assessment, shown as "Awaiting assessment" rows.
 *
 * ## How the set is derived (v1 approach — reported in the phase report)
 *
 * `lib/catalog/fines-read.ts` exposes no assessable-loan helper (the logic
 * contract is frozen for Phase 5), so this UI-side helper runs two plain
 * admin-readable selects through the cookie-aware anon client (RLS:
 * `loans` / `damage_reports` are `student_id = auth.uid() OR is_admin()` —
 * schema.md §4) and diffs them **in JS**:
 *
 *   1. `damage_reports.loan_id` → the set of loans already assessed;
 *   2. `loans WHERE condition_on_return = 'DAMAGED' AND returned_at NOT NULL`
 *      (ordered `returned_at DESC`, capped at `ASSESSABLE_FETCH_LIMIT` for
 *      safety) → keep the rows whose id is not in that set.
 *
 * Pagination happens over the diffed array (25/page) — acceptable for v1
 * because DAMAGED returns are rare; when the cap is hit `truncated` is true
 * and the page says so instead of pretending the list is complete.
 *
 * No `"use server"` marker: call this from the server component only.
 */

/** Safety cap on the DAMAGED-return scan (rows fetched before the diff). */
export const ASSESSABLE_FETCH_LIMIT = 200;

/** One RETURNED + DAMAGED loan without a damage report yet. */
export interface AssessableReturnRow {
  /** `loans.id` — the `loanId` argument of `assessDamage()`. */
  id: string;
  student_id: string;
  student_name: string;
  student_number: string | null;
  course_section: string | null;
  book_id: string;
  title: string;
  author: string;
  /** ISO timestamp of the damaged return (the queue is ordered by it). */
  returned_at: string;
  /** Book's replacement value in centavos (R-08/R-22) — the assessment preview. */
  replacement_value_centavos: number;
}

/** Paginated slice of the assessment queue. */
export interface AssessableReturnsPage {
  rows: AssessableReturnRow[];
  total: number;
  page: number;
  perPage: number;
  /** The scan hit `ASSESSABLE_FETCH_LIMIT` — older rows may be missing. */
  truncated: boolean;
}

function fail(message: string, details?: string): never {
  throw new Error(details ? `${message} (${details})` : message);
}

/** Normalize an embedded PostgREST row: FK embeds arrive object-or-array. */
function embedFirst<T>(value: T | T[] | null | undefined): T | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.length > 0 ? value[0] : null;
  if (typeof value === "object" && Object.keys(value).length === 0) return null;
  return value;
}

/**
 * Loans returned as DAMAGED that have no `damage_reports` row yet — the
 * "Awaiting assessment" queue on the Damages **Pending** tab (R-23, FR-18).
 *
 * - newest damaged return first;
 * - `page` is 1-based, `perPage` clamped 1–100 (default 25);
 * - throws on database errors so a failed read surfaces instead of an empty
 *   queue.
 */
export async function getAssessableReturns(
  opts: { page?: number; perPage?: number } = {},
): Promise<AssessableReturnsPage> {
  const page = Math.max(1, Math.floor(opts.page ?? 1));
  const perPage = Math.min(100, Math.max(1, Math.floor(opts.perPage ?? 25)));

  const supabase = await createClient();

  const [loansRes, reportsRes] = await Promise.all([
    // 2) every RETURNED loan marked DAMAGED at the desk (R-20/R-23).
    supabase
      .from("loans")
      .select(
        `id, student_id, book_id, returned_at,
         student:profiles!loans_student_id_fkey(full_name, student_id, course_section),
         book:books(title, author, replacement_value_centavos)`,
      )
      .eq("condition_on_return", "DAMAGED")
      .not("returned_at", "is", null)
      .order("returned_at", { ascending: false })
      .limit(ASSESSABLE_FETCH_LIMIT),
    // 1) loans that already have an assessment (R-21: one per loan).
    supabase.from("damage_reports").select("loan_id").limit(2000),
  ]);

  if (loansRes.error) {
    fail("Could not load damaged returns.", loansRes.error.message);
  }
  if (reportsRes.error) {
    fail("Could not load damage reports.", reportsRes.error.message);
  }

  const assessed = new Set(
    (reportsRes.data ?? []).map((row) => String(row.loan_id)),
  );

  interface JoinedRow {
    id: string;
    student_id: string;
    book_id: string;
    returned_at: string;
    student:
      | { full_name: string; student_id: string | null; course_section: string | null }
      | { full_name: string; student_id: string | null; course_section: string | null }[]
      | null;
    book:
      | { title: string; author: string; replacement_value_centavos: number }
      | { title: string; author: string; replacement_value_centavos: number }[]
      | null;
  }

  const diffed: AssessableReturnRow[] = ((loansRes.data ?? []) as unknown as JoinedRow[])
    .filter((row) => !assessed.has(String(row.id)))
    .map((row) => {
      const student = embedFirst(row.student);
      const book = embedFirst(row.book);
      return {
        id: String(row.id),
        student_id: row.student_id,
        student_name: student?.full_name ?? "",
        student_number: student?.student_id ?? null,
        course_section: student?.course_section ?? null,
        book_id: row.book_id,
        title: book?.title ?? "",
        author: book?.author ?? "",
        returned_at: row.returned_at,
        replacement_value_centavos: Number(book?.replacement_value_centavos ?? 0),
      };
    });

  const from = (page - 1) * perPage;
  return {
    rows: diffed.slice(from, from + perPage),
    total: diffed.length,
    page,
    perPage,
    truncated: (loansRes.data ?? []).length >= ASSESSABLE_FETCH_LIMIT,
  };
}
