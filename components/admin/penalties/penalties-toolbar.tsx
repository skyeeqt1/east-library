"use client";

import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Tabs } from "@/components/ui/tabs";
import {
  buildPenaltiesPath,
  type PenaltiesStatusFilter,
  type PenaltiesTypeFilter,
} from "@/components/admin/penalties/penalties-query";

export interface PenaltiesToolbarProps {
  status: PenaltiesStatusFilter;
  type: PenaltiesTypeFilter;
  q: string;
}

/**
 * Status tabs + type filter pills + free-text search for the fines desk
 * (design §4.3 / §4.4).
 *
 * State lives in the URL: every change does a `router.replace` with a page
 * reset, so the server component re-queries `getAdminFines()` and the
 * shareable URL stays true. The search box is uncontrolled and keyed by `q`
 * so it picks up external URL changes (back/forward, pill clicks) without an
 * effect — same pattern as the Loans / Students toolbars.
 */
export function PenaltiesToolbar({ status, type, q }: PenaltiesToolbarProps) {
  const router = useRouter();

  const go = (next: {
    status?: PenaltiesStatusFilter;
    type?: PenaltiesTypeFilter;
    q?: string;
  }) => {
    router.replace(
      buildPenaltiesPath({
        status: next.status ?? status,
        type: next.type ?? type,
        q: next.q ?? q,
        page: 1,
      }),
    );
  };

  const handleSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = String(new FormData(event.currentTarget).get("q") ?? "");
    go({ q: value.trim() });
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Status tabs — All first, then the working sets (Unpaid is the
          default desk view via the URL default, not position) */}
      <Tabs
        aria-label="Filter fines by status"
        activeId={status}
        onChange={(id) => go({ status: id as PenaltiesStatusFilter })}
        tabs={[
          { id: "all", label: "All" },
          { id: "unpaid", label: "Unpaid" },
          { id: "paid", label: "Paid" },
          { id: "waived", label: "Waived" },
        ]}
      />

      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        {/* Type pills — R-18 OVERDUE, R-22 DAMAGE, lost-book charges */}
        <Tabs
          aria-label="Filter fines by type"
          activeId={type}
          onChange={(id) => go({ type: id as PenaltiesTypeFilter })}
          tabs={[
            { id: "all", label: "All types" },
            { id: "OVERDUE", label: "Overdue" },
            { id: "DAMAGE", label: "Damage" },
            { id: "LOST", label: "Lost" },
          ]}
        />

        <form
          role="search"
          aria-label="Search fines"
          onSubmit={handleSearch}
          className="w-full lg:max-w-sm"
        >
          <Input
            key={q}
            name="q"
            type="search"
            defaultValue={q}
            placeholder="Search student, ID, course or title…"
            aria-label="Search fines"
            autoComplete="off"
            trailing={
              <button
                type="submit"
                aria-label="Submit fine search"
                className="flex size-9 items-center justify-center rounded-md text-gray-500 transition-colors duration-fast hover:text-gray-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
              >
                <Search className="size-4" aria-hidden="true" />
              </button>
            }
          />
        </form>
      </div>
    </div>
  );
}
