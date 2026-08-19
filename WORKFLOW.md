# Ocealgo App — Complete Workflow & Architecture

---

## 1. System Overview

The Ocealgo Team Dashboard is an internal operations platform for **Ocealgo**, a B2B baby wipes brand. It coordinates field sales, inventory, credit, marketing, and HR across six distinct user roles in a single mobile-first React + Firebase SPA.

**Core purpose:** Replace manual WhatsApp/spreadsheet coordination between distributors, retailers, sales reps, and admin with a structured, real-time system.

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + TypeScript 5.3 |
| Build | Vite 5 |
| Backend / DB | Firebase Firestore (NoSQL, real-time) |
| Auth | Firebase Email/Password Auth |
| Styling | Inline styles only — no CSS framework |
| Theme | Custom `useTheme()` hook — dark/light, persisted per user in localStorage |
| State | React Context (AuthContext, ThemeContext) + Firestore `onSnapshot` |
| Hosting | Vercel (auto-deploy on push to `main`) |
| Excel parsing | SheetJS (`xlsx` ^0.18.5) |

---

## 3. User Roles & Access Matrix

| Role | Label | Root View | Key Permissions |
|---|---|---|---|
| `super_admin` | 👑 Super Admin | AdminDashboard | Everything + Settings screen. Cannot be modified by anyone. Hardcoded to `amalau14113@gmail.com`. |
| `admin` | 🛡️ Admin | AdminDashboard | All modules, user management, workspace. Cannot access Settings. |
| `offline_sales` | 🏪 Offline Sales | SalesView | Visit logger, revisit logger, party add, allocations (read), credit (read), expenses (own), leaves |
| `online_sales` | 🌐 Online Sales | SalesView | Same as offline_sales (online-specific module is a placeholder) |
| `offline_marketing` | 📣 Offline Marketing | MarketingView | Placeholder — coming soon |
| `online_marketing` | 💻 Online Marketing | OnlineMarketingView | Content calendar + post status tracking |

### Account Status Gate

Every login is checked against the user's Firestore document status:

| Status | What the user sees |
|---|---|
| `pending` | Holding screen — "Awaiting admin approval" |
| `approved` | Full access to their role's module |
| `rejected` | Holding screen — "Access denied" |
| `deactivated` | Holding screen — "Account deactivated" |

---

## 4. Authentication Flows

### 4.1 New User Registration

```
User fills signup form (name, email, password)
  ↓
Firebase Auth creates account
  ↓
Firestore creates users/{uid}:
  { uid, email, name, role: null, status: 'pending', createdAt }
  ↓
User sees: "Your account is pending approval"
  ↓
Admin sees new entry in User Management → Pending tab
  ↓
Admin selects role → clicks Approve
  ↓
Firestore updates users/{uid}:
  { status: 'approved', role: '...', approvedAt, approvedBy, approvedByName }
  ↓
Next time user opens app → AuthContext fetches users/{uid}
  → status === 'approved' → routes to role-specific view
```

### 4.2 Login (existing approved user)

```
User enters email + password
  ↓
Firebase Auth validates credentials
  ↓
AuthContext fetches users/{uid} from Firestore
  ↓
Checks status → routes accordingly (see table above)
```

### 4.3 User Deactivation

```
Admin opens User Management → Active tab
  ↓
Clicks "Deactivate" on a user
  ↓
Firestore: users/{uid}.status = 'deactivated'
  → Firebase Auth account remains (same email can be reactivated)
  ↓
Next time that user opens app → sees "Account deactivated" screen
```

### 4.4 Role Change

```
Admin selects new role from dropdown in User Management → Active tab
  ↓
Firestore: users/{uid}.role = newRole
  ↓
User's view changes on next navigation / refresh
```

---

## 5. Module Workflows

---

### 5.1 Admin Dashboard

The admin's central hub. Four main tabs: **Overview**, **Sales**, **Marketing**, **Workspace**.

#### Overview Tab

Displays:
- **Quick Links grid** — 7 cards: Stock, Distributors/Retailers, Allocations, Products, Credit Book, Expenses, Leave Tracker. ⚙️ Settings card is additionally shown for `super_admin`.
- **Network Stats** — live counts of distributors, retailers, active parties (tapping navigates to Party Manager)
- **Allocation Summary** — overdue count, pending count, total credit outstanding (tapping navigates to Allocations)
- Any of these cards navigate to the corresponding sub-screen (full-screen takeover with a Back button)

#### Sales Tab

**Filters (combinable):**
- By sales person (All / specific user)
- Date mode: single day, month, or date range
- Party type: All / Distributor / Retailer
- Party status: All / Active / Inactive / Prospect
- Distributor sub-filter (for retailer filtering)

**Content shown:**
- Allocation summary per sales person (packets, total amount)
- Daily visit logs with individual visit entries
- Full-day leave cards (override visit logs for that user on that date)

#### Marketing Tab

Two sub-tabs:
- **Offline** — "Coming soon" placeholder
- **Online** — Content calendar for the current month (see §5.11)

#### Workspace Tab

Renders the WorkspaceDashboard (see §5.13).

---

### 5.2 Party Manager

Master registry of all distributors and retailers.

#### Viewing & Filtering

Filters (all combinable):
- Search: name, place, address (client-side)
- Type: All / Distributor / Retailer
- Status: All / Active / Prospect / Inactive
- Category: All / FMCG / Pharma / General Store / Supermarket / Online / Other
- Under Distributor: All / Independent / specific distributor
- District

Each party card shows: name, category badge, phone, email, address, place, district/state/pincode, parent distributor name, current stock per product, total packets allocated, last 3 dispatches (expandable).

#### Adding a New Party

All new parties start as `prospect`.

**Required fields:**
- Full name
- Phone (10-digit Indian mobile, validated; duplicate check across all parties)
- Address, Place, District, State, Pincode
- Type (Distributor / Retailer)
- Category

**Optional fields:**
- Email
- Parent Distributor (for retailers — enables indent/distribution flow)
- Low stock threshold
- Channel (`outletType`) — decides which extra fields the Outlet Visit form makes mandatory

**Duplicate guard:** same name + place + district + pincode = blocked with error message.

**On save:**
- Party created with `status: 'prospect'`
- If added by a sales rep → alert created for admin: `new_party` type

#### Adding a Party From the Field

The desk form above is too long for a rep standing in a shop, so the Outlet Visit screen
("Log a visit" → "Which outlet?") carries its own **Add an outlet** action, backed by
`components/QuickAddParty.tsx`.

- Required: name, phone (same 10-digit validation and duplicate check), place
- Optional: address, parent distributor; type, channel and category are one tap each
- District, state, pincode and the opening allocation are left blank and completed later from Network
- The current GPS fix is stored as the outlet's `coordinates`, so the next visit geofences cleanly
- Saved as `status: 'prospect'` with a `new_party` alert, exactly like a desk-added party, then the
  rep drops straight into the punch-in confirmation for the shop they just added

#### Editing a Party

All fields editable inline. For retailers, "Change Parent" button opens the edit form pre-focused on the distributor selector.

#### Deleting a Party

Blocked if the party has **outstanding credit** (unpaid credit allocations). Shows ₹ amount and prompts admin to clear dues first. Otherwise confirmed via danger modal → `deleteDoc`.

#### Import Tab (Admin / Super Admin only)

See §5.3.

#### Allocations Tab

Navigates directly to Allocation Manager (see §5.4), scoped to this party.

---

### 5.3 CSV / Excel Import

Allows bulk import of distributors and retailers from a Zoho-exported file processed through a mapper.

#### The 3-Step Flow

**Step 1 — Export from Zoho**
User goes to Zoho Books → Sales → Customers → Export → downloads CSV.

**Step 2 — Remap via Mapper**
Opens the mapper link (configured by super_admin in Settings). Pastes CSV, remaps columns to the app's expected format, downloads the result. Expected column headers after mapping:
`Name`, `Phone`, `Email`, `Address`, `Place / Area`, `District`, `State`, `Pincode`, `Outstanding Receivables`, `Type (distributor/retailer)`, `Category (FMCG/Pharma/...)`.

**Step 3 — Upload & Review**
User uploads the mapped CSV or Excel file (.csv / .xlsx / .xls).

#### Parse Logic

- Uses SheetJS to read both CSV and Excel uniformly
- Headers matched by normalized name (lowercase, special chars stripped)
- Fuzzy matches: e.g. "Name *", "Customer Name" → `name`; "Place / Area *" → `place`; "Type (distributor/retailer)" → `type`
- Type: if value contains "distributor" → distributor, else retailer
- Category: matched against known values, defaults to FMCG
- Phone: cleaned (strips `+91`, hyphens, spaces, takes last 10 digits)

#### Duplicate Detection

After parsing, all existing party names are fetched from Firestore. Any row whose name matches (case-insensitive) is auto-skipped — it never appears in the review flow. The count of skipped duplicates is shown in the header and summary screen.

#### Review Step (one entry at a time)

All fields are editable:
- **Type toggle** — Distributor / Retailer
- **Parent Distributor selector** — only shown for Retailer; "Independent retailer" default; lists all distributors sorted alphabetically
- Name, Phone, Email, Category, Address, Place / Area, District, State, Pincode (all editable inputs)
- Outstanding receivable from Zoho shown as info-only (not saved)

User can **Import & Next** (saves to Firestore, moves to next entry) or **Skip** (discards this entry, moves to next).

**On save per entry:**
- Party created with `status: 'prospect'`, `pricePerPacket: 0`, `packetsAllocated: 0`
- If a parent distributor was selected: `underDistributorId` + `underDistributorName` saved

#### Done Screen

Shows: imported count, skipped duplicates count, total in file.

---

### 5.4 Allocation Manager

Manages stock transfers from Ocealgo (company) to distributors/retailers, and from distributors to their linked retailers via indents.

#### List Tab

Shows all allocations. Filters: source (company/distributor/all), status (pending/sent/paid/overdue/all), payment type, party.

**Per allocation actions:**

| Current Status | Available Actions | What Happens |
|---|---|---|
| `pending` | **Dispatch** | Status → `sent`. Stock locked. If credit: `CreditEntry` created with status `outstanding`. |
| `pending` | **Cancel** | Status → `cancelled`. Locked stock released. |
| `sent` (credit) | **Mark Paid** | Status → `paid`. `CreditEntry` status → `settled`. Stock deducted from config. |
| `sent` (cash) | **Mark Paid** | Status → `paid`. Stock deducted. |
| `overdue` | **Mark Paid** | Same as sent → paid. |

#### New Tab

Create a company → party allocation:

1. Select source: Ocealgo (company) or a specific distributor
2. Select party (distributor or retailer)
3. Select product
4. Enter quantity (packets or cartons toggle)
5. Set price per packet (auto-fills from product default)
6. Payment type: Cash or Credit
7. Planned dispatch date + optional notes

**Stock validation:**
- Company source: `config.productStock[productId].total - locked >= qty`
- Distributor source: `distributor.stock[productId] >= qty`

On save: allocation created with `status: 'pending'`, stock locked.

#### Network Tab

Visualises the distributor → retailer hierarchy.

For each distributor: expandable card showing all linked retailers and their **pending indents** (`RetailerIndent` docs with `status: 'requested'` or `'partial'`).

**Indent fulfillment actions:**

| Action | Qty | Result |
|---|---|---|
| **Fulfill** | = requested | `status: fulfilled`. StockMovement created. `distributor.stock[pid] -= qty`, `retailer.stock[pid] += qty`. |
| **Partial** | < requested | `status: partial`. StockMovement created. `fulfilledPackets` incremented. |
| **Cancel** | — | `status: cancelled`. No stock movement. |

---

### 5.4b Duty Session — Punch In / Punch Out

The field day is opened by a punch-in (meter status, opening reading, photo, location, battery) and
closed by a punch-out. Everything else the field app does hangs off it: the outlet list stays locked
until `isOnDuty`, and every outlet visit is filed against the open session.

#### Forgetting to end the day

There is no backend — `firebase.json` declares no Cloud Functions — so nothing can fire on a
schedule. Both halves of the safety net therefore run on the officer's device, which is also the only
party [firestore.rules](firestore.rules) lets close their own session.

**18:00 — the nudge.** A local notification is scheduled at punch-in for 18:00 and cancelled at
punch-out (`src/device/notify.ts`). It fires with the app closed, which is the case that matters. A
day started after 18:00 gets none. Alongside it, the sales home shows a warn banner from 18:00 while
still on duty. Permission is requested once, at punch-in; a refusal just means no notification.

**23:00 — the sweep.** `closeAbandonedSessions()` runs on app open and closes any session that is
dated before today, or is today's and past 23:00. In practice a day forgotten on Tuesday night is
tidied on Wednesday morning rather than at 23:00 sharp.

An auto-closed day records:

- `status: 'closed'`, `autoClosed: true`, `autoClosedAt`, and an `endAt`
- **no** `endOdometerKm` and **no** `claimedDistanceKm` — no reading was taken, so none is invented
- any outlet visit still open is set to `status: 'abandoned'` (not `closed` — it never collected its
  required outcome), and is excluded from the visit count in Sales Reports
- a `duty_auto_closed` alert to `admin_group`, so a forgotten day is seen rather than silently
  reading as a day with no distance

**The odometer chain.** `lastDutyDay()` reads the previous session once and answers both of the
questions a punch-in has about the past. Its `closingKm` falls back to `startOdometerKm` when there
is no closing reading — without that fallback the "not lower than your last closing reading" floor
silently disappears after an auto-close, which would make forgetting to punch out the way to reset
your own meter baseline.

**Carrying the meter answer forward.** The same lookup returns the last day's `odometerStatus` and
`odometerIssueNote`, and punch-in starts on them when the last answer was *not* `recorded`. A rep
with a working meter sees no change; a rep who has no vehicle stops retyping the same sentence every
morning. It is shown, not hidden — the chooser carries "Carried over from your last day. Change it
if today is different." — and the first tap or keystroke wins over a lookup that lands late. Each
day's document still stores its own status and note, so the record stays self-explaining and
[firestore.rules](firestore.rules) is untouched.

Why it matters beyond convenience: that note is the only thing standing in for the readings and the
photos on a no-meter day. A required sentence asked ~250 times a year about a fact that has not
changed becomes "aaaaa", and the evidence the rule exists to produce is worth nothing.

Auto-closed days are labelled as such in the sales home, the duty summary and the admin Field Report
("never ended" / "Not ended"), so they never read as a real day that happened to cover no ground.

### 5.5 Visit Logger

Sales reps log all shop visits for the current day. All visits bundle into one `DailyVisitLog` document keyed `{salesPersonId}_{date}`.

#### Adding a Visit

1. **Select party** — search/filter from existing parties (type/status filters) OR tap "New Prospect" to create on the fly
2. **Mark outcome:**

**Outcome: Interested**

| Party type | Result |
|---|---|
| Direct retailer (no `underDistributorId`) | Creates `UnifiedAllocation` (company → retailer, `status: pending`). Party status → `active`. |
| Retailer under distributor | Creates `RetailerIndent` (`status: requested`). Party status → `active`. |
| Distributor | Creates `UnifiedAllocation` (company → distributor, `status: pending`). Party status → `active`. |

**Outcome: Not Interested**

Reason picker (required):
- Price too high / Margin not enough / Already has similar product / Loyal to competitor / Need more time / Come back next month / Shop too small / Low footfall / Product not relevant / Other (→ free text input)

Party status → remains `prospect`.

**Outcome: Follow Up**

Marks for later revisit. No allocation or indent created. Party unchanged.

#### End of Day

Sales rep adds optional end-of-day note → submits. Log finalised with:
- `totalVisited`, `totalInterested`, `totalNotInterested` (auto-calculated)
- `updatedAt` timestamp

---

### 5.6 Revisit Logger

For follow-up visits to **active** parties. A single revisit session can combine multiple action types. Stored as `RevisitLog` with an `actions[]` array.

#### Action Types

**1. Stock Update**
- Fields: product, opening qty, sold qty, balance qty
- Can use manual balance override (when opening qty is unknown)
- On save: `party.stock[productId] -= soldQty`
- Creates `StockUpdateAction` in the revisit log

**2. New Order**
- Fields: product, quantity, price per unit, payment type (cash/credit), planned date (defaults to T+2 days)
- Creates `UnifiedAllocation` (company/distributor → party, `status: pending`)

**3. Payment Collection**
- Fields: amount, method (cash / cheque / bank_transfer / UPI), collection type (direct to company / collected by sales person), date, notes
- Creates `PaymentTransaction` with `status: 'pending_approval'`
- Admin must approve in Credit Book

**4. Relationship Visit**
- Free-text notes only. No data changes.

**5. No Longer Active**
- Enter reason
- `party.status = 'inactive'`
- `party.inactiveReason` recorded

**6. Distribute to Retailers** (distributors only)
- Log stock pushed from distributor to their linked retailers
- Per retailer: qty + price per unit
- Creates `StockMovement` docs for each

Multiple actions can be combined in one revisit session before submitting.

---

### 5.7 Visit History

Read-only view of past `DailyVisitLog` and `RevisitLog` documents for the logged-in sales person. Filterable by single day or month. Expandable per-day cards showing all visit entries and outcomes.

---

### 5.8 Stock Manager

Central inventory control for Ocealgo's company-held stock.

#### Overview Tab

Displays per product:
- **Total** — physical packets held
- **Locked** — reserved for pending allocations
- **Available** — `total - locked`

Admin can inline-edit the total packets for any product.

Config stored at `config/stock`:
```
{ total, locked, packetsPerCarton, productStock: { [productId]: { total, locked } }, updatedAt }
```

#### Dispatch Tab

Direct dispatch from company stock to a party (creates a `Dispatch` doc — legacy path alongside the Allocation Manager flow).

#### History Tab

Chronological log of all `StockMovement` and `Dispatch` documents — from/to party, qty, amount, date, logged by.

---

### 5.9 Credit Book

Tracks the full lifecycle of credit-based sales.

#### Data Model

```
PaymentTransaction: {
  partyId, partyName, partyType,
  amount, method ('cash'|'cheque'|'bank_transfer'|'upi'),
  collectionType ('direct_to_company'|'collected_by_salesperson'),
  date, notes,
  status ('pending_approval'|'approved'|'rejected'),
  createdBy, createdByName, createdAt
}
```

#### Views

**Outstanding credit** — all credit allocations with `status: sent` or `overdue`. Grouped by party. Shows total ₹ outstanding per party.

**Pending Approval** — `PaymentTransaction` docs with `status: 'pending_approval'`. Sales rep collected cash but admin hasn't confirmed.

**Settled** — approved transactions and paid-off allocations.

#### Admin Actions

| Action | Trigger | Result |
|---|---|---|
| **Approve payment** | Admin clicks Approve on pending transaction | `PaymentTransaction.status → approved`. Linked allocation recalculated. |
| **Reject payment** | Admin clicks Reject | `PaymentTransaction.status → rejected`. Credit remains outstanding. |
| **Mark allocation paid** | Admin directly on allocation | `allocation.status → paid`. Stock deducted. |

#### Sales Rep Access

Read-only view of outstanding credit for their parties. Can log a payment collection (creates `PaymentTransaction`) but cannot approve.

---

### 5.10 Expense Logger

All users log field/operational expenses.

**Categories:** Travel 🚗 / Food 🍱 / Marketing 📣 / Operations ⚙️ / Misc 📦

**Fields per entry:** amount (₹), category, note/description, date (auto-captured), addedBy (auto-captured)

**Views:**
- Filter by single day or month
- Breakdown totals by category
- Grand total for period
- Admin sees all users' expenses; sales/marketing reps see only their own

Admin can click any expense to navigate directly to the visit log for that user on that date (cross-module link).

---

#### Nil returns — a week with nothing to claim

A rep with no entries can declare **"Nothing to claim this week"**. It creates the report as a draft
like any other week and submits it with `totalAmount: 0` and `nilReturn: true`.

This exists because the absence of a report was doing double duty. `expense_reports` docs are created
lazily on the first entry, so a rep who genuinely spent nothing — company vehicle, on leave, worked
out of HQ — left no document at all, and was indistinguishable from a rep who forgot to file. A
declared nil closes the week the normal way: submitted, then acknowledged.

- The reviewer sees "· nothing to claim" on the row, and Clear becomes **Acknowledge the week** with
  the money warning replaced — nothing is being paid.
- `nilReturn` is only read when the total is still zero. Adding an entry later makes the declaration
  obsolete rather than wrong, and a real submit clears the flag, so nothing has to reconcile it.
- Approval is unchanged: acknowledging still needs `clear_expenses`.

#### Fuel — claimed by distance, not by amount

When a ₹/km rate is configured, selecting **Fuel** replaces the amount field with a distance field:
the rep enters kilometres and the amount is `km × ratePerKm`. There is no way to type a rupee figure
for fuel, so a claim cannot drift from the rate.

- The rate lives on `expense_config/main` as `ratePerKm`, set on the **Rates** tab of the admin
  expense view. It is gated on `clear_expenses` — the person who signs off a report is the person who
  sets what it is worth. (Previously the tab was visible to any sales manager with `view_expenses`
  but the save was denied by rules; both sides now agree.)
- Leaving the rate blank turns the feature off and fuel goes back to a typed amount. A rate of zero
  is rejected rather than stored, since it would silently make every fuel claim worth nothing.
- The entry stores `distanceKm`, `ratePerKm` and `autoCalculated: true`. **The rate is copied onto
  the entry**, not looked up later — changing the rate must not restate claims already made, and a
  cleared week has to still explain its own arithmetic months afterwards.
- Both the rep's list and the admin review line show the working (`12 km at ₹4 per km`).

Not wired up: the day's `claimedDistanceKm` from the duty session is not used to pre-fill or check
the kilometres claimed. See §5.4b — the two numbers exist and nothing compares them.

### 5.11 Product Manager

CRUD for the product catalog.

**Fields:** name, unit label (e.g. "packets"), default price per unit, units per carton, `active` flag.

**Auto-seed:** On first app load, if no products exist, a default "Baby Wet Wipes" product is created (idempotent).

**Soft delete:** Products have an `active: boolean` flag. Inactive products are hidden from all selectors (allocations, visit logger, etc.) but their historical data is preserved.

---

### 5.12 Online Marketing Content Calendar

Tracks the status of content posts for the current month.

**Post data** (hardcoded in `data.ts`):
- 18 posts for May 2026
- Fields: id, date, day, pillar (Brand Story / Ingredient Education / Mom Relatability / etc.), format (Static Post / Carousel / Reel), topic, week (1–4)

**Post statuses** stored in Firestore `post_statuses` collection, keyed `{YYYY-MM}_post_{postId}`:

| Status | Emoji | Meaning |
|---|---|---|
| `pending` | ⏳ | Not yet started |
| `in-progress` | 🔄 | Being created |
| `posted` | ✅ | Published |
| `missed` | ❌ | Deadline passed, not posted |

**Features:**
- Filter by week (All / 1 / 2 / 3 / 4)
- Progress bar: `posted / total` %
- Weekly completion stats
- Any user with access can update a post's status

**Admin view:** Same calendar accessible in AdminDashboard → Marketing → Online tab.

---

### 5.13 Leave Tracker

Manages sales team attendance and leave records.

#### Data Model

```
LeaveRecord: {
  uid, name, role, date (YYYY-MM-DD),
  leaveType: 'full_day' | 'half_day',
  status: 'pending_approval' | 'active' | 'unmark_requested' | 'removed' | 'rejected',
  reason?,
  markedAt, markedBy, markedByName,
  auditLog: [{ action, by, byName, at }]
}

Holiday: { id, name, date, createdBy, createdByName, createdAt }
```

#### Status Transitions

```
pending_approval ──→ active       (admin approves)
                 └──→ rejected    (admin rejects)

active ──→ unmark_requested       (employee requests removal)

unmark_requested ──→ active       (admin rejects unmark)
                 └──→ removed     (admin approves unmark)
```

`rejected` and `removed` are terminal — excluded from all live views.

#### Admin Scenarios

**Approve leave request:**
- `status → active`
- Audit log entry added
- Alert notification sent to employee

**Reject leave request:**
- `status → rejected`
- Audit log entry added

**Approve unmark request:**
- `status → removed`
- Audit log entry added

**Reject unmark request:**
- `status → active` (reverted)
- Audit log entry added

**Mark leave directly on admin dashboard:** Admin can mark full day or half day leave for any sales user from the Sales tab of AdminDashboard (with confirmation modal). Blocked if the user already has a leave record for that date.

**Add / delete holidays:**
- Name + date required, no duplicate dates
- Can only delete future holidays (date >= today)

#### Views

- **Today** — active leaves for today
- **Month** — all active leaves this month
- **All** — full history (excluding removed/rejected)
- **Holidays** — list of company holidays

**Team Summary card:** Each sales user shown with on-leave status (🏖️), pending approval badge, monthly count, total count.

**Full-day leave + visit logs:** When a sales rep has an active full-day leave for a date, their visit log for that date is suppressed in the admin Sales view and replaced with a leave card.

---

### 5.14 Workspace (Admin only)

Three sections accessible via tabs.

#### Reminders

Date-based reminders with:
- Title, date, category (Finance / Operations / Sales / Marketing / General)
- Type: `manual` (user-created) or system-generated (`low_stock`, `dispatch`, `credit_due`, `allocation`)
- Can be marked done
- System can auto-generate reminders linked to specific transactions

#### Checklist

Recurring task items per team member:
- Title, category, owner (ownerId + ownerName)
- `completed: boolean`, `completedAt` timestamp
- Admin CRUD

#### Pinned Notes

Free-text workspace notes:
- `content`, `createdBy`, `archived` flag
- Can be archived (soft-hide) but not deleted

---

### 5.15 User Management (Admin only)

Three tabs:

**Pending** — new registrations awaiting approval.
- Admin assigns role from dropdown
- Approve → `status: approved`, role set, `approvedAt/By` recorded
- Reject → `status: rejected`

**Active** — all approved users.
- Change role (dropdown, live update)
- Deactivate → `status: deactivated` (Firebase Auth account kept)
- Super admin user (hardcoded email) cannot be modified by anyone

**Deactivated** — soft-deleted users.
- Reactivate → admin assigns role → `status: approved`
- Same email address can be reused

---

### 5.16 Settings (Super Admin only)

Accessed from Overview quick links grid (⚙️ Settings card). Only visible to `super_admin`.

**Current config:**

**Mapper Link** — URL to the column-mapping tool used in the CSV/Excel import flow. Saved to `config/settings.mapperLink` in Firestore. Validated as a proper `https://` URL before saving. Once saved, appears as a clickable "Open Mapper →" button in the Import screen (step 2).

*Future configs can be added as additional cards within this same screen.*

---

## 6. Firestore Collections Reference

| Collection | Key | Document Shape |
|---|---|---|
| `users` | `{uid}` | AppUser — uid, email, name, role, status, createdAt, approvedAt?, approvedBy? |
| `parties` | auto | Party — name, type, category, phone, email, address, place, district, state, pincode, status, underDistributorId?, underDistributorName?, pricePerPacket, packetsAllocated, cartonsAllocated, lowStockThreshold, stock?, addedBy, addedByName, createdAt |
| `allocations_v2` | auto | UnifiedAllocation — fromType, fromId, fromName, partyId, partyName, productId, packets, cartons, pricePerPacket, totalAmount, paymentType, plannedDate, status, sentAt?, paidAmount?, createdBy, createdByName, createdAt |
| `retailer_indents` | auto | RetailerIndent — distributorId, retailerId, retailerName, productId, requestedPackets, fulfilledPackets, status, requestedBy, requestedByName, createdAt |
| `visit_logs` | `{uid}_{date}` | DailyVisitLog — salesPersonId, salesPersonName, date, visits[], endOfDayNote, totalVisited, totalInterested, totalNotInterested, createdAt, updatedAt |
| `revisit_logs` | auto | RevisitLog — partyId, partyName, salesPersonId, date, actions[], notes, createdAt |
| `dispatches` | auto | Dispatch — partyId, partyName, packets, cartons, pricePerPacket, totalAmount, paymentType, dispatchedBy, dispatchedAt, createdAt |
| `stock_movements` | auto | StockMovement — fromId, fromName, toPartyId, toPartyName, packets, cartons, pricePerPacket, totalAmount, month, loggedBy, date, createdAt |
| `payment_transactions` | auto | PaymentTransaction — partyId, partyName, amount, method, collectionType, date, notes, status, createdBy, createdByName, createdAt |
| `expenses` | auto | Expense — amount, category, note, addedBy, addedByName, date, createdAt |
| `products` | auto | Product — name, unitLabel, defaultPricePerUnit, unitsPerCarton, active, createdBy, createdAt |
| `post_statuses` | `{YYYY-MM}_post_{id}` | PostStatus — postId, status, month, updatedBy, updatedAt |
| `leave_records` | auto | LeaveRecord — uid, name, role, date, leaveType, status, reason?, markedAt, markedBy, markedByName, auditLog[] |
| `holidays` | auto | Holiday — name, date, createdBy, createdByName, createdAt |
| `checkins` | `{name}_{date}` | CheckIn — name, role, shops, orders, did, doing, blocker, date, createdAt |
| `alerts` | auto | Alert — type, message, relatedId, read, createdAt |
| `reminders` | auto | Reminder — title, date, category, type, linkedId?, done, createdBy, createdByName, createdAt |
| `checklist_items` | auto | ChecklistItem — title, category, completed, completedAt?, ownerId, ownerName, createdAt |
| `pinned_notes` | auto | PinnedNote — content, createdBy, createdByName, archived, createdAt |
| `config/stock` | `"stock"` | StockConfig — total, locked, packetsPerCarton, productStock?, updatedAt |
| `config/settings` | `"settings"` | AppSettings — mapperLink |

---

## 7. Stock Locking System

Stock is never over-committed. The system maintains a `locked` counter alongside `total`.

```
Allocation created (pending)  →  locked += qty
Allocation cancelled          →  locked -= qty
Allocation dispatched (cash)  →  total -= qty, locked -= qty
Allocation dispatched (credit)→  locked stays (stock committed until paid)
Payment received / mark paid  →  total -= qty, locked -= qty
```

**Available stock** = `total - locked`

All new allocations are validated against available stock before saving.

---

## 8. Party Status Transitions

```
[prospect] ──→ [active]    on: allocation created, indent created, revisit "interested"
[active]   ──→ [inactive]  on: revisit action "no_longer_active"
[inactive] ──→ [prospect]  on: manual reactivation (edit party)
[prospect] stays prospect  on: visit outcome "not_interested" or "follow_up"
```

---

## 9. End-to-End Business Scenarios

### Scenario A — New Retailer Onboarded by Sales Rep

1. Sales rep opens Visit Logger
2. Taps "New Prospect" → fills shop details → creates party (status: `prospect`)
3. Marks outcome: **Interested** → selects product + qty
4. System creates `UnifiedAllocation` (company → retailer, `pending`)
5. Party status → `active`
6. Admin sees pending allocation in Allocation Manager
7. Admin dispatches → `status: sent`, stock locked
8. If credit: `PaymentTransaction` cycle begins (see Scenario C)
9. If cash: admin marks paid → stock deducted, complete

---

### Scenario B — Distributor Network Flow (Indent)

1. Sales rep visits retailer linked to Distributor X
2. Marks interested → creates `RetailerIndent` (status: `requested`)
3. Admin opens Allocation Manager → Network tab → Distributor X card
4. Sees pending indent for the retailer
5. Chooses **Fulfill** → enters qty
6. System: `RetailerIndent.status → fulfilled`, `StockMovement` created
7. `distributor.stock[productId] -= qty`, `retailer.stock[productId] += qty`

---

### Scenario C — Credit Collection Cycle

1. Admin dispatches credit allocation → `CreditEntry` created (status: `outstanding`)
2. Sales rep visits party later, logs Payment Collection in Revisit Logger
3. `PaymentTransaction` created (status: `pending_approval`)
4. Admin sees pending payment in Credit Book
5. Admin approves → allocation `status: paid`, stock fully deducted
6. Admin rejects → transaction `status: rejected`, credit remains outstanding

---

### Scenario D — Bulk Import from Zoho

1. Super admin sets mapper link in Settings (⚙️ → Mapper Link → Save)
2. Admin opens Party Manager → Import tab
3. Goes to Zoho Books → Sales → Customers → Export → downloads CSV
4. Opens mapper link → pastes CSV → remaps columns → downloads result
5. Uploads file in the Import screen
6. App parses file; auto-skips any names already in Firestore
7. Admin reviews each entry one by one (all fields editable)
8. For retailers: selects parent distributor (or leaves as independent)
9. Taps "Import & Next" per entry → party saved to Firestore as `prospect`
10. Done screen shows imported vs skipped count

---

### Scenario E — Sales Rep Leave

1. Sales rep requests leave from SalesView → Leave section
2. `LeaveRecord` created with `status: pending_approval`
3. Admin sees badge in Leave Tracker and AdminDashboard header
4. Admin approves → `status: active`, alert sent to rep
5. On the leave date, AdminDashboard Sales view suppresses the rep's visit log and shows a leave card instead
6. Rep can request to unmark their leave → `status: unmark_requested`
7. Admin approves unmark → `status: removed`; visit log visible again

---

### Scenario F — Marketing Calendar Update

1. Online marketing team opens OnlineMarketingView
2. Sees 18 posts for the month organised by week and pillar
3. Expands a post → changes status from `pending` → `in-progress`
4. Later: changes to `posted` after publishing
5. Admin sees same calendar in AdminDashboard → Marketing → Online tab
6. Progress bar updates live; week completion stats recalculate

---

## 10. Pending / Placeholder Modules

| Module | Status | Planned scope |
|---|---|---|
| Online Sales | Placeholder | Field visit logging and indent workflow for online channels |
| Offline Marketing | Placeholder | On-ground campaigns, events, BTL activities, collateral tracking |
| Monthly Request Manager | Referenced in code | Monthly stock request tracking (may be superseded by Allocation Manager) |
