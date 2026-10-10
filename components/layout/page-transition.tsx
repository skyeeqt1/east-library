"use client";

import { useCallback, useEffect, useRef, type ReactNode } from "react";

/**
 * Content wrapper that drives both transition states (design §2.4):
 *
 * - Page open / page switch → staggered landing cascade (`escr-cascade`
 *   on <html> + WAAPI beats on `.escr-landing-page` content).
 *   Armed pre-paint on document loads by app/layout.tsx's inline script,
 *   which also starts the beats on EVERY content block of the visible
 *   page (DOM order, up to 16 beats) — restarted here whenever the
 *   pathname changes (fresh template mount or in-place RSC patch —
 *   sidebar links, tool pages) and disarmed once the cascade settles
 *   (disarm scales with beat count).
 * - In-place updates (tabs, status pills, pagination, search/filter —
 *   pathname unchanged) → the uniform 200ms wipe (`escr-page-in`),
 *   replayed by a MutationObserver on this wrapper so patches that keep
 *   the template mounted still animate. Cascading on these would
 *   re-flash whole sections on every keystroke. Mutations whose every
 *   target sits inside a `<form>` are skipped (pending spinner, button
 *   label, error alert, field errors) — form feedback must never
 *   flash the page (login Enter).
 *
 * Why the pin: re-enabling `escr-page-in` by dropping a suppression
 * class restarts the wipe from 0 (visible pop). Disarm swaps
 * `escr-cascade` for `escr-landing-done`, which pins the wipe off; both
 * replay paths lift the pin before restarting an animation.
 *
 * Notes:
 * - Attribute-only changes (e.g. aria-pressed on tab pills) intentionally
 *   do not trigger — the pill already has its own color transition.
 * - Overlays are unaffected: modal and toast portal to document.body,
 *   outside this wrapper; there are no in-page dropdowns.
 * - Reduced motion: the observer is never attached, the marker
 *   cancels/skips all WAAPI beats (its own matchMedia guard), and
 *   globals.css keeps the global 0.01ms animation override as a
 *   third net.
 */

// Survives template remounts (one client bundle per session); the mount
// effect below seeds it on first mount.
let lastPathname: string | null = null;

type CascadeWindow = { __escrMarkCascade?: (mode?: "add" | "restart") => number };

// Re-runs the beat marker (defined by the pre-paint inline script in
// app/layout.tsx). Beats are Web Animations on every content block of
// the visible page (DOM order, up to 16 beats) — WAAPI writes nothing
// React diffs, so this is hydration-safe at any timing. 'restart'
// cancels and replays from beat 1 (page switch); 'add' keeps running
// beats and only animates blocks that appeared since (hydration
// mount, streaming). Returns the beat count so the disarm can scale
// with cascade length. 0 = no marker or no marked page.
const markCascadeBeats = (mode: "add" | "restart"): number =>
  (window as unknown as CascadeWindow).__escrMarkCascade?.(mode) ?? 0;

export function PageTransition({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const disarmTimer = useRef<number | null>(null);

  const clearDisarm = useCallback(() => {
    if (disarmTimer.current !== null) {
      window.clearTimeout(disarmTimer.current);
      disarmTimer.current = null;
    }
  }, []);

  // Cascade settles at (beats-1)*50 + 320ms; +150ms headroom for late
  // hydration, never earlier than the historical 750ms. Swapping (not
  // just removing) the flag keeps the wipe from restarting mid-session.
  const scheduleDisarm = useCallback((beats: number) => {
    clearDisarm();
    const settle =
      beats > 0 ? (beats - 1) * 50 + 320 + 150 : 750;
    disarmTimer.current = window.setTimeout(() => {
      const html = document.documentElement;
      html.classList.remove("escr-cascade");
      html.classList.add("escr-landing-done");
      disarmTimer.current = null;
    }, Math.max(750, settle));
  }, [clearDisarm]);

  // `data-cascade="on"` on <html> = "the VISIBLE page is a landing
  // page → suppress the wipe while the cascade runs". Judged from
  // rendered content (getClientRects), never from `:has` — Next keeps
  // the previous page's root in this wrapper after soft navigations
  // (display:none), and a stale hidden `.escr-landing-page` would
  // otherwise suppress the wipe on unmarked targets. Lives on <html>
  // (suppressHydrationWarning) — setting it on the wrapper would
  // mismatch hydration, since the inline script writes it pre-paint.
  const syncCascadeAttr = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const landingVisible = [...el.querySelectorAll(".escr-landing-page")]
      .some((n) => n.getClientRects().length > 0);
    if (landingVisible) document.documentElement.setAttribute("data-cascade", "on");
    else document.documentElement.removeAttribute("data-cascade");
  }, []);

  // Fresh mount = document load, template remount on navigation, or a
  // query-only remount (Next remounts templates on searchParams change
  // too — search/tab typing must NOT re-arm the cascade, only the
  // observer's wipe below). Arm + lift the pin only when the pathname
  // actually changed (lastPathname seeded null → first mount arms);
  // sync the wipe switch, then schedule the disarm.
  useEffect(() => {
    const html = document.documentElement;
    const path = window.location.pathname;
    const pathChanged = lastPathname !== path;
    lastPathname = path;
    if (pathChanged) {
      // Page open: arm (already set on first load — no-op), sync the
      // wipe switch, then lift the pin so it can't suppress the mount
      // animation. Order matters: the switch must be settled while the
      // pin still holds `escr-page-in` off, or the wipe would start
      // and pop.
      html.classList.add("escr-cascade");
      syncCascadeAttr();
      html.classList.remove("escr-landing-done");
    }
    // Schedule a disarm whenever the cascade is armed — page opens, and
    // remounts while a cascade is running (the cleanup below clears
    // this timer on unmount; StrictMode's double mount re-schedules).
    // A query-only remount with the cascade disarmed schedules nothing.
    if (pathChanged || html.classList.contains("escr-cascade")) {
      scheduleDisarm(markCascadeBeats("add"));
    }
    return clearDisarm;
  }, [clearDisarm, scheduleDisarm, syncCascadeAttr]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let queued = false;
    let pendingRecords: MutationRecord[] = [];

    // Form-interior mutation: the host (parent for childList records,
    // the text's parent for characterData) sits inside a <form> —
    // pending spinners, button label swaps, error alerts, field errors.
    // Replaying the wipe for these flashed the whole login screen the
    // moment Enter was pressed (server-action pending state), so form
    // feedback never re-animates the page; content patches outside
    // forms (rows, pills, sections) keep the designed wipe.
    const isFormInterior = (m: MutationRecord): boolean => {
      const host =
        m.type === "characterData" ? m.target.parentElement : m.target;
      return host instanceof Element && host.closest("form") !== null;
    };

    const replay = (records?: MutationRecord[]) => {
      if (records) pendingRecords.push(...records);
      if (queued) return;
      queued = true;
      // One restart per frame: burst mutations from a single commit
      // coalesce, and the URL is read here (not in the observer) so the
      // latest navigation wins the batch.
      requestAnimationFrame(() => {
        queued = false;
        const batch = pendingRecords;
        pendingRecords = [];
        const path = window.location.pathname;
        const isPageSwitch = path !== lastPathname;
        lastPathname = path;

        if (isPageSwitch) {
          // Real page switch → cascade. Toggle the flag so beats
          // restart from 0, re-derive the wipe switch for the new
          // visible page, lift the pin (unmarked pages fall back to
          // the wipe), re-mark ALL of its content blocks for the
          // staggered reveal, and push the disarm deadline out from now
          // scaled to the beat count.
          const html = document.documentElement;
          html.classList.remove("escr-cascade");
          html.classList.remove("escr-landing-done");
          el.classList.remove("escr-page-in");
          void el.offsetWidth; // force reflow so animations restart
          html.classList.add("escr-cascade");
          syncCascadeAttr();
          el.classList.add("escr-page-in");
          scheduleDisarm(markCascadeBeats("restart"));
        } else {
          // Pure form feedback (pending state, alerts, validation
          // messages) → no wipe, no cascade: the page must hold still.
          if (batch.length > 0 && batch.every(isFormInterior)) return;
          // Same-path update (filters, tabs, streaming) → plain wipe,
          // never a cascade. Exception: while the cascade is still
          // armed, incoming content belongs to it (streaming) — re-mark
          // (the new blocks join the cascade) and push the disarm out;
          // restarting the wipe now would cut through the running
          // reveal.
          const armed =
            document.documentElement.classList.contains("escr-cascade");
          if (armed) {
            syncCascadeAttr();
            scheduleDisarm(markCascadeBeats("add"));
            return;
          }
          document.documentElement.removeAttribute("data-cascade");
          el.classList.remove("escr-page-in");
          document.documentElement.classList.remove("escr-landing-done");
          void el.offsetWidth; // force reflow so the animation restarts
          el.classList.add("escr-page-in");
        }
      });
    };

    const observer = new MutationObserver((records) => replay(records));
    observer.observe(el, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    return () => observer.disconnect();
  }, [scheduleDisarm, syncCascadeAttr]);

  return (
    <div ref={ref} className="escr-page-in">
      {children}
    </div>
  );
}
