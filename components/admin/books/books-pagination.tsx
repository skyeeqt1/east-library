"use client";

import { useRouter } from "next/navigation";
import { TableFooter } from "@/components/ui/table-footer";
import { BOOKS_PER_PAGE, buildBooksPath } from "@/components/admin/books/books-query";

export interface BooksPaginationProps {
  page: number;
  pageCount: number;
  q: string;
  category: string;
}

/**
 * Table footer (design §4.4) bound to the URL: Previous/Next replace the
 * `page` param — keeping `q` / `category` — so the server component re-queries
 * the next range (25/page).
 */
export function BooksPagination({
  page,
  pageCount,
  q,
  category,
}: BooksPaginationProps) {
  const router = useRouter();

  return (
    <TableFooter
      page={page}
      pageCount={pageCount}
      perPage={BOOKS_PER_PAGE}
      onPageChange={(next) => {
        router.replace(buildBooksPath({ q, category, page: next }));
      }}
    />
  );
}
