"use client";

import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Tabs } from "@/components/ui/tabs";
import {
  buildBorrowedPath,
  type BorrowedStatusFilter,
} from "@/components/admin/borrowed/borrowed-query";
import { LOAN_STATUSES } from "@/lib/validations/borrowed";

/** Friendly tab label per `LOAN_STATUSES` value — "ACTIVE" → "Active". */
function tabLabel(status: BorrowedStatusFilter): string {
  return status.charAt(0) + status.slice(1).toLowerCase();
}

/**
 * Status pills for the loans desk (design §4.3), built from `LOAN_STATUSES`:
 * Active · Overdue · Returned. State lives in the URL — every switch resets
 * `page` (and keeps `q`) so the server component re-queries the matching tab.
 */
export function BorrowedTabs({ status }: { status: BorrowedStatusFilter }) {
  const router = useRouter();

  return (
    <Tabs
      aria-label="Filter borrowed books by status"
      activeId={status}
      onChange={(id) => {
        router.replace(buildBorrowedPath({ status: id as BorrowedStatusFilter, page: 1 }));
      }}
      tabs={LOAN_STATUSES.map((value) => ({
        id: value,
        label: tabLabel(value),
      }))}
    />
  );
}

export interface BorrowedSearchProps {
  q: string;
  status: BorrowedStatusFilter;
}

/**
 * Free-text search over the loans table (design §4.4). The server read
 * resolves `q` against student name / number / course, title / author and
 * copy barcode (lib/catalog/borrowed-read.ts), so this form only owns the URL:
 * submit → `router.replace` with `q` and a page reset.
 *
 * Uncontrolled + `key={q}` so back/forward and pill clicks refill the field
 * without an effect (same pattern as StudentsToolbar).
 */
export function BorrowedSearch({ q, status }: BorrowedSearchProps) {
  const router = useRouter();

  const handleSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = String(new FormData(event.currentTarget).get("q") ?? "");
    router.replace(buildBorrowedPath({ q: value.trim(), status, page: 1 }));
  };

  return (
    <form
      role="search"
      aria-label="Search borrowed books"
      onSubmit={handleSearch}
      className="w-full lg:max-w-sm"
    >
      <Input
        key={q}
        name="q"
        type="search"
        defaultValue={q}
        placeholder="Search student, ID, barcode, title or author…"
        aria-label="Search borrowed books"
        autoComplete="off"
        trailing={
          <button
            type="submit"
            aria-label="Submit search"
            className="flex size-9 items-center justify-center rounded-md text-gray-500 transition-colors duration-fast hover:text-gray-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
          >
            <Search className="size-4" aria-hidden="true" />
          </button>
        }
      />
    </form>
  );
}
