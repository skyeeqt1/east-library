"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { LogOut, Search } from "lucide-react";
import { signOut } from "@/lib/auth/actions";
import { cn } from "@/lib/utils";
import { NAV_ITEMS, type NavVariant } from "@/components/layout/nav";

export interface SidebarUser {
  /** Display name, e.g. "Maria Santos". */
  name: string;
  /** Student ID / staff code shown under the name, e.g. "2024-1056". */
  id: string;
}

export interface AppSidebarProps {
  variant: NavVariant;
  user?: SidebarUser;
  /** Called after a nav link is followed (used to close the mobile drawer). */
  onNavigate?: () => void;
  className?: string;
}

/** Default slot content while the real profile is not wired (Phase 1). */
const DEFAULT_USER: SidebarUser = { name: "ESCR Account", id: "Not connected" };

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * Sidebar — design §3: 264px fixed white surface, right border,
 * logo area, visual search box, icon nav, bottom user card.
 * Active item = gray-100 pill with a primary-500 icon.
 * The positioning wrapper (fixed desktop / drawer) lives in AppShell.
 */
export function AppSidebar({
  variant,
  user = DEFAULT_USER,
  onNavigate,
  className,
}: AppSidebarProps) {
  const pathname = usePathname();
  const items = NAV_ITEMS[variant];

  return (
    <div
      className={cn(
        "flex h-full w-full flex-col border-r border-gray-200 bg-white",
        className,
      )}
    >
      {/* Logo area — ESCR seal (public/logo.png) */}
      <div className="flex items-center gap-3 px-6 py-6">
        <Image
          src="/logo.png"
          alt=""
          width={36}
          height={36}
          className="size-9 shrink-0"
        />
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-base font-semibold tracking-tight text-gray-900">
            ESCR
          </span>
          <span className="truncate text-xs text-gray-500">Library</span>
        </span>
      </div>

      {/* Search box — visual only in Phase 0 (⌘K search lands in Phase 6/7) */}
      <div className="px-4 pb-4" aria-hidden="true">
        <div className="flex h-10 items-center gap-2 rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-500">
          <Search className="size-4 shrink-0" strokeWidth={1.75} />
          <span className="truncate">Search…</span>
        </div>
      </div>

      {/* Navigation */}
      <nav
        aria-label="Main"
        className="min-h-0 flex-1 overflow-y-auto px-3 py-2"
      >
        <ul className="flex flex-col gap-1">
          {items.map((item) => {
            const isActive =
              item.href === "/dashboard"
                ? pathname === item.href
                : pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;

            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "flex min-h-11 items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors duration-fast ease-standard",
                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500",
                    isActive
                      ? "bg-gray-100 text-gray-900"
                      : "text-gray-700 hover:bg-gray-50 hover:text-gray-900",
                  )}
                >
                  <Icon
                    className={cn(
                      "size-5 shrink-0",
                      isActive ? "text-primary-500" : "text-gray-500",
                    )}
                    strokeWidth={1.75}
                    aria-hidden="true"
                  />
                  <span className="truncate">{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* User card */}
      <div className="flex items-center gap-3 border-t border-gray-200 p-4">
        <span
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-100 text-xs font-semibold text-primary-700"
          aria-hidden="true"
        >
          {initialsOf(user.name)}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium text-gray-900">
            {user.name}
          </span>
          <span className="truncate text-xs text-gray-500">{user.id}</span>
        </span>
        <button
          type="button"
          onClick={() => {
            void signOut();
          }}
          aria-label="Sign out"
          title="Sign out"
          className="flex size-11 shrink-0 items-center justify-center rounded-md text-gray-500 transition-colors duration-fast hover:bg-gray-50 hover:text-error-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
        >
          <LogOut className="size-5" strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
