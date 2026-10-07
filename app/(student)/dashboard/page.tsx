import type { Metadata } from "next";
import { AppShell } from "@/components/layout/app-shell";
import { PhasePlaceholder } from "@/components/phase-placeholder";

export const metadata: Metadata = { title: "Dashboard" };

export default function StudentDashboardPage() {
  return (
    <AppShell
      title="Dashboard"
      navVariant="student"
      user={{ name: "Maria Santos", id: "2024-1056" }}
    >
      <div className="flex flex-col gap-6">
        {/* Greeting banner — design §6 */}
        <div className="rounded-lg bg-primary-600 bg-linear-to-r from-primary-500 to-primary-700 px-6 py-8 text-white shadow-xs">
          <p className="text-2xl font-semibold tracking-tight">Hello, Maria!</p>
          <p className="mt-1 text-sm text-primary-100">2024-1056 · BSIT 2A</p>
        </div>

        <PhasePlaceholder
          phase="Phase 7"
          description="Three hero cards (books out · due-soon countdown · balance ₱), active-loan countdown cards, and the pending-request feed (FR-22, US-6)."
        />
      </div>
    </AppShell>
  );
}
