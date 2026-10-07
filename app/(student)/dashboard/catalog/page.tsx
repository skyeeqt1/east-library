import type { Metadata } from "next";
import { AppShell } from "@/components/layout/app-shell";
import { PhasePlaceholder } from "@/components/phase-placeholder";

export const metadata: Metadata = { title: "Browse Catalog" };

export default function StudentCatalogPage() {
  return (
    <AppShell
      title="Browse Catalog"
      navVariant="student"
      user={{ name: "Maria Santos", id: "2024-1056" }}
    >
      <PhasePlaceholder
        phase="Phase 7"
        description="Responsive cover-card grid with search, category chips, per-card availability dots and a Request book button (“Already requested” / “No copies” disabled states)."
      />
    </AppShell>
  );
}
