"use client";

import { useRouter } from "next/navigation";
import { TableFooter } from "@/components/ui/table-footer";
import type {
  ActivityStatus,
  ActivityTab,
} from "@/lib/catalog/activity-types";
import {
  DASHBOARD_PER_PAGE,
  buildDashboardPath,
} from "@/components/admin/dashboard/dashboard-query";

export interface DashboardPaginationProps {
  page: number;
  pageCount: number;
  tab: ActivityTab;
  status: ActivityStatus;
  q: string;
}

/**
 * Table footer (design §4.4) bound to the URL: Previous/Next replace the
 * `page` param — keeping `tab`, `status` and `q` — so the server component
 * re-queries the next slice of the merged activity feed (10/page).
 * Rows-per-page stays fixed at 10, so the select is rendered disabled
 * (no `onPerPageChange`) — same contract as `LoansPagination`.
 */
export function DashboardPagination({
  page,
  pageCount,
  tab,
  status,
  q,
}: DashboardPaginationProps) {
  const router = useRouter();

  return (
    <TableFooter
      page={page}
      pageCount={pageCount}
      perPage={DASHBOARD_PER_PAGE}
      onPageChange={(next) => {
        router.replace(buildDashboardPath({ tab, status, q, page: next }));
      }}
    />
  );
}
