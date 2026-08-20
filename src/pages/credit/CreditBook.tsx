import { useState, useEffect } from "react";
import {
  collection,
  addDoc,
  updateDoc,
  doc,
} from "firebase/firestore";
import { onSnapshot } from "../../data/live";
import { db } from "../../firebase";
import {
  Party,
  UnifiedAllocation,
  PaymentTransaction,
  PaymentMethod,
  CollectionType,
  advanceHeld,
} from "../../types";
import { useAuth } from "../../context/AuthContext";
import { can, isSalesManager } from "../../auth/permissions";
import { useTheme } from "../../context/ThemeContext";
import { useConfirm } from "../../hooks/useConfirm";
import { localDateStr } from "../../utils/date";
import DateInput from "../../components/DateInput";
import {
  PageHeader,
  Section,
  StatGrid,
  StatCard,
  EmptyState,
  Field,
  ChipGroup,
  Note,
  GhostButton,
  PrimaryButton,
  inputStyle,
} from "../../components/ui";

interface Props {
  onBack: () => void;
  initialPartyId?: string;
  focusPaymentId?: string;
  salesRepOnly?: boolean;
}

// Direct customer = distributor OR independent retailer (no underDistributorId)
function isDirectCustomer(p: Party) {
  return (
    p.type === "distributor" ||
    (p.type === "retailer" && !(p as any).underDistributorId)
  );
}

const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: "Cash",
  cheque: "Cheque",
  bank_transfer: "Bank transfer",
  upi: "UPI",
};

const COLLECTION_LABEL: Record<CollectionType, string> = {
  direct_to_company: "Paid direct to the company",
  collected_by_salesperson: "Collected by a salesperson",
};

const CREDIT_PAGE_SIZE = 15

export default function CreditBook({ onBack, initialPartyId, focusPaymentId, salesRepOnly }: Props) {
  const { appUser } = useAuth();
  const { t } = useTheme();
  const { modal, showConfirm } = useConfirm();

  const [parties, setParties] = useState<Party[]>([]);
  const [allocations, setAllocations] = useState<UnifiedAllocation[]>([]);
  const [payments, setPayments] = useState<PaymentTransaction[]>([]);
  const [selectedPartyId, setSelectedPartyId] = useState<string | null>(initialPartyId ?? null);
  const [deepLinked, setDeepLinked] = useState<boolean>(!!initialPartyId);

  // Record payment form state
  const [showPayForm, setShowPayForm] = useState(false);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState<PaymentMethod>("cheque");
  const [payCollectionType, setPayCollectionType] =
    useState<CollectionType>("direct_to_company");
  const [payDate, setPayDate] = useState(localDateStr());
  const [payNotes, setPayNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [creditPage, setCreditPage] = useState(0);
  const [search, setSearch] = useState('');

  // Payment edit state
  const [payEdit, setPayEdit] = useState<{ id: string; amount: string; paymentMethod: PaymentMethod; date: string; notes: string } | null>(null);
  const [payEditSaving, setPayEditSaving] = useState(false);

  // Collapsible sections — auto-collapse allocs when deep-linking to a payment
  const [allocsCollapsed, setAllocsCollapsed] = useState(!!focusPaymentId);
  const [paymentsCollapsed, setPaymentsCollapsed] = useState(false);

  const today = localDateStr();
  // "isAdmin" here means "may act on payments" — recording, confirming, cancelling.
  const isAdmin = can(appUser, "approve_payments");
  const canMarkPaid = can(appUser, "mark_paid");


  useEffect(() => {
    const u1 = onSnapshot(collection(db, "parties"), (snap) =>
      setParties(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Party)),
    );
    const u2 = onSnapshot(collection(db, "allocations_v2"), (snap) =>
      setAllocations(
        snap.docs.map((d) => ({ id: d.id, ...d.data() }) as UnifiedAllocation),
      ),
    );
    const u3 = onSnapshot(collection(db, "payment_transactions"), (snap) =>
      setPayments(
        snap.docs
          .map((d) => ({ id: d.id, ...d.data() }) as PaymentTransaction)
          .sort((a, b) => b.createdAt - a.createdAt),
      ),
    );
    return () => {
      u1();
      u2();
      u3();
    };
  }, []);

  // Balance helpers
  const creditAllocsForParty = (partyId: string) =>
    allocations.filter(
      (a) =>
        a.partyId === partyId &&
        a.paymentType === "credit" &&
        (a.status === "sent" || a.status === "overdue") &&
        a.fromType !== "distributor",
    );

  const paymentsForParty = (partyId: string) =>
    payments.filter((p) => p.partyId === partyId && p.status !== "rejected");

  // Balance is stored directly on each alloc as paidAmount — no cross-collection maths needed
  const outstandingBalance = (partyId: string) =>
    creditAllocsForParty(partyId).reduce((s, a) => {
      const paid = (a as any).paidAmount || 0;
      return s + Math.max(0, a.totalAmount - paid);
    }, 0);

  const directParties = parties.filter(isDirectCustomer);
  const partiesWithCredit = directParties.filter(
    (p) =>
      creditAllocsForParty(p.id!).length > 0 ||
      paymentsForParty(p.id!).length > 0,
  );

  const totalOutstanding = partiesWithCredit.reduce(
    (s, p) => s + outstandingBalance(p.id!),
    0,
  );
  const pendingApprovalCount = payments.filter(
    (p) =>
      p.status === "pending_approval" &&
      directParties.some((d) => d.id === p.partyId),
  ).length;

  const currentMonth = today.slice(0, 7)

  /**
   * A manager reads these cards as the team; a rep reads them as themselves.
   *
   * Both cards switch together on purpose. Mixing the two scopes in one row is
   * what made this hard to read in the first place — a manager whose own number
   * is nearly always zero, sitting beside a figure that was not.
   *
   * "The team" is everybody, because there are no reporting lines in the data:
   * one sales team, no managerId on a user. The day somebody is assigned to a
   * particular manager this needs to narrow, and the tooltip says "everybody"
   * so nobody has read it as "mine" in the meantime.
   */
  const seesTeam = isSalesManager(appUser)

  /** Money a person carried in — never a transfer the party made to the company. */
  const collectedByHand = (p: PaymentTransaction) =>
    seesTeam ? !!p.collectedBy : p.collectedBy === appUser?.uid

  const collectedThisMonth = payments
    .filter(p => collectedByHand(p) && p.date?.startsWith(currentMonth) && p.status !== 'rejected')
    .reduce((s, p) => s + p.amount, 0)
  /** A manager who spent a day in the field has their own share in that total. */
  const ownCollectedThisMonth = payments
    .filter(p => p.collectedBy === appUser?.uid && p.date?.startsWith(currentMonth) && p.status !== 'rejected')
    .reduce((s, p) => s + p.amount, 0)

  // Not the whole book. This used to count everybody's regardless of who was
  // reading, which put a team-wide number between two cards about you — and it
  // was actionable by nobody who could see it, since the people who confirm a
  // payment are admins and admins do not get these cards at all.
  const unconfirmed = payments.filter(p =>
    p.status === 'pending_approval'
    && collectedByHand(p)
    && directParties.some(d => d.id === p.partyId))
  const unconfirmedCount = unconfirmed.length
  // The oldest, not the newest — a receipt that has sat there a fortnight is
  // the one worth opening. Taken by comparison rather than by position: this
  // list is sorted newest-first for display, and a card should not break
  // because somebody changes how the list below it is ordered.
  const oldestUnconfirmedPartyId = unconfirmed.length
    ? unconfirmed.reduce((a, b) => (a.createdAt <= b.createdAt ? a : b)).partyId
    : null

  // Per-party: determine overdue status client-side
  const isPartyOverdue = (partyId: string) =>
    creditAllocsForParty(partyId).some((a) => {
      const dueDate = (a as any).creditDueDate;
      return a.status === "overdue" || (dueDate && dueDate < today);
    });

  const handleConfirmPayment = async (p: PaymentTransaction) => {
    const ok = await showConfirm(
      "Confirm this receipt?",
      `Only confirm once ₹${p.amount.toLocaleString("en-IN")} from ${p.partyName} has actually reached the company account.\n\nThis cannot be undone.`,
      "Confirm",
    );
    if (!ok) return;
    await updateDoc(doc(db, "payment_transactions", p.id!), {
      status: "approved",
      confirmedAt: Date.now(),
      confirmedBy: appUser!.uid,
      confirmedByName: appUser!.name,
    });
  };

  const handleSavePayEdit = async () => {
    if (!payEdit || !appUser) return;
    const txn = payments.find((p) => p.id === payEdit.id);
    if (!txn) return;
    const newAmount = parseFloat(payEdit.amount) || 0;
    if (newAmount <= 0) return;
    setPayEditSaving(true);
    try {
      // Reverse old appliedTo
      const oldAppliedTo = (txn as any).appliedTo as { allocId: string; amount: number }[] | undefined;
      if (oldAppliedTo) {
        for (const { allocId, amount: applied } of oldAppliedTo) {
          const alloc = allocations.find((a) => a.id === allocId);
          if (!alloc) continue;
          const newPaid = Math.max(0, ((alloc as any).paidAmount || 0) - applied);
          const updates: any = { paidAmount: newPaid };
          if (alloc.status === "paid") {
            const dueDate = (alloc as any).creditDueDate;
            updates.status = dueDate && dueDate < today ? "overdue" : "sent";
          }
          await updateDoc(doc(db, "allocations_v2", allocId), updates);
        }
      }
      // Re-apply new amount FIFO to active credit allocs
      const freshAllocs = allocations
        .filter((a) => a.partyId === txn.partyId && a.paymentType === "credit" && (a.status === "sent" || a.status === "overdue") && a.fromType !== "distributor")
        .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      const newAppliedTo: { allocId: string; amount: number }[] = [];
      let remaining = newAmount;
      for (const alloc of freshAllocs) {
        if (remaining <= 0) break;
        const currentPaid = (alloc as any).paidAmount || 0;
        const owed = alloc.totalAmount - currentPaid;
        if (owed <= 0) continue;
        const toApply = Math.min(remaining, owed);
        const newPaid = currentPaid + toApply;
        const updates: any = { paidAmount: newPaid };
        if (newPaid >= alloc.totalAmount) { updates.status = "paid"; updates.paidAt = Date.now(); }
        await updateDoc(doc(db, "allocations_v2", alloc.id!), updates);
        newAppliedTo.push({ allocId: alloc.id!, amount: toApply });
        remaining -= toApply;
      }
      await updateDoc(doc(db, "payment_transactions", payEdit.id), {
        amount: newAmount,
        paymentMethod: payEdit.paymentMethod,
        date: payEdit.date,
        notes: payEdit.notes,
        appliedTo: newAppliedTo,
        updatedAt: Date.now(),
        updatedBy: appUser.uid,
        updatedByName: appUser.name,
      });
      setPayEdit(null);
    } finally {
      setPayEditSaving(false);
    }
  };

  const handleCancelPayment = async (p: PaymentTransaction) => {
    const ok = await showConfirm(
      "Cancel this payment?",
      `₹${p.amount.toLocaleString("en-IN")} from ${p.partyName} goes back onto their outstanding balance.`,
      "Cancel it",
    );
    if (!ok) return;

    // Reverse paidAmount on each alloc this payment touched
    const appliedTo = (p as any).appliedTo as
      | { allocId: string; amount: number }[]
      | undefined;
    if (appliedTo && appliedTo.length > 0) {
      for (const { allocId, amount: applied } of appliedTo) {
        const alloc = allocations.find((a) => a.id === allocId);
        if (!alloc) continue;
        const currentPaid = (alloc as any).paidAmount || 0;
        const newPaid = Math.max(0, currentPaid - applied);
        const updates: any = { paidAmount: newPaid };
        if (alloc.status === "paid") {
          const dueDate = (alloc as any).creditDueDate;
          updates.status = dueDate && dueDate < today ? "overdue" : "sent";
        }
        await updateDoc(doc(db, "allocations_v2", allocId), updates);
      }
    }

    await updateDoc(doc(db, "payment_transactions", p.id!), {
      status: "rejected",
    });
  };

  const handleMarkAllocPaid = async (a: UnifiedAllocation) => {
    const ok = await showConfirm(
      "Mark this as paid?",
      `Only do this once ₹${a.totalAmount.toLocaleString("en-IN")} from ${a.partyName} has actually reached the company account.\n\nThis cannot be undone.`,
      "Mark paid",
    );
    if (!ok) return;
    await updateDoc(doc(db, "allocations_v2", a.id!), {
      status: "paid",
      paidAt: Date.now(),
      paidAmount: a.totalAmount,
    });
  };

  const handleRecordPayment = async () => {
    if (!selectedPartyId || !payAmount || parseFloat(payAmount) <= 0) return;
    const party = parties.find((p) => p.id === selectedPartyId)!;
    const amount = parseFloat(payAmount);
    setSaving(true);
    try {
      // Apply FIFO to active credit allocs
      const activeAllocs = creditAllocsForParty(selectedPartyId)
        .slice()
        .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      const appliedTo: { allocId: string; amount: number }[] = [];
      let remaining = amount;
      for (const alloc of activeAllocs) {
        if (remaining <= 0) break;
        const currentPaid = (alloc as any).paidAmount || 0;
        const owed = alloc.totalAmount - currentPaid;
        if (owed <= 0) continue;
        const toApply = Math.min(remaining, owed);
        const newPaid = currentPaid + toApply;
        const updates: any = { paidAmount: newPaid };
        if (newPaid >= alloc.totalAmount) {
          updates.status = "paid";
          updates.paidAt = Date.now();
        }
        await updateDoc(doc(db, "allocations_v2", alloc.id!), updates);
        appliedTo.push({ allocId: alloc.id!, amount: toApply });
        remaining -= toApply;
      }
      await addDoc(collection(db, "payment_transactions"), {
        partyId: selectedPartyId,
        partyName: party.name,
        partyType: party.type,
        amount,
        paymentMethod: payMethod,
        collectionType: payCollectionType,
        ...(payCollectionType === "collected_by_salesperson"
          ? {
              collectedBy: appUser!.uid,
              collectedByName: appUser!.name,
            }
          : {}),
        notes: payNotes,
        status: "approved",
        approvedBy: appUser!.uid,
        approvedByName: appUser!.name,
        approvedAt: Date.now(),
        date: payDate,
        createdAt: Date.now(),
        appliedTo,
      });
      setShowPayForm(false);
      setPayAmount("");
      setPayNotes("");
      setPayDate(localDateStr());
      setPayMethod("cash");
      setPayCollectionType("direct_to_company");
    } finally {
      setSaving(false);
    }
  };

  const money = (n: number) => `₹${n.toLocaleString("en-IN")}`;

  const action = (label: string, onClick: () => void, disabled?: boolean) => (
    <button
      className="oc-action"
      onClick={onClick}
      disabled={disabled}
      style={{
        background: "none", border: "none", padding: 0, fontSize: 13, fontWeight: 400,
        color: t.text2, cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.5 : 1,
      }}
    >
      {label}
    </button>
  );

  /** A section heading that folds its contents away. */
  const Fold = ({ label, open, onToggle, children }: {
    label: string; open: boolean; onToggle: () => void; children: React.ReactNode
  }) => (
    <div>
      <button
        className="oc-action"
        onClick={onToggle}
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          background: "none", border: "none", padding: 0, width: "100%", cursor: "pointer",
          marginBottom: 12,
        }}
      >
        <span style={{ fontSize: 11, letterSpacing: "0.09em", textTransform: "uppercase", color: t.text3 }}>
          {label}
        </span>
        <span style={{ fontSize: 13, fontWeight: 400, color: t.text3 }}>{open ? "Hide" : "Show"}</span>
      </button>
      {open && children}
    </div>
  );

  const methodOptions = (["cash", "upi", "cheque", "bank_transfer"] as PaymentMethod[])
    .map((m) => ({ id: m, label: METHOD_LABEL[m] }));

  // ── PARTY DETAIL VIEW ──────────────────────────────────────────────────────
  if (selectedPartyId) {
    const party = parties.find((p) => p.id === selectedPartyId);
    if (!party) {
      // Wait for parties to load before resetting — avoids wiping initialPartyId on first render
      if (parties.length > 0) setSelectedPartyId(null);
      return null;
    }

    const creditAllocs = creditAllocsForParty(selectedPartyId);
    const partyPaymentsRaw = payments.filter((p) =>
      p.partyId === selectedPartyId &&
      (!salesRepOnly || p.collectedBy === appUser?.uid || p.id === focusPaymentId)
    );
    // When deep-linked to a specific payment, float it to the top
    const partyPayments = focusPaymentId
      ? [...partyPaymentsRaw].sort((a, b) =>
          a.id === focusPaymentId ? -1 : b.id === focusPaymentId ? 1 : 0
        )
      : partyPaymentsRaw;
    const balance = outstandingBalance(selectedPartyId);
    // Money this party handed over that never found a bill. Derived, not
    // stored — see unappliedAmount(). Computed from the full payment list
    // rather than partyPayments, which a rep's deep link narrows to their own.
    const advance = advanceHeld(
      payments.filter((p) => p.partyId === selectedPartyId),
    );
    // Sum of active alloc totals (before any payments)
    const totalActiveCredit = creditAllocs.reduce((s, a) => s + a.totalAmount, 0);
    // Sum of paidAmount already applied across active allocs
    const totalPaidOnAllocs = creditAllocs.reduce(
      (s, a) => s + Math.min(a.totalAmount, (a as any).paidAmount || 0),
      0,
    );
    const pendingPayments = partyPayments.filter((p) => p.status === "pending_approval");

    return (
      <div style={{ minHeight: "100vh", background: t.bg, paddingBottom: 60 }}>
        <PageHeader
          eyebrow={party.type === "distributor" ? "Distributor" : "Independent retailer"}
          title={party.name}
          subtitle={party.place || party.address}
          onBack={() => {
            if (deepLinked) { onBack(); return; }
            setSelectedPartyId(null);
            setShowPayForm(false);
          }}
        />

        <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 28 }}>
          <StatGrid>
            <StatCard value={money(totalActiveCredit)} label="Credit given" />
            <StatCard value={money(totalPaidOnAllocs)} label="Received" />
            <StatCard
              value={balance === 0 ? "Cleared" : money(balance)}
              label="Outstanding"
              context={balance === 0 ? "Nothing owed" : undefined}
            />
          </StatGrid>

          {advance > 0 && (
            <Note>
              <strong>{money(advance)} paid in advance.</strong> That much has been
              received from {party.name} without landing on a bill — either it arrived
              before the goods did, or a payment came in over what was owed.
              {balance > 0
                ? " It does not come off the outstanding above on its own. To settle a bill with it, use Mark paid on that bill rather than recording the money a second time."
                : " It will not attach itself to the next bill either. When one arrives, use Mark paid on it rather than recording the money a second time."}
            </Note>
          )}

          {pendingPayments.length > 0 && (
            <Note tone="warn">
              {pendingPayments.length} older payment{pendingPayments.length > 1 ? "s" : ""} still
              needs confirming. They are listed under payment history below.
            </Note>
          )}

          {/* Record a payment */}
          {isAdmin && (
            showPayForm ? (
              <Section
                label="Record a payment"
                right={action("Cancel", () => setShowPayForm(false))}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 460 }}>
                  <Field label="Amount">
                    <input
                      type="number"
                      inputMode="decimal"
                      value={payAmount}
                      onChange={(e) => setPayAmount(e.target.value)}
                      placeholder="5000"
                      style={inputStyle(t)}
                    />
                  </Field>

                  <Field label="Method">
                    <ChipGroup value={payMethod} onChange={setPayMethod} options={methodOptions} />
                  </Field>

                  <Field label="How it reached us">
                    <ChipGroup
                      value={payCollectionType}
                      onChange={setPayCollectionType}
                      options={(["direct_to_company", "collected_by_salesperson"] as CollectionType[])
                        .map((ct) => ({ id: ct, label: COLLECTION_LABEL[ct] }))}
                    />
                  </Field>

                  <Field label="Date">
                    <DateInput type="date" value={payDate} onChange={setPayDate} />
                  </Field>

                  <Field label="Notes" hint="A cheque number or reference, if there is one.">
                    <textarea
                      value={payNotes}
                      onChange={(e) => setPayNotes(e.target.value)}
                      placeholder="Cheque 004521"
                      rows={3}
                      style={{ ...inputStyle(t), resize: "vertical", lineHeight: 1.5 }}
                    />
                  </Field>

                  <Note tone="warn">
                    This is applied to the oldest unpaid credit first. Record it only once the
                    money has actually been received.
                  </Note>

                  <div>
                    <PrimaryButton
                      onClick={handleRecordPayment}
                      disabled={saving || !payAmount || parseFloat(payAmount) <= 0}
                    >
                      {saving ? "Saving" : "Record payment"}
                    </PrimaryButton>
                  </div>
                </div>
              </Section>
            ) : (
              <div>
                <GhostButton
                  onClick={() => {
                    // Start at the whole debt, because settling a bill in full
                    // is the ordinary case and retyping a figure already on
                    // screen is how a digit goes missing. Editable, and left
                    // empty when nothing is owed so that an advance has to be
                    // typed deliberately.
                    setPayAmount(balance > 0 ? String(balance) : "");
                    setShowPayForm(true);
                  }}
                >
                  Record a payment
                </GhostButton>
              </div>
            )
          )}

          {/* Credit allocations */}
          {creditAllocs.length > 0 && (
            <Fold
              label={`Credit allocations · ${creditAllocs.length}`}
              open={!allocsCollapsed}
              onToggle={() => setAllocsCollapsed((v) => !v)}
            >
              <div style={{ borderBottom: `0.5px solid ${t.border}` }}>
                {creditAllocs.map((a) => {
                  const dueDate = (a as any).creditDueDate;
                  const isOverdue = a.status === "overdue" || (dueDate && dueDate < today);
                  const paidAmt = Math.min(a.totalAmount, (a as any).paidAmount || 0);
                  const owedAmt = Math.max(0, a.totalAmount - paidAmt);
                  const paidPct = a.totalAmount > 0 ? Math.round((paidAmt / a.totalAmount) * 100) : 0;
                  return (
                    <div key={a.id} style={{ borderTop: `0.5px solid ${t.border}`, padding: "16px 0" }}>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 16 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 15, fontWeight: 500, color: t.text }}>
                            {a.productName || "Unnamed product"}
                          </div>
                          <div style={{ fontSize: 13, fontWeight: 400, color: t.text3, marginTop: 3 }}>
                            {a.sentAt ? new Date(a.sentAt).toLocaleDateString("en-IN") : a.plannedDate}
                            {" · "}{a.packets} packets
                            {paidAmt > 0 && ` · ${money(paidAmt)} received, ${paidPct}%`}
                          </div>
                          {dueDate && (
                            <div style={{ fontSize: 13, fontWeight: 400, marginTop: 3,
                                          color: isOverdue ? t.warn : t.text3 }}>
                              {isOverdue ? "Payment was due " : "Payment due "}{dueDate}
                            </div>
                          )}
                        </div>
                        <div style={{ textAlign: "right", flexShrink: 0 }}>
                          <div style={{ fontSize: 15, fontWeight: 500,
                                        color: isOverdue ? t.warn : t.text }}>
                            {money(owedAmt)}
                          </div>
                          <div style={{ fontSize: 13, fontWeight: 400, color: t.text3, marginTop: 3 }}>
                            of {money(a.totalAmount)}
                          </div>
                        </div>
                      </div>

                      {paidAmt > 0 && (
                        <div style={{ background: t.tint, borderRadius: 99, height: 3, overflow: "hidden", marginTop: 12 }}>
                          <div style={{ height: "100%", background: t.text2, width: `${paidPct}%` }} />
                        </div>
                      )}

                      {canMarkPaid && (
                        <div style={{ marginTop: 12 }}>
                          <Note tone="warn">
                            Mark this paid only once the money is in the company account. It cannot
                            be undone.
                          </Note>
                          <div style={{ marginTop: 10 }}>
                            {action("Mark as paid", () => handleMarkAllocPaid(a))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </Fold>
          )}

          {/* Payment history */}
          {partyPayments.length > 0 && (
            <Fold
              label={`Payment history · ${partyPayments.length}`}
              open={!paymentsCollapsed}
              onToggle={() => setPaymentsCollapsed((v) => !v)}
            >
              <div style={{ borderBottom: `0.5px solid ${t.border}` }}>
                {partyPayments.map((p) => {
                  const confirmed = !!(p as any).confirmedAt;
                  const confirmedByName = (p as any).confirmedByName as string | undefined;
                  const isEditing = payEdit && payEdit.id === p.id;
                  const isHighlighted = p.id === focusPaymentId;
                  const cancelled = p.status === "rejected";
                  const statusLabel = cancelled
                    ? "Cancelled"
                    : confirmed ? "Confirmed" : "Awaiting confirmation";

                  return (
                    <div
                      key={p.id}
                      id={`payment-${p.id}`}
                      style={{
                        borderTop: `0.5px solid ${t.border}`,
                        padding: "16px 0",
                        background: isHighlighted ? t.tint : "transparent",
                        opacity: cancelled ? 0.55 : 1,
                      }}
                    >
                      {isEditing && payEdit ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 460 }}>
                          <div style={{ fontSize: 15, fontWeight: 500, color: t.text }}>Edit this payment</div>

                          <Field label="Amount">
                            <input
                              type="number"
                              inputMode="decimal"
                              value={payEdit.amount}
                              onChange={(e) => setPayEdit((prev) => prev ? { ...prev, amount: e.target.value } : prev)}
                              style={inputStyle(t)}
                            />
                          </Field>

                          <Field label="Method">
                            <ChipGroup
                              value={payEdit.paymentMethod}
                              onChange={(m) => setPayEdit((prev) => prev ? { ...prev, paymentMethod: m } : prev)}
                              options={methodOptions}
                            />
                          </Field>

                          <Field label="Date">
                            <DateInput
                              type="date"
                              value={payEdit.date}
                              onChange={(v) => setPayEdit((prev) => prev ? { ...prev, date: v } : prev)}
                            />
                          </Field>

                          <Field label="Notes">
                            <input
                              type="text"
                              value={payEdit.notes}
                              onChange={(e) => setPayEdit((prev) => prev ? { ...prev, notes: e.target.value } : prev)}
                              placeholder="Cheque 004521"
                              style={inputStyle(t)}
                            />
                          </Field>

                          <Note>
                            Changing the amount reapplies it across their unpaid credit, oldest first.
                          </Note>

                          <div style={{ display: "flex", gap: 10 }}>
                            <PrimaryButton
                              onClick={handleSavePayEdit}
                              disabled={payEditSaving || !payEdit.amount || parseFloat(payEdit.amount) <= 0}
                            >
                              {payEditSaving ? "Saving" : "Save changes"}
                            </PrimaryButton>
                            <GhostButton onClick={() => setPayEdit(null)}>Cancel</GhostButton>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div style={{ display: "flex", alignItems: "baseline", gap: 16 }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 15, fontWeight: 500, color: t.text }}>
                                {money(p.amount)}
                              </div>
                              <div style={{ fontSize: 13, fontWeight: 400, color: t.text3, marginTop: 3 }}>
                                {p.date} · {METHOD_LABEL[p.paymentMethod]} · {COLLECTION_LABEL[p.collectionType]}
                              </div>
                              {p.collectedByName && p.collectionType === "collected_by_salesperson" && (
                                <div style={{ fontSize: 13, fontWeight: 400, color: t.text3, marginTop: 3 }}>
                                  Collected by {p.collectedByName}
                                </div>
                              )}
                              {confirmedByName && (
                                <div style={{ fontSize: 13, fontWeight: 400, color: t.text3, marginTop: 3 }}>
                                  Confirmed by {confirmedByName}
                                </div>
                              )}
                              {p.notes && (
                                <div style={{ fontSize: 13, fontWeight: 400, color: t.text3, marginTop: 3 }}>
                                  {p.notes}
                                </div>
                              )}
                            </div>
                            <div style={{ fontSize: 14, fontWeight: 400, whiteSpace: "nowrap", flexShrink: 0,
                                          color: !cancelled && !confirmed ? t.warn : t.text2 }}>
                              {statusLabel}
                            </div>
                          </div>

                          {isAdmin && !cancelled && !confirmed && (
                            <div style={{ marginTop: 12 }}>
                              <Note tone="warn">
                                Confirm only once the amount is in the company account. It cannot be undone.
                              </Note>
                              <div style={{ display: "flex", gap: 14, marginTop: 10 }}>
                                {action("Confirm receipt", () => handleConfirmPayment(p))}
                                {action("Edit", () => setPayEdit({
                                  id: p.id!, amount: String(p.amount), paymentMethod: p.paymentMethod,
                                  date: p.date, notes: p.notes || "",
                                }))}
                                {action("Cancel", () => handleCancelPayment(p))}
                              </div>
                            </div>
                          )}

                          {!isAdmin && p.collectedBy === appUser?.uid && p.status === "pending_approval" && (
                            <div style={{ display: "flex", gap: 14, marginTop: 12 }}>
                              {action("Edit", () => setPayEdit({
                                id: p.id!, amount: String(p.amount), paymentMethod: p.paymentMethod,
                                date: p.date, notes: p.notes || "",
                              }))}
                              {action("Delete", () => handleCancelPayment(p))}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </Fold>
          )}

          {creditAllocs.length === 0 && partyPayments.length === 0 && (
            <EmptyState
              title="No credit activity yet"
              body="Credit allocations and the payments against them will appear here."
            />
          )}
        </div>
        {modal}
      </div>
    );
  }

  // ── PARTY LIST — sort + filter ─────────────────────────────────────────────
  const sortedParties = [...partiesWithCredit].sort((a, b) => {
    const aOver = isPartyOverdue(a.id!) && outstandingBalance(a.id!) > 0
    const bOver = isPartyOverdue(b.id!) && outstandingBalance(b.id!) > 0
    if (aOver !== bOver) return aOver ? -1 : 1
    const aBal = outstandingBalance(a.id!)
    const bBal = outstandingBalance(b.id!)
    if ((aBal > 0) !== (bBal > 0)) return aBal > 0 ? -1 : 1
    return bBal - aBal
  })
  const q = search.trim().toLowerCase()
  const filteredParties = q
    ? sortedParties.filter(p => p.name.toLowerCase().includes(q) || (p.place || p.address || '').toLowerCase().includes(q))
    : sortedParties
  const isSearching = !!q
  const totalPages = Math.ceil(filteredParties.length / CREDIT_PAGE_SIZE)
  const pagedParties = isSearching
    ? filteredParties
    : filteredParties.slice(creditPage * CREDIT_PAGE_SIZE, (creditPage + 1) * CREDIT_PAGE_SIZE)

  const overdueCount = partiesWithCredit.filter(
    (p) => isPartyOverdue(p.id!) && outstandingBalance(p.id!) > 0,
  ).length;

  // ── PARTY LIST VIEW ────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: "100vh", background: t.bg, paddingBottom: 40 }}>
      <PageHeader
        eyebrow="Finance"
        title="Credit book"
        subtitle={
          overdueCount > 0
            ? `${money(totalOutstanding)} outstanding · ${overdueCount} past its due date`
            : `${money(totalOutstanding)} outstanding`
        }
        onBack={onBack}
      />

      <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 28 }}>
        {!isAdmin && (
          <StatGrid>
            <StatCard
              value={money(collectedThisMonth)}
              label={seesTeam ? "Team collected" : "You collected"}
              context={seesTeam && ownCollectedThisMonth > 0
                ? `This month · ${money(ownCollectedThisMonth)} of it yours`
                : "This month"}
              explain={seesTeam
                ? "Money anybody in sales carried in from a shop this calendar month, you "
                  + "included. Not what a party paid the company directly — a bank transfer is "
                  + "nobody's collection. Counted from the day it was recorded, whether or not an "
                  + "admin has confirmed it yet."
                : "Money you personally took from a shop this calendar month — not the team's, "
                  + "and not anything a party paid the company directly. Counted from the day you "
                  + "recorded it, whether or not an admin has confirmed it yet."} />
            <StatCard value={unconfirmedCount} label="Awaiting confirmation"
              context={unconfirmedCount > 0 ? "Tap below to review" : undefined}
              explain={(seesTeam
                ? "How many receipts the team has taken that an admin has not yet ticked off as "
                : "How many of your own receipts an admin has not yet ticked off as ")
                + "reaching the company. The money is already off the shop's balance; this is the "
                + "office confirming it arrived. Only an admin can clear it."} />
            <StatCard value={money(totalOutstanding)} label="Outstanding" context="Across the book"
              explain={"What every shop in the book still owes Ocealgo — the whole team's, not "
                + "yours. Counts dispatched credit bills only: an order not yet sent is a promise, "
                + "and stock a distributor sends its own retailer was never our money."} />
          </StatGrid>
        )}

        {!isAdmin && unconfirmedCount > 0 && oldestUnconfirmedPartyId && (
          <div>
            <GhostButton
              onClick={() => {
                setDeepLinked(false);
                setAllocsCollapsed(false);
                setPaymentsCollapsed(false);
                setSelectedPartyId(oldestUnconfirmedPartyId);
              }}
            >
              Review the oldest unconfirmed receipt
            </GhostButton>
          </div>
        )}

        {pendingApprovalCount > 0 && isAdmin && (
          <Note tone="warn">
            {pendingApprovalCount} older payment{pendingApprovalCount > 1 ? "s" : ""} still needs
            confirming. Open the party to review.
          </Note>
        )}

        {partiesWithCredit.length > 0 && (
          <Section label="Find">
            <div style={{ maxWidth: 460 }}>
              <input
                type="text"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setCreditPage(0); }}
                placeholder="Search by party name or place"
                style={inputStyle(t)}
              />
            </div>
            {isSearching && (
              <div style={{ fontSize: 13, fontWeight: 400, color: t.text3, marginTop: 8 }}>
                {filteredParties.length} result{filteredParties.length !== 1 ? "s" : ""}
              </div>
            )}
          </Section>
        )}

        {partiesWithCredit.length === 0 ? (
          <EmptyState
            title="No credit activity yet"
            body="Once you allocate stock on credit to a distributor or an independent retailer, their balance shows up here."
          />
        ) : filteredParties.length === 0 ? (
          <EmptyState
            title="Nothing matches that search"
            body="Try part of the party name, or the place they are in."
          />
        ) : (
          <div style={{ borderBottom: `0.5px solid ${t.border}` }}>
            {pagedParties.map((party) => {
              const balance = outstandingBalance(party.id!);
              const overdue = isPartyOverdue(party.id!);
              const pending = payments.filter(
                (p) => p.partyId === party.id! && p.status === "pending_approval",
              ).length;
              const creditCount = creditAllocsForParty(party.id!).length;
              const detail = [
                party.place || party.address,
                creditCount > 0 ? `${creditCount} credit order${creditCount > 1 ? "s" : ""}` : null,
                pending > 0 ? `${pending} awaiting confirmation` : null,
              ].filter(Boolean).join(" · ");

              return (
                <button
                  key={party.id}
                  className="oc-row"
                  onClick={() => {
                    setDeepLinked(false);
                    setAllocsCollapsed(false);
                    setPaymentsCollapsed(false);
                    setSelectedPartyId(party.id!);
                  }}
                  style={{
                    display: "flex", alignItems: "baseline", gap: 16, width: "100%", textAlign: "left",
                    background: "none", border: "none", borderTop: `0.5px solid ${t.border}`,
                    padding: "16px 14px", cursor: "pointer",
                  }}
                >
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 15, fontWeight: 500, color: t.text }}>
                      {party.name}
                    </span>
                    <span style={{ display: "block", fontSize: 13, fontWeight: 400, color: t.text3, marginTop: 3 }}>
                      {detail}
                    </span>
                  </span>
                  <span style={{ textAlign: "right", flexShrink: 0 }}>
                    <span style={{ display: "block", fontSize: 14, fontWeight: 400,
                                   color: balance === 0 ? t.text2 : overdue ? t.warn : t.text }}>
                      {balance === 0 ? "Cleared" : money(balance)}
                    </span>
                    {overdue && balance > 0 && (
                      <span style={{ display: "block", fontSize: 13, fontWeight: 400, color: t.warn, marginTop: 3 }}>
                        Overdue
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {!isSearching && totalPages > 1 && (
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <GhostButton onClick={() => setCreditPage((p) => Math.max(0, p - 1))} disabled={creditPage === 0}>
              Previous
            </GhostButton>
            <span style={{ fontSize: 13, fontWeight: 400, color: t.text3 }}>
              Page {creditPage + 1} of {totalPages}
            </span>
            <GhostButton
              onClick={() => setCreditPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={creditPage >= totalPages - 1}
            >
              Next
            </GhostButton>
          </div>
        )}
      </div>
      {modal}
    </div>
  );
}
