"use client";

import { useRouter } from "next/navigation";
import { Tabs } from "@/components/ui/tabs";
import {
  buildReportsPath,
  REPORT_TABS,
  type ReportTab,
} from "@/components/admin/reports/reports-query";

/** Friendly tab labels — "circulation" → "Circulation". */
const TAB_LABELS: Record<ReportTab, string> = {
  circulation: "Circulation",
  collections: "Collections",
};

export interface ReportsTabsProps {
  tab: ReportTab;
}

/**
 * Report tab row (design §5.1 — tabs sit directly under the header, above
 * the stat cards). State lives in the URL: every switch calls
 * `router.replace(buildReportsPath(...))`, so the server component re-reads
 * `searchParams` and runs **only the active tab's 3 queries**. Same pattern
 * as `DashboardTabs`.
 */
export function ReportsTabs({ tab }: ReportsTabsProps) {
  const router = useRouter();

  return (
    <Tabs
      aria-label="Report sections"
      activeId={tab}
      onChange={(id) => {
        router.replace(buildReportsPath({ tab: id as ReportTab }));
      }}
      tabs={REPORT_TABS.map((id) => ({ id, label: TAB_LABELS[id] }))}
    />
  );
}
