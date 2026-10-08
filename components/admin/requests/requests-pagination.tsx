"use client";

import { useRouter } from "next/navigation";
import { TableFooter } from "@/components/ui/table-footer";
import {
  REQUESTS_PER_PAGE,
  buildRequestsPath,
  type RequestsStatusFilter,
} from "@/components/admin/requests/requests-query";

export interface RequestsPaginationProps {
  page: number;
  pageCount: number;
  status: RequestsStatusFilter;
}

/**
 * Table footer (design §4.4) bound to the URL: Previous/Next replace the
 * `page` param — keeping `status` — so the server component re-queries the
 * next range (25/page). Rows-per-page stays fixed at 25, so the select is
 * rendered disabled (no `onPerPageChange`).
 */
export function RequestsPagination({
  page,
  pageCount,
  status,
}: RequestsPaginationProps) {
  const router = useRouter();

  return (
    <TableFooter
      page={page}
      pageCount={pageCount}
      perPage={REQUESTS_PER_PAGE}
      onPageChange={(next) => {
        router.replace(buildRequestsPath({ status, page: next }));
      }}
    />
  );
}
