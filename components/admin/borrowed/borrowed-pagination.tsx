"use client";

import { useRouter } from "next/navigation";
import { TableFooter } from "@/components/ui/table-footer";
import {
  BORROWED_PER_PAGE,
  buildBorrowedPath,
  type BorrowedStatusFilter,
} from "@/components/admin/borrowed/borrowed-query";

export interface BorrowedPaginationProps {
  page: number;
  pageCount: number;
  status: BorrowedStatusFilter;
  q: string;
}

/**
 * Table footer (design §4.4) bound to the URL: Previous/Next replace the
 * `page` param — keeping `status` and `q` — so the server component re-queries
 * the next range (25/page). Rows-per-page stays fixed at 25, so the select is
 * rendered disabled (no `onPerPageChange`).
 */
export function BorrowedPagination({
  page,
  pageCount,
  status,
  q,
}: BorrowedPaginationProps) {
  const router = useRouter();

  return (
    <TableFooter
      page={page}
      pageCount={pageCount}
      perPage={BORROWED_PER_PAGE}
      onPageChange={(next) => {
        router.replace(buildBorrowedPath({ status, q, page: next }));
      }}
    />
  );
}
