import type { ReactNode } from "react";
import { Check, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge, toneForStatus, type BadgeTone } from "@/components/ui/badge";
import { RequestDisclosure } from "@/components/student/request-disclosure";
import { CancelRequestButton } from "@/components/student/cancel-request-button";
import type { StudentRequestRow } from "@/lib/catalog/requests-read";
import type { RequestStatus } from "@/lib/validations/request";
import { cn } from "@/lib/utils";

/** Friendly badge/step label per R-12 state (design §2.1 map in badge.tsx). */
const STATUS_LABELS: Record<RequestStatus, string> = {
  PENDING: "Pending",
  APPROVED: "Approved",
  DECLINED: "Declined",
  CANCELLED: "Cancelled",
  EXPIRED: "Expired",
};

const TIMESTAMP_FORMAT = new Intl.DateTimeFormat("en-PH", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Manila",
});

/**
 * Status-pill override for this page (user request: approved reads green
 * end-to-end, rejected red end-to-end — including the pill). Shared tables
 * keep the design §2.1 map via `toneForStatus`.
 */
const OUTCOME_BADGE_TONES: Partial<Record<RequestStatus, BadgeTone>> = {
  APPROVED: "success",
  DECLINED: "error",
};

function formatTimestamp(iso: string | null): string | null {
  if (!iso) return null;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : TIMESTAMP_FORMAT.format(parsed);
}

/** Up to two title initials for the cover fallback block (design §8). */
function titleInitials(title: string): string {
  const words = title.trim().split(/\s+/).filter((word) => word.length > 0);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0].charAt(0) + words[1].charAt(0)).toUpperCase();
}

/* ------------------------------------------------------------------ */
/* Stepper                                                             */
/* ------------------------------------------------------------------ */

/**
 * Whole-chain outcome tint (user request: an approved request is green
 * end-to-end, a rejected one red end-to-end — no mixed gray/green checks).
 * Neutral covers pending / cancelled / expired chains.
 */
type StepTone = "success" | "error" | "neutral";

type StepState = "done" | "verdict" | "active" | "muted";

interface Step {
  key: string;
  label: string;
  /** Absolute Manila timestamp, or null while the step has no time yet. */
  time: string | null;
  state: StepState;
  /** Final-outcome tint for the whole chain (green approved / red rejected). */
  tone: StepTone;
  detail?: ReactNode;
  /** Shown in place of the timestamp while a step is still pending. */
  pending?: string;
}

const TONE_CIRCLE: Record<StepTone, string> = {
  success: "bg-success-500 text-white",
  error: "bg-error-500 text-white",
  neutral: "bg-gray-200 text-gray-600",
};

const TONE_LINE: Record<StepTone, string> = {
  success: "bg-success-500/30",
  error: "bg-error-500/30",
  neutral: "bg-gray-200",
};

/**
 * Circle per step — colored by the request's final outcome, not per-step:
 * every step of an approved chain is green, every step of a rejected chain
 * is red (check icon on progress steps; the verdict step carries the X for
 * rejections). Pending stays on the warning token (design §2.1);
 * cancelled/expired stay muted gray.
 */
function StepDot({ state, tone }: { state: StepState; tone: StepTone }) {
  if (state === "done") {
    return (
      <span
        aria-hidden="true"
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded-full",
          TONE_CIRCLE[tone],
        )}
      >
        <Check className="size-3" strokeWidth={3} />
      </span>
    );
  }
  if (state === "verdict") {
    return (
      <span
        aria-hidden="true"
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded-full",
          TONE_CIRCLE[tone],
        )}
      >
        {tone === "error" ? (
          <X className="size-3" strokeWidth={3} />
        ) : (
          <Check className="size-3" strokeWidth={3} />
        )}
      </span>
    );
  }
  if (state === "active") {
    // Awaiting decision — warning per the design §2.1 status map.
    return (
      <span
        aria-hidden="true"
        className="flex size-5 shrink-0 items-center justify-center rounded-full border-2 border-warning-500 bg-white"
      >
        <span className="size-1.5 rounded-full bg-warning-500" />
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className="flex size-5 shrink-0 items-center justify-center rounded-full bg-gray-300"
    >
      <span className="size-1.5 rounded-full bg-gray-500" />
    </span>
  );
}

/**
 * Build the timeline (design §6: Requested → Reviewed → (Released)) for one
 * state:
 *   ① Requested (created_at, always done)
 *   ② Under review (PENDING) · Approved (APPROVED, decided_at)
 *      · Declined (DECLINED, decided_at + reason box) · Cancelled / Expired
 *   ③ Released (APPROVED only, R-14) — the loan's released_at when the desk
 *      has handed the book over, otherwise an active "pick up" step.
 *
 * Every step of an approved chain is tinted green and of a rejected chain
 * red (user request) — the verdict step carries the X for rejections.
 */
function buildSteps(row: StudentRequestRow): Step[] {
  const tone: StepTone =
    row.status === "APPROVED"
      ? "success"
      : row.status === "DECLINED"
        ? "error"
        : "neutral";

  const requested: Step = {
    key: "requested",
    label: "Requested",
    time: row.created_at,
    state: "done",
    tone,
  };

  switch (row.status) {
    case "PENDING":
      return [
        requested,
        { key: "review", label: "Under review", time: null, state: "active", tone },
      ];
    case "APPROVED": {
      const approved: Step = {
        key: "approved",
        label: "Approved",
        time: row.decided_at,
        state: "verdict",
        tone,
      };
      // Third step — only meaningful for approved requests (design §6).
      const released: Step = row.released_at
        ? {
            key: "released",
            label: "Released",
            time: row.released_at,
            state: "done",
            tone,
          }
        : {
            key: "released",
            label: "Released",
            time: null,
            state: "active",
            tone,
            pending: "Awaiting pickup at the desk",
            detail: (
              <p className="mt-1 text-xs font-medium text-warning-700">
                Pick up the book at the library desk to check it out.
              </p>
            ),
          };
      return [requested, approved, released];
    }
    case "DECLINED":
      return [
        requested,
        {
          key: "declined",
          label: "Declined",
          time: row.decided_at,
          state: "verdict",
          tone,
          detail: row.decline_reason ? (
            <div className="mt-2 rounded-md border border-error-500/40 bg-error-25 px-3 py-2 text-xs text-error-700">
              <span className="font-medium">Reason:</span> {row.decline_reason}
            </div>
          ) : undefined,
        },
      ];
    case "CANCELLED":
      return [
        requested,
        { key: "cancelled", label: "Cancelled", time: null, state: "muted", tone },
      ];
    case "EXPIRED":
      return [
        requested,
        {
          key: "expired",
          label: "Expired",
          time: row.decided_at,
          state: "muted",
          tone,
        },
      ];
  }
}

/* ------------------------------------------------------------------ */
/* Card                                                                */
/* ------------------------------------------------------------------ */

/**
 * One request as a book row (user request: "books only" collapsed state) —
 * cover thumbnail + title/author + status pill; the Requested → Reviewed →
 * (Released) stepper timeline renders only when the row is clicked open
 * (RequestDisclosure).
 *
 * Server component: status, timestamps and the decline reason render here;
 * only the disclosure toggle and the Cancel trigger (pending requests) are
 * client components.
 */
export function RequestCard({ row }: { row: StudentRequestRow }) {
  const steps = buildSteps(row);

  return (
    <Card padded={false}>
      <RequestDisclosure
        label={row.title}
        summary={
          <>
            {/* Cover thumbnail — same fallback as the catalog grid (design §8) */}
            <span
              aria-hidden="true"
              className="relative flex aspect-[2/3] w-10 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-primary-100"
            >
              {row.cover_url ? (
                // cover_url is a storage path or arbitrary URL — next/image would
                // need a configured domain per host (same call as the catalog card).
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={row.cover_url}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="text-xs font-semibold tracking-tight text-primary-700">
                  {titleInitials(row.title)}
                </span>
              )}
            </span>

            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-gray-900">
                {row.title}
              </span>
              <span className="mt-0.5 block truncate text-xs text-gray-500">
                {row.author}
              </span>
            </span>

            <Badge tone={OUTCOME_BADGE_TONES[row.status] ?? toneForStatus(row.status)}>
              {STATUS_LABELS[row.status]}
            </Badge>
          </>
        }
      >
        {/* Vertical stepper timeline — details only while expanded */}
        <ol className="flex flex-col" aria-label={`Progress of ${row.title}`}>
          {steps.map((step, index) => {
            const last = index === steps.length - 1;
            const time = formatTimestamp(step.time);
            return (
              <li key={step.key} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <StepDot state={step.state} tone={step.tone} />
                  {!last ? (
                    <span
                      aria-hidden="true"
                      className={cn(
                        "my-1 w-px flex-1",
                        TONE_LINE[step.tone],
                      )}
                    />
                  ) : null}
                </div>
                <div className={cn("min-w-0 pb-4", last && "pb-0")}>
                  <p className="text-sm font-medium text-gray-900">
                    {step.label}
                  </p>
                  <p className="text-xs text-gray-500">
                    {time ??
                      step.pending ??
                      (step.state === "active" ? "Awaiting the library" : "—")}
                  </p>
                  {step.detail}
                </div>
              </li>
            );
          })}
        </ol>

        {/* Pending requests can still be withdrawn (FR-13 / R-12) */}
        {row.status === "PENDING" ? (
          <div className="mt-1 flex justify-end border-t border-gray-100 pt-4">
            <CancelRequestButton requestId={row.id} title={row.title} />
          </div>
        ) : null}
      </RequestDisclosure>
    </Card>
  );
}
