"use client";

import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";

export interface StudentPaginationProps {
  /** e.g. "/dashboard/catalog" or "/dashboard/requests". */
  basePath: string;
  /** Current query params to preserve (page is appended per target page). */
  query: Record<string, string>;
  page: number;
  pageCount: number;
  /** Accessible name, e.g. "Catalog pagination". */
  label: string;
}

/**
 * Previous / Next pager for the student card pages (design §4.4 footer,
 * adapted: no rows-per-page select — card grids use a fixed page size).
 * State lives in the URL so the server component re-queries the next range.
 */
export function StudentPagination({
  basePath,
  query,
  page,
  pageCount,
  label,
}: StudentPaginationProps) {
  const router = useRouter();

  const buildPath = (target: number): string => {
    const params = new URLSearchParams(query);
    if (target > 1) params.set("page", String(target));
    const search = params.toString();
    return search ? `${basePath}?${search}` : basePath;
  };

  const go = (target: number) => {
    if (target < 1 || target > pageCount || target === page) return;
    router.replace(buildPath(target));
  };

  return (
    <nav
      aria-label={label}
      className="flex flex-wrap items-center justify-between gap-4 text-sm text-gray-500"
    >
      <span>
        Page {page} of {pageCount}
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => go(page - 1)}
          className="inline-flex h-8 items-center gap-1 rounded-md border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 shadow-xs transition-colors duration-fast hover:bg-gray-50 disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          Previous
        </button>
        <button
          type="button"
          disabled={page >= pageCount}
          onClick={() => go(page + 1)}
          className="inline-flex h-8 items-center gap-1 rounded-md border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 shadow-xs transition-colors duration-fast hover:bg-gray-50 disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
        >
          Next
          <ChevronRight className="size-4" aria-hidden="true" />
        </button>
      </div>
    </nav>
  );
}
