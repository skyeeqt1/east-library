"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { markLoanLost } from "@/lib/admin/loan-actions";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Toast } from "@/components/ui/toast";
import { formatPeso } from "@/lib/utils";

export interface MarkLostButtonProps {
  loan: {
    id: string;
    title: string;
    student_name: string;
    student_number: string | null;
    /** Book's replacement value in centavos — shown in the confirmation. */
    replacement_value_centavos: number;
  };
}

/**
 * "Mark lost" action on the Borrowed table (user request — lost books never
 * come back, so the damage-assessment flow can never charge the student).
 *
 * Danger confirm modal per design §4.1: `markLoanLost` → SQL
 * `mark_loan_lost()` (migration 0010) closes the loan with condition LOST,
 * flags the copy LOST and charges a **LOST fine at the book's replacement
 * value** (R-08/R-29 — the amount is read in SQL, never from the client).
 * The fine then appears on the Penalties pages for payment/waival like any
 * other. Success toast reports the exact peso amount charged.
 */
export function MarkLostButton({ loan }: MarkLostButtonProps) {
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [notice, setNotice] = useState<
    { tone: "success" | "error"; message: string } | null
  >(null);

  const closeToast = useCallback(() => setNotice(null), []);

  const closeDialog = () => {
    if (isPending) return;
    setOpen(false);
  };

  function handleConfirm(): void {
    startTransition(async () => {
      try {
        const result = await markLoanLost({ loanId: loan.id });
        if (result.ok) {
          setNotice({
            tone: "success",
            message: `Marked lost — ${formatPeso(result.data.fineAmount)} charged to ${loan.student_name}.`,
          });
          setOpen(false);
          router.refresh();
        } else {
          setNotice({
            tone: "error",
            message: result.error ?? "Could not mark the book as lost. Please try again.",
          });
        }
      } catch {
        // The action redirected (session ended) — navigation is in flight.
      }
    });
  }

  return (
    <>
      <Button
        size="sm"
        variant="danger"
        onClick={() => setOpen(true)}
        disabled={isPending}
        aria-label={`Mark ${loan.title} as lost`}
      >
        Mark lost
      </Button>

      <Modal
        open={open}
        onClose={closeDialog}
        title="Mark this book as lost?"
        description={`“${loan.title}” will be closed as lost and removed from circulation.`}
        footer={
          <>
            <Button variant="secondary" size="md" onClick={closeDialog} disabled={isPending}>
              Cancel
            </Button>
            <Button
              size="md"
              variant="danger"
              onClick={handleConfirm}
              loading={isPending}
            >
              Mark lost
            </Button>
          </>
        }
      >
        <p>
          {loan.student_number ? `${loan.student_name} (${loan.student_number})` : loan.student_name}{" "}
          will be charged the replacement value,{" "}
          <span className="font-semibold">
            {formatPeso(loan.replacement_value_centavos)}
          </span>
          , recorded as a lost-book fine on their penalties. Use this only when
          the book will not come back — damaged books should go through the
          Damages assessment instead.
        </p>
      </Modal>

      {notice ? (
        <Toast tone={notice.tone} message={notice.message} onClose={closeToast} />
      ) : null}
    </>
  );
}
