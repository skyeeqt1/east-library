"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface TableFooterProps {
  page: number;
  pageCount: number;
  perPage: number;
  /** Page change callback (this component is client-rendered). */
  onPageChange?: (page: number) => void;
  /** Rows-per-page change callback. */
  onPerPageChange?: (perPage: number) => void;
  perPageOptions?: number[];
  className?: string;
}

/**
 * Data table footer — "Page 1 of 10 · 10 per page ▾" left,
 * `Previous / Next` secondary-sm buttons right (design §4.4).
 * Lives in a client module because pagination is interactive.
 */
export function TableFooter({
  page,
  pageCount,
  perPage,
  onPageChange,
  onPerPageChange,
  perPageOptions = [10, 25, 50],
  className,
}: TableFooterProps) {
  const atStart = page <= 1;
  const atEnd = page >= pageCount;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-4 border-t border-gray-200 bg-white px-4 py-3 text-sm text-gray-500",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <span>
          Page {page} of {pageCount}
        </span>
        <span aria-hidden="true">·</span>
        <label className="flex items-center gap-2">
          <span className="sr-only">Rows per page</span>
          <select
            value={perPage}
            onChange={(event) => onPerPageChange?.(Number(event.target.value))}
            className="h-8 rounded-md border border-gray-300 bg-white px-2 text-sm text-gray-700 focus:border-primary-500 focus:outline-none focus:shadow-focus disabled:opacity-50"
            disabled={!onPerPageChange}
          >
            {perPageOptions.map((option) => (
              <option key={option} value={option}>
                {option} per page
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={atStart || !onPageChange}
          onClick={() => onPageChange?.(page - 1)}
          className="inline-flex h-8 items-center gap-1 rounded-md border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 transition-colors duration-fast hover:bg-gray-50 disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          Previous
        </button>
        <button
          type="button"
          disabled={atEnd || !onPageChange}
          onClick={() => onPageChange?.(page + 1)}
          className="inline-flex h-8 items-center gap-1 rounded-md border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 transition-colors duration-fast hover:bg-gray-50 disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
        >
          Next
          <ChevronRight className="size-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
