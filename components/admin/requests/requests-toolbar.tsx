"use client";

import { useRouter } from "next/navigation";
import { Tabs } from "@/components/ui/tabs";
import {
  buildRequestsPath,
  type RequestsStatusFilter,
} from "@/components/admin/requests/requests-query";

export interface RequestsToolbarProps {
  status: RequestsStatusFilter;
  /** Live tab counters from `getRequestCounts()` — design §4.3 "Pending (12)". */
  counts: { pending: number; approved: number; declined: number; total: number };
}

/**
 * Status tab pills for the borrow-request queue (design §4.3 / §5).
 *
 * State lives in the URL: every switch does a `router.replace` with a page
 * reset, so the server component re-queries Supabase (pending queue vs the
 * decision feed) and the shareable URL stays true.
 */
export function RequestsToolbar({ status, counts }: RequestsToolbarProps) {
  const router = useRouter();

  const go = (next: RequestsStatusFilter) => {
    router.replace(buildRequestsPath({ status: next, page: 1 }));
  };

  return (
    <Tabs
      aria-label="Filter borrow requests by status"
      activeId={status}
      onChange={(id) => go(id as RequestsStatusFilter)}
      tabs={[
        { id: "pending", label: "Pending", count: counts.pending },
        { id: "approved", label: "Approved", count: counts.approved },
        { id: "declined", label: "Declined", count: counts.declined },
        { id: "all", label: "All", count: counts.total },
      ]}
    />
  );
}
