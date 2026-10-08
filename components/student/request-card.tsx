import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge, toneForStatus } from "@/components/ui/badge";
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

function formatTimestamp(iso: string | null): string | null {
  if (!iso) return null;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : TIMESTAMP_FORMAT.format(parsed);
}

/* ------------------------------------------------------------------ */
/* Stepper                                                             */
/* ------------------------------------------------------------------ */

type StepState = "done" | "active" | "approved" | "muted";

interface Step {
  key: string;
  label: string;
  /** Absolute Manila timestamp, or null while the step has no time yet. */
  time: string | null;
  state: StepState;
  detail?: ReactNode;
  /** Shown in place of the timestamp while a step is still pending. */
  pending?: string;
}

/** Circle per step state — tokens only (design §2.1/§6 stepper timeline). */
function StepDot({ state }: { state: StepState }) {
  if (state === "done" || state === "approved") {
    return (
      <span
        aria-hidden="true"
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded-full text-white",
          state === "approved" ? "bg-success-500" : "bg-primary-500",
        )}
      >
        <Check className="size-3" strokeWidth={3} />
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
 */
function buildSteps(row: StudentRequestRow): Step[] {
  const requested: Step = {
    key: "requested",
    label: "Requested",
    time: row.created_at,
    state: "done",
  };

  switch (row.status) {
    case "PENDING":
      return [
        requested,
        { key: "review", label: "Under review", time: null, state: "active" },
      ];
    case "APPROVED": {
      const approved: Step = {
        key: "approved",
        label: "Approved",
        time: row.decided_at,
        state: "approved",
      };
      // Third step — only meaningful for approved requests (design §6).
      const released: Step = row.released_at
        ? {
            key: "released",
            label: "Released",
            time: row.released_at,
            state: "done",
          }
        : {
            key: "released",
            label: "Released",
            time: null,
            state: "active",
            pending: "Awaiting pickup at the desk",
            detail: (
              <p className="mt-1 text-xs font-medium text-warning-700">
                Pick up the book at the library desk to start your loan.
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
          state: "muted",
          detail: row.decline_reason ? (
            <div className="mt-2 rounded-md border border-warning-500/40 bg-warning-25 px-3 py-2 text-xs text-warning-700">
              <span className="font-medium">Reason:</span> {row.decline_reason}
            </div>
          ) : undefined,
        },
      ];
    case "CANCELLED":
      return [
        requested,
        { key: "cancelled", label: "Cancelled", time: null, state: "muted" },
      ];
    case "EXPIRED":
      return [
        requested,
        {
          key: "expired",
          label: "Expired",
          time: row.decided_at,
          state: "muted",
        },
      ];
  }
}

/* ------------------------------------------------------------------ */
/* Card                                                                */
/* ------------------------------------------------------------------ */

/**
 * One request as a stepper card (design §6 — "Vertical stepper timeline per
 * request: Requested → Reviewed with timestamps & decline reason", extended
 * with the Released step from the same mock: approved → released shows when
 * the desk handed the book over, or the pickup prompt until then).
 *
 * Server component: status, timestamps and the decline reason render here;
 * only the Cancel trigger (pending requests) is a client component.
 */
export function RequestCard({ row }: { row: StudentRequestRow }) {
  const steps = buildSteps(row);

  return (
    <Card padded={false}>
      <div className="flex flex-col gap-4 p-5 sm:p-6">
        {/* Header: title/author + status pill (design §2.1 status → color) */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-gray-900">{row.title}</h3>
            <p className="mt-0.5 truncate text-xs text-gray-500">{row.author}</p>
          </div>
          <Badge tone={toneForStatus(row.status)}>
            {STATUS_LABELS[row.status]}
          </Badge>
        </div>

        {/* Vertical stepper timeline */}
        <ol className="flex flex-col" aria-label={`Progress of ${row.title}`}>
          {steps.map((step, index) => {
            const last = index === steps.length - 1;
            const time = formatTimestamp(step.time);
            return (
              <li key={step.key} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <StepDot state={step.state} />
                  {!last ? (
                    <span
                      aria-hidden="true"
                      className="my-1 w-px flex-1 bg-gray-200"
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
          <div className="flex justify-end border-t border-gray-100 pt-4">
            <CancelRequestButton requestId={row.id} title={row.title} />
          </div>
        ) : null}
      </div>
    </Card>
  );
}
