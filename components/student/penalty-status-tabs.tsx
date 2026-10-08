"use client";

import { useRouter } from "next/navigation";
import { Tabs } from "@/components/ui/tabs";
import {
  buildStudentPenaltiesPath,
  type StudentPenaltiesFilter,
} from "@/components/student/penalties-query";

/**
 * Status pills for "My Penalties" (design §6 statement list): **Unpaid**
 * (the live balance, newest first) · **History** (paid + waived — what has
 * already been settled or forgiven). State lives in the URL — each switch
 * resets `page` so the server component re-queries the matching set.
 */
export function PenaltyStatusTabs({
  status,
}: {
  status: StudentPenaltiesFilter;
}) {
  const router = useRouter();

  const go = (next: StudentPenaltiesFilter) => {
    router.replace(buildStudentPenaltiesPath({ status: next, page: 1 }));
  };

  return (
    <Tabs
      aria-label="Filter my penalties by status"
      activeId={status}
      onChange={(id) => go(id as StudentPenaltiesFilter)}
      tabs={[
        { id: "unpaid", label: "Unpaid" },
        { id: "history", label: "History" },
      ]}
    />
  );
}
