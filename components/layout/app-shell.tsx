"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Menu, X } from "lucide-react";
import { AppSidebar, type SidebarUser } from "@/components/layout/sidebar";
import type { NavVariant } from "@/components/layout/nav";

export interface AppShellProps {
  /** Page title rendered in the topbar (design §3). */
  title: string;
  /** Optional sub-heading under the title. */
  subtitle?: string;
  navVariant: NavVariant;
  /** Primary action slot, rendered at the top-right of the topbar. */
  actions?: ReactNode;
  user?: SidebarUser;
  children: ReactNode;
}

const SIDEBAR_WIDTH = 264; // px — design §3

/**
 * Application shell — design §3 layout framework.
 *
 * ≥1024px: fixed 264px sidebar + topbar + content (max-width 1440px,
 *          padding 24–32px). <1024px: sidebar collapses into a drawer with a
 *          hamburger toggle in the topbar.
 *
 * A11y: skip-to-content link is the first tab stop, the drawer is a labelled
 * dialog closed by Esc/backdrop, and hamburger carries aria-expanded.
 */
export function AppShell({
  title,
  subtitle,
  navVariant,
  actions,
  user,
  children,
}: AppShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  const hamburgerRef = useRef<HTMLButtonElement>(null);

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  // Focus the drawer when it opens; return focus to the hamburger when it
  // closes. (The drawer also closes on every nav link click via onNavigate.)
  useEffect(() => {
    if (!drawerOpen) return;
    const firstLink = drawerRef.current?.querySelector<HTMLElement>("a, button");
    firstLink?.focus();
    const hamburger = hamburgerRef.current;
    return () => {
      hamburger?.focus();
    };
  }, [drawerOpen]);

  const handleDrawerKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDrawer();
      }
    },
    [closeDrawer],
  );

  return (
    <div className="min-h-screen bg-white">
      {/* Skip-to-content — first tab stop (design §7) */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary-500 focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white"
      >
        Skip to content
      </a>

      {/* Desktop sidebar */}
      <div
        className="fixed inset-y-0 left-0 z-40 hidden lg:block"
        style={{ width: SIDEBAR_WIDTH }}
      >
        <AppSidebar variant={navVariant} user={user} />
      </div>

      {/* Mobile drawer */}
      {drawerOpen ? (
        <div
          className="fixed inset-0 z-50 lg:hidden"
          onKeyDown={handleDrawerKeyDown}
        >
          <div
            className="absolute inset-0 bg-backdrop"
            aria-hidden="true"
            onMouseDown={closeDrawer}
          />
          <div
            ref={drawerRef}
            id="app-navigation-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            className="absolute inset-y-0 left-0 max-w-[85vw] shadow-lg"
            style={{ width: SIDEBAR_WIDTH }}
          >
            <AppSidebar
              variant={navVariant}
              user={user}
              onNavigate={closeDrawer}
            />
            <button
              type="button"
              onClick={closeDrawer}
              aria-label="Close navigation"
              className="absolute right-2 top-4 flex size-10 items-center justify-center rounded-md text-gray-500 transition-colors duration-fast hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
            >
              <X className="size-5" aria-hidden="true" />
            </button>
          </div>
        </div>
      ) : null}

      {/* Content column */}
      <div className="lg:pl-[264px]">
        <header className="sticky top-0 z-30 flex min-h-16 items-center gap-4 border-b border-gray-200 bg-white/95 px-6 backdrop-blur lg:px-8">
          <button
            ref={hamburgerRef}
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-expanded={drawerOpen}
            aria-controls="app-navigation-drawer"
            aria-label="Open navigation"
            className="flex size-11 shrink-0 items-center justify-center rounded-md text-gray-700 transition-colors duration-fast hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 lg:hidden"
          >
            <Menu className="size-5" strokeWidth={1.75} aria-hidden="true" />
          </button>

          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-semibold text-gray-900">
              {title}
            </h1>
            {subtitle ? (
              <p className="truncate text-sm text-gray-500">{subtitle}</p>
            ) : null}
          </div>

          {actions ? (
            <div className="flex shrink-0 items-center gap-3">{actions}</div>
          ) : null}
        </header>

        <main
          id="main-content"
          className="mx-auto w-full max-w-[1440px] px-6 py-6 lg:px-8"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
