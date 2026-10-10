"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { requestLoanReturn } from "@/lib/student/loan-actions";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Toast } from "@/components/ui/toast";

export interface ReturnBookButtonProps {
  loanId: string;
  /** Book title — shown in the confirmation dialog. */
  title: string;
}

/**
 * "Return book" action for an ACTIVE/OVERDUE loan (user request: students can
 * return before the due date — FR-16 extension).
 *
 * Confirmation modal per design §4.1 (primary confirm, NOT danger — this is
 * not destructive): the student only *signals* intent via the
 * `request_loan_return` SQL function (migration 0009, ownership + active
 * state re-verified there); custody stays with the library until the desk
 * receives the book and confirms the return (condition + any overdue fine).
 * Success toast tells the student to hand the book over; the card then shows
 * a "Return requested" info chip instead of the button.
 */
export function ReturnBookButton({ loanId, title }: ReturnBookButtonProps) {
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
        const result = await requestLoanReturn(loanId);
        if (result.ok) {
          setNotice({
            tone: "success",
            message: "Return requested — hand the book to the library desk.",
          });
          setOpen(false);
          router.refresh();
        } else {
          setNotice({
            tone: "error",
            message: result.error ?? "Could not request the return. Please try again.",
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
        variant="secondary"
        onClick={() => setOpen(true)}
        disabled={isPending}
        aria-label={`Return ${title}`}
      >
        Return book
      </Button>

      <Modal
        open={open}
        onClose={closeDialog}
        title="Return this book?"
        description={`You are returning “${title}” before the due date.`}
        footer={
          <>
            <Button variant="secondary" size="md" onClick={closeDialog} disabled={isPending}>
              Keep it for now
            </Button>
            <Button
              size="md"
              onClick={handleConfirm}
              loading={isPending}
            >
              Return book
            </Button>
          </>
        }
      >
        <p>
          Hand the book to the library desk — a librarian will check its
          condition and confirm the return. Your overdue fine (if any) is
          settled at the desk.
        </p>
      </Modal>

      {notice ? (
        <Toast tone={notice.tone} message={notice.message} onClose={closeToast} />
      ) : null}
    </>
  );
}
