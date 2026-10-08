"use client";

import { useRouter } from "next/navigation";
import { TableFooter } from "@/components/ui/table-footer";
import {
  LOANS_PER_PAGE,
  buildLoansPath,
  type LoansStatusFilter,
} from "@/components/admin/loans/loans-query";

export interface LoansPaginationProps {
  page: number;
  pageCount: number;
  status: LoansStatusFilter;
  q: string;
}

/**
 * Table footer (design §4.4) bound to the URL: Previous/Next replace the
 * `page` param — keeping `status` and `q` — so the server component re-queries
 * the next range (25/page). Rows-per-page stays fixed at 25, so the select is
 * rendered disabled (no `onPerPageChange`).
 */
export function LoansPagination({
  page,
  pageCount,
  status,
  q,
}: LoansPaginationProps) {
  const router = useRouter();

  return (
    <TableFooter
      page={page}
      pageCount={pageCount}
      perPage={LOANS_PER_PAGE}
      onPageChange={(next) => {
        router.replace(buildLoansPath({ status, q, page: next }));
      }}
    />
  );
}
