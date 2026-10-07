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
