"use client";

import { Printer } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PrintButtonProps {
  /** Visible label — doubles as the button's accessible name. */
  label?: string;
  className?: string;
}

/**
 * "Print" action — the print half of prd.md FR-23 ("export … (CSV +
 * print)"). Delegates to the browser's own print dialog, which is exactly
 * what a librarian expects: no server round trip, no generated PDF, and the
 * ⌘P / Ctrl+P shortcut works without this button at all.
 *
 * The AppShell chrome (sidebar, hamburger, header actions) carries
 * `print:hidden` so the printout is the report itself, not the navigation
 * (components/layout/app-shell.tsx).
 *
 * Classes mirror `Button` secondary / size `md` (components/ui/button.tsx).
 */
export function PrintButton({ label = "Print", className }: PrintButtonProps) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className={cn(
        "inline-flex h-10 select-none items-center justify-center gap-2 whitespace-nowrap rounded-md px-4 text-sm font-medium",
        "transition-[background-color,transform,box-shadow] duration-fast ease-standard",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500",
        // Button secondary variant (kept in sync by hand).
        "border border-gray-300 bg-white text-gray-700 shadow-xs hover:bg-gray-50 active:translate-y-0 active:bg-gray-100",
        className,
      )}
    >
      <Printer className="size-4" aria-hidden="true" />
      {label}
    </button>
  );
}
