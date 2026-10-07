import type { Metadata } from "next";
import { AppShell } from "@/components/layout/app-shell";
import { PhasePlaceholder } from "@/components/phase-placeholder";

export const metadata: Metadata = { title: "Settings" };

export default function AdminSettingsPage() {
  return (
    <AppShell
      title="Settings"
      navVariant="admin"
      user={{ name: "Library Admin", id: "ADM-0001" }}
    >
      <PhasePlaceholder
        phase="Phase 5"
        description="Library settings: overdue fee per day (default ₱10.00), loan period (7 days), max active loans / pending requests, and the admin profile."
      />
    </AppShell>
  );
}
