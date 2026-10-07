"use client";

import { cn } from "@/lib/utils";

export interface TabItem {
  id: string;
  label: string;
  /** Optional count rendered as "Pending (12)" — design §4.3. */
  count?: number;
}

export interface TabsProps {
  tabs: TabItem[];
  activeId: string;
  /** Omit in static placeholders; real pages pass a client-side setter. */
  onChange?: (id: string) => void;
  "aria-label"?: string;
  className?: string;
}

/**
 * Tabs / filter pills — design §4.3.
 * Container: gray-100. Active pill: white bg + shadow-xs + gray-900 text.
 * Inactive: gray-500. Counts render as "Label (n)".
 *
 * Implemented as a labelled group of toggle buttons (aria-pressed) so it is
 * valid both for tab-like filters (admin dashboard) and filter pills.
 */
export function Tabs({
  tabs,
  activeId,
  onChange,
  "aria-label": ariaLabel = "Filters",
  className,
}: TabsProps) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex max-w-full flex-wrap items-center gap-1 rounded-lg bg-gray-100 p-1",
        className,
      )}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeId;
        return (
          <button
            key={tab.id}
            type="button"
            aria-pressed={isActive}
            onClick={() => onChange?.(tab.id)}
            className={cn(
              "inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-md px-3 text-sm font-medium transition-colors duration-fast ease-standard",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500",
              isActive
                ? "bg-white text-gray-900 shadow-xs"
                : "text-gray-500 hover:text-gray-700",
            )}
          >
            {tab.label}
            {typeof tab.count === "number" ? (
              <span className="text-xs font-medium text-gray-500">
                ({tab.count})
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
