import { Clock } from "lucide-react";
import { cn, formatPeso } from "@/lib/utils";

/**
 * Due countdown chip — design §6, **the one implementation of the rule**:
 *
 *   green  (success) — more than 3 days left   → "5 days left"
 *   orange (warning) — 1–3 days left           → "2 days left"
 *   red    (error)   — due today / past due    → "Due today" / "2 days overdue"
 *
 * Used by the loans countdown cards, the dashboard's "My active loans" cards
 * and the dashboard hero "Due soon" card, so all three follow the exact same
 * colour rule (prd US-6). The day figure is always in the text — colour is
 * never the only signal (design §7 / WCAG 1.4.1).
 *
 * Day figures come from the Manila date-only maths in
 * lib/catalog/loans-read.ts (`days_remaining` / `days_late`); this module
 * only renders what the read layer computed. RETURNED rows get no chip — the
 * status pill already carries the outcome (R-20 finalised the day count).
 */

export type CountdownTone = "success" | "warning" | "error";

export interface Countdown {
  tone: CountdownTone;
  /** Day figure in words — never colour alone (design §7). */
  text: string;
}

/** The subset of a loan row the countdown needs. */
export interface CountdownInput {
  status: string;
  days_remaining?: number;
  days_late?: number;
}

/** Design §4.5 badge styling: tinted bg + matching text (no dot — it's a pill). */
const TONE_CLASSES: Record<CountdownTone, string> = {
  success: "bg-success-25 text-success-700",
  warning: "bg-warning-25 text-warning-700",
  error: "bg-error-25 text-error-700",
};

/** "1 day" vs "n days" — chips are read at a glance, grammar still matters. */
function days(n: number): string {
  return `${n} ${n === 1 ? "day" : "days"}`;
}

/**
 * Resolve a loan row to its countdown (null when the loan has no countdown —
 * RETURNED rows, or a row without computed day fields).
 */
export function countdownFor(row: CountdownInput): Countdown | null {
  if (row.status === "RETURNED") return null;
  if (row.days_late !== undefined && row.days_late > 0) {
    return { tone: "error", text: `${days(row.days_late)} overdue` };
  }
  const left = row.days_remaining;
  if (left === undefined) return null;
  if (left === 0) return { tone: "error", text: "Due today" };
  if (left <= 3) return { tone: "warning", text: `${days(left)} left` };
  return { tone: "success", text: `${days(left)} left` };
}

/**
 * Design §6 — the red overdue chip carries the **live ₱ owed**: append the
 * UNPAID fine's amount ("2 days overdue · ₱20.00"). Fines are upserted by the
 * daily sweep (R-18), so a loan overdue since yesterday may not have a fine
 * row yet — in that case the chip keeps its day figure only and the card
 * shows the "fines update daily" note instead.
 */
export function withOwedAmount(
  countdown: Countdown | null,
  fine: { amount_centavos: number; status: string } | null | undefined,
): Countdown | null {
  if (!countdown || countdown.tone !== "error") return countdown;
  if (!fine || fine.status !== "UNPAID") return countdown;
  return { ...countdown, text: `${countdown.text} · ${formatPeso(fine.amount_centavos)}` };
}

export interface CountdownChipProps {
  countdown: Countdown;
  /** Extra classes for the pill (e.g. the dashboard hero sizes it up). */
  className?: string;
}

/**
 * The pill itself: clock icon + day text on the tone's tint (design §6 —
 * "pill with clock icon"). Slightly larger than a status badge so it reads
 * as the headline of a countdown card ("Big countdown chip").
 */
export function CountdownChip({ countdown, className }: CountdownChipProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-sm font-medium",
        TONE_CLASSES[countdown.tone],
        className,
      )}
    >
      <Clock className="size-3.5 shrink-0" aria-hidden="true" />
      {countdown.text}
    </span>
  );
}
