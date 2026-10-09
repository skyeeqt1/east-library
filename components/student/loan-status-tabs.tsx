"use client";

import { useRouter } from "next/navigation";
import { Tabs } from "@/components/ui/tabs";
import {
  buildStudentLoansPath,
  type StudentLoansFilter,
} from "@/components/student/loans-query";

/**
 * Status pills for "My Loans" (design §4.3): **Active & due** (open loans —
 * ACTIVE + OVERDUE) · **History** (RETURNED). State lives in the URL — each
 * switch resets `page` so the server component re-queries the matching set.
 */
export function LoanStatusTabs({
  status,
}: {
  status: StudentLoansFilter;
}) {
  const router = useRouter();

  const go = (next: StudentLoansFilter) => {
    router.replace(buildStudentLoansPath({ status: next, page: 1 }));
  };

  return (
    <Tabs
      aria-label="Filter my borrowed books by status"
      activeId={status}
      onChange={(id) => go(id as StudentLoansFilter)}
      tabs={[
        { id: "open", label: "Active & due" },
        { id: "returned", label: "History" },
      ]}
    />
  );
}
