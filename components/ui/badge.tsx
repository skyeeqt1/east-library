import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/**
 * Badge tones — the status→color map from design.md §2.1, used everywhere.
 */
export type BadgeTone =
  | "warning"
  | "info"
  | "primary"
  | "success"
  | "error"
  | "gray";

const TONE_CLASSES: Record<BadgeTone, string> = {
  warning: "bg-warning-25 text-warning-700",
  info: "bg-info-25 text-info-700",
  primary: "bg-primary-25 text-primary-700",
  success: "bg-success-25 text-success-700",
  error: "bg-error-25 text-error-700",
  gray: "bg-gray-100 text-gray-700",
};

const DOT_CLASSES: Record<BadgeTone, string> = {
  warning: "bg-warning-500",
  info: "bg-info-500",
  primary: "bg-primary-500",
  success: "bg-success-500",
  error: "bg-error-500",
  gray: "bg-gray-500",
};

/**
 * Status → tone mapping (design.md §2.1 table):
 *   Pending/Requested = warning · Approved = info · Active loan = primary
 *   Returned/Paid = success · Overdue/Unpaid = error
 *   Declined/Blocked/Damaged = gray-700
 */
const STATUS_TONES: Record<string, BadgeTone> = {
  pending: "warning",
  requested: "warning",
  approved: "info",
  active: "primary",
  "active loan": "primary",
  returned: "success",
  paid: "success",
  overdue: "error",
  "overdue loan": "error",
  unpaid: "error",
  declined: "gray",
  blocked: "gray",
  damaged: "gray",
  // Common extras kept in the same neutral family:
  cancelled: "gray",
  expired: "gray",
  waived: "gray",
  lost: "gray",
};

/** Resolve any status string (case/space-insensitive) to a badge tone. */
export function toneForStatus(status: string): BadgeTone {
  const normalized = status.trim().toLowerCase();
  return STATUS_TONES[normalized] ?? "gray";
}

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  /** Render the colored status dot (design §4.5). */
  dot?: boolean;
}

/** Status pill — 2px 8px padding, full radius, 12px/500, tinted bg + dot. */
export function Badge({
  tone = "gray",
  dot = true,
  className,
  children,
  ...rest
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium",
        TONE_CLASSES[tone],
        className,
      )}
      {...rest}
    >
      {dot ? (
        <span
          className={cn("size-1.5 shrink-0 rounded-full", DOT_CLASSES[tone])}
          aria-hidden="true"
        />
      ) : null}
      {children}
    </span>
  );
}

export interface StatusPillProps extends Omit<BadgeProps, "tone"> {
  /** Raw status value from the database, e.g. "PENDING", "Overdue", "PAID". */
  status: string;
}

/** Convenience wrapper: Badge pre-wired to the status → color map. */
export function StatusPill({ status, className, ...rest }: StatusPillProps) {
  return (
    <Badge tone={toneForStatus(status)} className={className} {...rest}>
      {status}
    </Badge>
  );
}
