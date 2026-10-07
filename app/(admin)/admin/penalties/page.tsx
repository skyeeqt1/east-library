import type { Metadata } from "next";
import { AppShell } from "@/components/layout/app-shell";
import { PhasePlaceholder } from "@/components/phase-placeholder";

export const metadata: Metadata = { title: "Penalties" };

export default function AdminPenaltiesPage() {
  return (
    <AppShell
      title="Penalties"
      navVariant="admin"
      user={{ name: "Library Admin", id: "ADM-0001" }}
    >
      <PhasePlaceholder
        phase="Phase 5"
        description="Overdue fines and payments grouped by student with ₱ totals, “Record payment” (cash received) and admin waivers with reasons."
      />
    </AppShell>
  );
}
