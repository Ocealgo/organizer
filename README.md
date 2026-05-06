# Ocealgo Team Dashboard

Internal operations dashboard for **Ocealgo** — a B2B baby wipes brand. Manages distributor/retailer allocations, field sales visits, stock tracking, credit, and admin oversight in a single mobile-first SPA.

---

## Tech Stack

| Layer | Choice |
|---|---|
| Framework | React 18 + TypeScript |
| Build tool | Vite 5 |
| Backend | Firebase Firestore (NoSQL) + Firebase Auth |
| Routing | React Router DOM v6 |
| Styling | Inline styles only, no CSS framework |
| Theme | Custom `useTheme()` hook — dark / light |

---

## Project Overview

- Single-page app; no server-side rendering.
- All business data lives in Firestore collections.
- Auth is Firebase Email/Password. New accounts go through an admin approval flow (`AccountStatus`: `pending` → `approved`).
- Role-based routing: the top-level `App.tsx` renders one of four root views (`AdminDashboard`, `SalesView`, `MarketingView`, `OnlineMarketingView`) based on the authenticated user's role.
- Mobile-first layout using inline flex/grid styles and the shared theme token system.

---

## User Roles

| Role | Label | Root View | Key Access |
|---|---|---|---|
| `super_admin` | Super Admin | AdminDashboard | Everything; cannot be modified by regular admin |
| `admin` | Admin | AdminDashboard | All modules, user management, workspace |
| `offline_sales` | Offline Sales | SalesView | Visit Logger, Revisit Logger, Visit History, Expense Logger, Credit Book (read) |
| `online_sales` | Online Sales | SalesView | Same as offline_sales |
| `offline_marketing` | Offline Marketing | MarketingView | Marketing content calendar, check-in |
| `online_marketing` | Online Marketing | OnlineMarketingView | Online content calendar, post status tracking |

**Account states:** `pending` (awaiting approval), `approved` (active), `rejected`, `deactivated`. Users in any non-approved state see a holding screen and cannot access any module.

---

## Core Modules

### 1. Admin Dashboard

**Who:** `admin`, `super_admin`

The admin's home view. Rendered as a tabbed layout with four top-level tabs:

- **Overview** — Summary cards: total parties, active distributors, active retailers, pending allocations, outstanding credit, low-stock alerts. Notification bell for system alerts (`new_party`, `credit_settlement`, `low_stock`, `stock_dispatched`).
- **Sales** — Two sub-tabs:
  - *Offline Sales*: AllocationManager, PartyManager, daily visit logs, credit book, stock manager.
  - *Online Sales*: Equivalent views scoped to online channel parties.
- **Marketing** — Content post status board; admin can mark posts as `pending`, `in-progress`, `posted`, or `missed` per month.
- **Workspace** — Reminders, Checklist, Pinned Notes (see Workspace section below).

---

### 2. Party Manager

**Who:** `admin` (CRUD), sales (read + add new parties during visit logging)

Manages the master list of **distributors** and **retailers**.

**Key fields on a Party:**

| Field | Purpose |
|---|---|
| `type` | `distributor` or `retailer` |
| `category` | `FMCG`, `Pharma`, `General Store`, `Supermarket`, `Online`, `Other` |
| `status` | `prospect` / `active` / `inactive` — auto-updated by allocation and revisit logic |
| `underDistributorId` | Links a retailer to its parent distributor |
| `pricePerPacket` | Party-specific price override |
| `lowStockThreshold` | Packets threshold that triggers a low-stock alert |

**Flows:**
- Search by name or place (client-side filter).
- Filter by party type and status.
- Add/edit party inline; phone and address stored for field reference.
- Parties are not deleted — they are marked inactive via revisit action or allocation logic.

---

### 3. Allocation Manager

**Who:** `admin`

Manages stock allocations from Ocealgo to distributors and direct retailers.

**Three tabs:**

#### List Tab
Displays all `allocations_v2` documents. Filters: status (`pending` / `sent` / `paid` / `overdue`), party, payment type. Each row shows party name, packets/cartons, price, total amount, planned date, status badge.

#### New Tab
Create a new allocation:
1. Select party (distributor or retailer).
2. Select product from the `products` collection.
3. Enter quantity in packets or cartons (auto-converts using `unitsPerCarton`).
4. Set `pricePerPacket`, payment type (`cash` / `credit`), and planned dispatch date.
5. Add optional notes.
6. Save → creates `UnifiedAllocation` doc with `status: pending`, sets the party's status to `active`.

**Dispatch (admin action on a pending allocation):**
- Admin clicks "Dispatch" → status becomes `sent`, `sentAt` timestamp recorded, `sentBy` set.
- A `Dispatch` doc is written to the `dispatches` collection.
- If `credit`: a `CreditEntry` doc is created (`status: outstanding`).
- If `cash`: treated as received immediately.
- Stock is locked at dispatch time via `StockConfig.locked`.

**Mark Paid (admin action on a sent/credit allocation):**
- Admin marks credit allocation as paid → `paidAt` set, status → `paid`.
- `CreditEntry` status → `settled`.
- Stock deducted from `StockConfig.total`.

#### Network Tab
Visualises the distributor → retailer map.

- Each distributor card expands to show its linked retailers.
- **Pending Indents section** per distributor: lists `RetailerIndent` docs with `status: requested` or `partial` that belong to that distributor.
- Admin actions on each indent:
  - **Fulfill**: enter qty → sets `fulfilledPackets = requestedPackets`, `status: fulfilled`, creates a `StockMovement` doc.
  - **Partial**: enter partial qty → updates `fulfilledPackets`, `status: partial`, creates a `StockMovement` doc.
  - **Cancel**: sets `status: cancelled`.

---

### 4. Visit Logger

**Who:** `offline_sales`, `online_sales`

Used by field sales reps to log each shop visit during the day. All visits for a day are bundled into a single `DailyVisitLog` document (keyed by `salesPersonId + date`).

**Visit entry flow:**

1. **Select party**: choose an existing party from the list, or tap "New Prospect" to log a party not yet in the system.
2. **Set outcome**: `interested`, `not_interested`, or `follow_up`.

**If `not_interested`:**
- Select a reason from the `NOT_INTERESTED_REASONS` list:
  `Price too high`, `Margin not enough`, `Already has similar product`, `Loyal to competitor`, `Need more time`, `Come back next month`, `Shop too small`, `Low footfall`, `Product not relevant`, `Other`.
- If `Other`, a free-text field is shown.

**If `interested` + party is a direct retailer (no `underDistributorId`):**
- Select product + quantity.
- Creates a `UnifiedAllocation` doc (status `pending`) directly.
- Sets party status → `active`.

**If `interested` + retailer under a distributor:**
- Select product + quantity.
- Creates a `RetailerIndent` doc (status `requested`) — a stock requisition routed through that retailer's parent distributor.
- Sets party status → `active`.

**End of day:** sales rep adds an end-of-day note and submits the log. Totals (`totalVisited`, `totalInterested`, `totalNotInterested`) are computed and stored.

---

### 5. Revisit Logger

**Who:** `offline_sales`, `online_sales`

For follow-up visits to **active** parties. A `RevisitLog` document stores one or more typed actions per visit.

**Action types:**

| Type | Data Captured |
|---|---|
| `stock_update` | Opening qty, purchased qty, sold qty, balance qty/value, optional photo URL, AI-read flag |
| `new_order` | Product, quantity, price per unit, total, payment type, planned date → creates `UnifiedAllocation` |
| `payment_collection` | Amount, notes, approval status (`pending_approval` / `approved` by admin) |
| `relationship_visit` | Free-text notes only |
| `no_longer_active` | Reason text → sets party status to `inactive` |

A single revisit can include multiple actions (e.g., stock update + new order on the same visit).

---

### 6. Visit History

**Who:** `offline_sales`, `online_sales`

Read-only view of past `DailyVisitLog` and `RevisitLog` documents for the logged-in sales person. Filter by date or month. Shows per-day summary cards that expand to show individual visit entries with outcomes and actions.

---

### 7. Stock Manager

**Who:** `admin`

- **Stock Config** (`config/stock` document): Edit `total` (total packets on hand), `locked` (packets committed to pending dispatches), `packetsPerCarton`.
- **Stock Movements Log**: Chronological list of `StockMovement` docs — distributor-to-retailer transfers, with from/to party, packets, amount, and date.

---

### 8. Credit Book

**Who:** `admin` (full access), sales (read-only + payment_collection logging)

Lists `CreditEntry` documents. Each entry links to a dispatch/allocation and records `packets`, `amount`, party details, and settlement state:

| Status | Meaning |
|---|---|
| `outstanding` | Payment not yet received |
| `pending_approval` | Sales rep has logged a payment collection; awaiting admin confirmation |
| `settled` | Admin confirmed payment; `settledBy` and `settledAt` recorded |

---

### 9. Expense Logger

**Who:** All roles (each user logs their own)

Log field or operational expenses. Each `Expense` doc has:
- `category`: `travel`, `food`, `misc`, `marketing`, `operations`
- `amount`, `note`, `date`, `addedBy`

Admin sees all expenses; sales/marketing see only their own.

---

### 10. Product Manager

**Who:** `admin`

CRUD interface for the `products` collection.

| Field | Description |
|---|---|
| `name` | Product display name |
| `unitLabel` | Label for one unit (e.g. `packets`, `bottles`) |
| `defaultPricePerUnit` | Fallback price used when no party-specific price is set |
| `unitsPerCarton` | Used to convert between packets and cartons everywhere |
| `active` | Soft-delete flag; inactive products are hidden from selectors |

On first app load, a seed function ensures a default `Baby Wet Wipes` product exists.

---

### 11. Workspace

**Who:** `admin`

Productivity utilities surfaced in the Admin Dashboard's Workspace tab.

- **Reminders**: Create dated reminders with a `WorkspaceCategory` (`Finance`, `Operations`, `Sales`, `Marketing`, `General`) and a `ReminderType` (`manual`, `low_stock`, `dispatch`, `credit_due`, `allocation`). System-generated reminders link to a `linkedId`. Mark as done.
- **Checklist**: Recurring task items per owner. Mark complete with timestamp.
- **Pinned Notes**: Free-text notes pinned to the workspace. Can be archived.

---

## Key Data Flows

### Allocation Flow (Admin dispatches to distributor or retailer)

```
[Admin] AllocationManager → New tab
  → UnifiedAllocation created (status: pending)
  → Party status set to 'active'

[Admin] clicks Dispatch on a pending allocation
  → UnifiedAllocation.status → 'sent', sentAt set
  → Dispatch doc written to dispatches collection
  → If credit: CreditEntry created (status: outstanding)
  → If cash: received immediately, no credit entry
  → Stock locked (StockConfig.locked += packets)

[Admin] marks credit allocation paid
  → UnifiedAllocation.status → 'paid', paidAt set
  → CreditEntry.status → 'settled'
  → StockConfig.total -= packets, locked -= packets
```

### Indent Flow (Sales visits retailer under distributor)

```
[Sales] VisitLogger → selects retailer with underDistributorId
  → Marks outcome: interested
  → Selects product + qty
  → RetailerIndent created (status: requested)
  → Retailer party status → 'active'

[Admin] AllocationManager → Network tab → distributor card → Pending Indents
  → Sees RetailerIndent with status: requested / partial

  Option A — Fulfilled:
    → Enter qty (= requestedPackets)
    → RetailerIndent.status → 'fulfilled', fulfilledPackets updated, fulfilledAt set
    → StockMovement doc created (fromId: distributorId → toPartyId: retailerId)

  Option B — Partial:
    → Enter qty (< requestedPackets)
    → RetailerIndent.status → 'partial', fulfilledPackets += qty
    → StockMovement doc created

  Option C — Cancel:
    → RetailerIndent.status → 'cancelled'
```

### Party Status Auto-Updates

| Trigger | New Status |
|---|---|
| Allocation created for any party | `active` |
| VisitLogger: retailer marked interested → indent created | `active` |
| Revisit action: `no_longer_active` | `inactive` |

---

## Firestore Collections

| Collection | Key Document Shape | Primary Writers | Primary Readers |
|---|---|---|---|
| `parties` | `Party` — name, type, category, phone, place, underDistributorId | admin, sales (prospects) | all roles |
| `allocations_v2` | `UnifiedAllocation` — partyId, packets, cartons, price, paymentType, plannedDate, status | admin, sales (VisitLogger) | admin |
| `retailer_indents` | `RetailerIndent` — distributorId, retailerId, productId, requestedPackets, fulfilledPackets, status | sales (VisitLogger) | admin |
| `visit_logs` | `DailyVisitLog` — salesPersonId, date, visits[], totals | sales | sales (own), admin |
| `revisit_logs` | `RevisitLog` — partyId, salesPersonId, date, actions[] | sales | sales (own), admin |
| `dispatches` | `Dispatch` — partyId, packets, cartons, price, totalAmount, paymentType, month | admin | admin |
| `stock_movements` | `StockMovement` — fromId, toPartyId, packets, cartons, price | admin (indent fulfillment) | admin |
| `credits` | `CreditEntry` — partyId, deliveryId, amount, status, settledBy | admin, sales (payment_collection) | admin, sales |
| `expenses` | `Expense` — amount, category, note, addedBy, date | all roles | own + admin |
| `products` | `Product` — name, unitLabel, defaultPricePerUnit, unitsPerCarton, active | admin | all roles |
| `checkins` | `CheckIn` — name, role, shops, orders, did, doing, blocker, date | sales, marketing | admin |
| `alerts` | `Alert` — type, message, relatedId, read | system (auto-generated) | admin |
| `config/stock` | `StockConfig` — total, locked, packetsPerCarton, updatedAt | admin | admin, system |
| `reminders` | `Reminder` — title, date, category, type, linkedId, done | admin + system | admin |
| `checklist_items` | `ChecklistItem` — title, category, completed, ownerId | admin | admin |
| `pinned_notes` | `PinnedNote` — content, createdBy, archived | admin | admin |

---

## Theme System

Theme is managed via `ThemeContext`. The provider persists the selected theme per user UID in Firestore or localStorage.

```ts
const { t, theme, toggle } = useTheme()
// theme: 'dark' | 'light'
// toggle(): switches between dark and light
// t: token object used for all inline styles
```

**Token map (`t`):**

| Token | Role |
|---|---|
| `t.bg` | Page background |
| `t.bg2` | Slightly elevated background (top bar, nav areas) |
| `t.bg3` | Further elevated background (section headers) |
| `t.card` | Card/panel background |
| `t.cardHover` | Card background on hover |
| `t.text` | Primary text |
| `t.text2` | Secondary / muted text |
| `t.text3` | Tertiary / placeholder text |
| `t.border` | Subtle border |
| `t.border2` | Stronger border |
| `t.primary` | Brand accent colour (green) |
| `t.primaryText` | Text on primary-coloured backgrounds |

All components use inline `style={{ ... }}` with these tokens — no CSS files, no Tailwind, no component library.

---

## Setup

### Prerequisites

- Node.js 18+
- A Firebase project with **Firestore** and **Authentication (Email/Password)** enabled.

### Environment Variables

Copy `.env.example` to `.env` and fill in your Firebase project credentials:

```env
VITE_FIREBASE_API_KEY=your_api_key_here
VITE_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_STORAGE_BUCKET=your_project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
VITE_FIREBASE_APP_ID=your_app_id
```

All variables are prefixed with `VITE_` so Vite exposes them to the client bundle. Never commit your `.env` file — it is listed in `.gitignore`.

### Install and Run

```bash
npm install

# Development server with hot reload
npm run dev

# Type-check + production build
npm run build

# Preview production build locally
npm run preview
```

### Firebase Setup

1. Enable **Email/Password** sign-in: Firebase Console → Authentication → Sign-in method.
2. Create a Firestore database (production mode), region `asia-south1` (Mumbai) recommended.
3. Apply Firestore security rules. A minimal rule set to start:

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

Tighten rules per-collection once the team structure is established.

4. The first user must be manually set to `role: "super_admin"` and `status: "approved"` directly in the Firestore console under the `users/{uid}` document. All subsequent users register via the app and are approved through the User Management screen.

### First-Run Seed

On every app load, `App.tsx` calls `seedDefaultProducts()` — an idempotent function that creates a `Baby Wet Wipes` product document if none exists. No manual seeding is required.

### Deployment (Vercel)

1. Push the repo to GitHub.
2. Import the repo in Vercel.
3. Add all six `VITE_FIREBASE_*` environment variables in the Vercel project settings.
4. Deploy. Every subsequent `git push` to `main` triggers an automatic redeploy.

---

## Project Structure

```
src/
  App.tsx                         # Root auth gate, role-based routing, TopBar
  firebase.ts                     # Firebase app, Firestore db, Auth exports
  types.ts                        # All shared TypeScript interfaces and types
  context/
    AuthContext.tsx                # firebaseUser + appUser (Firestore AppUser doc)
    ThemeContext.tsx               # useTheme(), token map, per-user persistence
  components/
    CustomSelect.tsx               # Shared styled select dropdown
    NotificationBell.tsx           # Alert bell for admins
  pages/
    auth/
      LoginPage.tsx
      SignupPage.tsx
    admin/
      AdminDashboard.tsx           # Tabbed admin root: Overview, Sales, Marketing, Workspace
      UserManagement.tsx           # Approve / reject / deactivate users
    distributors/
      AllocationManager.tsx        # List / New / Network tabs
      PartyManager.tsx             # Distributor and retailer CRUD
    products/
      ProductManager.tsx           # Product CRUD
    sales/
      SalesView.tsx                # Sales root — tab router for all sales modules
      VisitLogger.tsx              # Daily new-visit logging
      RevisitLogger.tsx            # Follow-up visit actions
    marketing/
      MarketingView.tsx            # Offline marketing content calendar
      OnlineMarketingView.tsx      # Online marketing post tracking
```

---

## Key Design Decisions

- **No URL-based navigation for in-app screens.** Views are toggled via `useState` flags in parent components. React Router DOM is present but used minimally (mainly for the top-level auth boundary).
- **Inline styles throughout.** All styling uses `style={{}}` props with theme token objects. This avoids CSS specificity issues and makes dark/light switching trivial.
- **DailyVisitLog is append-only per day.** A sales rep has one log document per date; each visit entry is pushed into the `visits[]` array. Submitting the log finalises the day's totals.
- **`allocations_v2` is the canonical allocation collection.** The older `allocations` collection (if present) is legacy and not used.
- **RetailerIndent as a routing mechanism.** Rather than giving field sales reps direct write access to allocations for distributor-linked retailers, indents act as a request queue that the admin processes through the Network tab — keeping stock control centralised.
