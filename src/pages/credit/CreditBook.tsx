import { useState, useEffect } from "react";
import {
  collection,
  onSnapshot,
  addDoc,
  updateDoc,
  doc,
  query,
  where,
} from "firebase/firestore";
import { db } from "../../firebase";
import {
  Party,
  UnifiedAllocation,
  PaymentTransaction,
  PaymentMethod,
  CollectionType,
} from "../../types";
import { useAuth } from "../../context/AuthContext";
import { useTheme } from "../../context/ThemeContext";
import { useConfirm } from "../../hooks/useConfirm";
import { localDateStr } from "../../utils/date";

interface Props {
  onBack: () => void;
}

// Direct customer = distributor OR independent retailer (no underDistributorId)
function isDirectCustomer(p: Party) {
  return (
    p.type === "distributor" ||
    (p.type === "retailer" && !(p as any).underDistributorId)
  );
}

const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: "💵 Cash",
  cheque: "📄 Cheque",
  bank_transfer: "🏦 Bank Transfer",
  upi: "📱 UPI",
};

const COLLECTION_LABEL: Record<CollectionType, string> = {
  direct_to_company: "Direct to Company",
  collected_by_salesperson: "Via Salesperson",
};

export default function CreditBook({ onBack }: Props) {
  const { appUser } = useAuth();
  const { t } = useTheme();
  const { modal, showConfirm } = useConfirm();

  const [parties, setParties] = useState<Party[]>([]);
  const [allocations, setAllocations] = useState<UnifiedAllocation[]>([]);
  const [payments, setPayments] = useState<PaymentTransaction[]>([]);
  const [selectedPartyId, setSelectedPartyId] = useState<string | null>(null);

  // Record payment form state
  const [showPayForm, setShowPayForm] = useState(false);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState<PaymentMethod>("cheque");
  const [payCollectionType, setPayCollectionType] =
    useState<CollectionType>("direct_to_company");
  const [payDate, setPayDate] = useState(localDateStr());
  const [payNotes, setPayNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const today = localDateStr();
  const isAdmin = appUser?.role === "super_admin" || appUser?.role === "admin";

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

  // Per-party: determine overdue status client-side
  const isPartyOverdue = (partyId: string) =>
    creditAllocsForParty(partyId).some((a) => {
      const dueDate = (a as any).creditDueDate;
      return a.status === "overdue" || (dueDate && dueDate < today);
    });

  const handleConfirmPayment = async (p: PaymentTransaction) => {
    const ok = await showConfirm(
      "Confirm Receipt?",
      `Confirm only if ₹${p.amount.toLocaleString()} from ${p.partyName} has been credited to the company's account.\n\nThis cannot be undone.`,
    );
    if (!ok) return;
    await updateDoc(doc(db, "payment_transactions", p.id!), {
      confirmedAt: Date.now(),
      confirmedBy: appUser!.uid,
      confirmedByName: appUser!.name,
    });
  };

  const handleCancelPayment = async (p: PaymentTransaction) => {
    const ok = await showConfirm(
      "Cancel Payment?",
      `Cancel ₹${p.amount.toLocaleString()} from ${p.partyName}? The credit will be re-added to their outstanding balance.`,
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
      "Mark as Paid?",
      `Confirm only if ₹${a.totalAmount.toLocaleString()} from ${a.partyName} has been credited to the company's account.\n\nThis cannot be undone.`,
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

  const inputCss: React.CSSProperties = {
    width: "100%",
    background: t.bg3,
    border: `1.5px solid ${t.border2}`,
    borderRadius: 12,
    padding: "12px 14px",
    fontSize: 15,
    color: t.text,
    outline: "none",
    boxSizing: "border-box",
  };

  // ── PARTY DETAIL VIEW ──────────────────────────────────────────────────────
  if (selectedPartyId) {
    const party = parties.find((p) => p.id === selectedPartyId);
    if (!party) {
      setSelectedPartyId(null);
      return null;
    }

    const creditAllocs = creditAllocsForParty(selectedPartyId);
    const partyPayments = payments.filter((p) => p.partyId === selectedPartyId);
    const balance = outstandingBalance(selectedPartyId);
    // Sum of active alloc totals (before any payments)
    const totalActiveCredit = creditAllocs.reduce(
      (s, a) => s + a.totalAmount,
      0,
    );
    // Sum of paidAmount already applied across active allocs
    const totalPaidOnAllocs = creditAllocs.reduce(
      (s, a) => s + Math.min(a.totalAmount, (a as any).paidAmount || 0),
      0,
    );
    const pendingPayments = partyPayments.filter(
      (p) => p.status === "pending_approval",
    );

    return (
      <div style={{ minHeight: "100vh", background: t.bg, paddingBottom: 60 }}>
        {/* Header */}
        <div
          style={{
            background: "linear-gradient(135deg,#4c1d95,#7c3aed)",
            padding: "20px 20px 16px",
          }}
        >
          <button
            onClick={() => {
              setSelectedPartyId(null);
              setShowPayForm(false);
            }}
            style={{
              background: "rgba(255,255,255,0.1)",
              border: "none",
              color: "#ddd6fe",
              padding: "6px 14px",
              borderRadius: 20,
              fontSize: 13,
              marginBottom: 14,
            }}
          >
            ← Back
          </button>
          <div style={{ fontSize: 12, color: "#ddd6fe" }}>
            {party.type === "distributor"
              ? "🚚 Distributor"
              : "🏪 Independent Retailer"}
          </div>
          <div
            style={{
              fontSize: 22,
              fontWeight: 900,
              color: "#fff",
              marginTop: 2,
            }}
          >
            {party.name}
          </div>
          <div style={{ fontSize: 12, color: "#c4b5fd", marginTop: 2 }}>
            {party.place || party.address}
          </div>

          {/* Balance summary */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: 8,
              marginTop: 14,
            }}
          >
            {[
              {
                label: "Credit Given",
                val: `₹${totalActiveCredit.toLocaleString()}`,
                color: "#fde68a",
              },
              {
                label: "Received",
                val: `₹${totalPaidOnAllocs.toLocaleString()}`,
                color: "#86efac",
              },
              {
                label: "Outstanding",
                val: `₹${balance.toLocaleString()}`,
                color: balance > 0 ? "#fca5a5" : "#86efac",
              },
            ].map((s) => (
              <div
                key={s.label}
                style={{
                  background: "rgba(0,0,0,0.2)",
                  borderRadius: 10,
                  padding: "10px 8px",
                  textAlign: "center",
                }}
              >
                <div style={{ fontSize: 15, fontWeight: 900, color: s.color }}>
                  {s.val}
                </div>
                <div
                  style={{
                    fontSize: 10,
                    color: "rgba(255,255,255,0.5)",
                    marginTop: 2,
                  }}
                >
                  {s.label}
                </div>
              </div>
            ))}
          </div>

          {pendingPayments.length > 0 && (
            <div
              style={{
                background: "rgba(245,158,11,0.2)",
                border: "1px solid rgba(245,158,11,0.35)",
                borderRadius: 10,
                padding: "8px 12px",
                marginTop: 12,
                fontSize: 12,
                color: "#fde68a",
                fontWeight: 700,
              }}
            >
              ⏳ {pendingPayments.length} legacy payment
              {pendingPayments.length > 1 ? "s" : ""} pending (tap to review)
            </div>
          )}
        </div>

        <div
          style={{
            padding: "14px 16px",
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          {/* Record Payment button */}
          {isAdmin && !showPayForm && (
            <button
              onClick={() => setShowPayForm(true)}
              style={{
                background: "linear-gradient(135deg,#4c1d95,#7c3aed)",
                color: "#fff",
                border: "none",
                borderRadius: 14,
                padding: "14px",
                fontSize: 15,
                fontWeight: 800,
              }}
            >
              + Record Payment
            </button>
          )}

          {/* Record Payment form */}
          {showPayForm && (
            <div
              style={{
                background: t.card,
                borderRadius: 16,
                padding: 16,
                border: `1.5px solid rgba(124,58,237,0.3)`,
                display: "flex",
                flexDirection: "column",
                gap: 12,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div style={{ fontSize: 14, fontWeight: 800, color: t.text }}>
                  Record Payment
                </div>
                <button
                  onClick={() => setShowPayForm(false)}
                  style={{
                    background: "none",
                    border: "none",
                    color: t.text3,
                    fontSize: 20,
                    cursor: "pointer",
                  }}
                >
                  ×
                </button>
              </div>
              <div>
                <div
                  style={{
                    fontSize: 11,
                    color: t.text3,
                    marginBottom: 6,
                    textTransform: "uppercase",
                    letterSpacing: 1,
                  }}
                >
                  Amount (₹)
                </div>
                <input
                  type="number"
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  placeholder="e.g. 5000"
                  style={{ ...inputCss, fontSize: 20, fontWeight: 900 }}
                />
              </div>
              <div>
                <div
                  style={{
                    fontSize: 11,
                    color: t.text3,
                    marginBottom: 6,
                    textTransform: "uppercase",
                    letterSpacing: 1,
                  }}
                >
                  Payment Method
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 6,
                  }}
                >
                  {(
                    [
                      "cash",
                      "upi",
                      "cheque",
                      "bank_transfer",
                    ] as PaymentMethod[]
                  ).map((m) => (
                    <button
                      key={m}
                      onClick={() => setPayMethod(m)}
                      style={{
                        background:
                          payMethod === m ? "rgba(124,58,237,0.15)" : t.bg3,
                        color: payMethod === m ? "#a78bfa" : t.text2,
                        border: `1.5px solid ${payMethod === m ? "#7c3aed" : t.border}`,
                        borderRadius: 10,
                        padding: "9px",
                        fontSize: 12,
                        fontWeight: 700,
                      }}
                    >
                      {METHOD_LABEL[m]}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div
                  style={{
                    fontSize: 11,
                    color: t.text3,
                    marginBottom: 6,
                    textTransform: "uppercase",
                    letterSpacing: 1,
                  }}
                >
                  Collection Type
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  {(
                    [
                      "direct_to_company",
                      "collected_by_salesperson",
                    ] as CollectionType[]
                  ).map((ct) => (
                    <button
                      key={ct}
                      onClick={() => setPayCollectionType(ct)}
                      style={{
                        flex: 1,
                        background:
                          payCollectionType === ct
                            ? "rgba(124,58,237,0.15)"
                            : t.bg3,
                        color: payCollectionType === ct ? "#a78bfa" : t.text2,
                        border: `1.5px solid ${payCollectionType === ct ? "#7c3aed" : t.border}`,
                        borderRadius: 10,
                        padding: "9px 6px",
                        fontSize: 11,
                        fontWeight: 700,
                      }}
                    >
                      {COLLECTION_LABEL[ct]}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div
                  style={{
                    fontSize: 11,
                    color: t.text3,
                    marginBottom: 6,
                    textTransform: "uppercase",
                    letterSpacing: 1,
                  }}
                >
                  Date
                </div>
                <input
                  type="date"
                  value={payDate}
                  onChange={(e) => setPayDate(e.target.value)}
                  style={inputCss}
                />
              </div>
              <div>
                <div
                  style={{
                    fontSize: 11,
                    color: t.text3,
                    marginBottom: 6,
                    textTransform: "uppercase",
                    letterSpacing: 1,
                  }}
                >
                  Notes (optional)
                </div>
                <textarea
                  value={payNotes}
                  onChange={(e) => setPayNotes(e.target.value)}
                  placeholder="Reference, cheque number, etc."
                  rows={2}
                  style={{ ...inputCss, resize: "none" }}
                />
              </div>
              <button
                onClick={handleRecordPayment}
                disabled={saving || !payAmount || parseFloat(payAmount) <= 0}
                style={{
                  background: saving
                    ? "#475569"
                    : "linear-gradient(135deg,#4c1d95,#7c3aed)",
                  color: "#fff",
                  border: "none",
                  borderRadius: 12,
                  padding: "13px",
                  fontSize: 14,
                  fontWeight: 800,
                  opacity: !payAmount || parseFloat(payAmount) <= 0 ? 0.4 : 1,
                }}
              >
                {saving ? "Saving..." : "Confirm Payment ✓"}
              </button>
            </div>
          )}

          {/* Credit Allocations */}
          {creditAllocs.length > 0 && (
            <>
              <div
                style={{
                  fontSize: 11,
                  color: t.text3,
                  fontWeight: 700,
                  letterSpacing: 1,
                  textTransform: "uppercase",
                }}
              >
                Credit Allocations ({creditAllocs.length})
              </div>
              {creditAllocs.map((a) => {
                const dueDate = (a as any).creditDueDate;
                const isOverdue =
                  a.status === "overdue" || (dueDate && dueDate < today);
                const paidAmt = Math.min(
                  a.totalAmount,
                  (a as any).paidAmount || 0,
                );
                const owedAmt = Math.max(0, a.totalAmount - paidAmt);
                const paidPct =
                  a.totalAmount > 0
                    ? Math.round((paidAmt / a.totalAmount) * 100)
                    : 0;
                return (
                  <div
                    key={a.id}
                    style={{
                      background: t.card,
                      borderRadius: 14,
                      padding: "14px 16px",
                      border: `1.5px solid ${isOverdue ? "rgba(220,38,38,0.4)" : "rgba(124,58,237,0.2)"}`,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "flex-start",
                        marginBottom: 8,
                      }}
                    >
                      <div>
                        <div
                          style={{
                            fontWeight: 700,
                            fontSize: 14,
                            color: t.text,
                          }}
                        >
                          {a.productName || "—"}
                        </div>
                        <div
                          style={{ fontSize: 11, color: t.text3, marginTop: 2 }}
                        >
                          {a.sentAt
                            ? new Date(a.sentAt).toLocaleDateString("en-IN")
                            : a.plannedDate}{" "}
                          · {a.packets} packets
                        </div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div
                          style={{
                            fontSize: 16,
                            fontWeight: 900,
                            color: isOverdue ? "#dc2626" : "#a78bfa",
                          }}
                        >
                          ₹{owedAmt.toLocaleString()}
                        </div>
                        <div style={{ fontSize: 10, color: t.text3 }}>
                          of ₹{a.totalAmount.toLocaleString()}
                        </div>
                        {isOverdue && (
                          <div
                            style={{
                              fontSize: 10,
                              color: "#dc2626",
                              fontWeight: 700,
                            }}
                          >
                            OVERDUE
                          </div>
                        )}
                      </div>
                    </div>
                    {/* Payment progress bar */}
                    {paidAmt > 0 && (
                      <div style={{ marginBottom: 8 }}>
                        <div
                          style={{
                            height: 4,
                            background: t.bg3,
                            borderRadius: 99,
                            overflow: "hidden",
                          }}
                        >
                          <div
                            style={{
                              height: "100%",
                              width: `${paidPct}%`,
                              background: "#16a34a",
                              borderRadius: 99,
                            }}
                          />
                        </div>
                        <div
                          style={{
                            fontSize: 10,
                            color: "#16a34a",
                            marginTop: 3,
                            fontWeight: 600,
                          }}
                        >
                          ₹{paidAmt.toLocaleString()} received ({paidPct}%)
                        </div>
                      </div>
                    )}
                    {dueDate && (
                      <div
                        style={{
                          fontSize: 11,
                          color: isOverdue ? "#dc2626" : "#d97706",
                          fontWeight: 600,
                          marginBottom: isAdmin ? 8 : 0,
                        }}
                      >
                        {isOverdue ? "🔴 Due date passed: " : "📅 Due: "}
                        {dueDate}
                      </div>
                    )}
                    {isAdmin && (
                      <>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, background: "rgba(217,119,6,0.08)", border: "1px solid rgba(217,119,6,0.2)", borderRadius: 8, padding: "7px 10px" }}>
                          <span style={{ fontSize: 13 }}>⚠️</span>
                          <span style={{ fontSize: 11, color: "#d97706", lineHeight: 1.4 }}>
                            Only mark as paid once the amount is credited to the company's account. <strong>Cannot be undone.</strong>
                          </span>
                        </div>
                        <button
                          onClick={() => handleMarkAllocPaid(a)}
                          style={{
                            width: "100%",
                            background: "rgba(22,163,74,0.1)",
                            color: "#16a34a",
                            border: "1px solid rgba(22,163,74,0.25)",
                            borderRadius: 10,
                            padding: "9px",
                            fontSize: 12,
                            fontWeight: 700,
                            marginTop: 6,
                          }}
                        >
                          ✅ Mark as Paid
                        </button>
                      </>
                    )}
                  </div>
                );
              })}
            </>
          )}

          {/* Payment History */}
          {partyPayments.length > 0 && (
            <>
              <div
                style={{
                  fontSize: 11,
                  color: t.text3,
                  fontWeight: 700,
                  letterSpacing: 1,
                  textTransform: "uppercase",
                  marginTop: 4,
                }}
              >
                Payment History ({partyPayments.length})
              </div>
              {partyPayments.map((p) => {
                const confirmed = !!(p as any).confirmedAt;
                const confirmedByName = (p as any).confirmedByName as
                  | string
                  | undefined;
                return (
                  <div
                    key={p.id}
                    style={{
                      background: t.card,
                      borderRadius: 14,
                      padding: "14px 16px",
                      border: `1.5px solid ${p.status === "rejected" ? "rgba(220,38,38,0.2)" : confirmed ? "rgba(22,163,74,0.35)" : "rgba(245,158,11,0.3)"}`,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "flex-start",
                        marginBottom: 6,
                      }}
                    >
                      <div>
                        <div
                          style={{
                            fontWeight: 800,
                            fontSize: 16,
                            color:
                              p.status === "rejected" ? t.text3 : "#16a34a",
                          }}
                        >
                          ₹{p.amount.toLocaleString()}
                        </div>
                        <div
                          style={{ fontSize: 11, color: t.text3, marginTop: 2 }}
                        >
                          {p.date} · {METHOD_LABEL[p.paymentMethod]} ·{" "}
                          {COLLECTION_LABEL[p.collectionType]}
                        </div>
                        {p.collectedByName &&
                          p.collectionType === "collected_by_salesperson" && (
                            <div style={{ fontSize: 11, color: t.text3 }}>
                              by {p.collectedByName}
                            </div>
                          )}
                        {confirmedByName && (
                          <div
                            style={{
                              fontSize: 11,
                              color: "#16a34a",
                              marginTop: 2,
                            }}
                          >
                            ✅ Confirmed by {confirmedByName}
                          </div>
                        )}
                        {p.notes && (
                          <div
                            style={{
                              fontSize: 11,
                              color: t.text2,
                              marginTop: 2,
                            }}
                          >
                            📝 {p.notes}
                          </div>
                        )}
                      </div>
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          padding: "3px 9px",
                          borderRadius: 99,
                          background:
                            p.status === "rejected"
                              ? "rgba(220,38,38,0.1)"
                              : confirmed
                                ? "rgba(22,163,74,0.12)"
                                : "rgba(245,158,11,0.15)",
                          color:
                            p.status === "rejected"
                              ? "#dc2626"
                              : confirmed
                                ? "#16a34a"
                                : "#d97706",
                        }}
                      >
                        {p.status === "rejected"
                          ? "❌ Cancelled"
                          : confirmed
                            ? "✅ Confirmed"
                            : "⏳ Pending Confirmation"}
                      </span>
                    </div>
                    {isAdmin && p.status !== "rejected" && !confirmed && (
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, background: "rgba(217,119,6,0.08)", border: "1px solid rgba(217,119,6,0.2)", borderRadius: 8, padding: "7px 10px" }}>
                        <span style={{ fontSize: 13 }}>⚠️</span>
                        <span style={{ fontSize: 11, color: "#d97706", lineHeight: 1.4 }}>
                          Only confirm once the amount is credited to the company's account. <strong>Cannot be undone.</strong>
                        </span>
                      </div>
                    )}
                    {isAdmin && p.status !== "rejected" && (
                      <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                        {!confirmed && (
                          <button
                            onClick={() => handleConfirmPayment(p)}
                            style={{
                              flex: 1,
                              background: "rgba(22,163,74,0.1)",
                              color: "#16a34a",
                              border: "1px solid rgba(22,163,74,0.25)",
                              borderRadius: 10,
                              padding: "9px",
                              fontSize: 12,
                              fontWeight: 700,
                            }}
                          >
                            ✅ Confirm Receipt
                          </button>
                        )}
                        {!confirmed && (
                          <button
                            onClick={() => handleCancelPayment(p)}
                            style={{
                              flex: confirmed ? 1 : 0,
                              minWidth: confirmed ? undefined : 110,
                              background: "rgba(220,38,38,0.07)",
                              color: "#dc2626",
                              border: "1px solid rgba(220,38,38,0.2)",
                              borderRadius: 10,
                              padding: "9px",
                              fontSize: 12,
                              fontWeight: 700,
                            }}
                          >
                            Cancel
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}

          {creditAllocs.length === 0 && partyPayments.length === 0 && (
            <div style={{ textAlign: "center", padding: 40, color: t.text3 }}>
              <div style={{ fontSize: 32, marginBottom: 10 }}>📋</div>
              <div style={{ fontWeight: 700 }}>No credit activity yet</div>
              <div style={{ fontSize: 13, marginTop: 6 }}>
                Credit allocations and payments will appear here
              </div>
            </div>
          )}
        </div>
        {modal}
      </div>
    );
  }

  // ── PARTY LIST VIEW ────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: "100vh", background: t.bg, paddingBottom: 40 }}>
      <div
        style={{
          background: "linear-gradient(135deg,#4c1d95,#7c3aed)",
          padding: "20px 20px 16px",
        }}
      >
        <button
          onClick={onBack}
          style={{
            background: "rgba(255,255,255,0.1)",
            border: "none",
            color: "#ddd6fe",
            padding: "6px 14px",
            borderRadius: 20,
            fontSize: 13,
            marginBottom: 14,
          }}
        >
          ← Back
        </button>
        <div
          style={{
            fontSize: 11,
            color: "#c4b5fd",
            letterSpacing: 3,
            textTransform: "uppercase",
            marginBottom: 4,
          }}
        >
          Finance 💜
        </div>
        <div style={{ fontSize: 22, fontWeight: 900, color: "#fff" }}>
          Credit Book
        </div>
        <div
          style={{
            fontSize: 28,
            fontWeight: 900,
            color: "#fde68a",
            marginTop: 4,
          }}
        >
          ₹{totalOutstanding.toLocaleString()}
        </div>
        <div style={{ fontSize: 12, color: "#c4b5fd", marginTop: 2 }}>
          total outstanding
        </div>

        {pendingApprovalCount > 0 && isAdmin && (
          <div
            style={{
              background: "rgba(245,158,11,0.2)",
              border: "1px solid rgba(245,158,11,0.35)",
              borderRadius: 10,
              padding: "8px 14px",
              marginTop: 12,
              fontSize: 12,
              color: "#fde68a",
              fontWeight: 700,
            }}
          >
            ⏳ {pendingApprovalCount} legacy payment
            {pendingApprovalCount > 1 ? "s" : ""} pending (tap to review)
          </div>
        )}
      </div>

      <div
        style={{
          padding: "14px 16px",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        {partiesWithCredit.length === 0 ? (
          <div style={{ textAlign: "center", padding: 48, color: t.text3 }}>
            <div style={{ fontSize: 40, marginBottom: 14 }}>💜</div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>
              No credit activity yet
            </div>
            <div style={{ fontSize: 13, marginTop: 8, lineHeight: 1.6 }}>
              Credit allocations to distributors and independent retailers will
              appear here
            </div>
          </div>
        ) : (
          partiesWithCredit.map((party) => {
            const balance = outstandingBalance(party.id!);
            const overdue = isPartyOverdue(party.id!);
            const pending = payments.filter(
              (p) => p.partyId === party.id! && p.status === "pending_approval",
            ).length;
            const creditCount = creditAllocsForParty(party.id!).length;

            return (
              <button
                key={party.id}
                onClick={() => setSelectedPartyId(party.id!)}
                style={{
                  background: t.card,
                  borderRadius: 16,
                  padding: "16px",
                  border: `1.5px solid ${overdue ? "rgba(220,38,38,0.35)" : balance === 0 ? "rgba(22,163,74,0.2)" : "rgba(124,58,237,0.25)"}`,
                  textAlign: "left",
                  width: "100%",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    marginBottom: 8,
                  }}
                >
                  <div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        marginBottom: 2,
                      }}
                    >
                      <span style={{ fontSize: 14 }}>
                        {party.type === "distributor" ? "🚚" : "🏪"}
                      </span>
                      <span
                        style={{ fontWeight: 800, fontSize: 15, color: t.text }}
                      >
                        {party.name}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: t.text3 }}>
                      {party.place || party.address}
                    </div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div
                      style={{
                        fontSize: 18,
                        fontWeight: 900,
                        color:
                          balance === 0
                            ? "#16a34a"
                            : overdue
                              ? "#dc2626"
                              : "#a78bfa",
                      }}
                    >
                      {balance === 0
                        ? "✅ Cleared"
                        : `₹${balance.toLocaleString()}`}
                    </div>
                    {overdue && balance > 0 && (
                      <div
                        style={{
                          fontSize: 10,
                          color: "#dc2626",
                          fontWeight: 700,
                        }}
                      >
                        OVERDUE
                      </div>
                    )}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {creditCount > 0 && (
                    <span
                      style={{
                        fontSize: 10,
                        background: "rgba(124,58,237,0.1)",
                        color: "#a78bfa",
                        padding: "2px 8px",
                        borderRadius: 99,
                        fontWeight: 700,
                      }}
                    >
                      {creditCount} credit order{creditCount > 1 ? "s" : ""}
                    </span>
                  )}
                  {pending > 0 && (
                    <span
                      style={{
                        fontSize: 10,
                        background: "rgba(245,158,11,0.12)",
                        color: "#d97706",
                        padding: "2px 8px",
                        borderRadius: 99,
                        fontWeight: 700,
                      }}
                    >
                      ⏳ {pending} pending approval
                    </span>
                  )}
                </div>
              </button>
            );
          })
        )}
      </div>
      {modal}
    </div>
  );
}
