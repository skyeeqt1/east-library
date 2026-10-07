"use client";

import { useEffect } from "react";
import { CircleAlert, CircleCheck, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ToastProps {
  tone?: "success" | "error";
  message: string;
  onClose: () => void;
  /** Auto-dismiss delay (design §4.7: 360ms in, ~4s visible). */
  durationMs?: number;
}

const TONE = {
  success: {
    icon: CircleCheck,
    classes:
      "border-success-500/30 bg-success-25 text-success-700",
    iconClass: "text-success-500",
  },
  error: {
    icon: CircleAlert,
    classes: "border-error-500/30 bg-error-25 text-error-700",
    iconClass: "text-error-500",
  },
} as const;

/**
 * Toast — design §4.7: bottom-right, success/error variant, auto-dismiss.
 * Announced politely (`role="status"`), dismissible with an explicit button.
 */
export function Toast({
  tone = "success",
  message,
  onClose,
  durationMs = 4000,
}: ToastProps) {
  const { icon: Icon, classes, iconClass } = TONE[tone];

  useEffect(() => {
    const timer = setTimeout(onClose, durationMs);
    return () => clearTimeout(timer);
  }, [onClose, durationMs, message]);

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "escr-modal-in fixed bottom-4 right-4 z-[60] flex w-[360px] max-w-[calc(100vw-2rem)] items-start gap-3 rounded-lg border px-4 py-3 shadow-lg",
        classes,
      )}
    >
      <Icon className={cn("mt-0.5 size-5 shrink-0", iconClass)} aria-hidden="true" />
      <p className="flex-1 text-sm font-medium">{message}</p>
      <button
        type="button"
        onClick={onClose}
        aria-label="Dismiss notification"
        className="-m-1 flex size-8 shrink-0 items-center justify-center rounded-md transition-colors duration-fast hover:bg-white/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}
