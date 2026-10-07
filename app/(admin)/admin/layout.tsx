/**
 * Admin route group — `app/(admin)/admin/*`.
 * Role-guarded by middleware.ts (ADMIN only, E10). Each page renders the
 * AppShell with its own title/actions so the topbar stays page-driven.
 */
export default function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
