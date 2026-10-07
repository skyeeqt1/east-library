import type { Metadata } from "next";
import { AppShell } from "@/components/layout/app-shell";
import { PhasePlaceholder } from "@/components/phase-placeholder";

export const metadata: Metadata = { title: "Reports" };

export default function AdminReportsPage() {
  return (
    <AppShell
      title="Reports"
      navVariant="admin"
      user={{ name: "Library Admin", id: "ADM-0001" }}
    >
      <PhasePlaceholder
        phase="Phase 8"
        description="Circulation, overdue and collections reports with CSV + print export (FR-23)."
      />
    </AppShell>
  );
}
