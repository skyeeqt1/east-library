"use client";

import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Click-to-expand row for My Requests — the summary (cover, title, author,
 * status pill) is always visible; the request's timeline details render only
 * while open (user request: "books only, details on click").
 *
 * The summary is server-rendered `children`-style content (`summary` prop) so
 * book data never hydrates — only the open state does. Full-row button with
 * `aria-expanded` / `aria-controls` for keyboard and screen-reader support.
 */
export function RequestDisclosure({
  summary,
  label,
  children,
}: {
  /** Always-visible row content (cover + title/author + status badge). */
  summary: ReactNode;
  /** Book title — used for the button's accessible name. */
  label: string;
  /** Timeline + actions, rendered only while open. */
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`${open ? "Hide" : "Show"} details for ${label}`}
        className="flex w-full cursor-pointer items-center gap-3 px-4 py-4 text-left transition-colors hover:bg-gray-50 focus-visible:-outline-offset-2 focus-visible:outline-2 focus-visible:outline-primary-500 sm:px-5"
      >
        {summary}
        <ChevronDown
          aria-hidden="true"
          className={cn(
            "size-4 shrink-0 text-gray-400 transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      </button>

      {open ? (
        <div
          id={panelId}
          className="border-t border-gray-100 px-4 pb-5 pt-4 sm:px-5"
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
