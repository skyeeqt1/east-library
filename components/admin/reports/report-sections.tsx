import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Server-renderable building blocks for the `/admin/reports` sections
 * (Phase 8b, prd.md FR-23): a titled section, a designed empty state and a
 * horizontal bar list — the report's chart primitive.
 *
 * Deliberately **not** a client component and deliberately **not** a chart
 * library: package.json ships no recharts/d3, every number here is already
 * exact text, and the bars are proportional CSS widths (aria-hidden) so
 * screen readers get the values, not a canvas. Everything stays server
 * rendered — zero JS on the reports page beyond the tab row.
 */

/* ------------------------------------------------------------------ */
/* Section                                                             */
/* ------------------------------------------------------------------ */

export interface ReportSectionProps {
  /** Stable id — the heading renders as `${id}-heading`. */
  id: string;
  title: string;
  /** Optional caption under the heading (what the numbers mean). */
  description?: string;
  children: ReactNode;
}

/**
 * A titled report section — `aria-labelledby` heading (design §7) with the
 * caption treatment used across the admin pages.
 */
export function ReportSection({
  id,
  title,
  description,
  children,
}: ReportSectionProps) {
  return (
    <section aria-labelledby={`${id}-heading`}>
      <div className="mb-4">
        <h2
          id={`${id}-heading`}
          className="text-lg font-semibold text-gray-900"
        >
          {title}
        </h2>
        {description ? (
          <p className="mt-1 text-sm text-gray-500">{description}</p>
        ) : null}
      </div>

      {children}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Empty state (design §4.7 — icon + title + description)              */
/* ------------------------------------------------------------------ */

export interface ReportEmptyStateProps {
  icon: LucideIcon;
  title: string;
  body: string;
}

/**
 * The dashed empty box every report section falls back to when its data
 * set is empty — a fresh install (all business tables at 0) renders a
 * composed page instead of a blank card. Same visual language as the
 * penalties page's empty state.
 */
export function ReportEmptyState({
  icon: Icon,
  title,
  body,
}: ReportEmptyStateProps) {
  return (
    <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-6 py-10 text-center">
      <span
        className="mx-auto flex size-11 items-center justify-center rounded-full bg-white text-primary-500 shadow-xs"
        aria-hidden="true"
      >
        <Icon className="size-5" strokeWidth={1.75} />
      </span>
      <p className="mt-4 text-base font-semibold text-gray-900">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-gray-500">{body}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Bar list — the trend / ranking chart (no chart library)             */
/* ------------------------------------------------------------------ */

export interface ReportBarRow {
  /** Left label — a Manila day (`2026-10-05`) or a category name. */
  label: string;
  /** Optional second line under the label (e.g. "12 titles · 30 copies"). */
  sublabel?: string;
  /** Right-aligned formatted value (`3`, `42 copies`). */
  value: string;
  /** Magnitude driving the bar width — 0 renders an empty track. */
  count: number;
}

export interface ReportBarListProps {
  rows: ReportBarRow[];
  /** Accessible name for the list (what the bars represent). */
  ariaLabel: string;
  className?: string;
}

/**
 * Horizontal bar list: label (→ sublabel) · proportional track · value.
 *
 * - the fill width is `count / max × 100%` (CSS only, `aria-hidden`), so
 *   the *text* is the accessible data and the bar is decoration — no
 *   canvas/SVG for assistive tech to miss;
 * - every row is a list item, so VoiceOver/NVDA read "Oct 5, 3" as data;
 * - the track stays visible at 0, keeping the rows visually aligned when
 *   most values are zero (the fresh-install baseline).
 *
 * Rows are sorted by the caller (chronological for trends, descending for
 * rankings).
 */
export function ReportBarList({
  rows,
  ariaLabel,
  className,
}: ReportBarListProps) {
  const max = rows.reduce((peak, row) => Math.max(peak, row.count), 0);

  return (
    <ul
      aria-label={ariaLabel}
      className={cn("flex flex-col gap-1.5", className)}
    >
      {rows.map((row, index) => {
        const width = max > 0 && row.count > 0 ? (row.count / max) * 100 : 0;
        return (
          <li key={`${row.label}-${index}`} className="flex items-center gap-3">
            <div className="w-28 shrink-0 min-w-0 sm:w-40">
              <span className="block truncate text-xs font-medium text-gray-700">
                {row.label}
              </span>
              {row.sublabel ? (
                <span className="block truncate text-[11px] text-gray-500">
                  {row.sublabel}
                </span>
              ) : null}
            </div>

            <div className="h-2.5 min-w-[48px] flex-1 overflow-hidden rounded-full bg-gray-100">
              <div
                className="h-full rounded-full bg-primary-500"
                style={{ width: `${width}%` }}
                aria-hidden="true"
              />
            </div>

            <span className="w-14 shrink-0 text-right text-xs font-medium tabular-nums text-gray-900">
              {row.value}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/* Shared formatting                                                   */
/* ------------------------------------------------------------------ */

/** Cached — one formatter instance for every day label on the page. */
const dayLabelFormatter = new Intl.DateTimeFormat("en-PH", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

/**
 * `"2026-10-05"` → `"Oct 5"` for a bar-list day label. Parsed at UTC
 * midnight (R-30 date-string maths) so no server timezone can shift the
 * label a day either way.
 */
export function formatDayLabel(date: string): string {
  const ms = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(ms)) return date;
  return dayLabelFormatter.format(ms);
}
