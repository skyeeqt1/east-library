import "server-only";

import { createClient } from "@/lib/supabase/server";

/**
 * ============================================================================
 *  Catalog reads — server-only helpers (Phase 2, rules.md §3 / R-07)
 * ============================================================================
 *
 * Plain async functions: **no `"use server"` directive** (they are not server
 * actions — call them from Server Components / route handlers / actions, never
 * from a client component). Every read goes through the cookie-aware anon
 * client so RLS applies: `books` / `book_copies` are `USING (true)` for reads
 * and the `book_availability` view is readable by everyone (schema.md §4).
 *
 * Availability is **never** a stored number (R-07): it is always derived from
 * `book_copies.status`, either through the `book_availability` view or by
 * counting the copies we already fetched.
 */

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

/** Copy lifecycle statuses — schema.md §2.3 / R-07. */
export type CopyStatus = "AVAILABLE" | "ON_LOAN" | "DAMAGED" | "LOST";

/** One row of `public.books` (schema.md §2.2) — columns only. */
export interface BookRecord {
  id: string;
  isbn: string | null;
  title: string;
  author: string;
  category: string | null;
  shelf_code: string | null;
  cover_url: string | null;
  replacement_value_centavos: number;
  created_at: string;
  updated_at: string;
}

/** A book row plus its merged availability counters (from `book_availability`). */
export interface BookRow extends BookRecord {
  total_copies: number;
  available_copies: number;
}

/** One physical copy — `book_copies` (schema.md §2.3). */
export interface BookCopyRow {
  id: string;
  barcode: string | null;
  status: CopyStatus;
  acquired_at: string | null;
}

/** Detail payload: the title with availability + every copy of that title. */
export interface BookDetail {
  book: BookRow;
  copies: BookCopyRow[];
}

/** Paginated catalog listing. */
export interface CatalogPage {
  rows: BookRow[];
  total: number;
  page: number;
  perPage: number;
}

/** Aggregates for the admin dashboard tiles. */
export interface CatalogStats {
  totalTitles: number;
  totalCopies: number;
  availableCopies: number;
  onLoanCopies: number;
}

const BOOK_COLUMNS =
  "id, isbn, title, author, category, shelf_code, cover_url, replacement_value_centavos, created_at, updated_at";

const DEFAULT_PER_PAGE = 25;
const MAX_PER_PAGE = 100;

/* ------------------------------------------------------------------ */
/* Internal helpers                                                    */
/* ------------------------------------------------------------------ */

/**
 * Build a PostgREST `or=(…)` term over `title` / `author` / `isbn`.
 *
 * User input is sanitized first: PostgREST logic trees split on `, ( ) "` and
 * the value is emitted **double-quoted**, so commas/dots/parens inside the term
 * stay part of the value (verified against PostgREST). Embedded `"` would close
 * the literal early, so it is replaced; LIKE wildcards `% _ \` are escaped so
 * the term matches literally.
 */
function searchFilter(query: string): string {
  const cleaned = query.replace(/"/g, "'").replace(/\s+/g, " ").trim();
  const escaped = cleaned.replace(/[\\%_]/g, (char) => `\\${char}`);
  const pattern = `"%${escaped}%"`;
  return `title.ilike.${pattern},author.ilike.${pattern},isbn.ilike.${pattern}`;
}

function fail(message: string, details?: string): never {
  throw new Error(details ? `${message} (${details})` : message);
}

/**
 * The `book_availability` view counts with `count(*)`, so a title with **zero**
 * copies still reports `total_copies = 1` (the null-extended join row) while
 * `available_copies` is correctly 0. Those `(1, 0)` rows are ambiguous — a
 * genuine single unavailable copy also looks like that — so they are checked
 * against `book_copies` in one extra batched query.
 */
async function correctZeroCopyTotals(rows: BookRow[]): Promise<void> {
  const ambiguous = rows.filter(
    (row) => row.total_copies === 1 && row.available_copies === 0,
  );
  if (ambiguous.length === 0) return;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("book_copies")
    .select("book_id")
    .in("book_id", ambiguous.map((row) => row.id));
  if (error) return; // best-effort — the view value stays as-is

  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    const bookId = (row as { book_id: string }).book_id;
    counts.set(bookId, (counts.get(bookId) ?? 0) + 1);
  }
  for (const row of ambiguous) {
    if (!counts.has(row.id)) row.total_copies = 0;
  }
}

/* ------------------------------------------------------------------ */
/* Public read API                                                     */
/* ------------------------------------------------------------------ */

/**
 * Paginated catalog with per-title availability merged in.
 *
 * 1. query `books` (ILIKE on title/author/isbn, exact `category` filter,
 *    `count: exact`, `title ASC`, `range` for the page),
 * 2. fetch the `book_availability` rows for that page's ids and merge
 *    `total_copies` / `available_copies` in JS — no PostgREST join needed.
 *
 * `perPage` defaults to 25 (clamped to 1–100); `page` is 1-based.
 * Throws on a database error so a failed read surfaces instead of rendering
 * an empty catalog.
 *
 * A `page` past the last row is not a database error: PostgREST answers such a
 * range with 416/PGRST103, which is translated here into an empty page that
 * still carries the exact total (so the UI can show "Nothing on this page.").
 */
export async function getBooksWithAvailability(opts: {
  query?: string;
  category?: string;
  page?: number;
  perPage?: number;
}): Promise<CatalogPage> {
  const page = Math.max(1, Math.floor(opts.page ?? 1));
  const perPage = Math.min(
    MAX_PER_PAGE,
    Math.max(1, Math.floor(opts.perPage ?? DEFAULT_PER_PAGE)),
  );
  const query = opts.query?.trim();
  const category = opts.category?.trim();

  const supabase = await createClient();

  let builder = supabase
    .from("books")
    .select(BOOK_COLUMNS, { count: "exact" });
  if (query) builder = builder.or(searchFilter(query));
  if (category) builder = builder.eq("category", category);

  const from = (page - 1) * perPage;
  let { data, error, count } = await builder
    .order("title", { ascending: true })
    .range(from, from + perPage - 1);

  // PostgREST rejects an offset past the last row with 416/PGRST103 instead of
  // returning an empty page. Re-run from offset 0 (same filters/order — `range()`
  // overwrites offset+limit) to learn the exact total, then hand back an empty
  // page so a stale `page` param renders "Nothing on this page." rather than a
  // load error.
  if (error?.code === "PGRST103") {
    const retry = await builder.range(0, perPage - 1);
    if (retry.error) fail("Could not load the catalog.", retry.error.message);
    data = [];
    count = retry.count;
    error = null;
  }

  if (error) fail("Could not load the catalog.", error.message);

  const records = (data ?? []) as BookRecord[];
  const rows: BookRow[] = records.map((book) => ({
    ...book,
    total_copies: 0,
    available_copies: 0,
  }));

  if (rows.length > 0) {
    const { data: availability, error: availabilityError } = await supabase
      .from("book_availability")
      .select("book_id, total_copies, available_copies")
      .in(
        "book_id",
        rows.map((row) => row.id),
      );
    if (availabilityError) {
      fail("Could not load availability.", availabilityError.message);
    }

    const byId = new Map<string, { total_copies: number; available_copies: number }>();
    for (const entry of (availability ?? []) as {
      book_id: string;
      total_copies: number;
      available_copies: number;
    }[]) {
      byId.set(entry.book_id, {
        total_copies: entry.total_copies,
        available_copies: entry.available_copies,
      });
    }
    for (const row of rows) {
      const merged = byId.get(row.id);
      if (merged) {
        row.total_copies = merged.total_copies;
        row.available_copies = merged.available_copies;
      }
    }
    await correctZeroCopyTotals(rows);
  }

  return { rows, total: count ?? rows.length, page, perPage };
}

/**
 * One title with every physical copy (admin detail drawer / edit form).
 * Returns `null` when the id does not exist.
 *
 * Availability on `book` is counted from the copies we just fetched (R-07) —
 * exact by construction, including the zero-copy case.
 */
export async function getBookDetail(bookId: string): Promise<BookDetail | null> {
  const supabase = await createClient();

  const { data: book, error } = await supabase
    .from("books")
    .select(BOOK_COLUMNS)
    .eq("id", bookId)
    .maybeSingle();
  if (error) fail("Could not load the book.", error.message);
  if (!book) return null;

  const { data: copies, error: copiesError } = await supabase
    .from("book_copies")
    .select("id, barcode, status, acquired_at")
    .eq("book_id", bookId)
    .order("acquired_at", { ascending: true })
    .order("barcode", { ascending: true, nullsFirst: false });
  if (copiesError) fail("Could not load the copies.", copiesError.message);

  const rows = (copies ?? []) as BookCopyRow[];
  return {
    book: {
      ...(book as BookRecord),
      total_copies: rows.length,
      available_copies: rows.filter((copy) => copy.status === "AVAILABLE")
        .length,
    },
    copies: rows,
  };
}

/**
 * Catalog aggregates for the dashboard:
 * `books` row count + `book_copies` counts grouped by status
 * (`AVAILABLE` → available, `ON_LOAN` → on loan, R-07).
 */
export async function getCatalogStats(): Promise<CatalogStats> {
  const supabase = await createClient();

  const [titles, copies] = await Promise.all([
    supabase
      .from("books")
      .select("id", { count: "exact", head: true }),
    supabase.from("book_copies").select("status"),
  ]);
  if (titles.error) fail("Could not load catalog statistics.", titles.error.message);
  if (copies.error) fail("Could not load catalog statistics.", copies.error.message);

  const statuses = (copies.data ?? []) as { status: string }[];
  let availableCopies = 0;
  let onLoanCopies = 0;
  for (const row of statuses) {
    if (row.status === "AVAILABLE") availableCopies += 1;
    else if (row.status === "ON_LOAN") onLoanCopies += 1;
  }

  return {
    totalTitles: titles.count ?? 0,
    totalCopies: statuses.length,
    availableCopies,
    onLoanCopies,
  };
}

/** Distinct non-null `books.category` values, ordered (filter dropdown). */
export async function getDistinctCategories(): Promise<string[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("books")
    .select("category")
    .not("category", "is", null)
    .order("category", { ascending: true });
  if (error) fail("Could not load categories.", error.message);

  const seen = new Set<string>();
  const categories: string[] = [];
  for (const row of (data ?? []) as { category: string | null }[]) {
    const value = row.category?.trim();
    if (value && !seen.has(value)) {
      seen.add(value);
      categories.push(value);
    }
  }
  return categories;
}
