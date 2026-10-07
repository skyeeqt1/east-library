"use client";

import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Tabs } from "@/components/ui/tabs";
import { BOOKS_PATH, buildBooksPath } from "@/components/admin/books/books-query";

export interface BooksToolbarProps {
  q: string;
  category: string;
  /** Distinct `books.category` values for the filter pills. */
  categories: string[];
}

/**
 * Search + category filter pills (design §4.3 / §4.4).
 *
 * - The search box is a plain **GET form** (`name="q"`) that also carries the
 *   active category as a hidden field, so submitting it navigates to a clean,
 *   shareable `/admin/books?q=…&category=…` URL (page resets to 1) — no JS
 *   required for the primary path.
 * - The pills are client-side: they `router.replace` the canonical URL built by
 *   `buildBooksPath`, keeping `q` and resetting `page`.
 */
export function BooksToolbar({ q, category, categories }: BooksToolbarProps) {
  const router = useRouter();

  const handleSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = String(new FormData(event.currentTarget).get("q") ?? "");
    router.replace(buildBooksPath({ q: value.trim(), category, page: 1 }));
  };

  const tabs = [
    { id: "ALL", label: "All" },
    ...categories.map((value) => ({ id: value, label: value })),
  ];

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
      <form
        role="search"
        aria-label="Search books"
        method="get"
        action={BOOKS_PATH}
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
          aria-label="Search books"
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
            buildBooksPath({
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
