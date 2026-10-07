# ESCR Library Management System — Business Rules

**Normative rule set.** Every rule is identified (`R-xx`) and must be enforced in
**both** application code (UX) and database layer (RLS / constraints / triggers) where
possible. Default values live in the `settings` table and may be changed by an admin;
the rule *structure* is fixed.

---

## 1. Configuration (stored in `settings`)

| Key | Default | Description |
|---|---|---|
| `loan_period_days` | **7** | Maximum borrow duration (FR-14) |
| `overdue_fee_per_day_centavos` | **1000** (₱10.00) | Cash penalty per overdue day |
| `max_active_loans` | **3** | Max concurrent loans per student |
| `max_pending_requests` | **3** | Max pending requests per student |
| `allow_renewals` | `false` | v1: no renewals |
| `block_on_unpaid_fines` | `true` | Hard-block requests when balance > 0 |

---

## 2. Accounts & Access

**R-01 — No self-registration.** No sign-up, register, or password-reset-by-email
route exists. All accounts are created by an admin. Public auth sign-up is disabled
in Supabase.

**R-02 — Student-ID-based identity.** Every student account must have a unique
`student_id` (ESCR format). The system maps it internally to a synthetic Supabase
auth email; students log in with **Student ID + password**.

**R-03 — Roles.** Exactly two roles: `ADMIN` and `STUDENT`. Roles are assigned only
by an admin (a student can never self-promote). RLS denies all privilege-changing
writes to students.

**R-04 — Account states.** `ACTIVE` (can log in) or `BLOCKED` (cannot log in).
Admins may block any student; blocked students are rejected at login with a generic
message.

**R-05 — Initial credentials.** Admin sets the password at creation (or a temporary
one). Students are encouraged to change it; password change requires the current
password.

**R-06 — Deletion.** Admins cannot hard-delete a student with loan/fine history —
the account is `BLOCKED` instead, preserving audit integrity.

---

## 3. Catalog & Availability

**R-07 — Copies are atomic.** Availability is tracked **per copy**
(`book_copies.status`): `AVAILABLE | ON_LOAN | DAMAGED | LOST`.
`available_count = COUNT(status = 'AVAILABLE')` — never a manually edited number.

**R-08 — Replacement value required.** Every book must have a positive
`replacement_value_centavos` before it can be requested (used for damage charges).

**R-09 — Request eligibility.** A student may request a book only when **all** hold:
1. student status = `ACTIVE`;
2. no unpaid fines (`block_on_unpaid_fines` = true);
3. no existing PENDING request for that book;
4. pending requests < `max_pending_requests`;
5. active loans < `max_active_loans`;
6. the book has ≥ 1 copy (requests are allowed even if temporarily 0 available —
   *decision: requests are only allowed for books with ≥1 AVAILABLE copy; if 0,
   the Request button shows "No copies available" and is disabled*).

**R-10 — One request per book.** Duplicate PENDING requests for the same
(student, book) are rejected by unique constraint.

---

## 4. Request → Approval Workflow

**R-11 — Requests, never automatic.** Every borrow begins as `PENDING`. There is no
code path that creates a loan without an admin action.

**R-12 — Statuses.**
```
PENDING → APPROVED | DECLINED | CANCELLED
```
- `PENDING` — awaiting admin.
- `APPROVED` — admin approved; waiting for release (pickup at the desk).
- `DECLINED` — admin rejected; optional `decline_reason` stored. No penalty.
- `CANCELLED` — withdrawn by the student while still PENDING.

**R-13 — Availability re-check at approval.** Approval is executed server-side and
must re-verify `available_count ≥ 1` **at the moment of approval**. If 0, the action
fails with *"No copies available — request cannot be approved."* and the request
remains PENDING.

**R-14 — Release creates the loan.** Approval alone does not start the clock. When
the admin hands over the book (Release):
- loan row created with `released_at = now()`;
- `due_date = released_at + loan_period_days` (7 days), computed in SQL;
- the chosen copy flips to `ON_LOAN`;
- request status → `APPROVED` and linked to the loan.

**R-15 — Single-decision rule.** Each request can be decided exactly once;
`decided_at` / `decided_by` are immutable after decision. Reversal requires an admin
to cancel the loan (audit-logged), never an edit.

**R-16 — Expiry (optional, default ON).** PENDING requests older than **3 days**
are auto-marked `EXPIRED` by the daily job so queues stay clean.

---

## 5. Loans, Overdue & Penalties

**R-17 — Maximum loan = 7 days.** `due_date ≤ released_at + 7 days` always. Loans
are **not renewable** in v1.

**R-18 — Daily overdue job.** Each day (00:05 Asia/Manila) the system:
1. marks open loans with `due_date < now()` as `OVERDUE`;
2. computes `days_late = GREATEST(1, DATE(due) diff DATE(now))` — *count of days
   after the due date*;
3. **upserts** (not accumulates) the OVERDUE fine as
   `amount_centavos = days_late × overdue_fee_per_day_centavos`.

> The fine is *recomputed from the due date each run*, so re-runs can never double-charge.

**R-19 — Overdue calculation examples** (₱10/day, due Oct 8):

| Returned | Days late | Fine |
|---|---|---|
| Oct 8 (on time) | 0 | ₱0 |
| Oct 9 | 1 | ₱10 |
| Oct 11 | 3 | ₱30 |
| Oct 31 | 23 | ₱230 |

**R-20 — Late return finalization.** When the admin marks a return, the OVERDUE fine
for that loan is finalized to the exact day count and the loan becomes `RETURNED`.
The copy returns to `AVAILABLE` (unless damaged).

**R-21 — One open fine per (loan, type).** Unique constraint prevents duplicate
OVERDUE or DAMAGE fines for the same loan.

---

## 6. Damage & Accountability

**R-22 — Student accountability.** Any damage recorded on a book the student held
places a `DAMAGE` fine on **that student**, equal to the book's
`replacement_value_centavos`. The student must either:
- **replace** the book (admin receives the replacement copy → fine marked `PAID`
  with `method = 'replacement'`), or
- **pay** the full value in cash (`method = 'cash'`).

**R-23 — Damage workflow.**
```
Return marked with condition DAMAGED
  → damage_reports row (description, photo?, assessed_by)
  → copy.status = DAMAGED (removed from circulation)
  → fine(type=DAMAGE, amount = replacement value, UNPAID) on the student
  → student blocked (R-25)
Admin resolves:
  → replacement received: copy replaced/restored → AVAILABLE, fine PAID(replacement)
  → payment received:     fine PAID(cash), copy disposed or repaired → AVAILABLE
```

**R-24 — Disputes.** Only an admin may `WAIVE` a fine, and only with a written
`waive_reason`; waives are audit-logged. Students cannot modify fines.

---

## 7. Blocking & Balances

**R-25 — Hard block on unpaid balances.** A student with ≥ 1 UNPAID fine (overdue
or damage) **cannot submit new requests**. UI shows the balance and instructions;
the server action re-verifies and rejects (defense in depth).

**R-26 — Existing loans are unaffected.** Blocking only stops *new* requests; the
student's existing loans must still be returned on time.

**R-27 — Balance = sum of UNPAID fines** for the student, always computed
(`SUM(amount_centavos) WHERE status = 'UNPAID'`), never cached.

**R-28 — Payment recording.** Admin records cash received → fine `PAID`,
`paid_at`, `received_by`. The system never handles money directly — it only records.

---

## 8. Money, Time & Data Integrity

**R-29 — Money in centavos.** All amounts are integers in centavos
(₱10.00 = `1000`); formatted as `₱1,234.56` at the UI layer only.

**R-30 — Timezone.** All timestamps are `timestamptz`; business dates (due dates,
day counts) are evaluated in **Asia/Manila**.

**R-31 — Server-side authority.** Due dates, fine amounts, availability, and role
checks are always computed/verified on the server. Client values are never trusted.

**R-32 — Audit log.** `approve · decline · release · return · damage · fine-create ·
fine-pay · fine-waive · account-create · account-block · settings-change` each write
an `audit_logs` row: `actor, action, target, before/after, timestamp`.

---

## 9. Authorization Rules Matrix

| Action | STUDENT | ADMIN |
|---|---|---|
| View catalog | ✅ | ✅ |
| Create/edit books, copies | ❌ | ✅ |
| Submit/cancel own pending request | ✅ (own only) | — |
| Approve / decline / release | ❌ | ✅ |
| Mark return / assess damage | ❌ | ✅ |
| Create/edit/block accounts | ❌ | ✅ |
| Record/waive fines & payments | ❌ | ✅ |
| Change settings (fee rate, loan days) | ❌ | ✅ |
| View other students' data | ❌ | ✅ |
| View own loans, requests, fines | ✅ | ✅ |

Enforced by: **middleware** (route redirects) + **RLS policies** (data) +
**server actions** (re-verification).

---

## 10. State Machines (reference)

**Request**
```
                 ┌── DECLINED (admin, optional reason)
PENDING ─────────┼── CANCELLED (student, while pending)
   │             └── EXPIRED (>3 days, cron)
   └── APPROVED (admin, iff available ≥ 1)
            └── released → Loan
```

**Loan**
```
ACTIVE ── return on time ──► RETURNED (no fine)
   │
   └── past due_date ──► OVERDUE (fine accrues daily ₱)
                            └── return ──► RETURNED + OVERDUE fine (UNPAID → PAID)
```

**Copy**
```
AVAILABLE ── release ──► ON_LOAN ── return good ──► AVAILABLE
                            └── return damaged ──► DAMAGED ── replaced/paid ──► AVAILABLE
LOST (admin-declared, billed like damage)
```

**Fine**
```
UNPAID ── cash received ──► PAID(method=cash)
   │
   ├── replacement received ──► PAID(method=replacement)
   └── admin waiver ──► WAIVED(reason required)
```

---

## 11. Edge Cases

| # | Case | Handling |
|---|---|---|
| E1 | Admin approves while last copy was just taken | Approval re-checks in a transaction; fails with error, request stays PENDING |
| E2 | Student returns book the same day | RETURNED, fine = 0 |
| E3 | Fine rate changed by admin | Existing fines keep their amount; only future accruals use the new rate (rate-change audit-logged) |
| E4 | Student blocked with active loans | Loans must still be returned; only new requests blocked |
| E5 | Book damaged while student still holds it | Damage recorded at return time only; loan cannot close with an unresolved condition |
| E6 | Two admins decide the same request simultaneously | First write wins (row lock / conditional update); second gets "already decided" |
| E7 | Cron runs twice in a day | Fine upsert is idempotent (recomputed, not accumulated) |
| E8 | Student forgets password | Admin resets it in person — no email flow |
| E9 | Student ID duplicated at creation | Unique constraint + inline form error |
| E10 | Attempt to access `/admin/*` as student | Middleware redirects to student dashboard; RLS also denies every admin table read/write |

---

## 12. Notifications (v1, in-app only)

| Event | Audience | Message |
|---|---|---|
| Request submitted | Admin | "N new borrow requests pending" |
| Request approved/declined | Student | Status change + reason if declined |
| Due in ≤ 1 day | Student | Warning banner on dashboard |
| Overdue | Student | Red banner + running ₱ balance |
| Fine recorded / paid | Student | Balance updated |
| Account created | Student | (Admin informs student of credentials in person) |
