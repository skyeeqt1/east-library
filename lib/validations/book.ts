import { z } from "zod";

/**
 * ============================================================================
 *  Book inventory validation (Phase 2 — rules.md §3, schema.md §2.2 / §2.3)
 * ============================================================================
 *
 * Two shapes exist for every money/normalization field:
 *
 *   admin form input                 parsed output → `books` / `book_copies`
 *   ---------------------------      ---------------------------------------
 *   replacement_value: "150.50"  →   replacement_value_centavos: 15050  (R-29)
 *   shelf_code: "fic-014"       →   shelf_code: "FIC-014"
 *   isbn: " 978 013 468 599 1 " →   isbn: "9780134685991" ("" → undefined)
 *   initial_copies: "3" (HTML)  →   initial_copies: 3 (0–50, default 1)
 *
 * Type exports:
 *   - `CreateBookInput` / `EditBookInput` / `AddCopiesInput`
 *       = `z.infer` → the **parsed, DB-ready** shape produced by the schemas.
 *   - `CreateBookFormInput` / `EditBookFormInput`
 *       = `z.input` → the **raw form** shape (peso string, optional fields).
 *
 * Use the `*FormInput` types to type React form state; the `*Input` types are
 * what the data layer sees after parsing (lib/admin/book-actions.ts parses
 * `unknown` on every call — R-31, client values are never trusted).
 *
 * Rules enforced here: R-07 (copies are atomic → `initial_copies` only seeds
 * new copies, never a hand-edited counter), R-08 (positive replacement value),
 * R-29 (money is integer centavos).
 */

/* ------------------------------------------------------------------ */
/* Field schemas                                                       */
/* ------------------------------------------------------------------ */

const titleSchema = z
  .string()
  .trim()
  .min(2, "Enter the book title.")
  .max(300, "Title must be 300 characters or fewer.");

const authorSchema = z
  .string()
  .trim()
  .min(2, "Enter the author's name.")
  .max(200, "Author must be 200 characters or fewer.");

/** ISBN — spaces stripped, exactly 10 or 13 digits, empty string → undefined. */
const isbnSchema = z
  .preprocess(
    (value) => (typeof value === "string" ? value.replace(/\s+/g, "") : value),
    z.union([
      z.literal(""),
      z
        .string()
        .regex(/^\d{10}$|^\d{13}$/, "ISBN must be exactly 10 or 13 digits."),
    ]),
  )
  .transform((value) => (value === "" ? undefined : value))
  .optional();

/** Shelf code, normalized to UPPERCASE (e.g. `fic-014` → `FIC-014`). */
const shelfCodeSchema = z
  .string()
  .trim()
  .max(20, "Shelf code must be 20 characters or fewer.")
  .transform((value) => (value === "" ? undefined : value.toUpperCase()))
  .optional();

const categorySchema = z
  .string()
  .trim()
  .max(60, "Category must be 60 characters or fewer.")
  .transform((value) => (value === "" ? undefined : value))
  .optional();

/** `book-covers` storage path (schema.md §2.2) or a full http(s) URL. */
const STORAGE_PATH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._\-/]*$/;

function isAcceptableCoverUrl(value: string): boolean {
  if (STORAGE_PATH_PATTERN.test(value)) return true;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

const coverUrlSchema = z
  .string()
  .trim()
  .max(300, "Cover URL must be 300 characters or fewer.")
  .refine(
    (value) => value === "" || isAcceptableCoverUrl(value),
    { message: "Enter a valid image URL, or leave it empty." },
  )
  .transform((value) => (value === "" ? undefined : value))
  .optional();

/**
 * Replacement value — the admin types **pesos** (`"150"`, `"150.50"`); the
 * schema stores **integer centavos** (R-29). R-08: must be positive before a
 * book can ever be requested/damaged-charged.
 */
const replacementValueSchema = z
  .string()
  .trim()
  .regex(/^\d{1,7}(\.\d{1,2})?$/, "Enter an amount like 150 or 150.50.")
  .transform((value) => Math.round(parseFloat(value) * 100))
  .refine((centavos) => centavos > 0, {
    message: "Replacement value must be greater than ₱0.",
  });

/** How many physical copies to create with the title (R-07 — never a counter). */
const initialCopiesSchema = z.coerce
  .number()
  .int("Initial copies must be a whole number.")
  .min(0, "Initial copies cannot be negative.")
  .max(50, "A title can start with at most 50 copies.")
  .default(1);

/** Shared editable book columns (everything except `initial_copies`). */
const bookFields = {
  title: titleSchema,
  author: authorSchema,
  isbn: isbnSchema,
  category: categorySchema,
  shelf_code: shelfCodeSchema,
  cover_url: coverUrlSchema,
  replacement_value: replacementValueSchema,
} as const;

/**
 * Rename the parsed peso amount to its DB column after validation so
 * `fieldErrors` stay keyed by the **form** field (`replacement_value`) while
 * the output matches `books.replacement_value_centavos`.
 */
function toCentavosColumn<T extends { replacement_value: number }>(
  value: T,
): Omit<T, "replacement_value"> & { replacement_value_centavos: number } {
  const { replacement_value, ...rest } = value;
  return { ...rest, replacement_value_centavos: replacement_value };
}

/* ------------------------------------------------------------------ */
/* Object schemas                                                      */
/* ------------------------------------------------------------------ */

/** Create a title + its first copies (admin form → lib/admin/book-actions.ts). */
export const createBookSchema = z
  .object({
    ...bookFields,
    initial_copies: initialCopiesSchema,
  })
  .transform(toCentavosColumn);

/** Edit an existing title. Same fields as create, minus `initial_copies`. */
export const editBookSchema = z.object(bookFields).transform(toCentavosColumn);

/** Add physical copies to an existing title (barcodes continue the sequence). */
export const addCopiesSchema = z.object({
  count: z.coerce
    .number()
    .int("Number of copies must be a whole number.")
    .min(1, "Add at least 1 copy.")
    .max(50, "You can add at most 50 copies at a time."),
  barcode_prefix: z
    .string()
    .trim()
    .max(20, "Barcode prefix must be 20 characters or fewer.")
    .optional(),
});

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

/** Parsed (DB-ready) create payload: no `replacement_value`, no peso strings. */
export type CreateBookInput = z.infer<typeof createBookSchema>;
/** Parsed (DB-ready) edit payload. */
export type EditBookInput = z.infer<typeof editBookSchema>;
/** Parsed add-copies payload. */
export type AddCopiesInput = z.infer<typeof addCopiesSchema>;

/** Raw admin-form shape accepted by {@link createBookSchema}. */
export type CreateBookFormInput = z.input<typeof createBookSchema>;
/** Raw admin-form shape accepted by {@link editBookSchema}. */
export type EditBookFormInput = z.input<typeof editBookSchema>;
/** Raw form shape accepted by {@link addCopiesSchema}. */
export type AddCopiesFormInput = z.input<typeof addCopiesSchema>;
