import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BookOpen } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/ui/stat-card";
import {
  PrimaryCell,
  Table,
  TableBody,
  Td,
  Th,
  TableHead,
  Tr,
} from "@/components/ui/table";
import { CreateBookButton } from "@/components/admin/books/create-book-button";
import { EditBookButton } from "@/components/admin/books/edit-book-button";
import { BooksPagination } from "@/components/admin/books/books-pagination";
import { BooksToolbar } from "@/components/admin/books/books-toolbar";
import {
  BOOKS_PER_PAGE,
  buildBooksPath,
  parseBooksQuery,
} from "@/components/admin/books/books-query";
import {
  getBooksWithAvailability,
  getCatalogStats,
  getDistinctCategories,
  type CatalogPage,
  type CatalogStats,
} from "@/lib/catalog/availability";
import { getCurrentProfile } from "@/lib/auth/guards";
import { cn, formatPeso } from "@/lib/utils";

export const metadata: Metadata = { title: "Books & Inventory" };

/** Session cookie + searchParams are read per request — blocking route. */
export const instant = false;

type SearchParams = Promise<{
  q?: string | string[];
  category?: string | string[];
  page?: string | string[];
}>;

/** Everything the page renders, loaded together (one failed read = error UI). */
interface LoadedCatalog {
  stats: CatalogStats;
  catalog: CatalogPage;
  categories: string[];
}

/** Up to two title initials for the cover fallback block (design §8). */
function titleInitials(title: string): string {
  const words = title.trim().split(/\s+/).filter((word) => word.length > 0);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0].charAt(0) + words[1].charAt(0)).toUpperCase();
}

/**
 * Admin → Books & Inventory (FR-07 / FR-08, rules.md §3 — R-07/R-08).
 *
 * Server component reading `searchParams` (q, category, page) and querying
 * through the **cookie-aware anon client** — RLS lets an admin read the whole
 * catalog while every write stays inside the guarded server actions
 * (`lib/admin/book-actions.ts`). Availability is always derived from
 * `book_copies.status` (R-07), never a stored counter.
 */
export default async function AdminBooksPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { q, category, page } = parseBooksQuery(await searchParams);
  const filtering = q.length > 0 || category.length > 0;

  const me = await getCurrentProfile();
  if (!me) redirect("/login");

  let data: LoadedCatalog | null = null;
  try {
    const [stats, catalog, categories] = await Promise.all([
      getCatalogStats(),
      getBooksWithAvailability({
        query: q || undefined,
        category: category || undefined,
        page,
        perPage: BOOKS_PER_PAGE,
      }),
      getDistinctCategories(),
    ]);
    data = { stats, catalog, categories };
  } catch {
    data = null; // surface a readable error instead of an empty catalog
  }

  const rows = data?.catalog.rows ?? [];
  const pageCount = Math.max(
    1,
    Math.ceil((data?.catalog.total ?? 0) / (data?.catalog.perPage ?? BOOKS_PER_PAGE)),
  );
  const onCurrentPage = page > pageCount;

  return (
    <AppShell
      title="Books & Inventory"
      navVariant="admin"
      user={{ name: me.full_name, id: me.student_id ?? "LIBRARIAN" }}
      actions={<CreateBookButton categories={data?.categories ?? []} />}
    >
      <div className="flex flex-col gap-6">
        {data === null ? (
          <div
            role="alert"
            className="rounded-lg border border-error-500 bg-error-25 px-6 py-10 text-center"
          >
            <p className="text-sm font-medium text-error-700">
              Could not load the catalog.
            </p>
            <p className="mt-1 text-sm text-error-700">
              Please try again in a moment.
            </p>
          </div>
        ) : (
          <>
            {/* Stat strip — real aggregates from getCatalogStats() (design §4.2) */}
            <section
              aria-label="Catalog metrics"
              className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4"
            >
              <StatCard
                title="Total titles"
                value={data.stats.totalTitles}
                data={[]}
              />
              <StatCard
                title="Total copies"
                value={data.stats.totalCopies}
                data={[]}
              />
              <StatCard
                title="Copies available"
                value={data.stats.availableCopies}
                data={[]}
              />
              <StatCard
                title="Copies on loan"
                value={data.stats.onLoanCopies}
                data={[]}
              />
            </section>

            {/* Toolbar: GET search + category filter pills (design §4.3/§4.4) */}
            <BooksToolbar
              q={q}
              category={category}
              categories={data.categories}
            />

            {rows.length === 0 ? (
              <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-6 py-12 text-center">
                <span
                  className="mx-auto flex size-11 items-center justify-center rounded-full bg-white text-primary-500 shadow-xs"
                  aria-hidden="true"
                >
                  <BookOpen className="size-5" strokeWidth={1.75} />
                </span>
                <p className="mt-4 text-base font-semibold text-gray-900">
                  {onCurrentPage
                    ? "Nothing on this page."
                    : filtering
                      ? "No books match your search."
                      : "No books in the catalog yet — add the first book."}
                </p>
                <p className="mx-auto mt-1 max-w-md text-sm text-gray-500">
                  {onCurrentPage
                    ? "Return to the first page to see the remaining books."
                    : filtering
                      ? "Try a different title, author or ISBN — or pick another category."
                      : "Each title starts with its physical copies — availability is counted per copy."}
                </p>
                {onCurrentPage || filtering ? (
                  <Button
                    variant="secondary"
                    size="md"
                    href={buildBooksPath(
                      onCurrentPage ? { q, category, page: 1 } : {},
                    )}
                    className="mt-4"
                  >
                    {onCurrentPage ? "Back to first page" : "Clear filters"}
                  </Button>
                ) : (
                  <div className="mt-4 flex justify-center">
                    <CreateBookButton categories={data.categories} />
                  </div>
                )}
              </div>
            ) : (
              <Table
                minWidth={1040}
                footer={
                  <BooksPagination
                    page={page}
                    pageCount={pageCount}
                    q={q}
                    category={category}
                  />
                }
              >
                <TableHead>
                  <Th className="w-16">Cover</Th>
                  <Th>Title</Th>
                  <Th>ISBN</Th>
                  <Th>Category</Th>
                  <Th>Shelf</Th>
                  <Th>Copies</Th>
                  <Th className="text-right">Replacement ₱</Th>
                  <Th className="text-right">Actions</Th>
                </TableHead>
                <TableBody>
                  {rows.map((row) => (
                    <Tr key={row.id}>
                      <Td>
                        {row.cover_url ? (
                          // cover_url is a storage path or an arbitrary URL —
                          // next/image would need a configured domain per host.
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={row.cover_url}
                            alt=""
                            width={40}
                            height={56}
                            loading="lazy"
                            className="h-14 w-10 rounded-sm border border-gray-200 bg-gray-100 object-cover"
                          />
                        ) : (
                          <span
                            aria-hidden="true"
                            className="flex h-14 w-10 items-center justify-center rounded-sm bg-gray-100 text-sm font-semibold text-primary-700"
                          >
                            {titleInitials(row.title)}
                          </span>
                        )}
                      </Td>
                      <Td className="min-w-56">
                        <PrimaryCell
                          primary={row.title}
                          secondary={row.author}
                        />
                      </Td>
                      <Td className="font-mono text-xs font-medium text-gray-900">
                        {row.isbn ?? "—"}
                      </Td>
                      <Td>
                        {row.category ? (
                          <Badge tone="gray">{row.category}</Badge>
                        ) : (
                          <span className="text-gray-500">—</span>
                        )}
                      </Td>
                      <Td className="font-mono text-xs font-medium text-gray-900">
                        {row.shelf_code ?? "—"}
                      </Td>
                      <Td className="whitespace-nowrap">
                        {/* R-07: green while at least one copy is free. */}
                        <span
                          className={cn(
                            "text-sm font-medium",
                            row.available_copies > 0
                              ? "text-success-700"
                              : "text-error-700",
                          )}
                        >
                          {row.available_copies} / {row.total_copies} available
                        </span>
                      </Td>
                      <Td className="whitespace-nowrap text-right font-mono text-xs font-medium text-gray-900">
                        {formatPeso(row.replacement_value_centavos)}
                      </Td>
                      <Td>
                        <div className="flex items-center justify-end">
                          <EditBookButton
                            book={{
                              id: row.id,
                              title: row.title,
                              author: row.author,
                              isbn: row.isbn,
                              category: row.category,
                              shelf_code: row.shelf_code,
                              cover_url: row.cover_url,
                              replacement_value_centavos:
                                row.replacement_value_centavos,
                              total_copies: row.total_copies,
                              available_copies: row.available_copies,
                            }}
                          />
                        </div>
                      </Td>
                    </Tr>
                  ))}
                </TableBody>
              </Table>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
