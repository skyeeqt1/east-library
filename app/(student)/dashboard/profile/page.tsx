import type { Metadata } from "next";
import { AppShell } from "@/components/layout/app-shell";
import { PhasePlaceholder } from "@/components/phase-placeholder";

export const metadata: Metadata = { title: "Profile" };

export default function StudentProfilePage() {
  return (
    <AppShell
      title="Profile"
      navVariant="student"
      user={{ name: "Maria Santos", id: "2024-1056" }}
    >
      <PhasePlaceholder
        phase="Phase 7"
        description="Read-only account card (name, Student ID, course/section) and the change-password form — current password required (FR-06, R-05)."
      />
    </AppShell>
  );
}
