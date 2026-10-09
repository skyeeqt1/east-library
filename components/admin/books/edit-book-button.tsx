"use client";

import {
  useCallback,
  useState,
  useTransition,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import {
  addCopiesSchema,
  editBookSchema,
  type EditBookFormInput,
} from "@/lib/validations/book";
import { fieldErrorsFromZod } from "@/lib/validations/auth";
import { addCopies, setCopyStatus, updateBook } from "@/lib/admin/book-actions";
import type {
  BookCopyRow,
  BookDetail,
  CopyStatus,
} from "@/lib/catalog/availability";
import { fetchBookDetail } from "@/components/admin/books/detail-action";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

/** Serializable slice of a `BookRow` this dialog needs (page → client props). */
export interface EditableBook {
  id: string;
  title: string;
  author: string;
  isbn: string | null;
  category: string | null;
  shelf_code: string | null;
  cover_url: string | null;
  replacement_value_centavos: number;
  total_copies: number;
  available_copies: number;
}

/** design.md §2.1 mapping as required by FR-08: per-copy status pills. */
const COPY_STATUS_TONES: Record<CopyStatus, BadgeTone> = {
  AVAILABLE: "success",
  ON_LOAN: "primary",
  DAMAGED: "error",
  LOST: "gray",
};

const STATUS_LABEL: Record<CopyStatus, string> = {
  AVAILABLE: "Available",
  ON_LOAN: "Borrowed out",
  DAMAGED: "Damaged",
  LOST: "Lost",
};

/** Statuses an admin may pick by hand — `ON_LOAN` belongs to the loan flow (R-07). */
const MANUAL_STATUSES = ["AVAILABLE", "DAMAGED", "LOST"] as const;

const ICON_BUTTON =
  "flex size-9 items-center justify-center rounded-md text-gray-500 transition-colors duration-fast hover:bg-gray-100 hover:text-gray-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500";

/** Prefill the edit form from the row — replacement value shown in pesos. */
function toEditForm(book: EditableBook): EditBookFormInput {
  return {
    title: book.title,
    author: book.author,
    isbn: book.isbn ?? "",
    category: book.category ?? "",
    shelf_code: book.shelf_code ?? "",
    cover_url: book.cover_url ?? "",
    replacement_value: (book.replacement_value_centavos / 100).toFixed(2),
  };
}

/**
 * Row action (design §4.4 — ghost pencil with `aria-label`) opening the
 * **Edit book** dialog: details form (FR-07) + per-copy management (FR-08).
 *
 * Two sections in one modal:
 *  1. Details — same shared Zod schema as the server, submitted to `updateBook`.
 *  2. Copies  — loaded on open through the `detail-action` server wrapper
 *     (server-only reads never run in the browser), then each copy's status
 *     changes through `setCopyStatus` and new copies through `addCopies`.
 *
 * The form state is the raw `EditBookFormInput` shape; like `createBook`, the
 * server actions re-parse that shape (the schema's *output* renames
 * `replacement_value` → `replacement_value_centavos` and is not re-parseable),
 * so `fieldErrors` always come back keyed by the visible field names.
 */
export function EditBookButton({ book }: { book: EditableBook }) {
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<EditBookFormInput>(() => toEditForm(book));
  const [saving, setSaving] = useState(false);

  const [detail, setDetail] = useState<BookDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const [copyBusy, setCopyBusy] = useState<string | null>(null);
  const [addCount, setAddCount] = useState("1");
  const [addError, setAddError] = useState<string | undefined>(undefined);

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<
    { tone: "success" | "error"; message: string } | null
  >(null);

  const closeToast = useCallback(() => setNotice(null), []);

  /** Load (or reload) the copy list through the guarded server action. */
  const loadDetail = useCallback(() => {
    startTransition(async () => {
      try {
        const data = await fetchBookDetail(book.id);
        setDetail(data);
        setDetailError(
          data ? null : "This book is no longer in the catalog.",
        );
      } catch {
        // Session ended (redirect in flight) or a network failure — surface it.
        setDetailError("Could not load the copies. Close and reopen to retry.");
      }
    });
  }, [book.id]);

  const openDialog = () => {
    setForm(toEditForm(book));
    setFieldErrors({});
    setFormError(undefined);
    setAddCount("1");
    setAddError(undefined);
    setDetail(null);
    setDetailError(null);
    setOpen(true);
    loadDetail();
  };

  const closeDialog = () => {
    if (saving || copyBusy) return;
    setOpen(false);
  };

  const busy = saving || copyBusy !== null;

  /** Controlled inputs — `isbn` is `unknown` in the schema's input type. */
  const isbnValue = typeof form.isbn === "string" ? form.isbn : "";

  async function handleDetailsSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const payload: EditBookFormInput = { ...form };
    const parsed = editBookSchema.safeParse(payload);
    if (!parsed.success) {
      setFieldErrors(fieldErrorsFromZod(parsed.error));
      setFormError(undefined);
      return;
    }

    setFieldErrors({});
    setFormError(undefined);
    setSaving(true);
    try {
      const result = await updateBook(book.id, payload);
      if (result.ok) {
        setNotice({ tone: "success", message: "Book details updated." });
        router.refresh();
      } else {
        setFieldErrors(result.fieldErrors ?? {});
        setFormError(result.error);
      }
    } catch {
      // The action redirected (session ended) — navigation is in flight.
    } finally {
      setSaving(false);
    }
  }

  async function handleStatusChange(copy: BookCopyRow, status: CopyStatus) {
    if (copy.status === status) return;
    setCopyBusy(copy.id);
    try {
      const result = await setCopyStatus(copy.id, status);
      if (result.ok) {
        setNotice({ tone: "success", message: "Copy status updated." });
        loadDetail();
        router.refresh();
      } else {
        setNotice({
          tone: "error",
          message: result.error ?? "Could not update the copy status.",
        });
      }
    } catch {
      // The action redirected (session ended) — navigation is in flight.
    } finally {
      setCopyBusy(null);
    }
  }

  async function handleAddCopies(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const parsed = addCopiesSchema.safeParse({ count: addCount });
    if (!parsed.success) {
      setAddError(
        fieldErrorsFromZod(parsed.error).count ?? "Invalid number of copies.",
      );
      return;
    }

    setAddError(undefined);
    setCopyBusy("add");
    try {
      const result = await addCopies(book.id, { count: addCount });
      if (result.ok) {
        setNotice({
          tone: "success",
          message: `+${result.data.added} copies added.`,
        });
        setAddCount("1");
        loadDetail();
        router.refresh();
      } else {
        setAddError(result.error ?? "Could not add the copies.");
      }
    } catch {
      // The action redirected (session ended) — navigation is in flight.
    } finally {
      setCopyBusy(null);
    }
  }

  const copies = detail?.copies ?? null;
  const total = copies ? copies.length : book.total_copies;
  const available = copies
    ? copies.filter((copy) => copy.status === "AVAILABLE").length
    : book.available_copies;
  const loading = isPending || (copies === null && detailError === null);

  return (
    <>
      <button
        type="button"
        aria-label={`Edit ${book.title}`}
        title="Edit"
        onClick={openDialog}
        className={ICON_BUTTON}
      >
        <Pencil className="size-4" aria-hidden="true" />
      </button>

      <Modal
        open={open}
        onClose={closeDialog}
        title="Edit book"
        description={`${book.title} · details and physical copies`}
        footer={
          <>
            <Button variant="secondary" size="md" onClick={closeDialog} disabled={busy}>
              Cancel
            </Button>
            <Button
              size="md"
              type="submit"
              form="edit-book-form"
              loading={saving}
            >
              Save changes
            </Button>
          </>
        }
      >
        {/* (a) Details ---------------------------------------------------- */}
        <form
          id="edit-book-form"
          onSubmit={handleDetailsSubmit}
          noValidate
          className="flex flex-col gap-4"
        >
          {formError ? (
            <div
              role="alert"
              className="rounded-md border border-error-500 bg-error-25 px-4 py-3 text-sm font-medium text-error-700"
            >
              {formError}
            </div>
          ) : null}

          <Field
            label="Title"
            name="title"
            required
            autoComplete="off"
            value={form.title}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, title: event.target.value }))
            }
            error={fieldErrors.title}
            disabled={saving}
          />

          <Field
            label="Author"
            name="author"
            required
            autoComplete="off"
            value={form.author}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, author: event.target.value }))
            }
            error={fieldErrors.author}
            disabled={saving}
          />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label="ISBN"
              name="isbn"
              autoComplete="off"
              inputMode="numeric"
              placeholder="Optional"
              helper="10 or 13 digits — spaces are ignored."
              value={isbnValue}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, isbn: event.target.value }))
              }
              error={fieldErrors.isbn}
              disabled={saving}
            />
            <Field
              label="Category"
              name="category"
              autoComplete="off"
              placeholder="Optional"
              value={typeof form.category === "string" ? form.category : ""}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, category: event.target.value }))
              }
              error={fieldErrors.category}
              disabled={saving}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label="Shelf code"
              name="shelf_code"
              autoComplete="off"
              placeholder="e.g. FIC-014"
              helper="Stored uppercase."
              value={typeof form.shelf_code === "string" ? form.shelf_code : ""}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, shelf_code: event.target.value }))
              }
              error={fieldErrors.shelf_code}
              disabled={saving}
            />
            <Field
              label="Replacement value"
              name="replacement_value"
              required
              inputMode="decimal"
              autoComplete="off"
              placeholder="150.00"
              leading="₱"
              helper="Cost to replace the book if damaged"
              value={form.replacement_value}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  replacement_value: event.target.value,
                }))
              }
              error={fieldErrors.replacement_value}
              disabled={saving}
            />
          </div>

          <Field
            label="Cover URL"
            name="cover_url"
            autoComplete="off"
            placeholder="Optional"
            helper="Image URL or storage path (e.g. book-covers/clean-code.jpg)."
            value={typeof form.cover_url === "string" ? form.cover_url : ""}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, cover_url: event.target.value }))
            }
            error={fieldErrors.cover_url}
            disabled={saving}
          />
        </form>

        {/* (b) Copies ----------------------------------------------------- */}
        <section aria-label="Physical copies" className="mt-6 border-t border-gray-200 pt-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-medium text-gray-900">Copies</h3>
            <p
              aria-live="polite"
              className={cn(
                "text-xs font-medium",
                available > 0 ? "text-success-700" : "text-error-700",
              )}
            >
              {available} of {total} available
            </p>
          </div>

          {detailError ? (
            <div
              role="alert"
              className="mt-3 rounded-md border border-error-500 bg-error-25 px-4 py-3 text-sm text-error-700"
            >
              {detailError}
              <button
                type="button"
                onClick={loadDetail}
                className="mt-2 block text-xs font-medium underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
              >
                Try again
              </button>
            </div>
          ) : loading ? (
            <div aria-busy="true" className="mt-3 space-y-2">
              <p className="text-xs text-gray-500">Loading copies…</p>
              <div className="h-9 animate-pulse rounded-md bg-gray-100" />
              <div className="h-9 animate-pulse rounded-md bg-gray-100" />
            </div>
          ) : copies && copies.length > 0 ? (
            <ul className="mt-3 max-h-80 divide-y divide-gray-100 overflow-y-auto overscroll-contain rounded-md border border-gray-200">
              {copies.map((copy) => {
                const onLoan = copy.status === "ON_LOAN";
                return (
                  <li
                    key={copy.id}
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                  >
                    <span className="font-mono text-xs text-gray-900">
                      {copy.barcode ?? "—"}
                    </span>
                    <div className="flex items-center gap-2">
                      <Badge tone={COPY_STATUS_TONES[copy.status]}>
                        {STATUS_LABEL[copy.status]}
                      </Badge>
                      <select
                        value={copy.status}
                        disabled={onLoan || copyBusy !== null}
                        title={onLoan ? "Managed automatically while the book is out" : undefined}
                        aria-label={`Status for copy ${copy.barcode ?? copy.id}`}
                        onChange={(event) =>
                          handleStatusChange(
                            copy,
                            event.target.value as CopyStatus,
                          )
                        }
                        className="h-10 rounded-md border border-gray-300 bg-white px-2 text-sm text-gray-700 transition-shadow duration-fast ease-standard focus:border-primary-500 focus:outline-none focus:shadow-focus disabled:pointer-events-none disabled:opacity-50"
                      >
                        {onLoan ? (
                          <option value="ON_LOAN">Borrowed out</option>
                        ) : null}
                        {MANUAL_STATUSES.map((status) => (
                          <option key={status} value={status}>
                            {STATUS_LABEL[status]}
                          </option>
                        ))}
                      </select>
                      {onLoan ? (
                        <span className="sr-only">
                          Status is managed automatically while the book is out.
                        </span>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-gray-500">
              No copies yet — add the first copies below.
            </p>
          )}

          <form
            onSubmit={handleAddCopies}
            className="mt-4 flex items-end gap-3"
            aria-label="Add copies"
          >
            <Field
              className="w-32"
              label="Add copies"
              name="count"
              type="number"
              min={1}
              max={50}
              step={1}
              inputMode="numeric"
              autoComplete="off"
              value={addCount}
              onChange={(event) => setAddCount(event.target.value)}
              error={addError}
              disabled={copyBusy !== null}
            />
            <Button
              type="submit"
              size="md"
              loading={copyBusy === "add"}
              disabled={copyBusy !== null}
            >
              Add copies
            </Button>
          </form>
        </section>
      </Modal>

      {notice ? (
        <Toast tone={notice.tone} message={notice.message} onClose={closeToast} />
      ) : null}
    </>
  );
}
