# Credit

What the app means by credit, how a bill becomes a debt, and how it stops being
one.

Written because "credit" is used for several different things in this codebase
and they get confused — including once by a bug that made every field-booked
order overdue the day it was raised.

---

## Credit is three things, not one

| The thing | Where it lives | What it means |
|---|---|---|
| **The terms** | `UnifiedAllocation.paymentType` — `'cash'` or `'credit'` | *whether* they pay later. Cash settles on delivery; credit means goods now, money later |
| **The period** | `UnifiedAllocation.creditDueDate` | *when* that particular bill must be paid. 30 days from the *planned* dispatch date, fixed when the order is raised |
| **What is owed now** | derived, nowhere stored | Σ (`totalAmount` − `paidAmount`) over credit bills that have been **dispatched** |

So credit is: *sell now, collect by this date.* Most confusion comes from
someone meaning one of the three and being heard to mean another.

**There is no credit ceiling.** A `Party.creditLimit` field once existed and was
removed — see below.

---

## The life of a bill

```
raised           dispatched              paid                     or not
  │                  │                    │                         │
pending  ───────►  sent  ───────────►  paid                     overdue
  │                  │                                              │
not a debt      NOW it is a debt                          past creditDueDate
```

**`pending` is not debt.** An order that has been raised but not dispatched is a
promise, not a receivable — nothing has left the building. This is why a rep can
take cash for an order booked twenty minutes ago while Outstanding still reads
₹0, and why the app records that money as an advance.

**`sent` is where debt begins.** Once stock is dispatched on credit terms, the
amount is owed and counts toward Outstanding.

**`overdue` is `creditDueDate` in the past, unpaid.** It drives the warn colour
in the Credit Book and the collections priority. Nothing ever *writes* it going
forward — it is derived at read time, so a bill the whole app calls overdue
still reads `status: 'sent'` in Firestore. Do not filter a report on it.

**`paid` is when `paidAmount` reaches `totalAmount`.** Partial payments leave it
`sent` with a reduced balance.

Only **company** supply counts. A distributor sending stock to their own
retailer (`fromType: 'distributor'`) is never Ocealgo's receivable — that retailer
settles with their distributor. Every calculation filters on
`fromType !== 'distributor'`.

---

## The due date

**30 days after the planned dispatch date**, set when the order is raised — and
never re-based when the goods actually go. If dispatch slips a fortnight, the
shop has 16 days to pay rather than 30.

- The Allocations screen offers it as an editable field, defaulting to 30 days.
- Orders booked in a shop or on a call use the same 30 days, computed from the
  planned date, and the form says so before the rep commits: *"Payment due by
  12 Oct — 30 days after dispatch."*

`CREDIT_DAYS = 30` is currently a constant in two screens. Real distributors
trade on different terms — 15 days for one, 45 for another — and the right home
for that is a `creditDays` field on the party record. It is not built.

> **A bug worth remembering.** Both field order forms once set `creditDueDate`
> to the *planned delivery date*, so every credit order booked in the field was
> due the day it was raised and read as overdue before anything had shipped.
> Ageing, the overdue flag, the collections priority and the visit's "past the
> due date" count were all wrong for anything booked outside the office. Fixed —
> but it is the kind of mistake that hides for months because each of those four
> looks individually plausible.

---

## There is no limit — and that is deliberate

`Party.creditLimit` was a ceiling on what a party could owe at once. It is gone.

It never worked. The rules reserved it for admins and the visit screen read it
in four places — a headroom line, an over-limit test, a warning before booking,
and a `credit_limit_exceeded` alert — but **no screen ever set it**. There was
no field in Party manager, none in the importer, none anywhere. The permission
was written for a form that was never built, so the value was `undefined` for
every party, every check short-circuited, and the alert never fired once.

The choice was to build the missing form or remove the machinery. Ocealgo does
not cap what a party may owe, so the machinery went. Dead code that looks like a
working safeguard is worse than no safeguard: the next person to read
`overCreditLimit` on an allocation would reasonably conclude somebody had been
warned.

What went with it: `Party.creditLimit`, `overCreditLimit` on allocations,
`creditLimitAtVisit` on visits, the `credit_limit_exceeded` alert and its push
title, the rules clause, and the long-dead `creditLimitChecked` tick.

**What did not go, because it is real:** `creditOutstandingAtVisit` — what the
shop actually owed on the day of a visit — is still captured at punch-out.
Outstanding is still shown to a rep before they ask for an order. They see what
is owed; there is simply no line above which the app objects.

Old records keep whatever they were stamped with. Nothing reads those fields, so
nothing changes for them, and nothing needed a migration.

**To bring limits back** you need all of it, not just the field: the number, an
admin screen to set it, the check in every order path — it only ever ran on the
in-shop one — and a decision about whether crossing it warns or refuses.

