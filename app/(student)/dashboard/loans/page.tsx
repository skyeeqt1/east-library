import type { Metadata } from "next";
import { AppShell } from "@/components/layout/app-shell";
import { PhasePlaceholder } from "@/components/phase-placeholder";

export const metadata: Metadata = { title: "My Loans" };

export default function StudentLoansPage() {
  return (
    <AppShell
      title="My Loans"
      navVariant="student"
      user={{ name: "Maria Santos", id: "2024-1056" }}
    >
      <PhasePlaceholder
        phase="Phase 7"
        description="Active loans with big countdown chips — green >3 days · orange 1–3 days · red overdue — plus the live ₱ amount owed."
      />
    </AppShell>
  );
}
