"use client";

import { useRouter } from "next/navigation";
import { Tabs } from "@/components/ui/tabs";
import {
  buildStudentRequestsPath,
  type StudentRequestsStatusFilter,
} from "@/components/student/requests-query";

/**
 * Status pills for "My Requests" (design §4.3): All | Pending | Approved |
 * Declined. State lives in the URL — each switch resets `page` so the server
 * component re-queries with the matching R-12 filter.
 */
export function RequestStatusTabs({
  status,
}: {
  status: StudentRequestsStatusFilter;
}) {
  const router = useRouter();

  const go = (next: StudentRequestsStatusFilter) => {
    router.replace(buildStudentRequestsPath({ status: next, page: 1 }));
  };

  return (
    <Tabs
      aria-label="Filter my requests by status"
      activeId={status}
      onChange={(id) => go(id as StudentRequestsStatusFilter)}
      tabs={[
        { id: "all", label: "All" },
        { id: "pending", label: "Pending" },
        { id: "approved", label: "Approved" },
        { id: "declined", label: "Declined" },
      ]}
    />
  );
}
