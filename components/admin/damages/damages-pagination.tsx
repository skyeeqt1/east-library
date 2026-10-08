"use client";

import { useRouter } from "next/navigation";
import { TableFooter } from "@/components/ui/table-footer";
import {
  DAMAGES_PER_PAGE,
  buildDamagesPath,
  type DamagesStatusFilter,
} from "@/components/admin/damages/damages-query";

export interface DamagesPaginationProps {
  page: number;
  pageCount: number;
  status: DamagesStatusFilter;
}

/**
 * Table footer (design §4.4) bound to the URL: Previous/Next replace the
 * `page` param — keeping `status` — so the server component re-queries the
 * next range (25/page). Rows-per-page stays fixed at 25, so the select is
 * rendered disabled (no `onPerPageChange`).
 */
export function DamagesPagination({
  page,
  pageCount,
  status,
}: DamagesPaginationProps) {
  const router = useRouter();

  return (
    <TableFooter
      page={page}
      pageCount={pageCount}
      perPage={DAMAGES_PER_PAGE}
      onPageChange={(next) => {
        router.replace(buildDamagesPath({ status, page: next }));
      }}
    />
  );
}
