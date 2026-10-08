"use client";

import { useRouter } from "next/navigation";
import { TableFooter } from "@/components/ui/table-footer";
import {
  PENALTIES_PER_PAGE,
  buildPenaltiesPath,
  type PenaltiesStatusFilter,
  type PenaltiesTypeFilter,
} from "@/components/admin/penalties/penalties-query";

export interface PenaltiesPaginationProps {
  page: number;
  pageCount: number;
  status: PenaltiesStatusFilter;
  type: PenaltiesTypeFilter;
  q: string;
}

/**
 * Table footer (design §4.4) bound to the URL: Previous/Next replace the
 * `page` param — keeping `status`, `type` and `q` — so the server component
 * re-queries the next range (25/page). Rows-per-page stays fixed at 25, so
 * the select is rendered disabled (no `onPerPageChange`).
 */
export function PenaltiesPagination({
  page,
  pageCount,
  status,
  type,
  q,
}: PenaltiesPaginationProps) {
  const router = useRouter();

  return (
    <TableFooter
      page={page}
      pageCount={pageCount}
      perPage={PENALTIES_PER_PAGE}
      onPageChange={(next) => {
        router.replace(buildPenaltiesPath({ status, type, q, page: next }));
      }}
    />
  );
}
