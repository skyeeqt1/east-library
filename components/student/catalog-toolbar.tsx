"use client";

import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Tabs } from "@/components/ui/tabs";
import {
  CATALOG_PATH,
  buildCatalogPath,
} from "@/components/student/catalog-query";

export interface CatalogToolbarProps {
  q: string;
  category: string;
  /** Distinct `books.category` values for the filter pills. */
  categories: string[];
}

/**
 * Student catalog search + category pills (design §6 — "search + category
 * chips"), the calm twin of `BooksToolbar`:
 *
 * - The search box is a plain **GET form** (`name="q"`) carrying the active
 *   category as a hidden field, so submitting navigates to a clean,
 *   shareable `/dashboard/catalog?q=…&category=…` URL (page resets to 1).
 * - The pills `router.replace` the canonical URL keeping `q`, resetting `page`.
 */
export function CatalogToolbar({ q, category, categories }: CatalogToolbarProps) {
  const router = useRouter();

  const handleSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = String(new FormData(event.currentTarget).get("q") ?? "");
    router.replace(buildCatalogPath({ q: value.trim(), category, page: 1 }));
  };

  const tabs = [
    { id: "ALL", label: "All" },
    ...categories.map((value) => ({ id: value, label: value })),
  ];

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
      <form
        role="search"
        aria-label="Search the catalog"
        method="get"
        action={CATALOG_PATH}
        onSubmit={handleSearch}
        className="w-full lg:max-w-sm"
      >
        {category ? <input type="hidden" name="category" value={category} /> : null}
        <Input
          key={q}
          name="q"
          type="search"
          defaultValue={q}
          placeholder="Search title, author or ISBN…"
          aria-label="Search the catalog"
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
        aria-label="Filter books by category"
        activeId={category === "" ? "ALL" : category}
        onChange={(id) => {
          router.replace(
            buildCatalogPath({
              q,
              category: id === "ALL" ? "" : id,
              page: 1,
            }),
          );
        }}
        tabs={tabs}
      />
    </div>
  );
}
