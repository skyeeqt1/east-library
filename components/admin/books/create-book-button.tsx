"use client";

import {
  useCallback,
  useId,
  useState,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";
import { BookPlus } from "lucide-react";
import {
  createBookSchema,
  type CreateBookFormInput,
} from "@/lib/validations/book";
import { fieldErrorsFromZod } from "@/lib/validations/auth";
import { createBook } from "@/lib/admin/book-actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Toast } from "@/components/ui/toast";

export interface CreateBookButtonProps {
  /** Existing categories — offered in the Category datalist (design §4.6). */
  categories: string[];
}

function emptyForm(): CreateBookFormInput {
  return {
    title: "",
    author: "",
    isbn: "",
    category: "",
    shelf_code: "",
    cover_url: "",
    replacement_value: "",
    initial_copies: 1,
  };
}

/**
 * "Add book" primary button (top-right of the Books & Inventory topbar) that
 * opens the create dialog — the only catalog-creation path (FR-07, rules §3).
 *
 * Client validates the raw form shape with the shared `createBookSchema` for
 * instant inline feedback, then sends **that same raw shape** to the
 * `createBook` server action, which re-validates with the same schema (R-31),
 * writes through RLS and appends the audit row.
 *
 * NOTE (contract): the schema's *output* renames `replacement_value` →
 * `replacement_value_centavos`, and that output is **not** a valid input for a
 * second parse — so the action always receives the `CreateBookFormInput` form
 * shape (which is also why `fieldErrors` come back keyed by form field names).
 */
export function CreateBookButton({ categories }: CreateBookButtonProps) {
  const router = useRouter();
  const listId = useId();

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<CreateBookFormInput>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);

  const closeToast = useCallback(() => setNotice(undefined), []);

  const openDialog = () => {
    setForm(emptyForm());
    setFieldErrors({});
    setFormError(undefined);
    setOpen(true);
  };

  const closeDialog = () => {
    if (saving) return;
    setOpen(false);
  };

  /** Controlled inputs — `isbn` is `unknown` in the schema's input type. */
  const isbnValue = typeof form.isbn === "string" ? form.isbn : "";
  const copiesValue =
    typeof form.initial_copies === "number" ? String(form.initial_copies) : "";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const copies =
      typeof form.initial_copies === "number" ? form.initial_copies : 1;
    const payload: CreateBookFormInput = { ...form, initial_copies: copies };

    const parsed = createBookSchema.safeParse(payload);
    if (!parsed.success) {
      setFieldErrors(fieldErrorsFromZod(parsed.error));
      setFormError(undefined);
      return;
    }
    // The schema allows 0 (a title may start with no copies), but the form's
    // contract is 1–50 — keep the UI rule explicit.
    if (copies < 1) {
      setFieldErrors({ initial_copies: "Add at least 1 copy." });
      return;
    }

    setFieldErrors({});
    setFormError(undefined);
    setSaving(true);
    try {
      const result = await createBook(payload);
      if (result.ok) {
        setForm(emptyForm());
        setOpen(false);
        setNotice("Book added.");
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

  return (
    <>
      <Button size="md" onClick={openDialog}>
        <BookPlus className="size-4" aria-hidden="true" />
        Add book
      </Button>

      <Modal
        open={open}
        onClose={closeDialog}
        title="Add book"
        description="Create the title, then its first physical copies (R-07)."
        footer={
          <>
            <Button variant="secondary" size="md" onClick={closeDialog} disabled={saving}>
              Cancel
            </Button>
            <Button
              size="md"
              type="submit"
              form="create-book-form"
              loading={saving}
            >
              Add book
            </Button>
          </>
        }
      >
        <form
          id="create-book-form"
          onSubmit={handleSubmit}
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
            placeholder="e.g. Clean Code"
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
            placeholder="e.g. Robert C. Martin"
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

            <div>
              <Field
                label="Category"
                name="category"
                autoComplete="off"
                list={listId}
                placeholder="Optional"
                helper="Pick an existing one or type a new category."
                value={typeof form.category === "string" ? form.category : ""}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, category: event.target.value }))
                }
                error={fieldErrors.category}
                disabled={saving}
              />
              <datalist id={listId}>
                {categories.map((category) => (
                  <option key={category} value={category} />
                ))}
              </datalist>
            </div>
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

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label="Initial copies"
              name="initial_copies"
              type="number"
              min={1}
              max={50}
              step={1}
              required
              inputMode="numeric"
              helper="Physical copies created right away (1–50)."
              value={copiesValue}
              onChange={(event) => {
                const raw = event.target.value;
                setForm((prev) => ({
                  ...prev,
                  initial_copies: raw === "" ? "" : Number(raw),
                }));
              }}
              error={fieldErrors.initial_copies}
              disabled={saving}
            />

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
          </div>

          {/* Submit lives in the modal footer; hidden submit keeps Enter-to-save. */}
          <button type="submit" className="sr-only" aria-hidden="true" tabIndex={-1}>
            Add book
          </button>
        </form>
      </Modal>

      {notice ? <Toast message={notice} onClose={closeToast} /> : null}
    </>
  );
}
