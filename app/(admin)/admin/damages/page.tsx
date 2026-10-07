import type { Metadata } from "next";
import { AppShell } from "@/components/layout/app-shell";
import { PhasePlaceholder } from "@/components/phase-placeholder";

export const metadata: Metadata = { title: "Damage Reports" };

export default function AdminDamagesPage() {
  return (
    <AppShell
      title="Damage Reports"
      navVariant="admin"
      user={{ name: "Library Admin", id: "ADM-0001" }}
    >
      <PhasePlaceholder
        phase="Phase 5"
        description="Damage reports with photo thumbnails, assessed replacement value (₱), and resolve actions: replacement received or cash paid."
      />
    </AppShell>
  );
}
