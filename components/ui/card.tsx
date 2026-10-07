import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Remove the 24px padding when the card wraps its own padded content. */
  padded?: boolean;
}

/**
 * Card — design §4: white bg, 1px gray-200 border, radius-lg, shadow-xs,
 * 24px padding.
 */
export function Card({ padded = true, className, ...rest }: CardProps) {
  return (
    <div
      className={cn(
        "rounded-lg border border-gray-200 bg-white shadow-xs",
        padded && "p-6",
        className,
      )}
      {...rest}
    />
  );
}
