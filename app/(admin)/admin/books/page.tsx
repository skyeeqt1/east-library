import type { Metadata } from "next";
import { AppShell } from "@/components/layout/app-shell";
import { PhasePlaceholder } from "@/components/phase-placeholder";

export const metadata: Metadata = { title: "Books" };

export default function AdminBooksPage() {
  return (
    <AppShell
      title="Books"
      navVariant="admin"
      user={{ name: "Library Admin", id: "ADM-0001" }}
    >
      <PhasePlaceholder
        phase="Phase 2"
        description="Inventory CRUD with cover thumbnails, per-copy availability (AVAILABLE / ON_LOAN / DAMAGED / LOST), shelf codes and replacement values."
      />
    </AppShell>
  );
}
