import type { Metadata } from "next";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { PhasePlaceholder } from "@/components/phase-placeholder";

export const metadata: Metadata = { title: "Students" };

export default function AdminStudentsPage() {
  return (
    <AppShell
      title="Students"
      navVariant="admin"
      user={{ name: "Library Admin", id: "ADM-0001" }}
      actions={
        <Button size="md" disabled>
          Create account
        </Button>
      }
    >
      <PhasePlaceholder
        phase="Phase 1"
        description="Student accounts: create from a unique ESCR Student ID + name + course + temporary password, edit, block/unblock, reset password (no self-registration, R-01)."
      />
    </AppShell>
  );
}
