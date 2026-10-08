import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge conditional class names, de-duplicating conflicting Tailwind utilities.
 * Use everywhere instead of raw template strings so component classes can be
 * overridden safely via `className`.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Shared peso formatter (R-29 — money is stored as integer centavos). */
const pesoFormatter = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
});

/**
 * Format integer **centavos** as Philippine peso for the UI — the only place
 * money leaves its integer form (R-29): `formatPeso(123456)` → `₱1,234.56`,
 * `formatPeso(15050)` → `₱150.50`, `formatPeso(0)` → `₱0.00`.
 */
export function formatPeso(centavos: number): string {
  const amount = (Number.isFinite(centavos) ? centavos : 0) / 100;
  const formatted = pesoFormatter.format(amount);
  // A runtime without full ICU data can't render the ₱ sign — fall back to a
  // manual grouping so the R-29 shape (`₱1,234.56`) is preserved either way.
  if (formatted.includes("₱")) return formatted;

  const fallback = Math.abs(amount).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${amount < 0 ? "-" : ""}₱${fallback}`;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** Absolute fallback beyond 30 days — a date reads better than "45 days ago". */
const relativeDateFormatter = new Intl.DateTimeFormat("en-PH", {
  dateStyle: "medium",
  timeZone: "Asia/Manila",
});

/**
 * Format an ISO timestamp as short **relative time** for table/card meta
 * columns — `formatRelativeTime("2026-10-08T06:00:00Z")` → `"2 hours ago"`
 * (design §4.4: relative times like "2 hours ago" in the Requested column).
 *
 * `< 1 min` → "just now", then minutes / hours / days via
 * `Intl.RelativeTimeFormat("en", { numeric: "auto" })` (`-1 day` renders as
 * "yesterday"), and a medium Asia/Manila date beyond 30 days. Invalid or
 * missing input renders as an em dash instead of "Invalid Date".
 */
export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "—";

  const elapsed = Date.now() - then.getTime(); // > 0 = past, < 0 = future
  const magnitude = Math.abs(elapsed);
  if (magnitude < MINUTE_MS) return "just now";

  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (magnitude < HOUR_MS) {
    return formatter.format(-Math.trunc(elapsed / MINUTE_MS), "minute");
  }
  if (magnitude < DAY_MS) {
    return formatter.format(-Math.trunc(elapsed / HOUR_MS), "hour");
  }
  if (magnitude < 30 * DAY_MS) {
    return formatter.format(-Math.trunc(elapsed / DAY_MS), "day");
  }
  return relativeDateFormatter.format(then);
}
