"use client";

import { useId, useState, type InputHTMLAttributes, type ReactNode } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input, Label } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface PasswordFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "className"> {
  /** Visible label text. */
  label: string;
  /** Error message; when present it replaces the helper text. */
  error?: string;
  /** 12px gray-500 helper text, shown when there is no error. */
  helper?: string;
  required?: boolean;
  /** Wrapper class (label + input + message). */
  className?: string;
  /** Extra control(s) rendered before the show/hide toggle (e.g. Generate). */
  trailing?: ReactNode;
  /** Class for the `<input>` itself (e.g. extra right padding). */
  inputClassName?: string;
}

/**
 * Password input — design §4.6 field layout with a mandatory show/hide
 * toggle (a11y: the toggle is a labelled, `aria-pressed` button; the value is
 * never otherwise exposed).
 */
export function PasswordField({
  label,
  error,
  helper,
  required,
  className,
  trailing,
  inputClassName,
  id,
  ...inputProps
}: PasswordFieldProps) {
  const autoId = useId();
  const inputId = id ?? `password-${autoId}`;
  const errorId = `${inputId}-error`;
  const helperId = `${inputId}-helper`;
  const [visible, setVisible] = useState(false);
  const describedBy = error ? errorId : helper ? helperId : undefined;

  return (
    <div className={className}>
      <Label htmlFor={inputId} required={required}>
        {label}
      </Label>
      <div className="mt-2">
        <Input
          id={inputId}
          type={visible ? "text" : "password"}
          error={Boolean(error)}
          aria-describedby={describedBy}
          required={required}
          className={cn(trailing ? "pr-28" : "pr-11", inputClassName)}
          trailing={
            <div className="flex items-center gap-0.5">
              {trailing}
              <button
                type="button"
                onClick={() => setVisible((current) => !current)}
                aria-label={visible ? "Hide password" : "Show password"}
                aria-pressed={visible}
                className="flex size-9 items-center justify-center rounded-md text-gray-500 transition-colors duration-fast hover:text-gray-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
              >
                {visible ? (
                  <EyeOff className="size-4" aria-hidden="true" />
                ) : (
                  <Eye className="size-4" aria-hidden="true" />
                )}
              </button>
            </div>
          }
          {...inputProps}
        />
      </div>
      {error ? (
        <p id={errorId} className="mt-2 text-xs text-error-500">
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
