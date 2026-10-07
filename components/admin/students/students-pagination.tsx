"use client";

import { useRouter } from "next/navigation";
import { TableFooter } from "@/components/ui/table-footer";
import {
  STUDENTS_PER_PAGE,
  buildStudentsPath,
  type StatusFilter,
} from "@/components/admin/students/students-query";

export interface StudentsPaginationProps {
  page: number;
  pageCount: number;
  q: string;
  status: StatusFilter;
}

/**
 * Table footer (design §4.4) bound to the URL: Previous/Next replace the
 * `page` param so the server component re-queries the next range (25/page).
 */
export function StudentsPagination({
  page,
  pageCount,
  q,
  status,
}: StudentsPaginationProps) {
  const router = useRouter();

  return (
    <TableFooter
      page={page}
      pageCount={pageCount}
      perPage={STUDENTS_PER_PAGE}
      onPageChange={(next) => {
        router.replace(buildStudentsPath({ q, status, page: next }));
      }}
    />
  );
}
