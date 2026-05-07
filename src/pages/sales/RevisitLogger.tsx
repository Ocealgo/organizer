import React, { useState, useEffect } from "react";
import {
  collection,
  addDoc,
  onSnapshot,
  updateDoc,
  doc,
  query,
  where,
  increment,
} from "firebase/firestore";
import { db } from "../../firebase";
import {
  Party,
  Product,
  RevisitAction,
  StockUpdateAction,
  NewOrderAction,
  PaymentCollectionAction,
  StockMovement,
  VisitOutcome,
} from "../../types";
import { useAuth } from "../../context/AuthContext";
import { useTheme } from "../../context/ThemeContext";
import { useConfirm } from "../../hooks/useConfirm";
import { localDateStr, localDateOffset } from "../../utils/date";

interface Props {
  party: Party;
  onBack: () => void;
  onDone: (revisitLogId: string, outcome: VisitOutcome) => void;
  logDate?: string;
}

type ActionKey =
  | "stock_update"
  | "new_order"
  | "payment_collection"
  | "relationship_visit"
  | "no_longer_active"
  | "distribute_to_retailers";

const today2 = () => localDateOffset(2);

export default function RevisitLogger({
  party,
  onBack,
  onDone,
  logDate,
}: Props) {
  const { appUser } = useAuth();
  const { t } = useTheme();
  const { modal, showConfirm } = useConfirm();
  const [products, setProducts] = useState<Product[]>([]);
  const [saving, setSaving] = useState(false);

  const [expandedAction, setExpandedAction] = useState<ActionKey | null>(null);
  const [doneKeys, setDoneKeys] = useState<Set<ActionKey>>(new Set());
  const [confirmedActions, setConfirmedActions] = useState<RevisitAction[]>([]);

  // Stock update
  const [stockProductId, setStockProductId] = useState("");
  const [soldQtyInput, setSoldQtyInput] = useState("");
  const [manualBalance, setManualBalance] = useState("");

  // New order
  const [orderProduct, setOrderProduct] = useState<Product | null>(null);
  const [orderQty, setOrderQty] = useState("");
  const [orderPrice, setOrderPrice] = useState("");
  const [orderPayment, setOrderPayment] = useState<"cash" | "credit">("cash");
  const [orderDate, setOrderDate] = useState(today2());

  // Payment
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentNote, setPaymentNote] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<
    "cash" | "cheque" | "bank_transfer" | "upi"
  >("cash");

  // Relationship / inactive
  const [visitNote, setVisitNote] = useState("");
  const [inactiveReason, setInactiveReason] = useState("");

  const [allocations, setAllocations] = useState<any[]>([]);
  const [subRetailers, setSubRetailers] = useState<Party[]>([]);
  const [distributions, setDistributions] = useState<
    Record<
      string,
      { qty: string; pricePerUnit: string; payment: "cash" | "credit" }
    >
  >({});

  const isUnderDistributor =
    party.type === "retailer" && !!(party as any).underDistributorId;

  // Outstanding = sum of (totalAmount - paidAmount) across active credit allocs from company
  const outstandingAmount = allocations
    .filter(
      (a: any) =>
        a.paymentType === "credit" &&
        (a.status === "sent" || a.status === "overdue") &&
        a.fromType !== "distributor",
    )
    .reduce(
      (s: number, a: any) =>
        s + Math.max(0, (a.totalAmount || 0) - (a.paidAmount || 0)),
      0,
    );

  const actionOptions: {
    key: ActionKey;
    emoji: string;
    label: string;
    sub: string;
  }[] = [
    {
      key: "stock_update",
      emoji: "📊",
      label: "Stock Update",
      sub: "Log current stock level",
    },
    {
      key: "new_order",
      emoji: "📦",
      label: "New Order",
      sub: "They want more stock — create allocation",
    },
    ...(!isUnderDistributor
      ? [
          {
            key: "payment_collection" as ActionKey,
            emoji: "💰",
            label: "Cash Collected",
            sub:
              outstandingAmount > 0
                ? `Outstanding: ₹${outstandingAmount.toLocaleString()}`
                : "No outstanding credit",
          },
        ]
      : []),
    {
      key: "relationship_visit",
      emoji: "🤝",
      label: "Relationship Visit",
      sub: "Visited, maintained relationship",
    },
    {
      key: "no_longer_active",
      emoji: "⚠️",
      label: "No Longer Active",
      sub: "Will be moved back to Prospect",
    },
    ...(party.type === "distributor"
      ? [
          {
            key: "distribute_to_retailers" as ActionKey,
            emoji: "📋",
            label: "Distribute to Retailers",
            sub: "Log stock pushed out to retailer network",
          },
        ]
      : []),
  ];

  useEffect(() => {
    return onSnapshot(collection(db, "products"), (snap) =>
      setProducts(
        snap.docs
          .map((d) => ({ id: d.id, ...d.data() }) as Product)
          .filter((p) => p.active),
      ),
    );
  }, []);

  useEffect(() => {
    const q = query(
      collection(db, "allocations_v2"),
      where("partyId", "==", party.id!),
    );
    return onSnapshot(q, (snap) =>
      setAllocations(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    );
  }, [party.id]);

  useEffect(() => {
    if (party.type !== "distributor") return;
    const q = query(
      collection(db, "parties"),
      where("underDistributorId", "==", party.id!),
    );
    return onSnapshot(q, (snap) =>
      setSubRetailers(
        snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Party),
      ),
    );
  }, [party.id, party.type]);

  useEffect(() => {
    if (orderProduct) setOrderPrice(String(orderProduct.defaultPricePerUnit));
  }, [orderProduct]);

  const stockOpening = stockProductId ? party.stock?.[stockProductId] || 0 : 0;
  const stockSold = parseInt(soldQtyInput) || 0;
  const stockBalance = Math.max(0, stockOpening - stockSold);

  const markDone = (key: ActionKey, action: RevisitAction) => {
    setDoneKeys((prev) => new Set([...prev, key]));
    setConfirmedActions((prev) => [...prev, action]);
    setExpandedAction(null);
  };

  // ── Per-action confirm handlers ───────────────────────────────────────────────

  const handleConfirmStockUpdate = async () => {
    if (!stockProductId) return;
    const bal =
      stockOpening === 0 ? parseInt(manualBalance) || 0 : stockBalance;
    if (stockOpening === 0 && bal <= 0) return;
    if (stockOpening > 0 && stockSold <= 0) return;
    const productName =
      products.find((p) => p.id === stockProductId)?.name || "";
    const confirmed = await showConfirm(
      "Confirm Stock Update",
      stockOpening === 0
        ? `Set balance for ${productName} to ${bal} packets`
        : `${productName} · Sold: ${stockSold} packets · Balance: ${bal} packets`,
    );
    if (!confirmed) return;
    if (stockOpening === 0) {
      await updateDoc(doc(db, "parties", party.id!), {
        [`stock.${stockProductId}`]: bal,
      });
      markDone("stock_update", {
        type: "stock_update",
        openingQty: 0,
        purchasedQty: 0,
        soldQty: 0,
        balanceQty: bal,
        balanceValue: 0,
        aiRead: false,
      } as StockUpdateAction);
    } else {
      await updateDoc(doc(db, "parties", party.id!), {
        [`stock.${stockProductId}`]: increment(-stockSold),
      });
      markDone("stock_update", {
        type: "stock_update",
        openingQty: stockOpening,
        purchasedQty: 0,
        soldQty: stockSold,
        balanceQty: stockBalance,
        balanceValue: 0,
        aiRead: false,
      } as StockUpdateAction);
    }
  };

  const handleConfirmNewOrder = async () => {
    if (!orderProduct || !orderQty || parseInt(orderQty) <= 0) return;
    const qty = parseInt(orderQty);
    const price = parseFloat(orderPrice) || orderProduct.defaultPricePerUnit;
    const total = qty * price;
    const confirmed = await showConfirm(
      "Confirm Order",
      isUnderDistributor
        ? `${qty} ${orderProduct.unitLabel} of ${orderProduct.name} → ${(party as any).underDistributorName}`
        : `${qty} ${orderProduct.unitLabel} of ${orderProduct.name} · ₹${total.toLocaleString()} · ${orderPayment}`,
    );
    if (!confirmed) return;
    const todayDate = logDate || localDateStr();
    let allocRef: any;
    if (isUnderDistributor) {
      allocRef = await addDoc(collection(db, "allocations_v2"), {
        fromType: "distributor",
        fromId: (party as any).underDistributorId,
        fromName: (party as any).underDistributorName || "",
        partyId: party.id!,
        partyName: party.name,
        partyType: party.type,
        productId: orderProduct.id!,
        productName: orderProduct.name,
        packets: qty,
        cartons: Math.floor(qty / orderProduct.unitsPerCarton),
        pricePerPacket: 0,
        totalAmount: 0,
        paymentType: "cash",
        plannedDate: todayDate,
        status: "pending",
        notes: "",
        createdBy: appUser!.uid,
        createdByName: appUser!.name,
        createdAt: Date.now(),
        month: todayDate.slice(0, 7),
        lockedAtCreation: false,
      });
    } else {
      allocRef = await addDoc(collection(db, "allocations_v2"), {
        fromType: "company",
        fromId: "company",
        fromName: "Ocealgo",
        partyId: party.id!,
        partyName: party.name,
        partyType: party.type,
        productId: orderProduct.id!,
        productName: orderProduct.name,
        packets: qty,
        cartons: Math.floor(qty / orderProduct.unitsPerCarton),
        pricePerPacket: price,
        totalAmount: total,
        paymentType: orderPayment,
        plannedDate: orderDate,
        status: "pending",
        notes: "",
        createdBy: appUser!.uid,
        createdByName: appUser!.name,
        createdAt: Date.now(),
        month: orderDate.slice(0, 7),
        lockedAtCreation: true,
      });
    }
    await updateDoc(doc(db, "parties", party.id!), { status: "active" });
    markDone("new_order", {
      type: "new_order",
      productId: orderProduct.id!,
      productName: orderProduct.name,
      quantity: qty,
      pricePerUnit: price,
      totalAmount: total,
      paymentType: orderPayment,
      plannedDate: orderDate,
      allocationId: allocRef.id,
    } as NewOrderAction);
  };

  const handleConfirmPayment = async () => {
    if (!paymentAmount) return;
    const amount = parseFloat(paymentAmount);
    if (amount <= 0) return;
    if (outstandingAmount > 0 && amount > outstandingAmount) return;
    const methodLabel: Record<string, string> = {
      cash: "Cash",
      cheque: "Cheque",
      bank_transfer: "Bank Transfer",
      upi: "UPI",
    };
    const confirmed = await showConfirm(
      "Confirm Payment",
      `Log ₹${amount.toLocaleString()} (${methodLabel[paymentMethod]}) collected from ${party.name}?`,
    );
    if (!confirmed) return;

    // Apply payment FIFO to active credit allocs — directly update paidAmount on each alloc
    const activeAllocs = allocations
      .filter(
        (a: any) =>
          a.paymentType === "credit" &&
          (a.status === "sent" || a.status === "overdue") &&
          a.fromType !== "distributor",
      )
      .sort((a: any, b: any) => (a.createdAt || 0) - (b.createdAt || 0));

    const appliedTo: { allocId: string; amount: number }[] = [];
    let remaining = amount;
    for (const alloc of activeAllocs) {
      if (remaining <= 0) break;
      const currentPaid = alloc.paidAmount || 0;
      const owed = (alloc.totalAmount || 0) - currentPaid;
      if (owed <= 0) continue;
      const toApply = Math.min(remaining, owed);
      const newPaid = currentPaid + toApply;
      const updates: any = { paidAmount: newPaid };
      if (newPaid >= (alloc.totalAmount || 0)) {
        updates.status = "paid";
        updates.paidAt = Date.now();
      }
      await updateDoc(doc(db, "allocations_v2", alloc.id!), updates);
      appliedTo.push({ allocId: alloc.id!, amount: toApply });
      remaining -= toApply;
    }

    await addDoc(collection(db, "payment_transactions"), {
      partyId: party.id!,
      partyName: party.name,
      partyType: party.type,
      amount,
      paymentMethod,
      collectionType: "collected_by_salesperson",
      collectedBy: appUser!.uid,
      collectedByName: appUser!.name,
      notes: paymentNote,
      status: "approved",
      approvedBy: appUser!.uid,
      approvedByName: appUser!.name,
      approvedAt: Date.now(),
      date: logDate || localDateStr(),
      createdAt: Date.now(),
      appliedTo,
    });
    await addDoc(collection(db, "alerts"), {
      type: "credit_settlement",
      message: `₹${amount.toLocaleString()} cash collected from ${party.name} by ${appUser!.name} (${methodLabel[paymentMethod]})`,
      relatedId: party.id!,
      read: false,
      createdAt: Date.now(),
      toRole: "admin_group",
    });
    markDone("payment_collection", {
      type: "payment_collection",
      amount,
      notes: paymentNote,
      status: "pending_approval",
    } as PaymentCollectionAction);
  };

  const handleConfirmRelationship = async () => {
    const confirmed = await showConfirm(
      "Confirm Relationship Visit",
      `Log visit to ${party.name}${visitNote.trim() ? ` · "${visitNote}"` : ""}?`,
    );
    if (!confirmed) return;
    markDone("relationship_visit", {
      type: "relationship_visit",
      notes: visitNote,
    });
  };

  const handleConfirmNoLongerActive = async () => {
    if (!inactiveReason) return;
    const confirmed = await showConfirm(
      "Move to Prospect?",
      `${party.name} will be moved to Prospect — not deleted. You can revisit them in the future.\n\nReason: ${inactiveReason}`,
    );
    if (!confirmed) return;
    await updateDoc(doc(db, "parties", party.id!), {
      status: "prospect",
      inactiveReason,
    });
    markDone("no_longer_active", {
      type: "no_longer_active",
      reason: inactiveReason,
    });
  };

  const handleConfirmDistribute = async () => {
    const entries = Object.entries(distributions).filter(
      ([, d]) => (parseInt(d.qty) || 0) > 0,
    );
    if (entries.length === 0) return;
    const totalQty = entries.reduce(
      (s, [, d]) => s + (parseInt(d.qty) || 0),
      0,
    );
    const confirmed = await showConfirm(
      "Confirm Distribution",
      `Send stock to ${entries.length} retailer${entries.length > 1 ? "s" : ""} · Total: ${totalQty} packets`,
    );
    if (!confirmed) return;
    const todayDate = logDate || localDateStr();
    for (const [retailerId, data] of entries) {
      const qty = parseInt(data.qty) || 0;
      const retailer = subRetailers.find((r) => r.id === retailerId);
      if (!retailer) continue;
      const mov: Omit<StockMovement, "id"> = {
        fromId: party.id!,
        fromName: party.name,
        toPartyId: retailerId,
        toPartyName: retailer.name,
        packets: qty,
        cartons: 0,
        pricePerPacket: 0,
        totalAmount: 0,
        paymentType: "cash",
        notes: "",
        month: todayDate.slice(0, 7),
        loggedBy: appUser!.uid,
        loggedByName: appUser!.name,
        date: todayDate,
        createdAt: Date.now(),
      };
      await addDoc(collection(db, "stock_movements"), mov);
    }
    await updateDoc(doc(db, "parties", party.id!), {
      packetsAllocated: increment(-totalQty),
    });
    markDone("distribute_to_retailers", {
      type: "distribute_to_retailers",
    } as any);
  };

  const handleDone = async () => {
    if (confirmedActions.length === 0) {
      onBack();
      return;
    }
    setSaving(true);
    try {
      const revisitRef = await addDoc(collection(db, "revisit_logs"), {
        partyId: party.id!,
        partyName: party.name,
        partyType: party.type,
        salesPersonId: appUser!.uid,
        salesPersonName: appUser!.name,
        date: logDate || localDateStr(),
        actions: confirmedActions,
        notes: visitNote,
        createdAt: Date.now(),
      });
      const outcome: VisitOutcome = confirmedActions.some(
        (a) => a.type === "no_longer_active",
      )
        ? "not_interested"
        : confirmedActions.some((a) => a.type === "new_order")
          ? "interested"
          : "follow_up";
      onDone(revisitRef.id, outcome);
    } finally {
      setSaving(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    background: t.bg3,
    border: `1.5px solid ${t.border2}`,
    borderRadius: 12,
    padding: "13px 16px",
    fontSize: 16,
    color: t.text,
    outline: "none",
    boxSizing: "border-box",
  };

  const confirmBtn = (
    label: string,
    onClick: () => void,
    disabled = false,
  ): React.ReactNode => (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: disabled
          ? "#334155"
          : "linear-gradient(135deg,#0d3d2e,#1a5c42)",
        color: "#fff",
        border: "none",
        borderRadius: 12,
        padding: "14px",
        fontSize: 15,
        fontWeight: 800,
        opacity: disabled ? 0.4 : 1,
        marginTop: 4,
      }}
    >
      {label}
    </button>
  );

  return (
    <div style={{ minHeight: "100vh", background: t.bg, paddingBottom: 40 }}>
      {/* Header */}
      <div
        style={{
          background: "linear-gradient(135deg,#0d3d2e,#1a5c42)",
          padding: "20px 20px 20px",
        }}
      >
        <button
          onClick={onBack}
          style={{
            background: "rgba(255,255,255,0.1)",
            border: "none",
            color: "#6ee7b7",
            padding: "6px 14px",
            borderRadius: 20,
            fontSize: 13,
            marginBottom: 14,
          }}
        >
          ← Back
        </button>
        <div style={{ fontSize: 13, color: "#a7f3d0" }}>
          {party.type === "distributor" ? "🚚 Distributor" : "🏪 Retailer"}
        </div>
        <div style={{ fontSize: 22, fontWeight: 900, color: "#fff" }}>
          {party.name}
        </div>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            alignItems: "center",
            marginTop: 4,
          }}
        >
          <span style={{ fontSize: 13, color: "#a7f3d0" }}>
            {party.place || party.address}
          </span>
          <span
            style={{
              fontSize: 13,
              color: (party as any).status === "active" ? "#86efac" : "#fde68a",
            }}
          >
            · {(party as any).status === "active" ? "🟢 Active" : "🟡 Prospect"}
          </span>
          {party.type === "retailer" && (
            <span
              style={{
                background: "rgba(255,255,255,0.15)",
                borderRadius: 99,
                padding: "2px 10px",
                fontSize: 11,
                fontWeight: 700,
                color: "#fff",
              }}
            >
              {(party as any).underDistributorName
                ? `Under ${(party as any).underDistributorName}`
                : "Independent"}
            </span>
          )}
        </div>
        {outstandingAmount > 0 && (
          <div
            style={{
              background: "rgba(220,38,38,0.2)",
              border: "1px solid rgba(220,38,38,0.35)",
              borderRadius: 12,
              padding: "10px 14px",
              marginTop: 12,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div>
              <div
                style={{
                  fontSize: 10,
                  color: "#fca5a5",
                  textTransform: "uppercase",
                  letterSpacing: 1,
                  fontWeight: 700,
                }}
              >
                Outstanding Credit
              </div>
              <div
                style={{
                  fontSize: 22,
                  fontWeight: 900,
                  color: "#f87171",
                  lineHeight: 1.2,
                }}
              >
                ₹{outstandingAmount.toLocaleString()}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 11, color: "#fca5a5" }}>
                Unpaid credit
              </div>
              <div
                style={{
                  fontSize: 10,
                  color: "rgba(252,165,165,0.7)",
                  marginTop: 2,
                }}
              >
                Collect before new order
              </div>
            </div>
          </div>
        )}
      </div>

      <div
        style={{
          padding: "16px 16px",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        {confirmedActions.length > 0 && (
          <div
            style={{
              background: "rgba(22,163,74,0.08)",
              border: "1px solid rgba(22,163,74,0.2)",
              borderRadius: 12,
              padding: "10px 14px",
              fontSize: 13,
              color: "#16a34a",
              fontWeight: 600,
            }}
          >
            {confirmedActions.length} action
            {confirmedActions.length > 1 ? "s" : ""} logged — tap Done when
            finished
          </div>
        )}

        {actionOptions.map((opt) => {
          const isDone = doneKeys.has(opt.key);
          const isExpanded = expandedAction === opt.key;

          return (
            <div key={opt.key}>
              <button
                onClick={() => {
                  if (isDone) return;
                  if (
                    !isExpanded &&
                    opt.key === "payment_collection" &&
                    !paymentAmount &&
                    outstandingAmount > 0
                  ) {
                    setPaymentAmount(String(outstandingAmount));
                  }
                  setExpandedAction(isExpanded ? null : opt.key);
                }}
                disabled={
                  isDone ||
                  (opt.key === "no_longer_active" && outstandingAmount > 0)
                }
                style={{
                  width: "100%",
                  background: isDone
                    ? "rgba(22,163,74,0.08)"
                    : isExpanded
                      ? "rgba(22,163,74,0.1)"
                      : t.card,
                  border: `2px solid ${isDone ? "#16a34a" : isExpanded ? "#16a34a" : t.border}`,
                  borderRadius: isExpanded ? "14px 14px 0 0" : 14,
                  padding: "16px 18px",
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  textAlign: "left",
                  cursor: isDone
                    ? "default"
                    : opt.key === "no_longer_active" && outstandingAmount > 0
                      ? "not-allowed"
                      : "pointer",
                }}
              >
                <span style={{ fontSize: 26 }}>{opt.emoji}</span>
                <div style={{ flex: 1 }}>
                  <div
                    style={{
                      fontWeight: 700,
                      fontSize: 16,
                      color: isDone
                        ? "#16a34a"
                        : isExpanded
                          ? "#16a34a"
                          : t.text,
                    }}
                  >
                    {opt.label}
                  </div>
                  <div style={{ fontSize: 13, color: t.text2, marginTop: 2 }}>
                    {!(
                      opt.key === "no_longer_active" && outstandingAmount > 0
                    ) && opt.sub}
                    {opt.key === "no_longer_active" &&
                      outstandingAmount > 0 && (
                        <div
                          style={{
                            color: "#fca5a5",
                            fontWeight: 600,
                            marginTop: 4,
                          }}
                        >
                          Disabled due to the remaining outstanding amount: ₹
                          {outstandingAmount.toLocaleString()}
                        </div>
                      )}
                  </div>
                </div>
                {!(opt.key === "no_longer_active" && outstandingAmount > 0) &&
                  (isDone ? (
                    <span
                      style={{
                        color: "#16a34a",
                        fontSize: 20,
                        fontWeight: 900,
                      }}
                    >
                      ✓
                    </span>
                  ) : (
                    <span style={{ color: t.text3, fontSize: 16 }}>
                      {isExpanded ? "▲" : "▼"}
                    </span>
                  ))}
              </button>

              {isExpanded && !isDone && (
                <div
                  style={{
                    background: t.card,
                    borderRadius: "0 0 14px 14px",
                    padding: "16px",
                    border: `2px solid #16a34a`,
                    borderTop: "none",
                    marginTop: -2,
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                  }}
                >
                  {/* ── STOCK UPDATE ── */}
                  {opt.key === "stock_update" && (
                    <>
                      <div
                        style={{
                          fontSize: 11,
                          color: t.text3,
                          textTransform: "uppercase",
                          letterSpacing: 1,
                        }}
                      >
                        Product
                      </div>
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 6,
                        }}
                      >
                        {products.map((p) => (
                          <button
                            key={p.id}
                            onClick={() => {
                              setStockProductId(p.id!);
                              setSoldQtyInput("");
                              setManualBalance("");
                            }}
                            style={{
                              background:
                                stockProductId === p.id
                                  ? "rgba(22,163,74,0.12)"
                                  : t.bg3,
                              border: `1.5px solid ${stockProductId === p.id ? "#16a34a" : t.border}`,
                              borderRadius: 10,
                              padding: "10px 14px",
                              display: "flex",
                              alignItems: "center",
                              gap: 10,
                              textAlign: "left",
                            }}
                          >
                            <span style={{ fontSize: 18 }}>📦</span>
                            <div style={{ flex: 1 }}>
                              <div
                                style={{
                                  fontWeight: 700,
                                  fontSize: 14,
                                  color:
                                    stockProductId === p.id
                                      ? "#16a34a"
                                      : t.text,
                                }}
                              >
                                {p.name}
                              </div>
                              <div style={{ fontSize: 11, color: t.text3 }}>
                                Current stock: {party.stock?.[p.id!] ?? 0}{" "}
                                {p.unitLabel}
                              </div>
                            </div>
                            {stockProductId === p.id && (
                              <span style={{ color: "#16a34a" }}>✓</span>
                            )}
                          </button>
                        ))}
                      </div>
                      {stockProductId && stockOpening === 0 && (
                        <>
                          <div
                            style={{
                              background: "rgba(217,119,6,0.08)",
                              border: "1px solid rgba(217,119,6,0.2)",
                              borderRadius: 10,
                              padding: "10px 12px",
                              fontSize: 12,
                              color: "#d97706",
                            }}
                          >
                            Opening stock is zero — enter the current balance
                            directly
                          </div>
                          <div>
                            <div
                              style={{
                                fontSize: 10,
                                color: "#6ee7b7",
                                marginBottom: 4,
                                textTransform: "uppercase",
                                letterSpacing: 1,
                              }}
                            >
                              Current Balance (packets)
                            </div>
                            <input
                              type="number"
                              value={manualBalance}
                              onChange={(e) => setManualBalance(e.target.value)}
                              placeholder="e.g. 20"
                              style={{
                                ...inputStyle,
                                fontSize: 18,
                                fontWeight: 900,
                              }}
                            />
                          </div>
                          {confirmBtn(
                            "Update Stock ✓",
                            handleConfirmStockUpdate,
                            (parseInt(manualBalance) || 0) <= 0,
                          )}
                        </>
                      )}
                      {stockProductId && stockOpening > 0 && (
                        <>
                          <div
                            style={{
                              background: "rgba(8,145,178,0.08)",
                              borderRadius: 10,
                              padding: "10px 12px",
                              fontSize: 12,
                              color: "#0891b2",
                            }}
                          >
                            💡 Enter qty sold — balance calculates automatically
                          </div>
                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns: "1fr 1fr",
                              gap: 8,
                            }}
                          >
                            <div>
                              <div
                                style={{
                                  fontSize: 10,
                                  color: t.text3,
                                  marginBottom: 4,
                                  textTransform: "uppercase",
                                  letterSpacing: 1,
                                }}
                              >
                                Opening Qty
                              </div>
                              <div
                                style={{
                                  ...inputStyle,
                                  fontSize: 16,
                                  fontWeight: 900,
                                  color: "#94a3b8",
                                  display: "flex",
                                  alignItems: "center",
                                }}
                              >
                                {stockOpening}
                              </div>
                            </div>
                            <div>
                              <div
                                style={{
                                  fontSize: 10,
                                  color: t.text3,
                                  marginBottom: 4,
                                  textTransform: "uppercase",
                                  letterSpacing: 1,
                                }}
                              >
                                Qty Sold
                              </div>
                              <input
                                type="number"
                                value={soldQtyInput}
                                onChange={(e) =>
                                  setSoldQtyInput(e.target.value)
                                }
                                placeholder="0"
                                style={{
                                  ...inputStyle,
                                  fontSize: 16,
                                  fontWeight: 700,
                                }}
                              />
                            </div>
                          </div>
                          <div>
                            <div
                              style={{
                                fontSize: 10,
                                color: "#6ee7b7",
                                marginBottom: 4,
                                textTransform: "uppercase",
                                letterSpacing: 1,
                              }}
                            >
                              Balance Qty
                            </div>
                            <div
                              style={{
                                ...inputStyle,
                                fontSize: 18,
                                fontWeight: 900,
                                color: stockBalance > 0 ? "#6ee7b7" : "#f87171",
                                background: "rgba(22,163,74,0.08)",
                                display: "flex",
                                alignItems: "center",
                              }}
                            >
                              {stockBalance}
                            </div>
                          </div>
                          {confirmBtn(
                            "Update Stock ✓",
                            handleConfirmStockUpdate,
                            stockSold <= 0,
                          )}
                        </>
                      )}
                    </>
                  )}

                  {/* ── NEW ORDER ── */}
                  {opt.key === "new_order" && (
                    <>
                      {isUnderDistributor && (
                        <div
                          style={{
                            background: "rgba(8,145,178,0.08)",
                            border: "1px solid rgba(8,145,178,0.2)",
                            borderRadius: 10,
                            padding: "10px 12px",
                            fontSize: 12,
                            color: "#0891b2",
                          }}
                        >
                          🚚 Stock via{" "}
                          <strong>{(party as any).underDistributorName}</strong>
                        </div>
                      )}
                      <div
                        style={{
                          fontSize: 12,
                          color: t.text3,
                          textTransform: "uppercase",
                          letterSpacing: 1,
                        }}
                      >
                        Product
                      </div>
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 8,
                        }}
                      >
                        {products.map((p) => (
                          <button
                            key={p.id}
                            onClick={() => setOrderProduct(p)}
                            style={{
                              background:
                                orderProduct?.id === p.id
                                  ? "rgba(22,163,74,0.12)"
                                  : t.bg3,
                              border: `1.5px solid ${orderProduct?.id === p.id ? "#16a34a" : t.border}`,
                              borderRadius: 10,
                              padding: "12px 14px",
                              display: "flex",
                              alignItems: "center",
                              gap: 10,
                              textAlign: "left",
                            }}
                          >
                            <span style={{ fontSize: 20 }}>📦</span>
                            <div style={{ flex: 1 }}>
                              <div
                                style={{
                                  fontWeight: 700,
                                  fontSize: 14,
                                  color:
                                    orderProduct?.id === p.id
                                      ? "#16a34a"
                                      : t.text,
                                }}
                              >
                                {p.name}
                              </div>
                              <div style={{ fontSize: 12, color: t.text2 }}>
                                ₹{p.defaultPricePerUnit}/{p.unitLabel}
                              </div>
                            </div>
                            {orderProduct?.id === p.id && (
                              <span style={{ color: "#16a34a" }}>✓</span>
                            )}
                          </button>
                        ))}
                      </div>
                      {orderProduct && (
                        <>
                          <div>
                            <div
                              style={{
                                fontSize: 12,
                                color: t.text3,
                                marginBottom: 4,
                                textTransform: "uppercase",
                                letterSpacing: 1,
                              }}
                            >
                              Quantity ({orderProduct.unitLabel})
                            </div>
                            <input
                              type="number"
                              value={orderQty}
                              onChange={(e) => setOrderQty(e.target.value)}
                              placeholder={`No. of ${orderProduct.unitLabel}`}
                              style={{
                                ...inputStyle,
                                borderColor:
                                  orderQty && parseInt(orderQty) <= 0
                                    ? "#dc2626"
                                    : undefined,
                              }}
                            />
                            {orderQty && parseInt(orderQty) <= 0 && (
                              <div
                                style={{
                                  fontSize: 12,
                                  color: "#dc2626",
                                  marginTop: 6,
                                  fontWeight: 600,
                                }}
                              >
                                Quantity must be greater than zero
                              </div>
                            )}
                          </div>
                          {!isUnderDistributor && (
                            <>
                              <div>
                                <div
                                  style={{
                                    fontSize: 12,
                                    color: t.text3,
                                    marginBottom: 4,
                                    textTransform: "uppercase",
                                    letterSpacing: 1,
                                  }}
                                >
                                  Price per {orderProduct.unitLabel} (₹)
                                </div>
                                <input
                                  type="number"
                                  value={orderPrice}
                                  onChange={(e) =>
                                    setOrderPrice(e.target.value)
                                  }
                                  placeholder={`₹${orderProduct.defaultPricePerUnit}`}
                                  style={inputStyle}
                                />
                                {orderQty &&
                                  orderPrice &&
                                  parseInt(orderQty) > 0 && (
                                    <div
                                      style={{
                                        fontSize: 13,
                                        color: "#6ee7b7",
                                        marginTop: 5,
                                        fontWeight: 600,
                                      }}
                                    >
                                      Total: ₹
                                      {(
                                        parseInt(orderQty) *
                                        parseFloat(orderPrice)
                                      ).toLocaleString()}
                                    </div>
                                  )}
                              </div>
                              <div style={{ display: "flex", gap: 8 }}>
                                {(
                                  [
                                    ["cash", "💵 Cash"],
                                    ["credit", "📋 Credit"],
                                  ] as const
                                ).map(([val, label]) => (
                                  <button
                                    key={val}
                                    onClick={() => setOrderPayment(val)}
                                    style={{
                                      flex: 1,
                                      background:
                                        orderPayment === val
                                          ? val === "cash"
                                            ? "rgba(22,163,74,0.15)"
                                            : "rgba(217,119,6,0.15)"
                                          : t.bg3,
                                      color:
                                        orderPayment === val
                                          ? val === "cash"
                                            ? "#16a34a"
                                            : "#d97706"
                                          : t.text2,
                                      border: `1.5px solid ${orderPayment === val ? (val === "cash" ? "#16a34a" : "#d97706") : t.border}`,
                                      borderRadius: 10,
                                      padding: "10px",
                                      fontSize: 13,
                                      fontWeight: 800,
                                    }}
                                  >
                                    {label}
                                  </button>
                                ))}
                              </div>
                              <div>
                                <div
                                  style={{
                                    fontSize: 12,
                                    color: t.text3,
                                    marginBottom: 4,
                                    textTransform: "uppercase",
                                    letterSpacing: 1,
                                  }}
                                >
                                  Planned Delivery Date
                                </div>
                                <input
                                  type="date"
                                  value={orderDate}
                                  onChange={(e) => setOrderDate(e.target.value)}
                                  style={inputStyle}
                                />
                              </div>
                            </>
                          )}
                          {confirmBtn(
                            "Place Order ✓",
                            handleConfirmNewOrder,
                            !orderQty ||
                              parseInt(orderQty) <= 0 ||
                              (!isUnderDistributor && !orderPrice),
                          )}
                        </>
                      )}
                    </>
                  )}

                  {/* ── PAYMENT COLLECTION ── */}
                  {opt.key === "payment_collection" && (
                    <>
                      {outstandingAmount > 0 && (
                        <div
                          style={{
                            background: "rgba(22,163,74,0.08)",
                            border: "1px solid rgba(22,163,74,0.2)",
                            borderRadius: 10,
                            padding: "10px 12px",
                            fontSize: 12,
                            color: "#16a34a",
                            fontWeight: 700,
                          }}
                        >
                          Outstanding: ₹{outstandingAmount.toLocaleString()}
                        </div>
                      )}
                      <div>
                        <div
                          style={{
                            fontSize: 12,
                            color: t.text3,
                            marginBottom: 4,
                            textTransform: "uppercase",
                            letterSpacing: 1,
                          }}
                        >
                          Amount Collected (₹)
                        </div>
                        <input
                          type="number"
                          value={paymentAmount}
                          onChange={(e) => setPaymentAmount(e.target.value)}
                          placeholder="e.g. 4500"
                          style={{
                            ...inputStyle,
                            fontSize: 22,
                            fontWeight: 900,
                          }}
                        />
                      </div>
                      <div>
                        <div
                          style={{
                            fontSize: 12,
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
                              ["cash", "💵 Cash"],
                              ["upi", "📱 UPI"],
                              ["cheque", "📄 Cheque"],
                              ["bank_transfer", "🏦 Bank Transfer"],
                            ] as const
                          ).map(([val, label]) => (
                            <button
                              key={val}
                              onClick={() => setPaymentMethod(val)}
                              style={{
                                background:
                                  paymentMethod === val
                                    ? "rgba(22,163,74,0.15)"
                                    : t.bg3,
                                color:
                                  paymentMethod === val ? "#16a34a" : t.text2,
                                border: `1.5px solid ${paymentMethod === val ? "#16a34a" : t.border}`,
                                borderRadius: 10,
                                padding: "9px 8px",
                                fontSize: 12,
                                fontWeight: 700,
                              }}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <div
                          style={{
                            fontSize: 12,
                            color: t.text3,
                            marginBottom: 4,
                            textTransform: "uppercase",
                            letterSpacing: 1,
                          }}
                        >
                          Notes
                        </div>
                        <textarea
                          value={paymentNote}
                          onChange={(e) => setPaymentNote(e.target.value)}
                          placeholder="Any notes about this payment..."
                          rows={2}
                          style={{ ...inputStyle, resize: "none" }}
                        />
                      </div>
                      {(() => {
                        const amt = parseFloat(paymentAmount) || 0;
                        const overLimit =
                          outstandingAmount > 0 && amt > outstandingAmount;
                        const invalid = !paymentAmount || amt <= 0 || overLimit;
                        return (
                          <>
                            {overLimit && (
                              <div
                                style={{
                                  fontSize: 12,
                                  color: "#dc2626",
                                  fontWeight: 700,
                                }}
                              >
                                ⚠️ Amount exceeds outstanding balance of ₹
                                {outstandingAmount.toLocaleString()}
                              </div>
                            )}
                            {amt <= 0 && paymentAmount && (
                              <div
                                style={{
                                  fontSize: 12,
                                  color: "#dc2626",
                                  fontWeight: 700,
                                }}
                              >
                                ⚠️ Amount must be greater than zero
                              </div>
                            )}
                            {confirmBtn(
                              "Log Payment ✓",
                              handleConfirmPayment,
                              invalid,
                            )}
                          </>
                        );
                      })()}
                    </>
                  )}

                  {/* ── RELATIONSHIP VISIT ── */}
                  {opt.key === "relationship_visit" && (
                    <>
                      <div>
                        <div
                          style={{
                            fontSize: 12,
                            color: t.text3,
                            marginBottom: 4,
                            textTransform: "uppercase",
                            letterSpacing: 1,
                          }}
                        >
                          Notes (optional)
                        </div>
                        <textarea
                          value={visitNote}
                          onChange={(e) => setVisitNote(e.target.value)}
                          placeholder="What was discussed? Any feedback?"
                          rows={3}
                          style={{ ...inputStyle, resize: "none" }}
                        />
                      </div>
                      {confirmBtn("Confirm Visit ✓", handleConfirmRelationship)}
                    </>
                  )}

                  {/* ── NO LONGER ACTIVE ── */}
                  {opt.key === "no_longer_active" && (
                    <>
                      <div
                        style={{
                          background: "rgba(217,119,6,0.08)",
                          border: "1px solid rgba(217,119,6,0.25)",
                          borderRadius: 10,
                          padding: "12px 14px",
                        }}
                      >
                        <div
                          style={{
                            fontSize: 13,
                            fontWeight: 700,
                            color: "#d97706",
                            marginBottom: 4,
                          }}
                        >
                          Moving to Prospect
                        </div>
                        <div
                          style={{
                            fontSize: 12,
                            color: "#fbbf24",
                            lineHeight: 1.5,
                          }}
                        >
                          {party.name} will be moved to Prospect — not deleted.
                          You can revisit them in the future.
                        </div>
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          color: t.text3,
                          textTransform: "uppercase",
                          letterSpacing: 1,
                        }}
                      >
                        Reason
                      </div>
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 6,
                        }}
                      >
                        {[
                          "Stopped selling our product",
                          "Changed supplier",
                          "Closed down",
                          "Low sales / not profitable",
                          "Other",
                        ].map((r) => (
                          <button
                            key={r}
                            onClick={() => setInactiveReason(r)}
                            style={{
                              background:
                                inactiveReason === r
                                  ? "rgba(217,119,6,0.12)"
                                  : t.bg3,
                              color: inactiveReason === r ? "#d97706" : t.text2,
                              border: `1.5px solid ${inactiveReason === r ? "#d97706" : t.border}`,
                              borderRadius: 10,
                              padding: "11px 14px",
                              fontSize: 14,
                              textAlign: "left",
                              fontWeight: inactiveReason === r ? 700 : 400,
                            }}
                          >
                            {inactiveReason === r ? "● " : "○ "}
                            {r}
                          </button>
                        ))}
                      </div>
                      {confirmBtn(
                        "Move to Prospect ✓",
                        handleConfirmNoLongerActive,
                        !inactiveReason,
                      )}
                    </>
                  )}

                  {/* ── DISTRIBUTE TO RETAILERS ── */}
                  {opt.key === "distribute_to_retailers" && (
                    <>
                      {subRetailers.length === 0 ? (
                        <div
                          style={{
                            fontSize: 13,
                            color: t.text3,
                            textAlign: "center",
                            padding: 12,
                          }}
                        >
                          No retailers linked under this distributor yet.
                        </div>
                      ) : (
                        <>
                          {subRetailers.map((r) => {
                            const dist = distributions[r.id!] || {
                              qty: "",
                              pricePerUnit: "",
                              payment: "cash" as const,
                            };
                            const setDist = (key: string, val: string) =>
                              setDistributions((prev) => ({
                                ...prev,
                                [r.id!]: { ...dist, [key]: val },
                              }));
                            const qty = parseInt(dist.qty) || 0;
                            return (
                              <div
                                key={r.id}
                                style={{
                                  background: t.bg3,
                                  borderRadius: 12,
                                  padding: 14,
                                  border: `1.5px solid ${qty > 0 ? "#16a34a33" : t.border}`,
                                }}
                              >
                                <div
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 10,
                                  }}
                                >
                                  <span style={{ fontSize: 16 }}>🏪</span>
                                  <div style={{ flex: 1 }}>
                                    <div
                                      style={{
                                        fontWeight: 700,
                                        fontSize: 14,
                                        color: t.text,
                                      }}
                                    >
                                      {r.name}
                                    </div>
                                    <div
                                      style={{ fontSize: 11, color: t.text3 }}
                                    >
                                      {r.place || r.address}
                                    </div>
                                  </div>
                                  <input
                                    type="number"
                                    min="0"
                                    value={dist.qty}
                                    onChange={(e) =>
                                      setDist("qty", e.target.value)
                                    }
                                    placeholder="0"
                                    style={{
                                      ...inputStyle,
                                      width: 90,
                                      fontSize: 15,
                                      fontWeight: 700,
                                      textAlign: "center",
                                    }}
                                  />
                                </div>
                                {qty > 0 && (
                                  <div
                                    style={{
                                      fontSize: 12,
                                      color: "#6ee7b7",
                                      fontWeight: 600,
                                      marginTop: 6,
                                      textAlign: "right",
                                    }}
                                  >
                                    {qty} packet{qty > 1 ? "s" : ""} sent
                                  </div>
                                )}
                              </div>
                            );
                          })}
                          {confirmBtn(
                            "Confirm Distribution ✓",
                            handleConfirmDistribute,
                            !Object.values(distributions).some(
                              (d) => (parseInt(d.qty) || 0) > 0,
                            ),
                          )}
                        </>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}

        <button
          onClick={handleDone}
          disabled={saving}
          style={{
            background: saving
              ? "#475569"
              : confirmedActions.length > 0
                ? "linear-gradient(135deg,#065f46,#047857)"
                : t.bg3,
            color: confirmedActions.length > 0 ? "#fff" : t.text2,
            border:
              confirmedActions.length > 0 ? "none" : `1.5px solid ${t.border}`,
            borderRadius: 14,
            padding: 18,
            fontSize: 16,
            fontWeight: 900,
            marginTop: 8,
          }}
        >
          {saving
            ? "Saving..."
            : confirmedActions.length > 0
              ? `Done — ${confirmedActions.length} action${confirmedActions.length > 1 ? "s" : ""} logged ✅`
              : "← Back"}
        </button>
      </div>
      {modal}
    </div>
  );
}
