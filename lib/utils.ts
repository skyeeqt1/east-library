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
