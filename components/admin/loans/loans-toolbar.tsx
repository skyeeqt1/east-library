"use client";

import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Tabs } from "@/components/ui/tabs";
import {
  buildLoansPath,
  type LoansStatusFilter,
} from "@/components/admin/loans/loans-query";
import { LOAN_STATUSES } from "@/lib/validations/loan";

/** Friendly tab label per `LOAN_STATUSES` value — "ACTIVE" → "Active". */
function tabLabel(status: LoansStatusFilter): string {
  return status.charAt(0) + status.slice(1).toLowerCase();
}

/**
 * Status pills for the loans desk (design §4.3), built from `LOAN_STATUSES`:
 * Active · Overdue · Returned. State lives in the URL — every switch resets
 * `page` (and keeps `q`) so the server component re-queries the matching tab.
 */
export function LoansTabs({ status }: { status: LoansStatusFilter }) {
  const router = useRouter();

  return (
    <Tabs
      aria-label="Filter loans by status"
      activeId={status}
      onChange={(id) => {
        router.replace(buildLoansPath({ status: id as LoansStatusFilter, page: 1 }));
      }}
      tabs={LOAN_STATUSES.map((value) => ({
        id: value,
        label: tabLabel(value),
      }))}
    />
  );
}

export interface LoansSearchProps {
  q: string;
  status: LoansStatusFilter;
}

/**
 * Free-text search over the loans table (design §4.4). The server read
 * resolves `q` against student name / number / course, title / author and
 * copy barcode (lib/catalog/loans-read.ts), so this form only owns the URL:
 * submit → `router.replace` with `q` and a page reset.
 *
 * Uncontrolled + `key={q}` so back/forward and pill clicks refill the field
 * without an effect (same pattern as StudentsToolbar).
 */
export function LoansSearch({ q, status }: LoansSearchProps) {
  const router = useRouter();

  const handleSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = String(new FormData(event.currentTarget).get("q") ?? "");
    router.replace(buildLoansPath({ q: value.trim(), status, page: 1 }));
  };

  return (
    <form
      role="search"
      aria-label="Search loans"
      onSubmit={handleSearch}
      className="w-full lg:max-w-sm"
    >
      <Input
        key={q}
        name="q"
        type="search"
        defaultValue={q}
        placeholder="Search student, ID, barcode, title or author…"
        aria-label="Search loans"
        autoComplete="off"
        trailing={
          <button
            type="submit"
            aria-label="Submit loan search"
            className="flex size-9 items-center justify-center rounded-md text-gray-500 transition-colors duration-fast hover:text-gray-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
          >
            <Search className="size-4" aria-hidden="true" />
          </button>
        }
      />
    </form>
  );
}
