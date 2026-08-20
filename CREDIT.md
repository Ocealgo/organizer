# Credit

What the app means by credit, how a bill becomes a debt, and how it stops being
one.

Written because "credit" is used for four different things in this codebase and
they get confused — including once by a bug that made every field-booked order
overdue the day it was raised.

---

## Credit is four things, not one

| The thing | Where it lives | What it means |
|---|---|---|
| **The terms** | `UnifiedAllocation.paymentType` — `'cash'` or `'credit'` | *whether* they pay later. Cash settles on delivery; credit means goods now, money later |
| **The period** | `UnifiedAllocation.creditDueDate` | *when* that particular bill must be paid. 30 days from the *planned* dispatch date, fixed when the order is raised |
| **The ceiling** | `Party.creditLimit` | the most they may owe **at any one time**, across every unpaid bill |
| **What is owed now** | derived, nowhere stored | Σ (`totalAmount` − `paidAmount`) over credit bills that have been **dispatched** |

So credit is the whole arrangement: *sell now, collect by this date, up to this
ceiling.* Most confusion comes from someone meaning one of the four and being
heard to mean another.

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
amount is owed and counts toward both Outstanding and the credit limit.

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

## The limit

`Party.creditLimit` is the ceiling on what a party may owe at once. The rules
reserve it for admins (`isUnchanged('creditLimit')` for everybody else).

**But no screen sets it.** Every reference to `creditLimit` in `src/` is a read.
There is no field for it in Party manager, none in the CSV importer, none
anywhere in the admin screens — the permission was written and the form behind
it never was. Today it can only be set from the Firebase console, so unless
somebody has done that by hand it is undefined for every party, the check below
never fires, and `credit_limit_exceeded` never sends. See
[CREDIT_LIFECYCLE.md](CREDIT_LIFECYCLE.md).

**It is checked, never enforced.** Booking an order that would cross it shows
the arithmetic before you press:

> *This takes them to ₹58,400 owed against a ₹50,000 limit. You can still book
> it — the admin team is told, and the order carries the fact.*

Go ahead and it books, raises a `credit_limit_exceeded` alert to management the
same day, and stamps `overCreditLimit: true` on the allocation so it can be
found later.

That is deliberate. A distributor carrying a balance still trades, and a rep
standing in front of one cannot wait for the office to raise a number —
refusing would cost the sale without collecting a rupee of the debt. So it is
told, recorded and flagged rather than blocked.

Only **company credit** counts toward the check: a cash order settles on the
spot, and a distributor supplying their own retailer is not Ocealgo's exposure.

---

## Collecting

A rep takes money at a shop from **Log a visit → Money**, or from the older
revisit flow. Both do the same thing:

1. Apply the amount **oldest bill first**, writing `paidAmount` onto each
   allocation and flipping it to `paid` when covered.
2. Write a `payment_transactions` row at `status: 'pending_approval'`.
3. Alert management that cash was taken.

The rep is told plainly: *"An admin confirms it reached the company. Until then
it is your word for it."* An admin confirms receipt in the Credit Book, which
sets `confirmedAt` — and a confirmed transaction can no longer be edited by the
person who took it.

**Who can be asked for money:** distributors and retailers standing on their
own. A retailer under a distributor settles with that distributor, so the money
section does not appear for them — unless they actually carry a company bill,
which can happen because any shop can be supplied by Ocealgo directly.

### Advances

Taking money with nothing outstanding is allowed and is labelled as an advance.
It is not an edge case: a distributor may pay ahead, or pay cash for an order
booked twenty minutes ago that is still `pending` and therefore invisible to
Outstanding.

**An advance does not settle a later bill.** There is no unapplied-credit
concept — the payment is recorded and confirmable, and it appears against the
party in the Credit Book, but when a bill arrives next week that bill reads
fully outstanding with the advance sitting beside it. Somebody reconciles by
hand. Worth knowing before advances become routine.

---

## Where to see it

| Question | Screen |
|---|---|
| Who owes us, and how much | **Credit book** — per party, with ageing |
| Is this shop over its limit | **Log a visit → Money**, before you ask for an order |
| What has already been collected | **Log a visit → Money → Collected lately**, including by other reps |
| Which receipts are unconfirmed | **Credit book** — pending approval |
| What this shop owed on the day of a visit | the visit record itself — `creditOutstandingAtVisit` and `creditLimitAtVisit`, captured at punch-out |

### The three cards at the top of Credit book

Shown to anybody without `approve_payments` — which by default is every rep
**and every sales manager**. Admins get the confirmation queue instead.

**The first two cards mean whatever the person reading them is responsible
for.** A rep carries a route, so they mean the rep. A sales manager oversees the
team, so they mean the team — a manager's own collection is nearly always zero,
and a card that reads ₹0 every day is worse than no card.

| Card | A rep sees | A sales manager sees |
|---|---|---|
| **You collected** / **Team collected** | money you took from a shop, this calendar month | money anybody in sales took, this calendar month — with their own share on the line beneath, since a manager can spend a day in the field |
| **Awaiting confirmation** | your receipts an admin has not ticked off | the team's, however old |
| **Outstanding** | the whole book | the whole book — same for everyone |

The third card cannot sensibly be anything but the book: nobody owns a party.

Both of the first two switch together. Mixing scopes within one row is what made
this hard to read in the first place.

**"The team" is everybody in sales**, because there are no reporting lines in
the data — no `managerId` on a user, one sales team. If reps are ever assigned
to a particular manager, this has to narrow, and the tooltip says "anybody in
sales" so that nobody has been reading it as "mine" in the meantime.

Neither collection card counts money a party paid the company directly. A bank
transfer is nobody's collection. Both count from the moment the receipt is
recorded rather than from confirmation, so the number does not sink when the
office is slow.

> The middle card used to count **everybody's** unconfirmed receipts no matter
> who was reading, sitting between two cards about you. It was also actionable
> by nobody who could see it: the people who confirm a payment are admins, and
> admins never see these cards.

That last one is numbers rather than an assertion. There used to be a "Credit
limit checked" tick a rep had to flip on every distributor visit; nothing ever
read it, and it recorded that somebody said they looked rather than what they
saw. The figures are captured instead, with no taps, and they survive the limit
being changed afterwards.

---

## Known gaps

- **Nothing sets a credit limit.** The check exists; the screen does not.
- **Advances do not auto-apply** to later bills. Manual reconciliation.
- **Credit terms are a hard-coded 30 days**, not a per-party field.
- **Reps write to the financial ledger.** Applying a payment writes `paidAmount`
  and `status` straight onto allocations from the client. `firestore.rules`
  permits it under an allowance marked `[GAP 3]`, explicitly pending a move to a
  Cloud Function. Functions now exist, so that move is smaller than it was.
