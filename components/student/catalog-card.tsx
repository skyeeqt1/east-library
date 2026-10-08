import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RequestBookButton } from "@/components/student/request-book-button";
import type { BookRow } from "@/lib/catalog/availability";
import { formatPeso } from "@/lib/utils";

/** Up to two title initials for the cover fallback block (design §8). */
function titleInitials(title: string): string {
  const words = title.trim().split(/\s+/).filter((word) => word.length > 0);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0].charAt(0) + words[1].charAt(0)).toUpperCase();
}

export interface CatalogCardProps {
  book: BookRow;
  /** Book id already in the viewer's PENDING request set (one batched query). */
  alreadyRequested: boolean;
  /** The viewer owes money — R-25 / US-7 disables every Request button. */
  hasBalance: boolean;
}

/**
 * Cover card for the student catalog grid (design §6 — "Responsive cover-card
 * grid … per-card availability dot + Request book button").
 *
 * Server component: book data never hydrates — only the action button is a
 * client component. Cover falls back to a `primary-100` block with
 * `primary-700` title initials (design §8) when `cover_url` is missing.
 */
export function CatalogCard({
  book,
  alreadyRequested,
  hasBalance,
}: CatalogCardProps) {
  const hasCopies = book.available_copies > 0;

  return (
    <Card padded={false} className="flex h-full min-w-0 flex-col overflow-hidden">
      {/* Cover area: aspect 2/3 capped at 192px so wide cards stay compact */}
      <div className="relative flex aspect-[2/3] max-h-48 w-full shrink-0 items-center justify-center overflow-hidden bg-primary-100">
        {book.cover_url ? (
          // cover_url is a storage path or arbitrary URL — next/image would
          // need a configured domain per host (same call as the admin books table).
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={book.cover_url}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <span
            aria-hidden="true"
            className="text-4xl font-semibold tracking-tight text-primary-700"
          >
            {titleInitials(book.title)}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1.5 p-4">
        <h3 className="line-clamp-2 text-sm font-semibold leading-5 text-gray-900">
          {book.title}
        </h3>
        <p className="truncate text-xs text-gray-500">{book.author}</p>

        <p className="mt-1">
          {/* availability chip: green dot + "n available" / red "None available" */}
          <Badge tone={hasCopies ? "success" : "error"}>
            {hasCopies ? `${book.available_copies} available` : "None available"}
          </Badge>
        </p>

        <p className="text-xs text-gray-500">
          Replacement{" "}
          <span className="font-mono">
            {formatPeso(book.replacement_value_centavos)}
          </span>
        </p>

        <div className="mt-auto pt-3">
          <RequestBookButton
            bookId={book.id}
            alreadyRequested={alreadyRequested}
            unavailable={!hasCopies}
            hasBalance={hasBalance}
          />
        </div>
      </div>
    </Card>
  );
}
