import type { Metadata } from "next";
import { AppShell } from "@/components/layout/app-shell";
import { PhasePlaceholder } from "@/components/phase-placeholder";

export const metadata: Metadata = { title: "My Penalties" };

export default function StudentPenaltiesPage() {
  return (
    <AppShell
      title="My Penalties"
      navVariant="student"
      user={{ name: "Maria Santos", id: "2024-1056" }}
    >
      <PhasePlaceholder
        phase="Phase 7"
        description="Statement-style list of fines: type, book, days late, amount ₱, status, and cash payment instructions (settled at the library desk)."
      />
    </AppShell>
  );
}
