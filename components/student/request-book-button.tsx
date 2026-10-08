"use client";

import { useCallback, useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { submitBookRequest } from "@/lib/student/request-actions";
import { Button } from "@/components/ui/button";
import { Toast } from "@/components/ui/toast";

export interface RequestBookButtonProps {
  bookId: string;
  /** The student already has a PENDING request for this title (R-10 / US-2). */
  alreadyRequested: boolean;
  /** `available_copies === 0` — request would fail R-09.6 anyway. */
  unavailable: boolean;
  /** Unpaid balance hard-blocks new requests (R-25 / US-7). */
  hasBalance: boolean;
}

/**
 * Mirror of `REQUEST_MESSAGES.blockedBalance` — that module is `server-only`,
 * so the exact US-7 string is duplicated here for the disabled button's hint.
 */
const BALANCE_BLOCK_MESSAGE =
  "Settle pending balance at the library to request new books.";

/**
 * "Request book" action for one catalog card (design §6 — per-card button).
 *
 * States (checked in this order):
 *   1. already requested → disabled **secondary** "Requested ✓";
 *   2. no copies         → disabled primary "No copies" (title = reason);
 *   3. unpaid balance    → disabled primary (title/hint = US-7 message);
 *   4. otherwise         → primary button; click runs `submitBookRequest`
 *      (server action — R-09/R-25 re-verified there) in a transition.
 *
 * Success → success toast "Request sent — awaiting approval." + refresh (the
 * server component re-renders the card as Requested). Failure → error toast
 * with the **exact** server message ("Settle pending balance…", "Request
 * limit reached.", "No copies available.", …). Eligibility is never
 * pre-computed per card (too expensive) — only the cheap pending-set and
 * availability flags arrive as props from the page.
 */
export function RequestBookButton({
  bookId,
  alreadyRequested,
  unavailable,
  hasBalance,
}: RequestBookButtonProps) {
  const router = useRouter();
  const hintId = useId();

  const [requested, setRequested] = useState(alreadyRequested);
  const [isPending, startTransition] = useTransition();
  const [notice, setNotice] = useState<
    { tone: "success" | "error"; message: string } | null
  >(null);

  const closeToast = useCallback(() => setNotice(null), []);

  const hint = requested
    ? "Your request is awaiting approval."
    : unavailable
      ? "No copies available."
      : hasBalance
        ? BALANCE_BLOCK_MESSAGE
        : undefined;

  const disabled = requested || unavailable || hasBalance;

  function handleClick(): void {
    if (disabled || isPending) return;
    startTransition(async () => {
      try {
        const result = await submitBookRequest({ bookId });
        if (result.ok) {
          setRequested(true);
          setNotice({
            tone: "success",
            message: "Request sent — awaiting approval.",
          });
          router.refresh();
        } else {
          setNotice({
            tone: "error",
            message:
              result.error ?? "Could not submit your request. Please try again.",
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
        className="w-full"
        variant={requested ? "secondary" : "primary"}
        disabled={disabled}
        loading={isPending}
        onClick={handleClick}
        aria-describedby={hint ? hintId : undefined}
      >
        {requested ? (
          // US-2 AC — "the button reads 'Already requested' and is disabled".
          "Already requested"
        ) : unavailable ? (
          "No copies"
        ) : isPending ? (
          "Requesting…"
        ) : (
          "Request book"
        )}
      </Button>
      {/* Screen-reader reason for the disabled state (WCAG 1.3.1 / 4.1.2). */}
      {hint ? (
        <span id={hintId} className="sr-only">
          {hint}
        </span>
      ) : null}
      {notice ? (
        <Toast tone={notice.tone} message={notice.message} onClose={closeToast} />
      ) : null}
    </>
  );
}
