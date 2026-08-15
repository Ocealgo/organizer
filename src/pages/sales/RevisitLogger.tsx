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
  getDoc,
  deleteDoc,
  getDocs,
} from "firebase/firestore";
import { db } from "../../firebase";
import {
  Party,
  Product,
  RevisitAction,
  StockUpdateAction,
  NewOrderAction,
  PaymentCollectionAction,
} from "../../types";
import { useAuth } from "../../context/AuthContext";
import { useTheme } from "../../context/ThemeContext";
import { useConfirm } from "../../hooks/useConfirm";
import { localDateStr, localDateOffset } from "../../utils/date";
import { recordStockMoves } from "../../data/stockLedger";
import { PageHeader, Note } from "../../components/ui";

interface EditMode {
  revisitLogId: string;
  existingActions: RevisitAction[];
  existingNotes: string;
}

interface Props {
  party: Party;
  onBack: () => void;
  onDone: (revisitLogId: string) => void;
  logDate?: string;
  editMode?: EditMode;
}

type ActionKey =
  | "stock_update"
  | "new_order"
  | "payment_collection"
  | "relationship_visit"
  | "no_longer_active";

const today2 = () => localDateOffset(2);

export default function RevisitLogger({
  party,
  onBack,
  onDone,
  logDate,
  editMode,
}: Props) {
  const { appUser } = useAuth();
  const { t } = useTheme();
  const { modal, showConfirm } = useConfirm();
  const [products, setProducts] = useState<Product[]>([]);
  const [saving, setSaving] = useState(false);
  const [paymentConfirmed, setPaymentConfirmed] = useState(false);
  const [orderDispatched, setOrderDispatched] = useState(false);

  const [expandedAction, setExpandedAction] = useState<ActionKey | null>(null);
  const [doneKeys, setDoneKeys] = useState<Set<ActionKey>>(() => {
    if (!editMode) return new Set();
    return new Set(editMode.existingActions.map((a) => a.type) as ActionKey[]);
  });
  const [confirmedActions, setConfirmedActions] = useState<RevisitAction[]>(
    () => editMode?.existingActions ?? [],
  );

  // Stock update
  const [stockProductId, setStockProductId] = useState(() => {
    if (!editMode) return "";
    const a = editMode.existingActions.find((a) => a.type === 'stock_update') as any;
    return a?.productId ?? "";
  });
  const [soldQtyInput, setSoldQtyInput] = useState(() => {
    if (!editMode) return "";
    const a = editMode.existingActions.find((a) => a.type === 'stock_update') as any;
    return a?.soldQty ? String(a.soldQty) : "";
  });
  const [manualBalance, setManualBalance] = useState(() => {
    if (!editMode) return "";
    const a = editMode.existingActions.find((a) => a.type === 'stock_update') as any;
    return a?.openingQty === 0 ? String(a.balanceQty ?? "") : "";
  });

  // New order
  const [orderProduct, setOrderProduct] = useState<Product | null>(null);
  const [orderUnit, setOrderUnit] = useState<"packet" | "carton">("packet");
  const [orderQty, setOrderQty] = useState(() => {
    if (!editMode) return "";
    const a = editMode.existingActions.find((a) => a.type === 'new_order') as any;
    return a?.quantity ? String(a.quantity) : "";
  });
  const [orderPrice, setOrderPrice] = useState(() => {
    if (!editMode) return "";
    const a = editMode.existingActions.find((a) => a.type === 'new_order') as any;
    return a?.pricePerUnit ? String(a.pricePerUnit) : "";
  });
  const [orderPayment, setOrderPayment] = useState<"cash" | "credit">(() => {
    if (!editMode) return "credit";
    const a = editMode.existingActions.find((a) => a.type === 'new_order') as any;
    return a?.paymentType ?? "cash";
  });
  const [orderDate, setOrderDate] = useState(() => {
    if (!editMode) return today2();
    const a = editMode.existingActions.find((a) => a.type === 'new_order') as any;
    return a?.plannedDate ?? today2();
  });

  // Payment
  const [paymentAmount, setPaymentAmount] = useState(() => {
    if (!editMode) return "";
    const a = editMode.existingActions.find((a) => a.type === 'payment_collection') as any;
    return a?.amount ? String(a.amount) : "";
  });
  const [paymentNote, setPaymentNote] = useState(() => {
    if (!editMode) return "";
    const a = editMode.existingActions.find((a) => a.type === 'payment_collection') as any;
    return a?.notes ?? "";
  });
  const [paymentMethod, setPaymentMethod] = useState<
    "cash" | "cheque" | "bank_transfer" | "upi"
  >("cheque");

  // Relationship / inactive
  const [visitNote, setVisitNote] = useState(() => editMode?.existingNotes ?? "");
  const [inactiveReason, setInactiveReason] = useState(() => {
    if (!editMode) return "";
    const a = editMode.existingActions.find((a) => a.type === 'no_longer_active') as any;
    return a?.reason ?? "";
  });

  const [allocations, setAllocations] = useState<any[]>([]);

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
    label: string;
    sub: string;
  }[] = [
    {
      key: "stock_update",
      label: "Stock Update",
      sub: "Log current stock level",
    },
    {
      key: "new_order",
      label: "New Order",
      sub: "They want more stock — create allocation",
    },
    ...(!isUnderDistributor
      ? [
          {
            key: "payment_collection" as ActionKey,
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
      label: "Relationship Visit",
      sub: "Visited, maintained relationship",
    },
    ...((party as any).status === "active" ? [{
      key: "no_longer_active" as ActionKey,
      label: "No Longer Active",
      sub: "Will be moved back to Prospect",
    }] : []),
  ];

  useEffect(() => {
    if (!editMode) return;
    const payAction = editMode.existingActions.find((a) => a.type === 'payment_collection') as any;
    if (payAction?.transactionId) {
      getDoc(doc(db, 'payment_transactions', payAction.transactionId)).then((snap) => {
        if (snap.exists() && snap.data()?.confirmedAt) setPaymentConfirmed(true);
      });
    }
    const orderAction = editMode.existingActions.find((a) => a.type === 'new_order') as any;
    if (orderAction?.allocationId) {
      getDoc(doc(db, 'allocations_v2', orderAction.allocationId)).then((snap) => {
        const status = snap.data()?.status;
        if (status && status !== 'pending') setOrderDispatched(true);
      });
    }
  }, []);

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
      editMode ? "Update Stock Entry" : "Confirm Stock Update",
      stockOpening === 0
        ? `Set balance for ${productName} to ${bal} packets`
        : `${productName} · Sold: ${stockSold} packets · Balance: ${bal} packets`,
    );
    if (!confirmed) return;

    // In edit mode: reverse old stock update first, then apply new
    if (editMode) {
      const oldAction = editMode.existingActions.find((a) => a.type === 'stock_update') as StockUpdateAction | undefined;
      if (oldAction && oldAction.productId) {
        if (oldAction.openingQty === 0) {
          // Was a manual set — just overwrite below (no reversal needed)
        } else {
          // Reverse the sold qty
          await updateDoc(doc(db, "parties", party.id!), {
            [`stock.${oldAction.productId}`]: increment(oldAction.soldQty),
          });
        }
      }
    }

    if (stockOpening === 0) {
      // A counted balance rather than a movement — recorded as a correction so
      // the ledger still adds up to what the party actually holds.
      await recordStockMoves([{
        partyId: party.id!, partyName: party.name,
        productId: stockProductId, productName,
        delta: bal - stockOpening, balanceAfter: bal,
        reason: 'adjustment', refType: 'revisit',
        byUid: appUser!.uid, byName: appUser!.name,
        date: logDate || localDateStr(),
      }])
      await updateDoc(doc(db, "parties", party.id!), {
        [`stock.${stockProductId}`]: bal,
      });
      markDone("stock_update", {
        type: "stock_update",
        productId: stockProductId,
        productName,
        openingQty: 0,
        purchasedQty: 0,
        soldQty: 0,
        balanceQty: bal,
        balanceValue: 0,
        aiRead: false,
      } as StockUpdateAction);
    } else {
      // Units gone off the shelf since the last visit — secondary sales.
      await recordStockMoves([{
        partyId: party.id!, partyName: party.name,
        productId: stockProductId, productName,
        delta: -stockSold, balanceAfter: stockBalance,
        reason: 'sale', refType: 'revisit',
        byUid: appUser!.uid, byName: appUser!.name,
        date: logDate || localDateStr(),
      }])
      await updateDoc(doc(db, "parties", party.id!), {
        [`stock.${stockProductId}`]: increment(-stockSold),
      });
      markDone("stock_update", {
        type: "stock_update",
        productId: stockProductId,
        productName,
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
    const rawQty = parseInt(orderQty);
    const qty = orderUnit === "carton"
      ? rawQty * (orderProduct.unitsPerCarton || 1)
      : rawQty;
    const price = parseFloat(orderPrice) || orderProduct.defaultPricePerUnit;
    const total = qty * price;

    // In edit mode: check if existing allocation is still pending
    const existingOrderAction = editMode?.existingActions.find((a) => a.type === 'new_order') as NewOrderAction | undefined;
    if (editMode && existingOrderAction?.allocationId) {
      const snap = await getDoc(doc(db, 'allocations_v2', existingOrderAction.allocationId!));
      const allocStatus = snap.data()?.status;
      if (allocStatus && allocStatus !== 'pending') {
        await showConfirm('Cannot Edit', `Allocation is already "${allocStatus}" and cannot be modified.`);
        return;
      }
    }

    const confirmed = await showConfirm(
      editMode ? "Update Order" : "Confirm Order",
      isUnderDistributor
        ?`${qty} ${orderProduct.unitLabel} of ${orderProduct.name} → ${(party as any).underDistributorName}`
        : `${qty} ${orderProduct.unitLabel} of ${orderProduct.name} · ₹${total.toLocaleString()} · ${orderPayment}`,
    );
    if (!confirmed) return;
    const todayDate = logDate || localDateStr();
    let allocId: string;

    // Edit mode: update existing allocation in-place
    if (editMode && existingOrderAction?.allocationId) {
      allocId = existingOrderAction.allocationId;
      await updateDoc(doc(db, "allocations_v2", allocId), {
        productId: orderProduct.id!,
        productName: orderProduct.name,
        packets: qty,
        cartons: Math.floor(qty / (orderProduct.unitsPerCarton || 1)),
        pricePerPacket: isUnderDistributor ? 0 : price,
        totalAmount: isUnderDistributor ? 0 : total,
        paymentType: isUnderDistributor ? "cash" : orderPayment,
        plannedDate: isUnderDistributor ? todayDate : orderDate,
        month: (isUnderDistributor ? todayDate : orderDate).slice(0, 7),
        updatedAt: Date.now(),
      });
    } else if (isUnderDistributor) {
      const allocRef = await addDoc(collection(db, "allocations_v2"), {
        fromType: "distributor",
        fromId: (party as any).underDistributorId,
        fromName: (party as any).underDistributorName || "",
        partyId: party.id!, partyName: party.name, partyType: party.type,
        productId: orderProduct.id!, productName: orderProduct.name,
        packets: qty, cartons: Math.floor(qty / orderProduct.unitsPerCarton),
        pricePerPacket: 0, totalAmount: 0, paymentType: "cash",
        plannedDate: todayDate, status: "pending", notes: "",
        createdBy: appUser!.uid, createdByName: appUser!.name,
        createdAt: Date.now(), month: todayDate.slice(0, 7), lockedAtCreation: false,
      });
      allocId = allocRef.id;
    } else {
      const allocRef = await addDoc(collection(db, "allocations_v2"), {
        fromType: "company", fromId: "company", fromName: "Ocealgo",
        partyId: party.id!, partyName: party.name, partyType: party.type,
        productId: orderProduct.id!, productName: orderProduct.name,
        packets: qty, cartons: Math.floor(qty / orderProduct.unitsPerCarton),
        pricePerPacket: price, totalAmount: total, paymentType: orderPayment,
        plannedDate: orderDate, status: "pending", notes: "",
        createdBy: appUser!.uid, createdByName: appUser!.name,
        createdAt: Date.now(), month: orderDate.slice(0, 7), lockedAtCreation: true,
      });
      allocId = allocRef.id;
    }
    await updateDoc(doc(db, "parties", party.id!), { status: "active" });
    markDone("new_order", {
      type: "new_order",
      productId: orderProduct.id!,
      productName: orderProduct.name,
      quantity: qty,
      pricePerUnit: isUnderDistributor ? 0 : price,
      totalAmount: isUnderDistributor ? 0 : total,
      paymentType: isUnderDistributor ? "cash" : orderPayment,
      plannedDate: isUnderDistributor ? todayDate : orderDate,
      allocationId: allocId,
    } as NewOrderAction);
  };

  const handleConfirmPayment = async () => {
    if (!paymentAmount) return;
    const amount = parseFloat(paymentAmount);
    if (amount <= 0) return;
    const methodLabel: Record<string, string> = {
      cash: "Cash",
      cheque: "Cheque",
      bank_transfer: "Bank Transfer",
      upi: "UPI",
    };

    // In edit mode: check if old transaction is admin-confirmed (block)
    const existingPayAction = editMode?.existingActions.find((a) => a.type === 'payment_collection') as any;
    if (editMode && existingPayAction?.transactionId) {
      const snap = await getDoc(doc(db, 'payment_transactions', existingPayAction.transactionId));
      if (snap.data()?.confirmedAt) {
        await showConfirm('Cannot Edit', 'Payment has been confirmed by admin and cannot be modified.');
        return;
      }
    }

    const confirmed = await showConfirm(
      editMode ? "Update Payment" : "Confirm Payment",
      `Log ₹${amount.toLocaleString()} (${methodLabel[paymentMethod]}) collected from ${party.name}?`,
    );
    if (!confirmed) return;

    // In edit mode: reverse old transaction's appliedTo before re-applying
    if (editMode && existingPayAction?.transactionId) {
      const txnSnap = await getDoc(doc(db, 'payment_transactions', existingPayAction.transactionId));
      if (txnSnap.exists()) {
        for (const applied of (txnSnap.data()?.appliedTo || [])) {
          const aSnap = await getDoc(doc(db, 'allocations_v2', applied.allocId));
          if (aSnap.exists()) {
            const aData = aSnap.data()!;
            const newPaid = Math.max(0, (aData.paidAmount || 0) - applied.amount);
            await updateDoc(doc(db, 'allocations_v2', applied.allocId), {
              paidAmount: newPaid,
              ...(aData.status === 'paid' && { status: 'sent', paidAt: null }),
            });
          }
        }
        await deleteDoc(doc(db, 'payment_transactions', existingPayAction.transactionId));
      }
    }

    const freshSnap = await getDocs(query(collection(db, 'allocations_v2'), where('partyId', '==', party.id!)));
    const freshAllocs = freshSnap.docs.map((d) => ({ id: d.id, ...d.data() } as any));

    // Apply payment FIFO to active credit allocs — directly update paidAmount on each alloc
    const activeAllocs = freshAllocs
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

    const txnRef = await addDoc(collection(db, "payment_transactions"), {
      partyId: party.id!,
      partyName: party.name,
      partyType: party.type,
      amount,
      paymentMethod,
      collectionType: "collected_by_salesperson",
      collectedBy: appUser!.uid,
      collectedByName: appUser!.name,
      notes: paymentNote,
      status: "pending_approval",
      date: logDate || localDateStr(),
      createdAt: Date.now(),
      appliedTo,
    });
    if (!editMode) {
      await addDoc(collection(db, "alerts"), {
        type: "credit_settlement",
        message: `₹${amount.toLocaleString()} cash collected from ${party.name} by ${appUser!.name} (${methodLabel[paymentMethod]})`,
        relatedId: party.id!,
        read: false,
        createdAt: Date.now(),
        toRole: "admin_group",
      });
    }
    markDone("payment_collection", {
      type: "payment_collection",
      amount,
      notes: paymentNote,
      status: "pending_approval",
      transactionId: txnRef.id,
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

  const handleDone = async () => {
    if (confirmedActions.length === 0) {
      onBack();
      return;
    }
    setSaving(true);
    try {
      if (editMode) {
        await updateDoc(doc(db, "revisit_logs", editMode.revisitLogId), {
          actions: confirmedActions,
          notes: visitNote,
          updatedAt: Date.now(),
        });
        onDone(editMode.revisitLogId);
      } else {
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
        onDone(revisitRef.id);
      }
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
          ? t.text3
          : t.text,
        color: t.bg,
        border: "none",
        borderRadius: 12,
        padding: "14px",
        fontSize: 15,
        fontWeight: 500,
        opacity: disabled ? 0.4 : 1,
        marginTop: 4,
      }}
    >
      {label}
    </button>
  );

  return (
    <div style={{ minHeight: "100vh", background: t.bg, paddingBottom: 40 }}>
      <PageHeader
        eyebrow={party.type === "distributor" ? "Distributor" : "Retailer"}
        title={party.name}
        subtitle={[
          party.place || party.address,
          (party as any).status === "active" ? "active" : "prospect",
          party.type === "retailer"
            ? ((party as any).underDistributorName
                ? `under ${(party as any).underDistributorName}`
                : "independent")
            : null,
        ].filter(Boolean).join(" · ")}
        onBack={onBack}
      />

      {outstandingAmount > 0 && (
        <div style={{ padding: "20px 20px 0" }}>
          <Note tone="warn">
            {`₹${outstandingAmount.toLocaleString("en-IN")} is still owed on credit. Collect it before taking a new order.`}
          </Note>
        </div>
      )}

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
              color: t.text2,
              fontWeight: 500,
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
                  if (isDone) {
                    if (editMode) {
                      if (opt.key === 'payment_collection' && paymentConfirmed) return;
                      if (opt.key === 'new_order' && orderDispatched) return;
                      setDoneKeys((prev) => { const s = new Set(prev); s.delete(opt.key); return s; });
                      setConfirmedActions((prev) => prev.filter((a) => a.type !== opt.key));
                      setExpandedAction(opt.key);
                    }
                    return;
                  }
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
                  (isDone && !editMode) ||
                  (isDone && editMode && opt.key === 'payment_collection' && paymentConfirmed) ||
                  (isDone && editMode && opt.key === 'new_order' && orderDispatched) ||
                  (opt.key === "no_longer_active" && outstandingAmount > 0)
                }
                style={{
                  width: "100%",
                  background: isDone
                    ? "rgba(22,163,74,0.08)"
                    : isExpanded
                      ? "rgba(22,163,74,0.1)"
                      : t.card,
                  border: `2px solid ${isDone ? t.text2 : isExpanded ? t.text2 : t.border}`,
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
                <div style={{ flex: 1 }}>
                  <div
                    style={{
                      fontWeight: 500,
                      fontSize: 16,
                      color: isDone
                        ? t.text2
                        : isExpanded
                          ? t.text2
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
                            color: t.warn,
                            fontWeight: 500,
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
                    <span style={{ color: (opt.key === 'payment_collection' && paymentConfirmed) || (opt.key === 'new_order' && orderDispatched) ? t.text3 : t.text2, fontSize: editMode ? 11 : 20, fontWeight: 500 }}>
                      {opt.key ==='new_order' && orderDispatched ?'Dispatched' : opt.key ==='payment_collection' && paymentConfirmed ?'Admin confirmed' : editMode ?'tap to edit' :''}
                    </span>
                  ) : (
                    <span style={{ color: t.text3, fontSize: 16 }}>
                      {isExpanded ?"▲" :"▼"}
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
                              border: `1.5px solid ${stockProductId === p.id ? t.text2 : t.border}`,
                              borderRadius: 10,
                              padding: "10px 14px",
                              display: "flex",
                              alignItems: "center",
                              gap: 10,
                              textAlign: "left",
                            }}
                          >
                            <span style={{ fontSize: 18 }}></span>
                            <div style={{ flex: 1 }}>
                              <div
                                style={{
                                  fontWeight: 500,
                                  fontSize: 14,
                                  color:
                                    stockProductId === p.id
                                      ? t.text2
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
                              <span style={{ color: t.text2 }}></span>
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
                              color: t.warn,
                            }}
                          >
                            Opening stock is zero — enter the current balance
                            directly
                          </div>
                          <div>
                            <div
                              style={{
                                fontSize: 10,
                                color: t.accent,
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
                                fontWeight: 500,
                              }}
                            />
                          </div>
                          {confirmBtn(
                            "Update stock",
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
                              color: t.text2,
                            }}
                          >
 Enter qty sold — balance calculates automatically
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
                                  fontWeight: 500,
                                  color: t.text3,
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
                                  fontWeight: 500,
                                }}
                              />
                            </div>
                          </div>
                          <div>
                            <div
                              style={{
                                fontSize: 10,
                                color: t.accent,
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
                                fontWeight: 500,
                                color: stockBalance > 0 ? t.accent : t.warn,
                                background: "rgba(22,163,74,0.08)",
                                display: "flex",
                                alignItems: "center",
                              }}
                            >
                              {stockBalance}
                            </div>
                          </div>
                          {confirmBtn(
                            "Update stock",
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
                            color: t.text2,
                          }}
                        >
 Stock via{""}
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
                              border: `1.5px solid ${orderProduct?.id === p.id ? t.text2 : t.border}`,
                              borderRadius: 10,
                              padding: "12px 14px",
                              display: "flex",
                              alignItems: "center",
                              gap: 10,
                              textAlign: "left",
                            }}
                          >
                            <span style={{ fontSize: 20 }}></span>
                            <div style={{ flex: 1 }}>
                              <div
                                style={{
                                  fontWeight: 500,
                                  fontSize: 14,
                                  color:
                                    orderProduct?.id === p.id
                                      ? t.text2
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
                              <span style={{ color: t.text2 }}></span>
                            )}
                          </button>
                        ))}
                      </div>
                      {orderProduct && (
                        <>
                          <div>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                              <div style={{ fontSize: 12, color: t.text3, textTransform: "uppercase", letterSpacing: 1 }}>
                                Quantity
                              </div>
                              <div style={{ display: "flex", gap: 4 }}>
                                {(["packet", "carton"] as const).map((u) => (
                                  <button
                                    key={u}
                                    onClick={() => { setOrderUnit(u); setOrderQty(""); }}
                                    style={{
                                      padding: "3px 10px",
                                      borderRadius: 20,
                                      fontSize: 11,
                                      fontWeight: 500,
                                      border: `1.5px solid ${orderUnit === u ? t.text2 : t.border}`,
                                      background: orderUnit === u ? "rgba(22,163,74,0.12)" : t.bg3,
                                      color: orderUnit === u ? t.text2 : t.text3,
                                      cursor: "pointer",
                                    }}
                                  >
                                    {u === "packet" ? orderProduct.unitLabel : "cartons"}
                                  </button>
                                ))}
                              </div>
                            </div>
                            <input
                              type="number"
                              value={orderQty}
                              onChange={(e) => setOrderQty(e.target.value)}
                              placeholder={orderUnit === "carton" ? "No. of cartons" : `No. of ${orderProduct.unitLabel}`}
                              style={{
                                ...inputStyle,
                                borderColor: orderQty && parseInt(orderQty) <= 0 ? t.warn : undefined,
                              }}
                            />
                            {orderUnit === "carton" && orderQty && parseInt(orderQty) > 0 && (
                              <div style={{ fontSize: 12, color: t.text2, marginTop: 5 }}>
                                = {parseInt(orderQty) * (orderProduct.unitsPerCarton || 1)} {orderProduct.unitLabel}
                              </div>
                            )}
                            {orderQty && parseInt(orderQty) <= 0 && (
                              <div style={{ fontSize: 12, color: t.warn, marginTop: 6, fontWeight: 500 }}>
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
                                        color: t.accent,
                                        marginTop: 5,
                                        fontWeight: 500,
                                      }}
                                    >
                                      Total: ₹
                                      {(
                                        (orderUnit === "carton"
                                          ? parseInt(orderQty) * (orderProduct.unitsPerCarton || 1)
                                          : parseInt(orderQty)) *
                                        parseFloat(orderPrice)
                                      ).toLocaleString()}
                                    </div>
                                  )}
                              </div>
                              <div style={{ display: "flex", gap: 8 }}>
                                {(
                                  [
                                    ["cash","Cash"],
                                    ["credit","Credit"],
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
                                            ? t.text2
                                            : t.warn
                                          : t.text2,
                                      border: `1.5px solid ${orderPayment === val ? (val === "cash" ? t.text2 : t.warn) : t.border}`,
                                      borderRadius: 10,
                                      padding: "10px",
                                      fontSize: 13,
                                      fontWeight: 500,
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
                            "Place order",
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
                      {outstandingAmount > 0 && (() => {
                        const typedAmt = parseFloat(paymentAmount) || 0;
                        const remaining = Math.max(0, outstandingAmount - typedAmt);
                        const cleared = typedAmt > 0 && remaining === 0;
                        return (
                          <div style={{ background: cleared ? "rgba(22,163,74,0.12)" : "rgba(22,163,74,0.08)", border: `1px solid ${cleared ? "rgba(22,163,74,0.4)" : "rgba(22,163,74,0.2)"}`, borderRadius: 10, padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                            <div style={{ fontSize: 12, color: t.text2, fontWeight: 500 }}>
                              {cleared ?"Fully cleared" :"Outstanding"}
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              {typedAmt > 0 && (
                                <>
                                  <span style={{ fontSize: 13, color: t.text3, textDecoration: "line-through" }}>₹{outstandingAmount.toLocaleString()}</span>
                                  <span style={{ fontSize: 12, color: t.text3 }}>→</span>
                                </>
                              )}
                              <span style={{ fontSize: 15, fontWeight: 500, color: cleared ? t.text2 : remaining < outstandingAmount ? t.warn : t.text2 }}>
                                ₹{remaining.toLocaleString()}
                              </span>
                            </div>
                          </div>
                        );
                      })()}
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
                            fontWeight: 500,
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
                              ["cash","Cash"],
                              ["upi","UPI"],
                              ["cheque","Cheque"],
                              ["bank_transfer","Bank Transfer"],
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
                                  paymentMethod === val ? t.text2 : t.text2,
                                border: `1.5px solid ${paymentMethod === val ? t.text2 : t.border}`,
                                borderRadius: 10,
                                padding: "9px 8px",
                                fontSize: 12,
                                fontWeight: 500,
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
                                  color: t.warn,
                                  fontWeight: 500,
                                }}
                              >
 Amount exceeds outstanding balance of ₹
                                {outstandingAmount.toLocaleString()}
                              </div>
                            )}
                            {amt <= 0 && paymentAmount && (
                              <div
                                style={{
                                  fontSize: 12,
                                  color: t.warn,
                                  fontWeight: 500,
                                }}
                              >
 Amount must be greater than zero
                              </div>
                            )}
                            {confirmBtn(
                              "Log payment",
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
                      {confirmBtn("Confirm Visit", handleConfirmRelationship)}
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
                            fontWeight: 500,
                            color: t.warn,
                            marginBottom: 4,
                          }}
                        >
                          Moving to Prospect
                        </div>
                        <div
                          style={{
                            fontSize: 12,
                            color: t.warn,
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
                              color: inactiveReason === r ? t.warn : t.text2,
                              border: `1.5px solid ${inactiveReason === r ? t.warn : t.border}`,
                              borderRadius: 10,
                              padding: "11px 14px",
                              fontSize: 14,
                              textAlign: "left",
                              fontWeight: inactiveReason === r ? 700 : 400,
                            }}
                          >
                            {inactiveReason === r ?"" :""}
                            {r}
                          </button>
                        ))}
                      </div>
                      {confirmBtn(
                        "Move back to prospect",
                        handleConfirmNoLongerActive,
                        !inactiveReason,
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
              ? t.text3
              : confirmedActions.length > 0
                ? t.text
                : t.bg3,
            color: confirmedActions.length > 0 ? t.bg : t.text2,
            border:
              confirmedActions.length > 0 ? "none" : `1.5px solid ${t.border}`,
            borderRadius: 14,
            padding: 18,
            fontSize: 16,
            fontWeight: 500,
            marginTop: 8,
          }}
        >
          {saving
            ? "Saving..."
            : confirmedActions.length > 0
              ?`Done — ${confirmedActions.length} action${confirmedActions.length > 1 ?"s" :""} logged`
              :"← Back"}
        </button>
      </div>
      {modal}
    </div>
  );
}
