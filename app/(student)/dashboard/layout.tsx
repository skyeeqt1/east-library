/**
 * Student route group — `app/(student)/dashboard/*`.
 * Role-guarded by middleware.ts (STUDENT; admins may preview it via
 * "Switch dashboard"). Distinct, calmer shell (variant="student").
 */
export default function StudentLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
