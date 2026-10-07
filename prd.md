# ESCR Library Management System — Product Requirements Document (PRD)

**Product:** ESCR Library Management System ("ESCR Library")
**Client:** East Systems Colleges of Rizal (ESCR)
**Version:** 1.0 · **Status:** Approved for planning · **Last updated:** Oct 7, 2026

---

## 1. Executive Summary

A closed, web-based library management system reserved **exclusively for ESCR
students and staff**. The admin (librarian) is the sole owner of the account
lifecycle: there is no public registration. Students browse the catalog and
*request* books; nothing is borrowed until the admin approves and releases a copy.
Loans run for a maximum of **7 days**, enforced with automatic **₱ cash penalties
per day** when overdue, and students are financially accountable for any book they
damage (replace or pay its value in pesos).

The system replaces manual logbooks with a real-time dashboard, eliminates
unauthorized access from non-ESCR users, and gives the school a clear, auditable
record of every circulation, penalty, and damage event.

---

## 2. Goals & Success Metrics

| # | Goal | Metric |
|---|---|---|
| G1 | Only ESCR members can use the system | 0 accounts created outside admin flow |
| G2 | Enforce 7-day loans | 100% of loans have a due date ≤ release + 7 days |
| G3 | Recover overdue losses | Overdue fines auto-computed for 100% of late returns |
| G4 | Recover damage losses | 100% of damaged books produce a replacement charge |
| G5 | Faster circulation processing | Admin handles a request in < 30 seconds |
| G6 | Reliable daily operations | Dashboard loads < 2s; 99%+ uptime |

---

## 3. Users & Personas

### 3.1 Admin (Librarian / staff)
- Manages the entire system: accounts, books, requests, returns, penalties, damages.
- Needs speed and density: tables, filters, bulk visibility of what needs attention.
- Trust level: highest; every sensitive action is audit-logged.

### 3.2 Student (ESCR enrollee)
- Logs in with Student ID + password issued by the admin.
- Browses the catalog, requests books, tracks due dates and any balance owed.
- Never sees other students' data; never approves anything.

### 3.3 Non-user (public / non-ESCR person)
- Has no path into the system: no sign-up page, no public registration, unknown
  credentials rejected. Requests to create an account go through the admin.

---

## 4. Scope

### 4.1 In Scope (v1)
1. Credential login (no sign-up); role-based dashboards (admin vs student).
2. Admin-created, Student-ID-based accounts (create / edit / block / reset password).
3. Book inventory with per-copy availability tracking and replacement values.
4. Request → manual approve/decline workflow with availability enforcement.
5. 7-day loan lifecycle: release, return, auto overdue detection.
6. Overdue cash penalties (₱/day, configurable) + damage replacement charges.
7. Fine payment recording (cash) and student blocking until settled.
8. Admin dashboard (reference UI) + distinct student dashboard.
9. Reports (circulation, overdue, collections) with CSV/print export.
10. Audit log of all admin actions.

### 4.2 Out of Scope (v1)
- Online payments / gateways (fines are settled in cash at the library).
- Public browsing of the catalog (login required).
- Email/SMS notifications (in-app only; optional later).
- Barcode/QR hardware, RFID, multi-campus support, e-book lending.

---

## 5. Functional Requirements

| ID | Requirement | Priority |
|---|---|---|
| **Auth** |||
| FR-01 | System shall authenticate users via Student ID (students) / credentials (admin) + password using Supabase Auth | P0 |
| FR-02 | System shall **not** expose any sign-up or registration route | P0 |
| FR-03 | System shall redirect users by role: admin → `/admin/*`, student → `/dashboard/*` | P0 |
| **Accounts** |||
| FR-04 | Admin shall create a student account requiring: Student ID (unique), full name, course/section, password | P0 |
| FR-05 | Admin shall edit, block/unblock, and reset passwords of student accounts | P1 |
| FR-06 | Students shall change their own password | P1 |
| **Catalog** |||
| FR-07 | Admin shall manage books: title, author, ISBN, category, cover, shelf code, copies, replacement value (₱) | P0 |
| FR-08 | System shall track availability per copy (AVAILABLE / ON_LOAN / DAMAGED / LOST) | P0 |
| **Requests** |||
| FR-09 | Student shall submit a borrow request for an available book; status = PENDING | P0 |
| FR-10 | Student shall have at most **1 active request per book** and a configurable max of **3 active loans** | P1 |
| FR-11 | Admin shall approve a request **only if ≥ 1 copy is available**; otherwise the action is blocked with an error | P0 |
| FR-12 | Admin shall decline a request with an optional reason; no penalty applies | P0 |
| FR-13 | Student may cancel their own pending request | P1 |
| **Loans** |||
| FR-14 | On release, system shall set `due_date = release + 7 days` (configurable constant) | P0 |
| FR-15 | Admin shall record book return; system finalizes any overdue fine | P0 |
| FR-16 | System shall recompute overdue fines daily and mark loans OVERDUE | P0 |
| **Penalties & damage** |||
| FR-17 | Overdue fine = days late × `overdue_fee_per_day` (default **₱10/day**) | P0 |
| FR-18 | Admin shall record a damage assessment; fine = book's replacement value (₱) | P0 |
| FR-19 | Admin shall mark fines PAID (cash) or WAIVED (with reason, audit-logged) | P0 |
| FR-20 | A student with any UNPAID fine shall be **blocked from new requests** until settled | P0 |
| **Dashboards** |||
| FR-21 | Admin dashboard shall show stat cards (books, active loans, overdue), trend sparklines, and a paginated borrow-activity table — matching the reference design | P0 |
| FR-22 | Student dashboard shall show loans out, due-soon countdown, and balance — in a distinct card-based UI | P0 |
| **Reports** |||
| FR-23 | Admin shall export circulation, overdue, and collections reports (CSV + print) | P2 |
| **Audit** |||
| FR-24 | Every approve/decline/release/return/fine/account action shall be written to an audit log with actor and timestamp | P1 |

---

## 6. User Stories & Acceptance Criteria

**US-1 — Admin creates a student account**
> As an admin, I want to create an account from a student's ID so only ESCR students can use the system.
- **AC:** Given the admin opens *Students → Create account*, when they submit a valid unique Student ID + name + course + password, then the account exists and the student can log in immediately; when the Student ID already exists, then an inline error is shown and no account is created. No other page offers registration.

**US-2 — Student requests a book**
> As a student, I want to request a book so I can borrow it after approval.
- **AC:** Given an available book, when the student clicks *Request*, then a PENDING request appears in their *My Requests* and in the admin queue; when the student already has a pending request for that book, then the button reads "Already requested" and is disabled.

**US-3 — Admin approves only when available**
> As an admin, I want approval to be blocked when no copy is free so I never over-lend.
- **AC:** Given 0 available copies, when the admin clicks *Approve*, then an error toast appears and the request stays PENDING. Given ≥1 copy, when approved and released, then the request becomes APPROVED, a loan is created with `due_date = today + 7`, and that copy flips to ON_LOAN.

**US-4 — 7-day loan & overdue penalty**
> As an admin, I want overdue books penalized ₱/day automatically so late returns cost the student.
- **AC:** Given a loan released Oct 1, its due date is Oct 8. Returned Oct 11 → the system records a fine of **3 days × ₱10 = ₱30**, status UNPAID, visible on both dashboards.

**US-5 — Damaged book accountability**
> As an admin, I want to charge the student who damaged a book its full value.
- **AC:** Given a returned book marked DAMAGED, when the admin saves the assessment, then a DAMAGE fine equal to the book's replacement value is created on that student, the copy becomes unavailable, and the student cannot request new books until they replace the book or pay.

**US-6 — Student dashboard awareness**
> As a student, I want to see at a glance what I have out, what's due soon, and what I owe.
- **AC:** The dashboard shows 3 hero cards (books out, due-soon countdown, balance), color-coded countdown chips (green >3 days, orange 1–3, red overdue), and zero reference to admin functions.

**US-7 — Blocked student**
> As a system, I want to prevent new requests from students with unpaid fines.
- **AC:** Given a student with an UNPAID fine, when they open the catalog, then *Request* buttons are disabled with the message "Settle pending balance at the library to request new books"; after the admin records payment, requests re-enable.

---

## 7. Business Rules Summary
See **`rules.md`** for the full normative rule set (R-01…R-24).

---

## 8. Non-Functional Requirements

| Category | Requirement |
|---|---|
| Security | RLS on every table; service-role key server-only; HTTPS; no signup endpoint |
| Performance | Pages < 2s on 4G; tables paginate at 10–25 rows; images lazy-loaded |
| Availability | 99% during school hours; Supabase-managed backups (PITR) |
| Usability | Admin completes approve/return in ≤ 3 clicks; student needs no training |
| Accessibility | WCAG 2.1 AA (contrast, keyboard, focus, screen readers) |
| Compatibility | Chrome/Edge/Safari/Firewall latest; 320px → 1920px responsive |
| Data integrity | Money in integer centavos; timestamps `timestamptz`; all mutations logged |
| Auditability | Audit log retained ≥ 1 school year |

---

## 9. Constraints & Assumptions

**Constraints**
- Deployment limited to ESCR stakeholders; credentials issued by the admin only.
- Fines are settled **in cash at the library** — the system records, it does not collect.
- Single library / single campus in v1.

**Assumptions (editable before/during build)**
- A1 — Overdue fee default **₱10 per day** (stored in `settings`).
- A2 — Loan period default **7 days**, non-renewable in v1.
- A3 — Max **3 active loans** per student.
- A4 — Max replacement value input is admin-defined per book (no auto-pricing).
- A5 — School will provide the Supabase project + a Vercel (or node) host.

---

## 10. Milestones

| Phase | Deliverable | Est. |
|---|---|---|
| 0 | Scaffold, tokens, Supabase auth + role middleware, login | Week 1 |
| 1 | Admin account creation + student management | Week 1 |
| 2 | Book inventory + copies | Week 2 |
| 3 | Request/approve workflow | Week 2 |
| 4 | Loans, returns, 7-day due dates | Week 3 |
| 5 | Fines, damages, blocking, daily cron | Week 3 |
| 6 | Admin dashboard UI (reference image) | Week 4 |
| 7 | Student dashboard UI (distinct) | Week 4 |
| 8 | Reports, responsive/a11y polish, seed data, handoff | Week 5 |

---

## 11. Success Acceptance (sign-off checklist)

- [ ] No registration page exists anywhere in the app.
- [ ] Admin can create a student from a Student ID and that student can log in.
- [ ] A student request cannot become a loan without an admin approval.
- [ ] Approval is impossible when 0 copies are available.
- [ ] Every loan has due date = release + 7 days.
- [ ] An overdue return auto-generates the correct ₱ fine.
- [ ] A damaged book auto-generates a replacement-value fine and blocks the student.
- [ ] Admin dashboard visually matches the reference design.
- [ ] Student dashboard is visually distinct and card-based.
- [ ] All text passes WCAG AA contrast; full keyboard operation.
