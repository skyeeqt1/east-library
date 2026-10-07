import { useId, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Label — design §4.6: 14px/500 gray-700, 8px gap above the input     */
/* ------------------------------------------------------------------ */

export interface LabelProps {
  htmlFor: string;
  children: ReactNode;
  required?: boolean;
  className?: string;
}

export function Label({ htmlFor, children, required, className }: LabelProps) {
  return (
    <label
      htmlFor={htmlFor}
      className={cn("block text-sm font-medium text-gray-700", className)}
    >
      {children}
      {required ? (
        <span className="ml-0.5 text-error-500" aria-hidden="true">
          *
        </span>
      ) : null}
    </label>
  );
}

/* ------------------------------------------------------------------ */
/* Input — design §4.6                                                 */
/* ------------------------------------------------------------------ */

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Renders an error state (border-error-500 + aria-invalid). */
  error?: boolean;
  /** Optional slot rendered inside the field (e.g. show/hide password). */
  trailing?: ReactNode;
  /**
   * Leading adornment rendered inside the field (e.g. the `₱` money prefix,
   * design §4.6). Purely decorative — screen readers skip it (`aria-hidden`).
   */
  leading?: ReactNode;
}

export function Input({
  error = false,
  trailing,
  leading,
  className,
  ...rest
}: InputProps) {
  return (
    <div className="relative">
      {leading ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-sm text-gray-500"
        >
          {leading}
        </span>
      ) : null}
      <input
        className={cn(
          "block h-10 w-full rounded-md border bg-white px-3.5 text-sm text-gray-900",
          "placeholder:text-gray-500",
          "transition-shadow duration-fast ease-standard",
          "focus:outline-none focus:shadow-focus",
          error
            ? "border-error-500 focus:border-error-500"
            : "border-gray-300 focus:border-primary-500",
          leading ? "pl-9" : null,
          trailing ? "pr-11" : null,
          className,
        )}
        aria-invalid={error ? true : undefined}
        {...rest}
      />
      {trailing ? (
        <div className="absolute inset-y-0 right-0 flex items-center pr-2">
          {trailing}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Field — Label + Input + helper/error text, fully wired for a11y      */
/* ------------------------------------------------------------------ */

export interface FieldProps
  extends Omit<InputProps, "aria-describedby" | "error"> {
  /** Visible label text. */
  label: string;
  /** Error message; when present it replaces the helper text. */
  error?: string;
  /** 12px gray-500 helper text, shown when there is no error. */
  helper?: string;
  required?: boolean;
  className?: string;
}

export function Field({
  label,
  error,
  helper,
  required,
  className,
  id,
  ...inputProps
}: FieldProps) {
  const autoId = useId();
  const inputId = id ?? `field-${autoId}`;
  const errorId = `${inputId}-error`;
  const helperId = `${inputId}-helper`;
  const describedBy = error
    ? errorId
    : helper
      ? helperId
      : undefined;

  return (
    <div className={className}>
      <Label htmlFor={inputId} required={required}>
        {label}
      </Label>
      <div className="mt-2">
        <Input
          id={inputId}
          error={Boolean(error)}
          aria-describedby={describedBy}
          required={required}
          {...inputProps}
        />
      </div>
      {error ? (
        <p id={errorId} aria-live="polite" className="mt-2 text-xs text-error-500">
          {error}
        </p>
      ) : helper ? (
        <p id={helperId} className="mt-2 text-xs text-gray-500">
          {helper}
        </p>
      ) : null}
    </div>
  );
}
