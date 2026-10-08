"use client";

import { useCallback, useId, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, TriangleAlert } from "lucide-react";
import { returnLoan } from "@/lib/admin/loan-actions";
import {
  LOAN_CONDITIONS,
  LOAN_MESSAGES,
  type LoanCondition,
  type ReturnLoanResult,
} from "@/lib/validations/loan";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Toast } from "@/components/ui/toast";
import { cn, formatPeso } from "@/lib/utils";

/** Serializable slice of an ACTIVE/OVERDUE row this dialog needs. */
export interface ReturnableLoan {
  id: string;
  title: string;
  author: string;
  barcode: string | null;
  student_name: string;
  student_number: string | null;
  /** `loans.due_date` — date-only `YYYY-MM-DD` (R-17). */
  due_date: string;
}

const DUE_FORMAT = new Intl.DateTimeFormat("en-PH", {
  dateStyle: "medium",
  timeZone: "Asia/Manila",
});

function formatDue(dueDate: string): string {
  const parsed = new Date(dueDate);
  return Number.isNaN(parsed.getTime()) ? dueDate : DUE_FORMAT.format(parsed);
}

/** "1 day late" vs "n days late" for the success panel (R-19 examples). */
function lateLabel(daysLate: number): string {
  return `${daysLate} ${daysLate === 1 ? "day" : "days"} late`;
}

/** Friendly labels for the R-20 `condition_on_return` values. */
const CONDITION_LABELS: Record<LoanCondition, string> = {
  GOOD: "Good",
  DAMAGED: "Damaged",
};

const CONDITION_HINTS: Record<LoanCondition, string> = {
  GOOD: "Ready for the shelves.",
  DAMAGED: "Pulled from circulation for assessment.",
};

/**
 * "Mark returned" action for one open loan row (FR-15 / R-20).
 *
 * Opens the return modal (design §4.7 — 480px dialog, Esc/backdrop close,
 * focus trapped): book + student + due info, then a GOOD (default) | DAMAGED
 * condition choice. Confirm runs `returnLoan` (server action — `assertAdmin`,
 * Zod re-validation and `record_return()` in SQL are all re-checked there) in
 * async state, then swaps the dialog body for a **success panel** showing the
 * exact-day fine SQL finalized:
 *
 *   - `fineCreated` → warning box `Overdue fine recorded: ₱X (n days late)`
 *   - otherwise     → `Returned on time — no fine.`
 *   - DAMAGED       → note pointing at Damages (Phase 5)
 *
 * Close refreshes the server component so the row leaves the Active tab.
 * Failures surface the **exact** server message in an error toast (E6: "This
 * loan is already returned." etc.) with the modal left open for a retry.
 */
export function ReturnButton({ loan }: { loan: ReturnableLoan }) {
  const router = useRouter();
  const groupId = useId();

  const [open, setOpen] = useState(false);
  const [condition, setCondition] = useState<LoanCondition>("GOOD");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ReturnLoanResult | null>(null);
  const [returnedAs, setReturnedAs] = useState<LoanCondition>("GOOD");
  const [notice, setNotice] = useState<
    { tone: "success" | "error"; message: string } | null
  >(null);

  const closeToast = useCallback(() => setNotice(null), []);

  function handleOpen(): void {
    setCondition("GOOD");
    setResult(null);
    setOpen(true);
  }

  function handleClose(): void {
    if (submitting) return;
    const hadResult = result !== null;
    setOpen(false);
    // The success panel is only reachable after a write — sync the table.
    if (hadResult) router.refresh();
  }

  function handleConditionChange(event: ChangeEvent<HTMLInputElement>): void {
    setCondition(event.target.value as LoanCondition);
  }

  async function handleSubmit(): Promise<void> {
    setSubmitting(true);
    try {
      const response = await returnLoan({ loanId: loan.id, condition });
      if (response.ok) {
        setReturnedAs(condition);
        setResult(response.data);
      } else {
        // Exact server text — e.g. E6 "This loan is already returned."
        setNotice({
          tone: "error",
          message: response.error ?? LOAN_MESSAGES.returnFailed,
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
        variant="secondary"
        onClick={handleOpen}
        disabled={submitting}
        aria-label={`Mark returned: ${loan.title} from ${loan.student_name}`}
      >
        Mark returned
      </Button>

      <Modal
        open={open}
        onClose={handleClose}
        title={result ? "Loan returned" : "Mark returned"}
        description={
          result
            ? `${loan.title} — ${loan.student_name}`
            : "Confirm the book came back and record its condition (FR-15)."
        }
        footer={
          result ? (
            <Button size="md" onClick={handleClose}>
              Close
            </Button>
          ) : (
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
                {submitting ? "Recording…" : "Mark returned"}
              </Button>
            </>
          )
        }
      >
        {result ? (
          <ReturnSuccessPanel
            result={result}
            condition={returnedAs}
            dueDate={loan.due_date}
          />
        ) : (
          <>
            {/* What is physically coming back (design §4.4 meta rows) */}
            <dl className="grid grid-cols-1 gap-y-2">
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-xs font-medium text-gray-500">Book</dt>
                <dd className="min-w-0 text-right text-sm font-medium text-gray-900">
                  <span className="block truncate">{loan.title}</span>
                  <span className="block truncate text-xs font-normal text-gray-500">
                    {loan.author}
                  </span>
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-xs font-medium text-gray-500">Copy</dt>
                <dd className="font-mono text-xs text-gray-700">
                  {loan.barcode ?? "—"}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-xs font-medium text-gray-500">Student</dt>
                <dd className="min-w-0 text-right text-sm text-gray-700">
                  <span className="block truncate">{loan.student_name}</span>
                  {loan.student_number ? (
                    <span className="block font-mono text-xs text-gray-500">
                      {loan.student_number}
                    </span>
                  ) : null}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-xs font-medium text-gray-500">Due</dt>
                <dd className="text-sm text-gray-700">
                  {formatDue(loan.due_date)}
                </dd>
              </div>
            </dl>

            <fieldset className="mt-5" disabled={submitting}>
              <legend className="text-sm font-medium text-gray-700">
                Condition on return
              </legend>
              <div className="mt-2 flex flex-col gap-2">
                {LOAN_CONDITIONS.map((value) => {
                  const selected = condition === value;
                  return (
                    <label
                      key={value}
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
                        value={value}
                        checked={selected}
                        onChange={handleConditionChange}
                        aria-describedby={
                          value === "DAMAGED" && selected
                            ? `${groupId}-damaged-help`
                            : undefined
                        }
                        className="mt-0.5 size-4 shrink-0 accent-primary-500"
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-gray-900">
                          {CONDITION_LABELS[value]}
                        </span>
                        <span className="block text-xs text-gray-500">
                          {CONDITION_HINTS[value]}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
              {condition === "DAMAGED" ? (
                <p
                  id={`${groupId}-damaged-help`}
                  className="mt-2 text-xs text-gray-500"
                >
                  {"DAMAGED: the book will be assessed for replacement cost — you'll be taken to Damages next"}
                </p>
              ) : null}
            </fieldset>
          </>
        )}
      </Modal>

      {notice ? (
        <Toast tone={notice.tone} message={notice.message} onClose={closeToast} />
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Success panel (FR-15 / R-20 — what SQL finalized)                    */
/* ------------------------------------------------------------------ */

function ReturnSuccessPanel({
  result,
  condition,
  dueDate,
}: {
  result: ReturnLoanResult;
  condition: LoanCondition;
  dueDate: string;
}) {
  return (
    <div>
      <div className="flex flex-col items-center gap-3 text-center">
        <span
          aria-hidden="true"
          className="flex size-11 items-center justify-center rounded-full bg-success-25 text-success-500"
        >
          <CircleCheck className="size-6" strokeWidth={1.75} />
        </span>
        <p className="text-sm text-gray-500">
          Returned · due {formatDue(dueDate)}
        </p>
      </div>

      {/* R-20 finalized fine: exact-day figure, never recomputed client-side */}
      {result.fineCreated ? (
        <div
          role="status"
          className="mt-4 flex items-start gap-2 rounded-md border border-warning-500/40 bg-warning-25 px-4 py-3 text-sm font-medium text-warning-700"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            {`Overdue fine recorded: ${formatPeso(result.fineAmount)} (${lateLabel(result.daysLate)})`}
          </span>
        </div>
      ) : (
        <div
          role="status"
          className="mt-4 flex items-start gap-2 rounded-md border border-success-500/30 bg-success-25 px-4 py-3 text-sm font-medium text-success-700"
        >
          <CircleCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>Returned on time — no fine.</span>
        </div>
      )}

      {condition === "DAMAGED" ? (
        <p className="mt-3 rounded-md bg-gray-50 px-4 py-3 text-xs text-gray-700">
          Copy marked DAMAGED — assess damage in Damages (Phase 5).
        </p>
      ) : null}
    </div>
  );
}
