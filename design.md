# ESCR Library Management System — Design System

**Reference UI:** Untitled UI "Site traffic" dashboard (white sidebar, stat cards with
sparklines, tab pills, paginated data table — see project reference image).
**Applies to:** Admin dashboard + Student dashboard (shared tokens, distinct layouts).

---

## 1. Design Principles

1. **Consistency over novelty** — one token set, one component library, zero one-off styles.
2. **Data-dense for admins, calm and friendly for students** — same DNA, different density.
3. **Clarity of state** — every request/borrow/fine always shows a color-coded status.
4. **Accessible by default** — WCAG 2.1 AA (4.5:1 text contrast) baked into tokens.
5. **Mobile-first** — usable on a school lab desktop *and* a student's phone.

---

## 2. Design Tokens

### 2.1 Color

```css
:root {
  /* Brand / Primary (ESCR seal red — sampled from logo.png, the school seal)
     White on primary-500 = 5.4:1, white on primary-600 = 6.6:1 (AA ✓) */
  --primary-25:  #FEF4F4;
  --primary-50:  #FDE8E8;
  --primary-100: #FBD2D2;
  --primary-300: #F19999;
  --primary-500: #D32020;   /* buttons, active nav, chart lines */
  --primary-600: #B71C1C;   /* hover */
  --primary-700: #9E1616;   /* active */

  /* Accent (ESCR seal gold — decorative only: rules, marks, graphics.
     Never carries text — 1.2:1 on white.) */
  --gold-400: #F5D90A;
  --gold-500: #E0B400;
  --gold-700: #9E7A00;

  /* Neutrals */
  --gray-25:  #FCFCFD;
  --gray-50:  #F9FAFB;   /* page background, sidebar hover */
  --gray-100: #F2F4F7;   /* table header, chips */
  --gray-200: #E4E7EC;   /* borders */
  --gray-300: #D0D5DD;
  --gray-500: #667085;   /* secondary text (AA on white ✓) */
  --gray-700: #344054;
  --gray-900: #101828;   /* headings */

  /* Semantic */
  --success-25:  #F6FEF9;  --success-500: #12B76A;  --success-700: #027A48;
  --warning-25:  #FFFCEB;  --warning-500: #F79009;  --warning-700: #B54708;
  --error-25:    #FFFBFA;  --error-500:   #F04438;  --error-700:   #B42318;
  --info-25:     #F5F8FF;  --info-500:    #2E90FA;
}
```

**Status → color mapping (used everywhere):**

| Status | Token | Badge style |
|---|---|---|
| Pending / Requested | `warning` | 🟠 orange pill |
| Approved | `info` | 🔵 blue pill |
| Borrowed out / Active | `success` | 🟢 green pill *(rev. — was `primary` seal-red; brand red read as an error, user request 2026-10-10)* |
| Returned | `gray` | ⚫ gray pill *(rev. — moved off `success` so Returned stays distinguishable from Active)* |
| Paid fine | `success` | 🟢 green pill |
| Overdue / Unpaid fine | `error` | 🔴 red pill |
| Declined / Blocked / Damaged | `gray-700` | ⚫ gray pill |

**Dark theme (optional, phase 8):** invert neutrals (`--gray-900` bg, `--gray-50` text),
keep primary/semantic hues, dim surfaces by +4% lightness.

### 2.2 Typography

```css
--font-sans: 'Inter', ui-sans-serif, system-ui, sans-serif;   /* everything */
--font-mono: 'JetBrains Mono', ui-monospace;                  /* IDs, ISBN, ₱ values */

/* Scale */
--text-xs:   0.75rem/1rem;        /* 12px — table meta, badges */
--text-sm:   0.875rem/1.25rem;    /* 14px — body, table cells */
--text-base: 1rem/1.5rem;         /* 16px — default body */
--text-lg:   1.125rem/1.75rem;    /* 18px — card titles */
--text-xl:   1.25rem/1.75rem;     /* 20px — page titles */
--text-2xl:  1.5rem/2rem;         /* 24px — stat numbers */
--text-4xl:  2.25rem/2.5rem;      /* 36px — hero metric */

/* Weights: 400 regular · 500 medium (nav, buttons) · 600 semibold (headings) */
--tracking-tight: -0.02em;        /* big numbers only */
```

### 2.3 Spacing (4px base)

`4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48 · 64` px
(`space-1` … `space-16`). Table cells = 16px vertical / 24px horizontal.
Card padding = 24px. Grid gutter = 24px.

### 2.4 Elevation, radius, motion

```css
--radius-sm: 6px;    /* badges, inputs */
--radius:    8px;    /* buttons, table wrapper */
--radius-lg: 10px;   /* cards */
--radius-xl: 12px;   /* modals */

--shadow-xs: 0 1px 2px rgba(16,24,40,.05);            /* cards, buttons */
--shadow-md: 0 4px 8px -2px rgba(16,24,40,.10);       /* dropdown */
--shadow-lg: 0 12px 16px -4px rgba(16,24,40,.08);     /* modal */

--duration-fast: 150ms; --duration: 200ms; --ease: cubic-bezier(.4,0,.2,1);
/* All motion wrapped in @media (prefers-reduced-motion: reduce) */
```

**Motion behaviors (app/template.tsx + app/layout.tsx + globals.css):**

| Trigger | Animation |
|---|---|
| Page open (full load or reload) and page switch (sidebar / path navigation) | Landing cascade — **every content block** of the page fades up **top to bottom**, one beat every 50ms (max 16 beats), 320ms per block; the wipe is suppressed while the cascade runs. Beats are Web Animations (`el.animate`, no DOM attributes — React 19 flags pre-hydration attribute injection) created by the marker in the inline script of app/layout.tsx: it walks the visible `.escr-landing-page` in DOM order, descends containers up to 3 levels, keeps tables/lists whole, forms included, cap 16 beats. Armed via `html.escr-cascade` (pre-paint on document loads, by PageTransition whenever the pathname changes), disarmed once settled (beat count × 50ms + 470ms, never before 750ms) |
| Same-path updates (tabs, status pills, pagination, search/filter) | `escr-page-in` — content fades in **top to bottom**: clip-path sweep reveals the page downward while opacity ramps, 200ms |
| Mobile drawer / backdrop | slide-in 250ms / fade 150ms |
| Toast / modal | slide-up 220ms / scale-fade 200ms |

One mechanism covers every switch: `PageTransition` re-runs the marker
(`'restart'` mode — beats replay from 0) on every pathname change
(fresh template mount or in-place RSC patch) and replays the wipe for
same-path patches (its MutationObserver) — search, tab and filter
updates never re-trigger the cascade. Mutations that stay **inside a
`<form>`** (pending spinners, button label swaps, error alerts, field
errors) are exempt from the replay — form feedback must never flash
the page (login Enter). Query-only template remounts
(Next remounts templates on `searchParams` changes too) are detected
via `lastPathname` and do not arm. Pages opt in with the
`.escr-landing-page` class on their root (every app page has it;
unmarked routes such as 404 fall back to the wipe) — content blocks
need no per-element markup.
Wipe suppression while armed keys off `data-cascade="on"` on `<html>` —
derived from the **visible** page content, because Next keeps the
previous page's root hidden (`display:none`) inside the wrapper after
soft navigations, and a `:has(.escr-landing-page)` check would false-match
that stale root and kill the wipe on unmarked targets. Disarming swaps
the flag for `escr-landing-done` (a pin) so the wipe never restarts
mid-session; the next switch lifts the pin before re-arming.

**Reduced motion:** global `0.01ms` override + the marker cancels and
skips all WAAPI beats (explicit `matchMedia` guard) + the
MutationObserver is never attached — content appears instantly.

---

## 3. Layout Framework

```
┌───────────────┬──────────────────────────────────────────────┐
│               │  Topbar: Page title            [Primary btn]│
│   SIDEBAR     ├──────────────────────────────────────────────┤
│   264px       │  Tabs / filter pills                        │
│               ├──────────────────────────────────────────────┤
│  ◉ ESCR logo  │  ┌─────────┐ ┌─────────┐ ┌─────────┐        │
│               │  │ StatCard│ │ StatCard│ │ StatCard│        │
│  ▸ Dashboard  │  ┌──────────────────────────────────────┐    │
│  ▸ Requests   │  │  Data table (search · filters ·      │    │
│  ▸ Books      │  │  badges · actions · pagination)      │    │
│  …            │  └──────────────────────────────────────┘    │
│               │                                              │
│  ───────────  │  max-width 1440px, padding 24–32px           │
│  [avatar]     │                                              │
│  name · ID    │                                              │
│  ⏻ Sign out   │                                              │
└───────────────┴──────────────────────────────────────────────┘
```

- **Breakpoints:** mobile 320 · sm 640 · md 768 · lg 1024 (sidebar ≥1024, drawer <1024) · xl 1280.
- Sidebar: fixed left, white bg, right border `gray-200`; active item = `gray-100` pill with
  `primary-500` icon — exactly as in the reference.
- Page background: `--gray-50` for content? **No** — content area is white (as reference),
  cards use `white` + 1px `gray-200` border + `shadow-xs`.

---

## 4. Component Library

### 4.1 Buttons
| Variant | Style | Usage |
|---|---|---|
| Primary | `primary-500` bg, white text, `shadow-xs`, hover `primary-600` + `translateY(-1px)` | Approve, Create account, Export report |
| Secondary | white bg, `gray-300` border, `gray-700` text | Filters, Cancel, Switch dashboard |
| Ghost | transparent, hover `gray-50` | Row icons, overflow menus |
| Danger | `error-500` bg / outline | Decline, Block, Delete |
Sizes: **sm 32px · md 40px · lg 44px** (44px default = touch target).
All: `focus-visible` → 2px `primary-500` ring, 2px offset.

### 4.2 Stat card (from reference)
```
┌──────────────────────────────────────────┐
│ Books out                           ⋮  │   ← header: 14px/500 gray-500
│                                          │
│ 128   ↗ 2.4%  vs last week              │   ← number 24–36px/600 gray-900 (−0.02em)
│                                          │      delta 12px/500 success-500 ▲ or error-500 ▼
│ ▁▂▃▂▁▂▃▅▄▃▂▁▂▃▄▅▆▅▄▃▂▁▂▃▅                  │   ← 48px sparkline, primary-500, gradient fill 8%
└──────────────────────────────────────────┘
```
- 3 across ≥1024px, 2 across ≥640px, 1 across on mobile.
- Sparkline: 7–30 points, no axes, `strokeWidth 2`, area fill `rgba(211,32,32,.08)`.

### 4.3 Tabs / filter pills
Container `gray-100` (or bordered), active pill = white bg + `shadow-xs` + `gray-900` text;
inactive `gray-500`. Counts shown as `Pending (12)`.

### 4.4 Data table
- Wrapper: `radius-lg`, 1px border, overflow hidden.
- Header: 44px, `gray-50` bg, 12px/500 `gray-500`, sortable ⇅.
- Rows: 60px min, bottom border `gray-100`, hover `gray-25`, checkbox column 44px.
- Cells: 14px; primary cell = `gray-900` 500 + secondary line 12px `gray-500`.
- Actions: ghost icon buttons (eye / pencil / trash) with `aria-label`.
- Footer: "Page 1 of 10 · 10 per page ▾" left, `Previous / Next` right (secondary, sm).
- Responsive: horizontal scroll < 768px, or stacked cards on mobile.

### 4.5 Badges (status pills)
`padding 2px 8px`, radius 999px, 12px/500, colored dot + light tint bg
(e.g. overdue = `error-25` bg / `error-700` text / `error-500` dot).

### 4.6 Forms
- Label 14px/500 `gray-700` above, 8px gap.
- Input h-40px, radius 8px, border `gray-300`, focus: border `primary-500` +
  `box-shadow 0 0 0 4px rgba(211,32,32,.12)`.
- Error: border `error-500` + 12px `error-500` message, `aria-invalid`.
- Helper text 12px `gray-500`.

### 4.7 Feedback
- **Modal:** 480px, radius-xl, backdrop `rgba(16,24,40,.55)`, focus trap,
  Esc to close. Used for Approve/Decline confirmations and Create Account.
- **Toast:** bottom-right, 360ms auto-dismiss, success/error variants.
- **Skeletons:** gray-100 shimmer blocks matching final layout.
- **Empty states:** icon + 16px title + 14px description + primary CTA.
- **Inline alert:** tinted bg + icon + message (e.g. *"Student has unpaid fines — request blocked"*).

---

## 5. Admin Dashboard Design (reference-matched)

**Route:** `/admin/dashboard` · Page title "Library Dashboard"
Top-right actions: `Switch dashboard` (secondary) · `Export report` (primary).

1. **Tab row:** All activity · Pending requests · Overdue · Returns · Fines
2. **Three stat cards:** `Total books` · `Books out` · `Overdue this week`
   (each with delta vs last week + sparkline)
3. **"Borrow activity" table** — columns:
   `checkbox · Student (ID) · Book · Requested/Released · Due date · Status · Actions`
   with search field (`⌘K` hint), `Filters` button, status filter pills, pagination —
   identical chrome to the reference image's "Pages and screens" table.

**Admin pages rhythm:** header → tabs → (stat cards where relevant) → toolbar → table → pagination.

**Distinct admin pages:**
- `/admin/requests` — priority list with inline **Approve / Decline** and an
  availability indicator (green "3 copies free" / red "No copies").
- `/admin/students` — table + **"Create account"** primary button → modal form
  (Student ID, name, course/section, phone, temp password).
- `/admin/books` — grid/table hybrid, cover thumbnails, copies sub-table.
- `/admin/penalties` — grouped-by-student fines with ₱ totals and `Record payment`.
- `/admin/damages` — photo thumbnails, assessed value, resolve actions.

---

## 6. Student Dashboard Design (deliberately different)

**Not** a dense data table UI. Friendly, card-based, countdown-first.

```
┌────────────────────────────────────────────────────┐
│  Hello, Maria!  ·  2024-1056 · BSIT 2A     [avatar]│  ← soft seal-red gradient banner
├────────────────────────────────────────────────────┤
│ ┌──────────┐ ┌──────────┐ ┌──────────────────┐     │
│ │ 2 books  │ │ Due in   │ │ Balance          │     │
│ │ out      │ │ 3 days ⏱│ │ ₱0.00            │     │
│ └──────────┘ └──────────┘ └──────────────────┘     │
│                                                    │
│ 📚 My borrowed books                                 │
│ ┌──────────────────────────────────────────────┐   │
│ │ 📖 The Great Gatsby          ⏱ 3 days left   │   │
│ │ Due Oct 14, 2026             [View details]  │   │
│ └──────────────────────────────────────────────┘   │
│                                                    │
│ ⏳ Pending requests                                │
│ • Clean Code — awaiting approval…                  │
└────────────────────────────────────────────────────┘
```

**Student pages:**

| Route | Design |
|---|---|
| `/dashboard` | Greeting banner + 3 hero cards + borrowed-book countdown cards + pending-request feed |
| `/dashboard/catalog` | Responsive **cover-card grid** (2/3/5 cols), search + category chips, per-card availability dot + `Request book` button (disabled state: "Already requested" / "No copies") |
| `/dashboard/requests` | Vertical **stepper timeline** per request: Requested → Reviewed → (Released) with timestamps & decline reason |
| `/dashboard/loans` | Big countdown chip: green >3 days · orange ≤3 days · red overdue with live ₱ owed |
| `/dashboard/penalties` | Statement-style list: type, book, days, amount ₱, status, payment instructions |
| `/dashboard/profile` | Read-only account card + change-password form |

**Countdown chip:** pill with clock icon; `success` >3d, `warning` 1–3d, `error` overdue.

**Balance figures:** always `error-700` red (dashboard hero + penalties hero, even at ₱0.00) — a balance is money owed, never `success` green.

---

## 7. Accessibility (WCAG 2.1 AA)

- **Contrast:** all text ≥ 4.5:1 (gray-500 on white = 4.6 ✓); large metrics ≥ 3:1.
- **Focus:** visible 2px `primary-500` outline, 2px offset, never removed.
- **Keyboard:** tables navigable, modals focus-trapped, `Esc` closes overlays,
  skip-to-content link as first tab stop.
- **Touch targets:** ≥ 44×44px on mobile.
- **Semantics:** real `<table>`/`<th scope>`, `<nav aria-label>`, live regions for toasts,
  icon-only buttons carry `aria-label`.
- **Motion:** honours `prefers-reduced-motion`.
- **Zoom:** layouts hold to 200% browser text zoom.

---

## 8. Assets & Handoff

- **Icons:** lucide-react, 20px default / 16px in tables, `strokeWidth 1.75`.
- **Logos:** ESCR seal — `public/logo.png` (256px PNG) in sidebar top + both login
  lockups; favicon = `app/icon.png` (128px seal). Gold accent rule under the login hero.
- **Book covers:** fallback = primary-100 block with title initials.
- **Fonts:** Inter (400/500/600/700) via `next/font`, self-hosted.
- **Handoff notes:** every component maps 1:1 to Tailwind classes using the tokens above;
  spacing/radius/shadow values are never hardcoded outside `tailwind.config.ts`.
