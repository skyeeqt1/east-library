import type { Metadata } from "next";
import { AppShell } from "@/components/layout/app-shell";
import { PhasePlaceholder } from "@/components/phase-placeholder";

export const metadata: Metadata = { title: "Loans" };

export default function AdminLoansPage() {
  return (
    <AppShell
      title="Loans"
      navVariant="admin"
      user={{ name: "Library Admin", id: "ADM-0001" }}
    >
      <PhasePlaceholder
        phase="Phase 4"
        description="Active loans and releases: 7-day due dates (due = release + 7 days), return marking with condition, and overdue flags."
      />
    </AppShell>
  );
}
