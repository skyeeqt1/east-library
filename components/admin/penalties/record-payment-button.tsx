"use client";

import { useCallback, useId, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { recordFinePayment } from "@/lib/admin/fine-actions";
import { FINE_MESSAGES, type FineType } from "@/lib/validations/fine";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Toast } from "@/components/ui/toast";
import { cn, formatPeso } from "@/lib/utils";

/** Serializable slice of an UNPAID row this dialog needs. */
export interface PayableFine {
  id: string;
  student_name: string;
  student_number: string | null;
  type: FineType;
  /** Integer centavos (R-29) — display only, never submitted (R-31). */
  amount_centavos: number;
}

/** Friendly chip text per `fines.type` (R-18 / R-22). */
const TYPE_LABELS: Record<FineType, string> = {
  OVERDUE: "Overdue",
  DAMAGE: "Damage",
  LOST: "Lost book",
};

/**
 * "Record payment" action for one UNPAID fine (FR-19 / R-28).
 *
 * Opens the settlement modal (design §4.7 — 480px dialog, Esc/backdrop close,
 * focus trapped): a fine summary (student, type, big ₱ amount) and a method
 * radio group — **Cash received** (CASH, default) or **Book replaced**
 * (REPLACEMENT, R-22). Confirm runs `recordFinePayment` (server action —
 * `assertAdmin()` + Zod + the conditional UNPAID → PAID update are all
 * re-checked there) then toasts "Payment recorded." and refreshes the queue.
 *
 * The amount never travels: R-28/R-31 — the system records, it does not
 * collect, and `settleFinePayment()` re-reads the amount from the row.
 * Failures surface the **exact** server message (e.g. FINE_MESSAGES —
 * "This fine has already been settled.") in an error toast with the modal
 * left open for a retry.
 */
export function RecordPaymentButton({ fine }: { fine: PayableFine }) {
  const router = useRouter();
  const groupId = useId();

  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<"CASH" | "REPLACEMENT">("CASH");
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<
    { tone: "success" | "error"; message: string } | null
  >(null);

  const closeToast = useCallback(() => setNotice(null), []);

  function handleOpen(): void {
    setMethod("CASH");
    setOpen(true);
  }

  function handleClose(): void {
    if (submitting) return;
    setOpen(false);
  }

  function handleMethodChange(event: ChangeEvent<HTMLInputElement>): void {
    setMethod(event.target.value as "CASH" | "REPLACEMENT");
  }

  async function handleSubmit(): Promise<void> {
    setSubmitting(true);
    try {
      const response = await recordFinePayment({
        fineId: fine.id,
        method,
      });
      if (response.ok) {
        setOpen(false);
        setNotice({ tone: "success", message: "Payment recorded." });
        router.refresh();
      } else {
        // Exact server text — e.g. FINE_MESSAGES.alreadySettled (E6).
        setNotice({
          tone: "error",
          message: response.error ?? FINE_MESSAGES.paymentFailed,
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
        variant="secondary"
        onClick={handleOpen}
        disabled={submitting}
        aria-label={`Record payment for ${typeLabel.toLowerCase()} fine of ${formatPeso(fine.amount_centavos)} from ${fine.student_name}`}
      >
        Record payment
      </Button>

      <Modal
        open={open}
        onClose={handleClose}
        title="Record payment"
        description="Confirm what the library received at the desk (R-28)."
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
            <Button size="md" onClick={handleSubmit} loading={submitting}>
              {submitting ? "Recording…" : "Record payment"}
            </Button>
          </>
        }
      >
        {/* Fine summary — student, type, big amount (design §4.4 meta rows) */}
        <dl className="grid grid-cols-1 gap-y-2">
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-xs font-medium text-gray-500">Student</dt>
            <dd className="min-w-0 text-right text-sm font-medium text-gray-900">
              <span className="block truncate">{fine.student_name}</span>
              {fine.student_number ? (
                <span className="block font-mono text-xs font-normal text-gray-500">
                  {fine.student_number}
                </span>
              ) : null}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-xs font-medium text-gray-500">Type</dt>
            <dd className="text-sm text-gray-700">{typeLabel}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-xs font-medium text-gray-500">Amount</dt>
            <dd className="text-2xl font-semibold tracking-tight text-gray-900">
              {formatPeso(fine.amount_centavos)}
            </dd>
          </div>
        </dl>

        <fieldset className="mt-5" disabled={submitting}>
          <legend className="text-sm font-medium text-gray-700">
            How was it settled?
          </legend>
          <div className="mt-2 flex flex-col gap-2">
            {(
              [
                {
                  value: "CASH",
                  label: "Cash received",
                  hint: "Money handed over at the library desk.",
                },
                {
                  value: "REPLACEMENT",
                  label: "Book replaced",
                  hint: "A replacement copy was received for the damaged or lost book — it goes straight back into circulation.",
                },
              ] as const
            ).map((option) => {
              const selected = method === option.value;
              return (
                <label
                  key={option.value}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 transition-colors duration-fast",
                    "focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary-500",
                    selected
                      ? "border-primary-500 bg-primary-25"
                      : "border-gray-200 bg-white hover:bg-gray-25",
                  )}
                >
                  <input
                    type="radio"
                    name={groupId}
                    value={option.value}
                    checked={selected}
                    onChange={handleMethodChange}
                    className="mt-0.5 size-4 shrink-0 accent-primary-500"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-gray-900">
                      {option.label}
                    </span>
                    <span className="block text-xs text-gray-500">
                      {option.hint}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      </Modal>

      {notice ? (
        <Toast tone={notice.tone} message={notice.message} onClose={closeToast} />
      ) : null}
    </>
  );
}
