"use client";

import {
  useEffect,
  useRef,
  useSyncExternalStore,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Tabs } from "@/components/ui/tabs";
import type {
  ActivityCounts,
  ActivityStatus,
  ActivityTab,
} from "@/lib/catalog/activity-types";
import {
  buildDashboardPath,
  ACTIVITY_TABS,
  ACTIVITY_STATUSES,
} from "@/components/admin/dashboard/dashboard-query";

/* ------------------------------------------------------------------ */
/* Tab row (design §5.1) — sits above the stat cards                   */
/* ------------------------------------------------------------------ */

/** Friendly tab label per `ActivityTab` — "pending" → "Pending requests". */
const TAB_LABELS: Record<ActivityTab, string> = {
  all: "All activity",
  pending: "Pending requests",
  overdue: "Overdue",
  returns: "Returns",
  fines: "Fines",
};

export interface DashboardTabsProps {
  tab: ActivityTab;
  counts: ActivityCounts;
  /** Kept across tab switches (only `status` resets — see dashboard-query). */
  q: string;
}

/**
 * Activity tab row with live badge counts (design §5.1 / §4.3
 * "Pending requests (12)"). State lives in the URL: every switch resets
 * `status` to `all` and `page` to 1 (a status pill from another tab would
 * otherwise silently filter to nothing) while keeping the active `q`.
 */
export function DashboardTabs({ tab, counts, q }: DashboardTabsProps) {
  const router = useRouter();

  return (
    <Tabs
      aria-label="Activity filters"
      activeId={tab}
      onChange={(id) => {
        router.replace(
          buildDashboardPath({ tab: id as ActivityTab, status: "all", q, page: 1 }),
        );
      }}
      tabs={ACTIVITY_TABS.map((id) => ({
        id,
        label: TAB_LABELS[id],
        count: counts[id],
      }))}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Toolbar (design §5.3) — search + status pills, below the stat cards */
/* ------------------------------------------------------------------ */

/** Status pill labels — "all" → "All statuses", others reuse the pill word. */
const STATUS_LABELS: Record<ActivityStatus, string> = {
  all: "All statuses",
  pending: "Pending",
  active: "Active",
  overdue: "Overdue",
  returned: "Returned",
  unpaid: "Unpaid",
};

/* ------------------------------------------------------------------ */
/* Platform detection for the ⌘K hint                                  */
/* ------------------------------------------------------------------ */

/** The user agent never changes during a session — no re-subscription. */
function subscribeToPlatform(): () => void {
  return () => {};
}

function isMacPlatform(): boolean {
  return /mac|iphone|ipad|ipod/i.test(navigator.userAgent);
}

/**
 * Client-only value read through `useSyncExternalStore` instead of
 * `setState`-in-an-effect (forbidden by React's lint rules): the server
 * snapshot renders the default `⌘K`, and the browser swaps in the real
 * answer right after hydration without a cascade render or a mismatch
 * warning.
 */
function useIsMacPlatform(): boolean {
  return useSyncExternalStore(subscribeToPlatform, isMacPlatform, () => true);
}

export interface DashboardToolbarProps {
  tab: ActivityTab;
  status: ActivityStatus;
  /** Current `q`, also used as the uncontrolled input's `key` so back/
   * forward and pill clicks refill the field without an effect. */
  q: string;
  /** Rows in the (filtered) feed — rendered as a live results count. */
  total: number;
  /** The server capped the feed — disclosed under the toolbar. */
  truncated: boolean;
}

/**
 * Borrow-activity toolbar: free-text search with a `⌘K` hint (design §5.3)
 * on the left, status filter pills + live results count on the right.
 *
 * Every interaction only writes the URL (`router.replace` via
 * `buildDashboardPath`), so the server component re-queries — same pattern
 * as `LoansSearch`. Search submit resets `page` to 1; status pills reset
 * `page` too but keep `tab` + `q`.
 *
 * ⌘K / Ctrl+K focuses the search field from anywhere on the page: the
 * listener skips keystrokes that already originate from a form control
 * (no `preventDefault`, so native inputs keep their own shortcuts) and the
 * `<kbd>` hint flips to "Ctrl K" on non-Mac platforms after hydration.
 */
export function DashboardToolbar({
  tab,
  status,
  q,
  total,
  truncated,
}: DashboardToolbarProps) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const isMac = useIsMacPlatform();

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!event.metaKey && !event.ctrlKey) return;
      if (event.key.toLowerCase() !== "k") return;

      // Never hijack a keystroke inside a form control (native Cmd-K etc).
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        target?.isContentEditable
      ) {
        return;
      }

      event.preventDefault();
      formRef.current
        ?.querySelector<HTMLInputElement>("input")
        ?.focus();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = String(new FormData(event.currentTarget).get("q") ?? "");
    router.replace(buildDashboardPath({ tab, status, q: value.trim(), page: 1 }));
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <form
          ref={formRef}
          role="search"
          aria-label="Search borrow activity"
          onSubmit={handleSearch}
          className="w-full lg:max-w-md"
        >
          <Input
            key={q}
            name="q"
            type="search"
            defaultValue={q}
            placeholder="Search student, ID, title or author…"
            aria-label="Search borrow activity"
            aria-keyshortcuts="Meta+K Control+K"
            autoComplete="off"
            // Room for the ⌘K hint + submit button inside the field.
            className="pr-28"
            trailing={
              <div className="flex items-center gap-1.5">
                <kbd
                  aria-hidden="true"
                  className="pointer-events-none rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[11px] font-medium text-gray-500"
                >
                  {isMac ? "⌘K" : "Ctrl K"}
                </kbd>
                <button
                  type="submit"
                  aria-label="Submit activity search"
                  className="flex size-9 items-center justify-center rounded-md text-gray-500 transition-colors duration-fast hover:text-gray-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
                >
                  <Search className="size-4" aria-hidden="true" />
                </button>
              </div>
            }
          />
        </form>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Tabs
            aria-label="Filter activity by status"
            activeId={status}
            onChange={(id) => {
              router.replace(
                buildDashboardPath({
                  tab,
                  status: id as ActivityStatus,
                  q,
                  page: 1,
                }),
              );
            }}
            tabs={ACTIVITY_STATUSES.map((id) => ({
              id,
              label: STATUS_LABELS[id],
            }))}
          />
          <p aria-live="polite" className="text-sm text-gray-500">
            {total} {total === 1 ? "result" : "results"}
          </p>
        </div>
      </div>

      {truncated ? (
        <p className="text-xs text-gray-500">
          Only the most recent activity is listed here — the tab counts above
          stay exact.
        </p>
      ) : null}
    </div>
  );
}
