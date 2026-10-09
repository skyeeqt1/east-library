import { assertAdmin } from "@/lib/auth/guards";
import {
  getCirculationReport,
  getCollectionsReport,
} from "@/lib/catalog/reports-read";
import { getLibrarySettings } from "@/lib/catalog/settings-read";
import { manilaToday, toManilaDate } from "@/lib/catalog/loans-read";
import { formatPeso } from "@/lib/utils";

/**
 * ============================================================================
 *  GET /admin/reports/export — CSV report export (Phase 8b, prd.md FR-23)
 * ============================================================================
 *
 * The download half of "Admin shall export circulation, overdue, and
 * collections reports (CSV + print)" (FR-23, prd L67). The print half is the
 * `PrintButton` on the reports page; this route streams one CSV covering
 * **both** tabs plus the library configuration:
 *
 *   SETTINGS      — rules §1 snapshot (with peso + centavos money, R-29);
 *   INVENTORY     — titles / copies / available + the category breakdown;
 *   CIRCULATION   — headline counters, the 14-day release trend, top-10
 *                   borrowed titles and the last 10 returns (with the
 *                   Manila due-date punctuality);
 *   FINES         — unpaid total, collected & waived this Manila month, the
 *                   type × status matrix and the largest unpaid balances.
 *
 * ## Contract
 *
 * - **Auth**: `assertAdmin()` first, *outside* any try/catch — it throws
 *   `NEXT_REDIRECT` for anon/students (→ 307 `/login` / `/dashboard`, E10)
 *   and that error must reach Next.js, not be swallowed by an error
 *   handler. Same hard gate as `app/(admin)/admin/layout.tsx`, so the file
 *   is never reachable without an admin session even if the page guard
 *   changes.
 * - **Reads**: one parallel wave — `getLibrarySettings()` +
 *   `getCirculationReport()` + `getCollectionsReport()` (each of the two
 *   report readers internally fans out its own ≤3-query `Promise.all`, so
 *   everything below resolves in a single round trip to PostgREST).
 *   The session cookie rides along, so RLS applies (schema.md §4).
 * - **Response**: `text/csv; charset=utf-8` + `Content-Disposition:
 *   attachment; filename="escr-report-YYYY-MM-DD.csv"` (Manila date) +
 *   `Cache-Control: private, no-store` — a report is a point-in-time
 *   snapshot, never a cached artifact.
 * - **CSV shape**: UTF-8 BOM (Excel opens accented names correctly), CRLF
 *   line endings, one blank line between sections, each section prefixed by
 *   its own title row + header row so the file is readable in any editor
 *   *and* pivots cleanly in a spreadsheet. Every cell is escaped by
 *   `csvCell` (`"` doubled, `,`/CR/LF quoted).
 * - **Money**: exported both as integer centavos (machine-friendly) and as
 *   `formatPeso()` (human-friendly) — never a hand-rolled peso string.
 * - **Failure**: any read/build error → 500 `text/plain` with a stable
 *   message; the browser shows the body instead of a half-written file.
 */

/* ------------------------------------------------------------------ */
/* CSV helpers                                                         */
/* ------------------------------------------------------------------ */

/** RFC 4180 cell: double quotes inside, quote when the cell needs it. */
function csvCell(value: string | number): string {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Line writer — keeps every section's escaping in ONE place. */
class CsvWriter {
  private readonly lines: string[] = [];

  row(...cells: Array<string | number>): void {
    this.lines.push(`${cells.map(csvCell).join(",")}\r\n`);
  }

  /** Blank separator line between sections. */
  blank(): void {
    this.lines.push("\r\n");
  }

  /** Section banner (blank line before it, except for the very first row). */
  section(title: string): void {
    if (this.lines.length > 0) this.blank();
    this.row(title);
  }

  toString(): string {
    // BOM keeps Excel from mangling UTF-8 (₱, accented names).
    return `\uFEFF${this.lines.join("")}`;
  }
}

/** "On time" / "3 days late" from the report's Manila date maths. */
function punctuality(daysLate: number | null): string {
  if (daysLate === null) return "On time";
  return `${daysLate} ${daysLate === 1 ? "day" : "days"} late`;
}

/* ------------------------------------------------------------------ */
/* Report builder                                                      */
/* ------------------------------------------------------------------ */

async function buildReportCsv(): Promise<string> {
  const [settings, circulation, collections] = await Promise.all([
    getLibrarySettings(),
    getCirculationReport(),
    getCollectionsReport(),
  ]);

  const csv = new CsvWriter();
  const today = manilaToday();

  csv.row("ESCR Library Management System - report");
  csv.row("Generated", new Date().toISOString());
  csv.row("As of", `${today} (Asia/Manila)`);

  /* ---- SETTINGS -------------------------------------------------- */
  csv.section("SETTINGS");
  csv.row("Setting", "Value");
  csv.row("Loan period", `${settings.loanPeriodDays} days`);
  csv.row(
    "Overdue fee per day",
    `${formatPeso(settings.overdueFeePerDayCentavos)} (${settings.overdueFeePerDayCentavos} centavos)`,
  );
  csv.row("Max active loans", settings.maxActiveLoans);
  csv.row("Max pending requests", settings.maxPendingRequests);
  csv.row("Allow renewals", settings.allowRenewals ? "Yes" : "No");
  csv.row("Block on unpaid fines", settings.blockOnUnpaidFines ? "Yes" : "No");

  /* ---- INVENTORY ------------------------------------------------- */
  csv.section("INVENTORY");
  csv.row("Metric", "Value");
  csv.row("Titles", collections.stats.titles);
  csv.row("Total copies", collections.stats.totalCopies);
  csv.row("Available copies", collections.stats.availableCopies);

  csv.blank();
  csv.row("By category");
  csv.row("Category", "Titles", "Copies", "Available");
  for (const category of collections.categories) {
    csv.row(
      category.category,
      category.titles,
      category.copies,
      category.available,
    );
  }

  /* ---- CIRCULATION ------------------------------------------------ */
  csv.section("CIRCULATION");
  csv.row("Metric", "Value");
  csv.row("Active loans", circulation.stats.activeLoans);
  csv.row("Overdue now", circulation.stats.overdueNow);
  csv.row("Returned this month", circulation.stats.returnedThisMonth);
  csv.row("Requests this month", circulation.stats.requestsThisMonth);
  csv.row("Requests pending this month", circulation.stats.requestsPendingThisMonth);
  csv.row("Requests approved this month", circulation.stats.requestsApprovedThisMonth);

  csv.blank();
  csv.row("Loans over time (Manila days)");
  csv.row("Date", "Loans released");
  for (const day of circulation.releaseTrend) {
    csv.row(day.date, day.count);
  }

  csv.blank();
  csv.row("Top borrowed books");
  csv.row("Rank", "Title", "Author", "Loans");
  for (const row of circulation.topBorrowed) {
    csv.row(row.rank, row.title, row.author, row.borrow_count);
  }

  csv.blank();
  csv.row("Recent returns");
  csv.row(
    "Student",
    "Student number",
    "Book",
    "Author",
    "Returned",
    "Condition",
    "Punctuality",
  );
  for (const row of circulation.recentReturns) {
    csv.row(
      row.student_name,
      row.student_number ?? "",
      row.title,
      row.author,
      toManilaDate(row.returned_at),
      row.condition_on_return ?? "",
      punctuality(row.days_late),
    );
  }

  /* ---- FINES ------------------------------------------------------ */
  const { fineCounts, fineSummary, topUnpaid } = collections;
  csv.section("FINES");
  csv.row("Metric", "Value");
  csv.row("Unpaid total (centavos)", fineCounts.unpaidTotal_centavos);
  csv.row("Unpaid total", formatPeso(fineCounts.unpaidTotal_centavos));
  csv.row("Unpaid fines", fineCounts.unpaidCount);
  csv.row("Students with unpaid fines", fineCounts.studentsWithFines);
  csv.row(
    "Collected this month (centavos)",
    fineCounts.paidThisMonth_centavos,
  );
  csv.row("Collected this month", formatPeso(fineCounts.paidThisMonth_centavos));
  csv.row("Waived this month (centavos)", fineCounts.waivedThisMonth_centavos);
  csv.row("Waived this month", formatPeso(fineCounts.waivedThisMonth_centavos));

  csv.blank();
  csv.row("By type and status");
  csv.row("Type", "Status", "Count", "Amount (centavos)", "Amount");
  for (const row of fineSummary) {
    for (const [status, cell] of [
      ["UNPAID", row.unpaid],
      ["PAID", row.paid],
      ["WAIVED", row.waived],
    ] as const) {
      csv.row(
        row.type,
        status,
        cell.count,
        cell.total_centavos,
        formatPeso(cell.total_centavos),
      );
    }
    csv.row(
      row.type,
      "TOTAL",
      row.count,
      row.total_centavos,
      formatPeso(row.total_centavos),
    );
  }

  csv.blank();
  csv.row("Largest unpaid balances (top 10)");
  csv.row(
    "Student",
    "Student number",
    "Course / section",
    "Unpaid fines",
    "Balance (centavos)",
    "Balance",
  );
  for (const row of topUnpaid) {
    csv.row(
      row.student_name,
      row.student_number ?? "",
      row.course_section ?? "",
      row.unpaid_count,
      row.balance_centavos,
      formatPeso(row.balance_centavos),
    );
  }

  return csv.toString();
}

/* ------------------------------------------------------------------ */
/* Route handler                                                       */
/* ------------------------------------------------------------------ */

/**
 * GET /admin/reports/export — download the report as `escr-report-<date>.csv`.
 *
 * `assertAdmin()` runs **before** the try/catch on purpose: a redirect it
 * throws must propagate to Next.js untouched (see the file header).
 */
export async function GET(): Promise<Response> {
  await assertAdmin();

  let csv: string;
  try {
    csv = await buildReportCsv();
  } catch {
    return new Response("Could not generate the report.", {
      status: 500,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "private, no-store",
      },
    });
  }

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      // Manila date in the filename (R-30) — stable, sortable, no spaces.
      "Content-Disposition": `attachment; filename="escr-report-${manilaToday()}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
