import type { Metadata } from "next";
import { AppShell } from "@/components/layout/app-shell";
import { PhasePlaceholder } from "@/components/phase-placeholder";

export const metadata: Metadata = { title: "My Requests" };

export default function StudentRequestsPage() {
  return (
    <AppShell
      title="My Requests"
      navVariant="student"
      user={{ name: "Maria Santos", id: "2024-1056" }}
    >
      <PhasePlaceholder
        phase="Phase 7"
        description="Vertical stepper timeline per request: Requested → Reviewed → (Released), with timestamps, decline reasons, and cancel for pending requests."
      />
    </AppShell>
  );
}
