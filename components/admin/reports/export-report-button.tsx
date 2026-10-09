import { Download } from "lucide-react";
import { cn } from "@/lib/utils";

/** The CSV route (app/(admin)/admin/reports/export/route.ts). */
export const REPORT_EXPORT_PATH = "/admin/reports/export";

export interface ExportReportButtonProps {
  /** Visible label — doubles as the link's accessible name. */
  label?: string;
  className?: string;
}

/**
 * "Export report" / "Export CSV" action (prd.md FR-23, L67 "CSV/print
 * export").
 *
 * A plain `<a href download>`, **not** `next/link`: a file download is a
 * navigation with a `Content-Disposition: attachment` response, so Link
 * would only add prefetch machinery for a CSV — and could never stream the
 * body as a preview. The `download` hint names the file client-side while
 * the route handler still owns the real `filename`, so right-click → "Save
 * link as…" works too.
 *
 * The classes mirror `Button` primary / size `md` (components/ui/button.tsx)
 * so the action matches the dashboard header's visual weight; the visible
 * label is the accessible name, and the icon is decorative.
 */
export function ExportReportButton({
  label = "Export report",
  className,
}: ExportReportButtonProps) {
  return (
    <a
      href={REPORT_EXPORT_PATH}
      download
      className={cn(
        "inline-flex h-10 select-none items-center justify-center gap-2 whitespace-nowrap rounded-md px-4 text-sm font-medium",
        "transition-[background-color,transform,box-shadow] duration-fast ease-standard",
        // Focus: visible 2px primary-500 ring, 2px offset (design §7).
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500",
        // Button primary variant (kept in sync by hand — see the doc above).
        "bg-primary-500 text-white shadow-xs hover:bg-primary-600 hover:-translate-y-px active:translate-y-0 active:bg-primary-700",
        className,
      )}
    >
      <Download className="size-4" aria-hidden="true" />
      {label}
    </a>
  );
}
