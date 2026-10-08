"use client";

import { useCallback, useId, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { resolveDamage } from "@/lib/admin/damage-actions";
import { FINE_MESSAGES } from "@/lib/validations/fine";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Toast } from "@/components/ui/toast";
import { cn, formatPeso } from "@/lib/utils";

/** Serializable slice of a PENDING damage report this dialog needs. */
export interface ResolvableDamage {
  id: string;
  student_name: string;
  student_number: string | null;
  title: string;
  /** Assessed value in integer centavos (R-29) — display only (R-31). */
  assessed_value_centavos: number;
}

type Resolution = "REPLACEMENT" | "PAYMENT";

/** R-23 resolution choices — the two ways a DAMAGE fine is settled. */
const RESOLUTIONS: ReadonlyArray<{
  value: Resolution;
  label: string;
  hint: string;
}> = [
  {
    value: "REPLACEMENT",
    label: "Student replaced the book",
    hint: "Replacement copy received — returned to the shelf, fine PAID (replacement).",
  },
  {
    value: "PAYMENT",
    label: "Student paid the replacement value in cash",
    hint: "Value received at the desk — fine PAID (cash), copy returns to circulation.",
  },
];

/**
 * "Resolve" action for one PENDING damage report (FR-18 / R-23).
 *
 * Opens the resolution modal (design §4.7 — 480px dialog, Esc/backdrop close,
 * focus trapped): a summary of the assessment (student, book, assessed value
 * in ₱) and a radio group for how it was settled — REPLACEMENT or PAYMENT.
 * Confirm runs `resolveDamage` (server action: settles the still-UNPAID
 * DAMAGE fine, flips the copy back to AVAILABLE and marks the report
 * RESOLVED, exactly one admin wins a race) then toasts
 * "Damage resolved — copy available again." and refreshes the queue.
 *
 * Failures surface the **exact** server message (e.g.
 * FINE_MESSAGES.alreadyResolved) in an error toast with the modal left open.
 */
export function ResolveButton({ damage }: { damage: ResolvableDamage }) {
  const router = useRouter();
  const groupId = useId();

  const [open, setOpen] = useState(false);
  const [resolution, setResolution] = useState<Resolution>("REPLACEMENT");
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<
    { tone: "success" | "error"; message: string } | null
  >(null);

  const closeToast = useCallback(() => setNotice(null), []);

  function handleOpen(): void {
    setResolution("REPLACEMENT");
    setOpen(true);
  }

  function handleClose(): void {
    if (submitting) return;
    setOpen(false);
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>): void {
    setResolution(event.target.value as Resolution);
  }

  async function handleSubmit(): Promise<void> {
    setSubmitting(true);
    try {
      const response = await resolveDamage({
        damageId: damage.id,
        resolution,
      });
      if (response.ok) {
        setOpen(false);
        setNotice({
          tone: "success",
          message: "Damage resolved — copy available again.",
        });
        router.refresh();
      } else {
        // Exact server text — e.g. FINE_MESSAGES.alreadyResolved (E6).
        setNotice({
          tone: "error",
          message: response.error ?? FINE_MESSAGES.resolveFailed,
        });
      }
    } catch {
      // The action redirected (session ended) — navigation is in flight.
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Button
        size="sm"
        onClick={handleOpen}
        disabled={submitting}
        aria-label={`Resolve damage report for ${damage.title} from ${damage.student_name}`}
      >
        Resolve
      </Button>

      <Modal
        open={open}
        onClose={handleClose}
        title="Resolve damage report"
        description={`${damage.title} — ${damage.student_name}`}
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
              {submitting ? "Resolving…" : "Resolve report"}
            </Button>
          </>
        }
      >
        {/* Assessed summary — what SQL charged for this report (R-22 / R-29) */}
        <dl className="grid grid-cols-1 gap-y-2">
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-xs font-medium text-gray-500">Student</dt>
            <dd className="min-w-0 text-right text-sm font-medium text-gray-900">
              <span className="block truncate">{damage.student_name}</span>
              {damage.student_number ? (
                <span className="block font-mono text-xs font-normal text-gray-500">
                  {damage.student_number}
                </span>
              ) : null}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-xs font-medium text-gray-500">Book</dt>
            <dd className="min-w-0 text-right text-sm text-gray-700">
              <span className="block truncate">{damage.title}</span>
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-xs font-medium text-gray-500">Fine amount</dt>
            <dd className="text-2xl font-semibold tracking-tight text-gray-900">
              {formatPeso(damage.assessed_value_centavos)}
            </dd>
          </div>
        </dl>

        <fieldset className="mt-5" disabled={submitting}>
          <legend className="text-sm font-medium text-gray-700">
            How was it settled? (R-23)
          </legend>
          <div className="mt-2 flex flex-col gap-2">
            {RESOLUTIONS.map((option) => {
              const selected = resolution === option.value;
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
                    onChange={handleChange}
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
