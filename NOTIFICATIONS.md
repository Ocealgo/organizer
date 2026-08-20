# Notifications

Every message this app sends, who receives it, and why.

Written because "who gets told about that?" was only answerable by reading
eleven files. If you add an alert, add a row here.

---

## How a notification works

There is one queue. Every notification in the app is a document in the
**`alerts`** collection, and nothing else sends anything.

```
something happens  →  writes an alerts document  →  reaches people two ways
                                                     ├── the bell, in the app
                                                     └── a push, on the phone
```

Both readers use the same addressing, so a message can never reach one audience
in the app and a different one on the phone. Adding a new kind of alert needs no
change to either — write the document and it is delivered.

### Addressing

An alert carries **at most one** of these:

| Field | Reaches | Used for |
|---|---|---|
| `toUid: "<uid>"` | that one person | anything about *your* record — your leave, your expenses, a colleague sharing a visit with you |
| `toRole: "admin_group"` | admin, super admin, **every** sales manager | company business — approvals, money, exceptions |
| `toRole: "everyone"` | every approved account | nothing yet. The door exists so that the day something is genuinely for all hands, no rule has to change |
| *(neither)* | **admin, super admin, sales manager** | see below |

**An alert nobody addressed goes to management, not to everybody.** That is
deliberate: a tag somebody forgets to write should hide something from people
rather than broadcast it. It used to fall through to "show it to everyone",
which meant every rep saw every shop anybody added and every order raised
anywhere in the company.

`admin_group` includes **all** sales managers regardless of their permissions —
the same rule the in-app bell uses (`isManagement()` in
`src/auth/permissions.ts`). If you change one, change the other, or the channel
starts deciding who hears.

### The two channels

**The bell** (`src/components/NotificationBell.tsx`) shows the newest 20 that
are addressed to you. It only works while the app is open.

**Push** (`functions/push.js` → `pushOnAlert`) fires on every `alerts` document
created, resolves the audience, and sends to every device that has registered.
It reaches a closed phone.

Push requires the person to have turned it on: **Account → Notifications**. Each
device is separate. On iPhone it needs iOS 16.4+ **and** the app installed to
the home screen — a Safari tab receives nothing. The Android app schedules its
own reminder locally and does not use push at all.

---

## Every notification, by who receives it

### Sent to one person (`toUid`)

| Type | Message | Goes to | Raised when |
|---|---|---|---|
| `leave_approved` | *Your full day leave on 12 Sep was approved.* | the person who asked | an admin or manager approves leave — `LeaveTracker.tsx` |
| `expense_submitted` | *Your expenses for w/c 8 Sep were cleared — ₹2,400.* | the person who claimed | an admin clears a week — `ExpenseLogger.tsx` |
| `expense_submitted` | *Your expenses for w/c 8 Sep were sent back: bill missing. Please edit and submit again.* | the person who claimed | an admin rejects a week — `ExpenseLogger.tsx` |
| `visit_share_requested` | *Ravi shared Anand Stores' visit log with you for 12 Sep* | the colleague named | a rep shares a visit — `VisitLogger.tsx` |
| `visit_share_requested` | *Ravi edited a shared visit entry for Anand Stores* | the sharing partner | a shared entry is edited or deleted — `VisitLogger.tsx` |

### Sent to management (`toRole: "admin_group"`)

Reaches **admin, super admin and every sales manager**.

| Type | Message | Raised when |
|---|---|---|
| `leave_requested` | *Ravi requested a full day off on 14 Sep · Personal* | a rep marks leave — `LeaveHistory.tsx` |
| `leave_requested` | *Ravi asked to cancel a half day of leave on 14 Sep* | a rep asks to unmark leave |
| `expense_submitted` | *Ravi submitted expenses for w/c 8 Sep — ₹2,400* | a week is submitted — `ExpenseLogger.tsx` |
| `expense_submitted` | *Ravi declared nothing to claim for w/c 8 Sep* | a nil return is declared |
| `credit_settlement` | *₹5,000 collected from Anand Stores by Ravi during a visit* | cash taken on a visit — `OutletVisitScreen.tsx` |
| `credit_settlement` | *₹5,000 cash collected from Anand Stores by Ravi (UPI)* | cash taken on a revisit — `RevisitLogger.tsx` |
| `new_allocation` | *New allocation: 120 packets of Baby Wet Wipes to Anand Stores, from Ocealgo* | any order is raised, anywhere — `bookAllocation.ts` |
| `new_party` | *Ravi added retailer: Kumar Medicals during a field visit* | an outlet is added mid-visit — `QuickAddParty.tsx` |
| `new_party` | *Ravi added retailer: Kumar Medicals — needs 5 cartons* | a rep adds an outlet from Network — `PartyManager.tsx` |
| `duty_auto_closed` | *Ravi did not end their day on 12 Sep — closed automatically, no distance claimed* | the 23:00 sweep closes a forgotten day — `useDutySession.ts` |
| `party_pin_moved` | *Ravi moved Anand Stores' registered position by 240 m* | a shop's pin moves more than 150 m — `partyPin.ts` |
| `password_reset_requested` | *Ravi (Sales officer) cannot sign in and has asked for a password reset* | somebody uses "Ask for a reset" — `functions/passwordRequests.js` |
| `password_reset_requested` | *Akhil reset the password for Ravi — nothing more to do* | the reset happens; the original is marked read so the badge clears |
| `visit_log_submitted` | *Ravi submitted visit log · 8 visits · 3 interested* | the older visit logger submits a day — `VisitLogger.tsx` |

### Sent by the server, to nobody in particular

| What | Goes to | When |
|---|---|---|
| **End of day** — *You are still punched in. Record your closing meter reading before you finish.* | every rep whose day is still `active` | 18:00 IST daily, `functions/push.js` → `endOfDayReminder` |

This one is push only — it is not an `alerts` document, because there is nobody
to show it to in an app that is closed. The Android build schedules its own copy
locally and ignores this.

---

## What is deliberately **not** notified

- **Nothing is sent to a rep about another rep.** A rep's bell only ever shows
  their own record and shares addressed to them by name.
- **No notification is sent for an ordinary visit, order or expense entry.**
  Those are work, not events. Only submissions, approvals, money and exceptions
  are worth interrupting somebody for.
- **`toRole: "everyone"` is never written.** If you find yourself wanting it,
  ask whether it is really for everyone or just for management.
- **Nothing is sent about a credit limit.** There used to be a
  `credit_limit_exceeded` alert. Limits were removed — see
  [CREDIT.md](CREDIT.md) — and it went with them.

---

## Turning it on

**Account → Notifications**, on each device. It is asked from a tap on purpose:
iOS refuses the permission prompt unless it comes from a real gesture, and
Chrome counts an on-load ask against the whole site.

| Where the app is running | What arrives |
|---|---|
| Android app (Capacitor) | its own local notifications, including the 18:00 reminder. No setup |
| Installed web app, Android | everything, once switched on |
| Installed web app, iPhone | everything, once switched on — **iOS 16.4+ only** |
| Safari tab on iPhone | nothing, ever. It must be added to the home screen first |
| Any private window | nothing |

A token is stored per device in `push_tokens`, unreadable from the client, and
removed automatically when a device stops existing.

---

## Adding a new notification

1. Write an `alerts` document with `type`, `message`, `relatedId`, `read: false`,
   `createdAt`, and an address (`toUid`, or `toRole: 'admin_group'`).
2. Add the `type` to the `Alert` union in `src/types.ts`, or nothing will
   complain that it does not exist — the payloads are untyped object literals.
3. Add a title for it in `titleFor()` in `functions/push.js`, or it arrives on a
   phone headed "Ocealgo".
4. Add a row to this file.

Nothing else. Delivery is not your problem.
