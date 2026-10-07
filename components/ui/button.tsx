import type { ButtonHTMLAttributes } from "react";
import Link from "next/link";
import { LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** sm 32px · md 40px · lg 44px (default = touch target, design §4.1). */
  size?: ButtonSize;
  /** Shows a spinner and sets aria-busy while a submit is in flight. */
  loading?: boolean;
  /** When set, renders an anchor with identical styling (navigation). */
  href?: string;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    "bg-primary-500 text-white shadow-xs hover:bg-primary-600 hover:-translate-y-px active:translate-y-0 active:bg-primary-700",
  secondary:
    "bg-white border border-gray-300 text-gray-700 shadow-xs hover:bg-gray-50 active:translate-y-0 active:bg-gray-100",
  ghost: "text-gray-700 hover:bg-gray-50",
  danger:
    "bg-error-500 text-white shadow-xs hover:bg-error-700 hover:-translate-y-px active:translate-y-0",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-4 text-sm",
  lg: "h-11 px-4 text-sm",
};

export function Button({
  variant = "primary",
  size = "lg",
  loading = false,
  disabled,
  className,
  children,
  type = "button",
  href,
  ...rest
}: ButtonProps) {
  const classes = cn(
    "inline-flex select-none items-center justify-center gap-2 rounded-md font-medium",
    "transition-[background-color,transform,box-shadow] duration-fast ease-standard",
    // Focus: visible 2px primary-500 ring, 2px offset (design §7).
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500",
    "disabled:pointer-events-none disabled:opacity-50",
    VARIANT_CLASSES[variant],
    SIZE_CLASSES[size],
    className,
  );

  if (href) {
    return (
      <Link href={href} className={classes}>
        {children}
      </Link>
    );
  }

  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={classes}
      {...rest}
    >
      {loading ? (
        <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
      ) : null}
      {children}
    </button>
  );
}
