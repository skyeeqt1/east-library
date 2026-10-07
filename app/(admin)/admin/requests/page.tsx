import type { Metadata } from "next";
import { AppShell } from "@/components/layout/app-shell";
import { PhasePlaceholder } from "@/components/phase-placeholder";

export const metadata: Metadata = { title: "Borrow Requests" };

export default function AdminRequestsPage() {
  return (
    <AppShell
      title="Borrow Requests"
      navVariant="admin"
      user={{ name: "Library Admin", id: "ADM-0001" }}
    >
      <PhasePlaceholder
        phase="Phase 3"
        description="Pending borrow queue with inline Approve / Decline actions, availability indicators (“3 copies free” / “No copies”), and decline reasons."
      />
    </AppShell>
  );
}
