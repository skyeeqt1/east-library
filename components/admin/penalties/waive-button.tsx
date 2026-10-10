"use client";

import { useCallback, useId, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import { waiveFine } from "@/lib/admin/fine-actions";
import {
  FINE_MESSAGES,
  waiveFineSchema,
  type FineType,
} from "@/lib/validations/fine";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Toast } from "@/components/ui/toast";
import { cn, formatPeso } from "@/lib/utils";

/** Serializable slice of an UNPAID row this dialog needs. */
export interface WaivableFine {
  id: string;
  student_name: string;
  student_number: string | null;
  type: FineType;
  /** Integer centavos (R-29) — display only, never editable (R-29/R-31). */
  amount_centavos: number;
}

/** `waiveFineSchema` mirrors the server cap (R-31: the action re-checks it). */
const REASON_MAX = 300;

const TYPE_LABELS: Record<FineType, string> = {
  OVERDUE: "Overdue",
  DAMAGE: "Damage",
  LOST: "Lost book",
};

/**
 * "Waive" action for one UNPAID fine (FR-19 / R-24).
 *
 * Opens the waiver dialog (design §4.7): a warning box — *"Waiving forgives
 * the amount — this is recorded in the audit log."* — plus a **required**
 * written reason (min 3 characters). The inline error comes from the shared
 * `waiveFineSchema` (lib/validations/fine.ts — client-safe), so the message
 * is byte-identical to what the server action rejects with, and the DB
 * `waiver_needs_reason` constraint backstops it (R-24).
 *
 * Confirm runs `waiveFine` (danger button — the amount is forgiven), then
 * toasts "Fine waived." and refreshes the queue. A waiver never touches
 * `amount_centavos`: the row keeps its original amount as history (R-29) and
 * simply stops counting toward the R-27 balance.
 */
export function WaiveButton({ fine }: { fine: WaivableFine }) {
  const router = useRouter();
  const reasonId = useId();

  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<
    { tone: "success" | "error"; message: string } | null
  >(null);

  const closeToast = useCallback(() => setNotice(null), []);

  function handleOpen(): void {
    setReason("");
    setReasonError(undefined);
    setOpen(true);
  }

  function handleClose(): void {
    if (submitting) return;
    setOpen(false);
  }

  function handleReasonChange(event: ChangeEvent<HTMLTextAreaElement>): void {
    setReason(event.target.value.slice(0, REASON_MAX));
    if (reasonError) setReasonError(undefined);
  }

  async function handleSubmit(): Promise<void> {
    // Client-side pre-check with the shared schema so the inline message
    // matches the server exactly (R-31 — the action re-validates anyway).
    const parsed = waiveFineSchema.safeParse({ fineId: fine.id, reason });
    if (!parsed.success) {
      const issue = parsed.error.issues.find((item) =>
        item.path.includes("reason"),
      );
      setReasonError(
        issue?.message ?? "Enter a reason for the waiver (at least 3 characters).",
      );
      return;
    }

    setSubmitting(true);
    try {
      const response = await waiveFine(parsed.data);
      if (response.ok) {
        setOpen(false);
        setNotice({ tone: "success", message: "Fine waived." });
        router.refresh();
      } else if (response.fieldErrors?.reason) {
        setReasonError(response.fieldErrors.reason);
      } else {
        // Exact server text — e.g. FINE_MESSAGES.alreadySettled (E6).
        setNotice({
          tone: "error",
          message: response.error ?? FINE_MESSAGES.waiveFailed,
        });
      }
    } catch {
      // The action redirected (session ended) — navigation is in flight.
    } finally {
      setSubmitting(false);
    }
  }

  const typeLabel = TYPE_LABELS[fine.type];

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        onClick={handleOpen}
        disabled={submitting}
        aria-label={`Waive ${typeLabel.toLowerCase()} fine of ${formatPeso(fine.amount_centavos)} from ${fine.student_name}`}
      >
        Waive
      </Button>

      <Modal
        open={open}
        onClose={handleClose}
        title="Waive fine"
        description={`${fine.student_name} — ${typeLabel} · ${formatPeso(fine.amount_centavos)}`}
        footer={
          <>
            <Button
              variant="secondary"
              size="md"
              onClick={handleClose}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              size="md"
              variant="danger"
              onClick={handleSubmit}
              loading={submitting}
            >
              {submitting ? "Waiving…" : "Waive fine"}
            </Button>
          </>
        }
      >
        {/* R-24 — waiving is an audited, admin-only decision */}
        <div
          role="status"
          className="flex items-start gap-2 rounded-md border border-warning-500/40 bg-warning-25 px-4 py-3 text-sm font-medium text-warning-700"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            Waiving forgives the amount — this is recorded in the audit log.
          </span>
        </div>

        <div className="mt-4">
          <label
            htmlFor={reasonId}
            className="block text-sm font-medium text-gray-700"
          >
            Reason{" "}
            <span className="text-error-500" aria-hidden="true">
              *
            </span>
          </label>
          <textarea
            id={reasonId}
            value={reason}
            onChange={handleReasonChange}
            maxLength={REASON_MAX}
            rows={3}
            disabled={submitting}
            required
            placeholder="e.g. Book replaced by the student at the desk."
            aria-invalid={reasonError ? true : undefined}
            aria-describedby={
              reasonError ? `${reasonId}-error` : `${reasonId}-helper`
            }
            className={cn(
              "mt-2 block w-full rounded-md border bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-500 transition-shadow duration-fast ease-standard focus:outline-none focus:shadow-focus disabled:opacity-50",
              reasonError
                ? "border-error-500 focus:border-error-500"
                : "border-gray-300 focus:border-primary-500",
            )}
          />
          {reasonError ? (
            <p
              id={`${reasonId}-error`}
              aria-live="polite"
              className="mt-2 text-xs text-error-500"
            >
              {reasonError}
            </p>
          ) : (
            <p id={`${reasonId}-helper`} className="mt-2 text-xs text-gray-500">
              Required (R-24) — stored on the fine and visible in the audit log.{" "}
              {reason.length}/{REASON_MAX} characters.
            </p>
          )}
        </div>
      </Modal>

      {notice ? (
        <Toast tone={notice.tone} message={notice.message} onClose={closeToast} />
      ) : null}
    </>
  );
}
