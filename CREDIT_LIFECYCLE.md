# The life of a credit order

Who does what, in order, from a rep standing in a shop to the money being
confirmed as received.

[CREDIT.md](CREDIT.md) explains what credit *means*. This is the operational
version: the handoffs, and what each role has to actually do.

---

## The short version

```
REP                    ADMIN                REP                 ADMIN
raises the order  →  dispatches it  →  collects money  →  confirms receipt
   pending             sent               (applied)           approved

                     ↑ the debt starts here, not before
```

Four steps, three handoffs, two people. A step nobody does is a step that
silently stalls — none of these time out or escalate on their own.

---

## Stage 1 — A rep raises the order

**Who:** any sales rep. Also a sales manager working a field day. No permission
is checked on the field paths at all.

**Where, and they behave differently:**

| Path | Screen | Due date set? |
|---|---|---|
| In a shop | Log a visit → Order | ✅ +30 days |
| Phone / WhatsApp | Remote contact | ✅ +30 days |
| At a desk | Allocations → New | ✅ editable, defaults 30 |
| Revisit (older flow) | Revisit logger | ❌ **none** |

Nothing caps what a party may owe — see
[CREDIT.md](CREDIT.md#there-is-no-limit--and-that-is-deliberate). A rep is shown
the outstanding balance before they ask for an order, and that is the whole of
it.

The order is written `status: 'pending'`, the stock is **locked** but not
removed, and management gets a `new_allocation` alert.

**Nothing is owed yet.** A pending order is a promise. It does not appear in
Outstanding and does not age.

**The rep cannot dispatch their own order.** They see *"Waiting for an admin to
dispatch this."*

---

## Stage 2 — An admin dispatches it

**Who:** an admin, a super admin, or a sales manager granted
`dispatch_allocations`. Not a manager by default.

**Where:** Allocations → the order → **Dispatch**.

This is the step that creates the debt. In one transaction it:

- sets `status: 'sent'` with `sentAt` / `sentBy` / `sentDate`
- takes the packets out of company stock and releases the lock
- adds them to the party's stock
- writes a stock ledger line

From this moment the amount is owed, appears in Outstanding, and starts ageing.

> **The due date does not move.** It was fixed when the order was raised — 30
> days from the *planned* date, not from the day it actually shipped. If
> dispatch slips a fortnight, the shop gets 16 days to pay, not 30. Worth
> knowing before chasing somebody who was never given the full month.

---

## Stage 3 — The clock runs

Nobody does anything. The bill ages on its own.

**"Overdue" is not a state anything writes.** It is worked out fresh every time
a screen renders, by comparing `creditDueDate` to today. A bill everybody in the
app calls overdue still reads `status: 'sent'` in the database. That is by
design and matters in exactly one place: don't write a report that filters on
`status == 'overdue'` and expect to find anything.

Overdue drives the warn colour, the collections priority, and the ordering of
the Credit book.

---

## Stage 4 — A rep collects the money

**Who:** the rep visiting the shop. **Where:** Log a visit → Money, or the older
revisit flow.

Recording it does three things at once:

1. **Applies the amount oldest bill first.** Each allocation's `paidAmount`
   goes up until it is covered, then flips to `paid`. What went where is stored
   on the receipt as `appliedTo` — that array is the only record of the
   application, and the only way to unwind it.
2. **Writes the receipt** at `status: 'pending_approval'`.
3. **Alerts management** that cash was taken.

The shop's balance drops **immediately** — before anyone in the office has
agreed the money arrived. The rep is told as much: *"An admin confirms it
reached the company. Until then it is your word for it."*

**Money with nothing outstanding is an advance.** Allowed, recorded, and it does
**not** settle a later bill — see [CREDIT.md](CREDIT.md).

---

## Stage 5 — An admin confirms it arrived

**Who:** an admin or super admin. A sales manager cannot, by default.

**Where:** Credit book → the party → the receipt → **Confirm**.

Sets `confirmedAt` / `confirmedBy`. It touches no allocation — the money was
already applied at Stage 4. Confirming is purely the company saying *yes, this
reached us*. Once confirmed, the rep who took it can no longer edit or delete
it.

**Rejecting** reverses the whole thing: each allocation in `appliedTo` gets its
`paidAmount` reduced, a `paid` bill goes back to `sent` or `overdue`, and the
balance reappears. The receipt is marked `rejected` and stops counting.

> A receipt with no `appliedTo` — anything from before that field existed —
> cannot be reversed. Rejecting it marks the receipt and leaves the money off
> the bills. Check the balance by hand after rejecting an old one.

---

## What each role has to do

### Sales rep

Daily, in the field. Nothing here needs a permission.

- Raise orders. Prefer **Log a visit → Order** over the other paths — it is the
  one that shows you the shop's position while you are standing in it.
- Read the shop's outstanding before asking for a bigger order.
- Collect money and record it the same day, at the shop.
- If you take money for an order that has not shipped yet, expect the balance
  not to move. That is an advance, and somebody applies it by hand later.

### Sales manager

**By default a manager can do almost nothing in this chain.** They hold
`view_credit` and can read the whole book; they hold `edit_parties`. They do
**not** hold `dispatch_allocations`, `mark_paid` or `approve_payments`.

So the manager's job here is oversight, not action:

- Watch **Team collected** and **Awaiting confirmation** in the Credit book —
  both are the whole team's for a manager.
- Chase reps on overdue balances; chase admins on receipts sitting unconfirmed.

An admin can grant a manager `dispatch_allocations`, `mark_paid` or
`approve_payments` individually, in User management. Two cautions before doing
so — a manager granted `dispatch_allocations` gets a **Mark paid** button that
fails, because that button checks the wrong permission; and a manager who works
a field day and collects cash will **half-record** it. Both are detailed at the
bottom.

A manager cannot cap what a shop owes, and neither can anyone else — there are
no credit limits in this app.

### Admin

The whole chain depends on an admin doing two things promptly.

- **Dispatch orders.** Nothing is owed until this happens, so a pending pile is
  revenue that is not yet a receivable and stock that is locked out of use.
- **Confirm receipts.** Reps are told their collection is unconfirmed; leaving
  it is telling them their word has not been taken.
- Reject anything that did not arrive, and check the balance by hand if the
  receipt is an old one.
- Grant and remove manager permissions in User management.
- Cancel orders that will not ship — but only while they are still `pending`.

### Super admin

**Nothing in the credit chain is super-admin-only.** An admin can do every step.
What only a super admin can do sits around the edges:

- Change another *admin's* account, or grant the super admin role
- Delete users
- Write `config/settings`
- Delete the dispatch, ledger and stock-movement audit records

---

## Faults found while writing this

These are real, verified against the code, and none is fixed.

**A dispatched bill offers "Dispatch" again once it is overdue.** The
Allocations list rewrites a past-due `sent` bill's status to `overdue` in
memory, and the action row shows Dispatch and Cancel for anything `pending` *or*
`overdue`. Neither handler re-checks the real status and the rules permit both
transitions from any state. Pressing **Dispatch** runs the whole stock
transaction a second time — stock decremented twice, party stock credited twice,
duplicate audit rows. Pressing **Cancel** hides the debt from the Credit book
while leaving `paidAmount` untouched, and decrements a lock that was already
released. This is the one to fix first.

**A sales manager who collects cash half-records it.** The rules allowance that
lets a rep write `paidAmount` covers `offline_sales` and `online_sales` only —
not `sales_manager`. A manager on a field day gets the receipt written and every
bill update denied: a receipt exists, no balance moves. Granting `mark_paid`
does not fix it, since that only permits a full settlement, not a partial one.

**"Mark paid" on the Allocations screen writes no `paidAmount`.** The Credit
book version writes all three fields; this one writes `status` and `paidAt`
only, leaving `paidAmount` at zero forever — so any later reversal computes from
zero and gives the money back to nobody. Its button also checks
`dispatch_allocations` while the rules require `mark_paid`.

**A rep's Edit and Delete on their own pending receipt cannot succeed.** Both
call an update, and updates require `approve_payments`. The rules do allow a rep
to *delete* their own unconfirmed receipt — but the button does not delete, it
updates.

**An office-recorded payment shows "Awaiting confirmation" though it is already
approved.** The label keys off `confirmedAt`, which that path never writes,
while the pending queue counts a different field. Two indicators disagreeing.

**Desk orders are stamped as shop orders.** The Allocations screen never passes
a channel, so every order raised at a desk records itself as `field_visit`. Any
split of field versus office orders is wrong.

**The revisit flow bypasses the shared order writer.** It locks stock it never
records, writes no due date — so those credit bills never age — and skips the
`new_allocation` alert entirely.
