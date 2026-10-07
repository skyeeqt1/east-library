import type {
  HTMLAttributes,
  ReactNode,
  TdHTMLAttributes,
  ThHTMLAttributes,
} from "react";
import { cn } from "@/lib/utils";

// Client component (interactive pagination) — re-exported for convenience.
export { TableFooter, type TableFooterProps } from "@/components/ui/table-footer";

/* ------------------------------------------------------------------ */
/* Wrapper — radius-lg, 1px border, overflow hidden (design §4.4)       */
/* ------------------------------------------------------------------ */

export interface TableProps extends HTMLAttributes<HTMLDivElement> {
  /** Minimum width before horizontal scroll kicks in (<768px). */
  minWidth?: number;
  /** Pagination bar rendered inside the wrapper, below the scroll area. */
  footer?: ReactNode;
  children: ReactNode;
}

export function Table({
  minWidth = 720,
  footer,
  children,
  className,
  ...rest
}: TableProps) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xs",
        className,
      )}
      {...rest}
    >
      <div className="overflow-x-auto">
        <table
          className="w-full border-collapse text-sm"
          style={{ minWidth: `${minWidth}px` }}
        >
          {children}
        </table>
      </div>
      {footer}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Header — 44px, gray-50 bg, 12px/500 gray-500                        */
/* ------------------------------------------------------------------ */

export function TableHead({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <thead className={cn("bg-gray-50", className)}>
      <tr className="h-11">{children}</tr>
    </thead>
  );
}

export type ThProps = ThHTMLAttributes<HTMLTableCellElement>;

/** Column header cell — always `scope="col"` for screen readers (design §7). */
export function Th({ children, className, ...rest }: ThProps) {
  return (
    <th
      scope="col"
      className={cn(
        "px-6 text-left text-xs font-medium uppercase tracking-wide text-gray-500",
        className,
      )}
      {...rest}
    >
      {children}
    </th>
  );
}

/** Checkbox gutter column — 44px (design §4.4). */
export function ThCheckbox({ className, ...rest }: ThProps) {
  return <Th className={cn("w-11 px-4", className)} {...rest} />;
}

/* ------------------------------------------------------------------ */
/* Body / rows — 60px min, bottom border gray-100, hover gray-25       */
/* ------------------------------------------------------------------ */

export function TableBody({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <tbody className={className}>{children}</tbody>;
}

export type TrProps = HTMLAttributes<HTMLTableRowElement>;

export function Tr({ children, className, ...rest }: TrProps) {
  return (
    <tr
      className={cn(
        "h-15 border-b border-gray-100 transition-colors duration-fast last:border-b-0 hover:bg-gray-25",
        className,
      )}
      {...rest}
    >
      {children}
    </tr>
  );
}

export type TdProps = TdHTMLAttributes<HTMLTableCellElement>;

export function Td({ children, className, ...rest }: TdProps) {
  return (
    <td
      className={cn("px-6 py-4 align-middle text-sm text-gray-700", className)}
      {...rest}
    >
      {children}
    </td>
  );
}

export function TdCheckbox({ className, ...rest }: TdProps) {
  return <Td className={cn("w-11 px-4", className)} {...rest} />;
}

/**
 * Primary cell — gray-900 500 title with an optional 12px gray-500
 * secondary line (design §4.4).
 */
export function PrimaryCell({
  primary,
  secondary,
  className,
}: {
  primary: ReactNode;
  secondary?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col", className)}>
      <span className="truncate text-sm font-medium text-gray-900">
        {primary}
      </span>
      {secondary ? (
        <span className="mt-0.5 truncate text-xs text-gray-500">
          {secondary}
        </span>
      ) : null}
    </div>
  );
}
