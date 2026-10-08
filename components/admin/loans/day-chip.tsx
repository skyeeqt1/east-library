import { Badge } from "@/components/ui/badge";
import type { LoanStatus } from "@/lib/validations/loan";

/**
 * Due-date day chip for the admin loans table (design §2.1 semantic colors):
 *
 *   green  (success) — more than 3 days left     → "5 days left"
 *   orange (warning) — 1–3 days left             → "≤3 days"
 *   red    (error)   — due today                 → "Today"
 *   red    (error)   — past due / flagged        → "3 days OVERDUE"
 *
 * `RETURNED` rows get no chip: the status pill already carries the outcome,
 * and a "days OVERDUE" figure on a finished loan would read as if it were
 * still late (R-20 finalized that number at return time, not today).
 *
 * Day figures come from `AdminLoanRow.days_remaining` / `days_late`
 * (Manila date-only math in lib/catalog/loans-read.ts) — this component only
 * renders what the read layer computed.
 */
export interface DayChipProps {
  status: LoanStatus;
  daysRemaining?: number;
  daysLate?: number;
}

/** "1 day" vs "n days" — chips are read at a glance, grammar still matters. */
function days(n: number): string {
  return `${n} ${n === 1 ? "day" : "days"}`;
}

export function DayChip({ status, daysRemaining, daysLate }: DayChipProps) {
  if (status === "RETURNED") return null;

  if (daysLate !== undefined && daysLate > 0) {
    return <Badge tone="error">{`${days(daysLate)} OVERDUE`}</Badge>;
  }
  if (daysRemaining === undefined) return null;
  if (daysRemaining === 0) {
    return <Badge tone="error">Today</Badge>;
  }
  if (daysRemaining <= 3) {
    return <Badge tone="warning">≤3 days</Badge>;
  }
  return <Badge tone="success">{`${days(daysRemaining)} left`}</Badge>;
}
