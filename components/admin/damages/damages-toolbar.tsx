"use client";

import { useRouter } from "next/navigation";
import { Tabs } from "@/components/ui/tabs";
import {
  buildDamagesPath,
  type DamagesStatusFilter,
} from "@/components/admin/damages/damages-query";

/**
 * Status pills for the damage desk (design §4.3): Pending · Resolved · All.
 * State lives in the URL — every switch resets `page` so the server component
 * re-queries `getDamageReports()` with the matching filter.
 *
 * The Pending tab additionally carries the "Awaiting assessment" queue (loans
 * returned as DAMAGED with no report yet) — that block is server-rendered by
 * the page, not counted here, so the pills stay report-only counters.
 */
export function DamagesTabs({ status }: { status: DamagesStatusFilter }) {
  const router = useRouter();

  return (
    <Tabs
      aria-label="Filter damage reports by status"
      activeId={status}
      onChange={(id) => {
        router.replace(buildDamagesPath({ status: id as DamagesStatusFilter, page: 1 }));
      }}
      tabs={[
        { id: "pending", label: "Pending" },
        { id: "resolved", label: "Resolved" },
        { id: "all", label: "All" },
      ]}
    />
  );
}
