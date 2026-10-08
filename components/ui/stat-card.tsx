import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Sparkline } from "@/components/ui/sparkline";

export interface StatCardProps {
  /** 14px/500 gray-500 header (design §4.2). */
  title: string;
  /**
   * Optional 12px gray-500 line under the title (e.g. the student Due card's
   * "Next: Oct 15" subtitle) — rendered only when provided.
   */
  subtitle?: string;
  /**
   * Big metric — 24–36px/600 gray-900 with −0.02em tracking. Accepts a
   * ReactNode so callers can render an icon or a chip inline (the student
   * dashboard's "Due soon" card passes the design §6 countdown chip).
   */
  value: ReactNode;
  /**
   * Optional token classes for the metric itself (e.g. the student balance
   * card renders `text-success-700` at ₱0.00 and `text-error-700` when money
   * is owed — design §2.1 semantic colors). Defaults to gray-900.
   */
  valueClassName?: string;
  /**
   * Trend vs the previous period: ▲ success-500 / ▼ error-500.
   * `"flat"` renders an en-dash in gray — the zero-baseline state where a
   * percent change would divide by zero (fresh installs, Phase 6 dashboard).
   */
  delta?: { value: string; direction: "up" | "down" | "flat" };
  /** Right-hand caption, e.g. "vs last week". */
  caption?: string;
  /** 7–30 points feeding the sparkline. */
  data: number[];
  /** Optional trailing slot (e.g. a menu button supplied by the page). */
  trailing?: ReactNode;
  className?: string;
}

/**
 * Stat card — design §4.2 (matches the Untitled UI reference):
 * title row → metric + delta → 48px sparkline.
 * Grid: 3 across ≥1024px, 2 across ≥640px, 1 across on mobile (apply on the
 * parent grid: `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6`).
 */
export function StatCard({
  title,
  subtitle,
  value,
  valueClassName,
  delta,
  caption = "vs last week",
  data,
  trailing,
  className,
}: StatCardProps) {
  const isUp = delta?.direction === "up";
  const isDown = delta?.direction === "down";

  return (
    <article
      className={cn(
        "flex min-w-0 flex-col rounded-lg border border-gray-200 bg-white p-6 shadow-xs",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-gray-500">{title}</h3>
          {subtitle ? (
            <p className="mt-1 truncate text-xs text-gray-500">{subtitle}</p>
          ) : null}
        </div>
        {trailing}
      </div>

      <div className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span
          className={cn(
            "text-4xl font-semibold tracking-tight text-gray-900",
            valueClassName,
          )}
        >
          {value}
        </span>
        {delta ? (
          <span
            className={cn(
              "flex items-center gap-1 text-xs font-medium",
              isUp
                ? "text-success-500"
                : isDown
                  ? "text-error-500"
                  : "text-gray-500",
            )}
          >
            <span aria-hidden="true">{isUp ? "▲" : isDown ? "▼" : "–"}</span>
            {/* Direction in words for screen readers (the glyph is hidden). */}
            <span className="sr-only">
              {isUp ? "up" : isDown ? "down" : "no change"}
            </span>
            <span>{delta.value}</span>
          </span>
        ) : null}
        {delta ? <span className="text-xs text-gray-500">{caption}</span> : null}
      </div>

      {/* Sparkline area — omitted entirely when the caller has no trend data
          (e.g. Phase 2 catalog tiles), so the card keeps even padding. */}
      {data.length >= 2 ? (
        <div className="mt-5" aria-hidden="true">
          <Sparkline data={data} />
        </div>
      ) : null}
    </article>
  );
}
