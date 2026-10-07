/**
 * URL query helpers for `/admin/books`.
 *
 * Shared by the server page (reading `searchParams`) and the client toolbar /
 * pagination (writing the URL), so both sides always agree on the contract —
 * the mirror of `components/admin/students/students-query.ts`.
 */

export const BOOKS_PATH = "/admin/books";

export const BOOKS_PER_PAGE = 25;

export interface BooksQuery {
  /** Free-text search over title / author / ISBN (rules.md §3). */
  q: string;
  /** Exact `books.category` filter; empty string = all categories. */
  category: string;
  page: number;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Sanitize raw Next.js `searchParams` into a typed, safe query. */
export function parseBooksQuery(raw: {
  q?: string | string[];
  category?: string | string[];
  page?: string | string[];
}): BooksQuery {
  const q = (first(raw.q) ?? "").trim().slice(0, 80);
  const category = (first(raw.category) ?? "").trim().slice(0, 60);

  const parsedPage = Number.parseInt(first(raw.page) ?? "1", 10);
  const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;

  return { q, category, page };
}

/** Build the canonical `/admin/books?...` URL (empty params are dropped). */
export function buildBooksPath(query: Partial<BooksQuery>): string {
  const params = new URLSearchParams();
  const q = query.q?.trim();
  if (q) params.set("q", q);
  if (query.category?.trim()) params.set("category", query.category.trim());
  if (query.page && query.page > 1) params.set("page", String(query.page));

  const search = params.toString();
  return search ? `${BOOKS_PATH}?${search}` : BOOKS_PATH;
}
