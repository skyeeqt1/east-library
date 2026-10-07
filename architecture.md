# ESCR Library Management System — Architecture

**Project:** East Systems Colleges of Rizal (ESCR) Library Management System
**Version:** 1.0
**Status:** Planning (pre-implementation)

---

## 1. System Overview

A school-exclusive, web-based library management system for ESCR. There is **no public
sign-up**: every account is created by an admin and tied to a valid ESCR Student ID.
Students request books; an admin manually approves each request only when a copy is
available. Loans last a maximum of **7 days**, after which daily cash penalties accrue.
Damaged books make the student financially accountable (replace or pay in pesos).

```
                       ┌──────────────────────────────┐
                       │        Next.js (Vercel /      │
                       │        self-hosted node)      │
                       │                              │
   Browser ──────────► │  Middleware (auth + role)     │
   (Admin / Student)   │  React UI (App Router)       │
                       │  Server Actions / Route      │
                       │  Handlers (business logic)   │
                       └──────────────┬───────────────┘
                                      │
                       Supabase client (anon key, RLS-scoped)
                                      │
                       ┌──────────────▼───────────────┐
                       │         Supabase             │
                       │  • Auth (email/password)     │
                       │  • Postgres + Row Level      │
                       │    Security                  │
                       │  • Storage (book covers,     │
                       │    damage photos)            │
                       │  • Edge Functions (overdue   │
                       │    cron, admin-only actions) │
                       └──────────────────────────────┘
```

---

## 2. Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| Framework | **Next.js 14+ (App Router, TypeScript)** | Server Components for dashboards, Server Actions for mutations |
| Styling | **Tailwind CSS** + design tokens | Untitled-UI token set (see `design.md`) |
| Charts | Recharts | Sparklines + trend charts on admin dashboard |
| Database | **Supabase Postgres** | Schema in `schema.md` |
| Auth | **Supabase Auth** (email/password) | Sign-up disabled; accounts created via admin server action using the service-role key |
| Authorization | Role claim in `user_roles` table + **RLS policies** | Defense in depth: middleware for redirects, RLS for data |
| Storage | Supabase Storage | `book-covers/`, `damage-photos/` buckets |
| Scheduled jobs | Supabase Edge Function + **pg_cron** | Daily overdue scan & fine accrual |
| Validation | Zod | Shared client/server input validation |
| Icons | lucide-sidebar icon set | Matches reference UI |

### Why Supabase
- **Auth without sign-up:** accounts created exclusively through the service-role key in
  admin-only server actions; the public sign-up endpoint is disabled in the dashboard.
- **RLS as a hard guarantee:** even if a route guard fails, a student cannot read
  another student's loans, approve requests, or modify book inventory.
- **Managed Postgres:** no database server to maintain for a school deployment.

---

## 3. Application Layers

```
app/
├── (auth)/login/               # Public: single login page (no signup route)
├── (admin)/admin/              # Guarded: role = ADMIN
│   ├── dashboard/              # Stat cards, charts, activity table
│   ├── requests/               # Pending borrow requests → approve/decline
│   ├── loans/                  # Active loans, returns, releases
│   ├── books/                  # Inventory CRUD, copies, replacement values
│   ├── students/               # Account creation / edit / block
│   ├── penalties/              # Overdue fines + payments
│   ├── damages/                # Damage reports & assessments
│   ├── reports/                # Circulation & collections reports
│   └── settings/               # Fine rate, loan days, admin profile
├── (student)/dashboard/        # Guarded: role = STUDENT
│   ├── ├──                     # My loans, due-soon, balances
│   ├── catalog/                # Browse + request books
│   ├── requests/               # My request statuses
│   ├── loans/                  # My active loans
│   └── penalties/              # My fines & damage charges
└── api/                        # Route handlers where server actions don't fit
    ├── supabase/               # BFF client helpers (cookies)
    └── cron/overdue/           # Secured cron endpoint (or Edge Function)

lib/
├── supabase/{server,client}.ts # Browser client (anon+RLS) vs server client (cookies)
├── auth/                       # Session parsing, role helpers, guards
├── rules/                      # Pure business-rule functions (see rules.md)
│   ├── borrow.ts               #  request → approve → release → due date
│   ├── overdue.ts              #  daily fine accrual
│   └── damage.ts               #  damage assessment → replacement fine
└── validations/                # Zod schemas

components/
├── ui/                         # Button, Card, Table, Badge, Modal, Input…
├── admin/                      # StatCard, RequestRow, BookForm…
└── student/                    # LoanCountdownCard, CatalogCard…
```

---

## 4. Authentication & Session Flow

1. User visits `/login` and submits **Student ID (or admin email) + password**.
2. Server action resolves the identifier → synthetic Supabase auth email
   (`{student_id}@escr.students` for students, `{email}` for admins) and calls
   `supabase.auth.signInWithPassword`.
3. Session cookie is set (Supabase SSR cookie adapter).
4. `middleware.ts` reads the session, loads the role from `profiles` / `user_roles`,
   and redirects:
   - `ADMIN` → `/admin/dashboard`
   - `STUDENT` → `/dashboard`
   - unauthenticated → `/login`
5. Any `/signup`, `/register`, `/auth/callback-signup` path → **404** (never exposed).

### Two Supabase clients
| Client | Key | Used for | RLS |
|---|---|---|---|
| Browser/server client | `anon` + user session | All reads/writes by logged-in users | Policies apply |
| Server-only admin client | `service_role` (env, never shipped to client) | Creating accounts, admin decision writes, cron | Bypasses RLS — only called inside admin-guarded server actions |

---

## 5. Authorization Model

| Capability | STUDENT | ADMIN |
|---|---|---|
| Browse catalog | ✅ | ✅ |
| Submit borrow request | ✅ (self only) | — |
| Approve / decline request | ❌ | ✅ |
| Release book / mark returned | ❌ | ✅ |
| Create / edit / block accounts | ❌ | ✅ |
| CRUD books & copies | ❌ | ✅ |
| Record fines & payments | ❌ (view own only) | ✅ |
| Assess damage | ❌ | ✅ |
| Change settings (fine rate, loan days) | ❌ | ✅ |

Enforced **twice**: route-level middleware (UX) + Postgres RLS policies (security).

---

## 6. Key Flows (system perspective)

### 6.1 Request → Loan
```
Student submits request
  → INSERT loan_requests (status=PENDING)          [RLS: student = auth.uid()]
  → Admin opens /admin/requests
  → Admin clicks Approve
      → Server action (service role) re-checks available_copies > 0
      → status=APPROVED, then release: INSERT loans (due_date = now() + 7 days)
      → book_copies.status: AVAILABLE → ON_LOAN
  → Or Decline: status=DECLINED + reason (no penalty)
```

### 6.2 Overdue accrual (daily, 00:05 via pg_cron)
```
For each loan WHERE returned_at IS NULL AND due_date < now():
  → loan.status = 'OVERDUED'
  → days_late = date_diff(now, due_date)
  → upsert fines (type='OVERDUE', amount = days_late × settings.overdue_fee_per_day)
```
Fine amount is *recomputed*, never accumulated, to avoid double-billing.

### 6.3 Return & damage
```
Admin marks return
  → If overdue: finalize OVERDUE fine (already accrued)
  → Admin indicates condition:
      GOOD  → copy.status = AVAILABLE
      DAMAGED → create damage_reports + fine(type='DAMAGE',
                amount = book.replacement_value) + copy.status = DAMAGED
  → Student blocked from new requests until all fines are PAID or WAIVED
```

---

## 7. Cross-Cutting Concerns

| Concern | Approach |
|---|---|
| **Validation** | Zod schemas shared between client forms and server actions |
| **Audit trail** | `audit_logs` written on every approve/decline/return/fine/account action |
| **Time** | All timestamps `timestamptz`, app timezone `Asia/Manila`; due dates computed in SQL (`now() + interval '7 days'`) |
| **Money** | Integer **centavos** in DB (`amount_centavos`), displayed as ₱ with 2 decimals |
| **Error states** | Every table/card defines empty, loading (skeleton), and error states |
| **Responsive** | Mobile-first; sidebar collapses to drawer < 1024px |
| **Accessibility** | WCAG AA contrast, keyboard navigation, focus rings (see `design.md`) |
| **Secrets** | `SUPABASE_SERVICE_ROLE_KEY` server-only; exposed keys rotated if leaked |

---

## 8. Environment Variables

```bash
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...     # server-only
NEXT_PUBLIC_APP_URL=https://library.escr.edu.ph
DEFAULT_TIMEZONE=Asia/Manila
```

---

## 9. Deployment

- **App:** Vercel or a school Node server (Docker image provided at implementation).
- **DB/Auth/Storage:** Supabase project (region: Southeast Asia for latency).
- **Cron:** `pg_cron` + Supabase scheduled Edge Function for the daily overdue job.
- **Backups:** Supabase PITR / daily scheduled exports.

---

## 10. Milestones (build order)

| Phase | Scope |
|---|---|
| 0 | Scaffold, tokens, Supabase clients, middleware + role guards, login |
| 1 | Admin account creation, student list (service role) |
| 2 | Book inventory + copies CRUD |
| 3 | Request → approve/decline with availability check |
| 4 | Release, 7-day due dates, returns |
| 5 | Overdue cron, fines, damage reports, payments, blocking |
| 6 | Admin dashboard UI (replicate reference image) |
| 7 | Student dashboard UI (distinct card-based design) |
| 8 | Reports/export, responsive + a11y polish, seed data |

---

## 11. Out of Scope (v1)

- Online payment gateways (fines are recorded as **cash received** by the admin)
- Barcode/QR scanning hardware integration
- SMS/email notifications (in-app banners only; email via Supabase optional later)
- Multi-campus / multi-library support
- Student self-service profile editing beyond password change
