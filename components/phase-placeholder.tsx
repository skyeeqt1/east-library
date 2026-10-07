/**
 * Placeholder body for routes whose functionality lands in a later phase.
 * Keeps every page visually consistent until real content is built.
 */
export function PhasePlaceholder({
  phase,
  description,
}: {
  /** e.g. "Phase 3" */
  phase: string;
  description: string;
}) {
  return (
    <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-6 py-10 text-center">
      <p className="text-sm font-medium text-gray-700">{phase} placeholder</p>
      <p className="mx-auto mt-1 max-w-xl text-sm text-gray-500">{description}</p>
    </div>
  );
}
