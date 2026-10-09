import type { ReactNode } from "react";
import { PageTransition } from "@/components/layout/page-transition";

/**
 * Page transition template — every switch fades in from top to bottom
 * (clip-path sweep + opacity, design §2.4):
 *
 * - Page open / page switch → staggered landing cascade on pages marked
 *   `.escr-landing-page` (their auto-marked content blocks stagger top
 *   to bottom while `html.escr-cascade` is armed — pre-paint by
 *   app/layout.tsx's inline script on document loads, by PageTransition
 *   whenever the pathname changes, disarmed after it settles).
 * - Query-only switches (tabs, status pills, pagination via
 *   router.replace) and search/filter patches → PageTransition's
 *   MutationObserver replays the uniform wipe on the patched content.
 * - Full page load / layout-group navigation → cascade on mount.
 *
 * One mechanism for every case keeps the direction consistent — a View
 * Transitions crossfade would dissolve uniformly and hide the sweep.
 *
 * Reduced motion: the global 0.01ms override in globals.css neutralises
 * the keyframes (duration and delay), and the observer is never attached.
 */
export default function Template({ children }: { children: ReactNode }) {
  return <PageTransition>{children}</PageTransition>;
}
