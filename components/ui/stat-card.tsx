import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Sparkline } from "@/components/ui/sparkline";

export interface StatCardProps {
  /** 14px/500 gray-500 header (design §4.2). */
  title: string;
  /** Big metric — 24–36px/600 gray-900 with −0.02em tracking. */
  value: string | number;
  /**
   * Optional token classes for the metric itself (e.g. the student balance
   * card renders `text-success-700` at ₱0.00 and `text-error-700` when money
   * is owed — design §2.1 semantic colors). Defaults to gray-900.
   */
  valueClassName?: string;
  /** Trend vs the previous period: ▲ success-500 / ▼ error-500. */
  delta?: { value: string; direction: "up" | "down" };
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
  value,
  valueClassName,
  delta,
  caption = "vs last week",
  data,
  trailing,
  className,
}: StatCardProps) {
  const isUp = delta?.direction === "up";

  return (
    <article
      className={cn(
        "flex min-w-0 flex-col rounded-lg border border-gray-200 bg-white p-6 shadow-xs",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <h3 className="text-sm font-medium text-gray-500">{title}</h3>
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
              isUp ? "text-success-500" : "text-error-500",
            )}
          >
            <span aria-hidden="true">{isUp ? "▲" : "▼"}</span>
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
