"use client";

import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Tabs } from "@/components/ui/tabs";
import {
  buildStudentsPath,
  type StatusFilter,
} from "@/components/admin/students/students-query";

export interface StudentsToolbarProps {
  q: string;
  status: StatusFilter;
  counts: { all: number; active: number; blocked: number };
}

/**
 * Search + status filter pills (design §4.3 / §4.4).
 *
 * State lives in the URL: every change does a `router.replace` with a page
 * reset, so the server component re-queries Supabase and the shareable URL
 * stays true. The search box is uncontrolled and keyed by `q` so it picks up
 * external URL changes (back/forward, pill clicks) without an effect.
 */
export function StudentsToolbar({ q, status, counts }: StudentsToolbarProps) {
  const router = useRouter();

  const go = (next: { q: string; status: StatusFilter }) => {
    router.replace(buildStudentsPath({ ...next, page: 1 }));
  };

  const handleSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = String(new FormData(event.currentTarget).get("q") ?? "");
    go({ q: value.trim(), status });
  };

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
      <form
        role="search"
        aria-label="Search students"
        onSubmit={handleSearch}
        className="w-full lg:max-w-sm"
      >
        <Input
          key={q}
          name="q"
          type="search"
          defaultValue={q}
          placeholder="Search name, student ID, or course…"
          aria-label="Search students"
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

      <Tabs
        aria-label="Filter students by status"
        activeId={status}
        onChange={(id) => go({ q, status: id as StatusFilter })}
        tabs={[
          { id: "ALL", label: "All", count: counts.all },
          { id: "ACTIVE", label: "Active", count: counts.active },
          { id: "BLOCKED", label: "Blocked", count: counts.blocked },
        ]}
      />
    </div>
  );
}
