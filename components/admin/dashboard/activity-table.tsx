"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { BookOpen, Eye } from "lucide-react";
import { StatusPill } from "@/components/ui/badge";
import {
  PrimaryCell,
  Table,
  TableBody,
  Td,
  TdCheckbox,
  Th,
  ThCheckbox,
  TableHead,
  Tr,
} from "@/components/ui/table";
import type { ActivityRow } from "@/lib/catalog/activity-types";
import { formatPeso, formatRelativeTime } from "@/lib/utils";

const DATE_FORMAT = new Intl.DateTimeFormat("en-PH", {
  dateStyle: "medium",
  timeZone: "Asia/Manila",
});

/** Date-only (`YYYY-MM-DD`) or ISO timestamp → Manila medium date. */
function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : DATE_FORMAT.format(parsed);
}

/** Fallback queues when a row arrives without an explicit `href`. */
const KIND_HREF: Record<ActivityRow["kind"], string> = {
  REQUEST: "/admin/requests",
  LOAN: "/admin/loans",
  RETURN: "/admin/loans",
  FINE: "/admin/penalties",
};

/** Title + absolute timestamp behind the relative time (design §4.4 meta). */
function RelativeTime({ iso }: { iso: string }) {
  return (
    <time dateTime={iso} title={new Date(iso).toLocaleString("en-PH")}>
      {formatRelativeTime(iso)}
    </time>
  );
}

export interface ActivityTableEmptyState {
  title: string;
  body: string;
  /** Optional CTA rendered under the copy (e.g. "Create books…" link). */
  action?: ReactNode;
}

export interface ActivityTableProps {
  rows: ActivityRow[];
  /** Pagination bar rendered inside the wrapper (design §4.4). */
  footer?: ReactNode;
  /** Rendered as a full-width row when `rows` is empty. */
  empty: ActivityTableEmptyState;
}

/**
 * "Borrow activity" table (design §5.3 / §4.4) — the whole table lives in
 * this client component because the select-all checkbox and the per-row
 * checkboxes must share selection state (header + body are otherwise
 * separate subtrees).
 *
 * Columns: checkbox · Student (ID) · Book · Requested / Released ·
 * Due date · Status (+ ₱ for FINE rows) · Actions (Eye → the row's queue).
 *
 * Selection is **visual-only** for now (Phase 6 ships no bulk action): the
 * header checkbox is `indeterminate` while a subset of the current page is
 * checked, all state resets implicitly as the URL-driven rows change, and
 * every control carries an `aria-label` (design §7).
 *
 * An empty feed renders as a single `colSpan` row so the table chrome and
 * pagination stay put; the page supplies the copy + CTA per empty variant.
 */
export function ActivityTable({ rows, footer, empty }: ActivityTableProps) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const headerRef = useRef<HTMLInputElement>(null);

  const pageIds = rows.map((row) => row.id);
  const selectedOnPage = pageIds.filter((id) => selected.has(id)).length;
  const allSelected = rows.length > 0 && selectedOnPage === rows.length;
  const someSelected = selectedOnPage > 0 && !allSelected;

  // `indeterminate` has no JSX prop — it must be set imperatively.
  useEffect(() => {
    if (headerRef.current) headerRef.current.indeterminate = someSelected;
  }, [someSelected]);

  const toggleAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        for (const id of pageIds) next.delete(id);
      } else {
        for (const id of pageIds) next.add(id);
      }
      return next;
    });
  };

  const toggleRow = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <Table minWidth={980} footer={footer}>
      <TableHead>
        <ThCheckbox>
          <input
            ref={headerRef}
            type="checkbox"
            aria-label="Select all rows on this page"
            checked={allSelected}
            disabled={rows.length === 0}
            onChange={toggleAll}
            className="size-4 rounded border-gray-300 accent-primary-500"
          />
        </ThCheckbox>
        <Th>Student</Th>
        <Th>Book</Th>
        <Th>Requested / Released</Th>
        <Th>Due date</Th>
        <Th>Status</Th>
        <Th className="text-right">Actions</Th>
      </TableHead>
      <TableBody>
        {rows.length === 0 ? (
          <Tr>
            <Td colSpan={7} className="px-6 py-12 text-center">
              <span
                className="mx-auto flex size-11 items-center justify-center rounded-full bg-white text-primary-500 shadow-xs"
                aria-hidden="true"
              >
                <BookOpen className="size-5" strokeWidth={1.75} />
              </span>
              <p className="mt-4 text-base font-semibold text-gray-900">
                {empty.title}
              </p>
              <p className="mx-auto mt-1 max-w-md text-sm text-gray-500">
                {empty.body}
              </p>
              {empty.action ? <div className="mt-4">{empty.action}</div> : null}
            </Td>
          </Tr>
        ) : (
          rows.map((row) => (
            <Tr key={`${row.kind}-${row.id}`}>
              <TdCheckbox>
                <input
                  type="checkbox"
                  aria-label={`Select row for ${row.student.name}`}
                  checked={selected.has(row.id)}
                  onChange={() => toggleRow(row.id)}
                  className="size-4 rounded border-gray-300 accent-primary-500"
                />
              </TdCheckbox>
              <Td className="min-w-52">
                <PrimaryCell
                  primary={row.student.name}
                  secondary={
                    <span className="flex items-center gap-1.5">
                      <span className="font-mono">
                        {row.student.studentNumber ?? "—"}
                      </span>
                      {row.student.courseSection ? (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>{row.student.courseSection}</span>
                        </>
                      ) : null}
                    </span>
                  }
                />
              </Td>
              <Td className="min-w-56">
                <PrimaryCell
                  primary={row.bookTitle}
                  secondary={row.bookAuthor}
                />
              </Td>
              <Td className="whitespace-nowrap text-gray-500">
                <span className="block text-sm text-gray-700">
                  {row.event.label}
                </span>
                <span className="block text-xs">
                  <RelativeTime iso={row.event.at} />
                </span>
              </Td>
              <Td className="whitespace-nowrap">{formatDate(row.dueDate)}</Td>
              <Td>
                <StatusPill status={row.status} />
                {row.kind === "FINE" &&
                typeof row.fine_centavos === "number" ? (
                  <span className="mt-1 block text-xs font-medium text-gray-700">
                    {formatPeso(row.fine_centavos)}
                  </span>
                ) : null}
              </Td>
              <Td>
                <div className="flex items-center justify-end">
                  <Link
                    href={row.href ?? KIND_HREF[row.kind]}
                    aria-label={`View ${row.bookTitle} in ${
                      row.kind === "REQUEST"
                        ? "requests"
                        : row.kind === "FINE"
                          ? "penalties"
                          : "borrowed books"
                    }`}
                    className="flex size-9 items-center justify-center rounded-md text-gray-500 transition-colors duration-fast hover:bg-gray-100 hover:text-gray-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
                  >
                    <Eye className="size-4" aria-hidden="true" />
                  </Link>
                </div>
              </Td>
            </Tr>
          ))
        )}
      </TableBody>
    </Table>
  );
}
