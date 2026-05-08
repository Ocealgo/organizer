import React, { useState, useEffect } from "react";
import {
  collection,
  addDoc,
  onSnapshot,
  updateDoc,
  doc,
  getDoc,
  query,
  where,
  arrayUnion,
  increment,
  getDocs,
} from "firebase/firestore";
import { db } from "../../firebase";
import {
  AppUser,
  Party,
  Product,
  VisitEntry,
  VisitOutcome,
  NOT_INTERESTED_REASONS,
  NotInterestedReason,
  DailyVisitLog,
  RetailerIndent,
} from "../../types";
import { useAuth } from "../../context/AuthContext";
import { useTheme } from "../../context/ThemeContext";
import CustomSelect from "../../components/CustomSelect";
import RevisitLogger from "./RevisitLogger";
import { localDateStr, localDateOffset } from "../../utils/date";
import { INDIAN_STATES } from "../../data";

interface Props {
  onBack: () => void;
}

type Step = "home" | "selectShop" | "addNewShop" | "markOutcome" | "revisit";

export default function VisitLogger({ onBack }: Props) {
  const { appUser } = useAuth();
  const { t } = useTheme();
  const [parties, setParties] = useState<Party[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [todayLog, setTodayLog] = useState<DailyVisitLog | null>(null);
  const [todayRevisitLogs, setTodayRevisitLogs] = useState<any[]>([]);
  const [salesUsers, setSalesUsers] = useState<AppUser[]>([]);
  const [shareRequestTargets, setShareRequestTargets] = useState<string[]>([]);
  const [shareRequestPartyId, setShareRequestPartyId] = useState<string | null>(
    null,
  );
  const [shareRequestPartyName, setShareRequestPartyName] = useState("");
  const [pendingShareRequests, setPendingShareRequests] = useState<any[]>([]);
  const [outgoingPendingRequests, setOutgoingPendingRequests] = useState<any[]>([]);
  const [step, setStep] = useState<Step>("home");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [selectedParty, setSelectedParty] = useState<Party | null>(null);
  const [outcome, setOutcome] = useState<VisitOutcome | null>(null);
  const [notInterestedReason, setNotInterestedReason] = useState<
    NotInterestedReason | ""
  >("");
  const [otherReason, setOtherReason] = useState("");
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [allocQty, setAllocQty] = useState("");
  const [allocPrice, setAllocPrice] = useState("");
  const [allocPayment, setAllocPayment] = useState<"cash" | "credit">("cash");
  const [allocDate, setAllocDate] = useState(localDateOffset(2));
  const [endNote, setEndNote] = useState("");
  const [newShop, setNewShop] = useState({
    name: "",
    phone: "",
    address: "",
    place: "",
    district: "",
    state: "",
    pincode: "",
    type: "retailer" as "distributor" | "retailer",
    underDistributorId: "",
    email: "",
  });
  const [showNewShopEmail, setShowNewShopEmail] = useState(false);
  const [showFinishModal, setShowFinishModal] = useState(false);
  const [visitPartyStatus, setVisitPartyStatus] = useState<
    "all" | "active" | "prospect" | "inactive"
  >("all");
  const [selectedDate, setSelectedDate] = useState(localDateStr());

  // ── ALL hooks first ───────────────────────────────────────────────────────
  useEffect(() => {
    const u1 = onSnapshot(collection(db, "parties"), (snap) =>
      setParties(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Party)),
    );
    const u2 = onSnapshot(collection(db, "products"), (snap) =>
      setProducts(
        snap.docs
          .map((d) => ({ id: d.id, ...d.data() }) as Product)
          .filter((p) => p.active),
      ),
    );
    return () => {
      u1();
      u2();
    };
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(
      query(
        collection(db, "users"),
        where("status", "==", "approved"),
        where("role", "in", ["offline_sales", "online_sales"]),
      ),
      (snap) => {
        setSalesUsers(
          snap.docs.map((d) => ({ uid: d.id, ...d.data() }) as AppUser),
        );
      },
    );
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!appUser) return;
    const pendingQuery = query(
      collection(db, "visit_share_requests"),
      where("toUid", "==", appUser.uid),
      where("status", "==", "pending"),
    );
    return onSnapshot(pendingQuery, (snap) => {
      setPendingShareRequests(
        snap.docs.map((d) => ({ id: d.id, ...d.data() })),
      );
    });
  }, [appUser]);

  useEffect(() => {
    if (!appUser) return;
    const outgoingQuery = query(
      collection(db, "visit_share_requests"),
      where("fromUid", "==", appUser.uid),
      where("status", "==", "pending"),
    );
    return onSnapshot(outgoingQuery, (snap) => {
      setOutgoingPendingRequests(
        snap.docs.map((d) => ({ id: d.id, ...d.data() })),
      );
    });
  }, [appUser]);

  useEffect(() => {
    if (!appUser) return;

    const ownQuery = query(
      collection(db, "visit_logs"),
      where("salesPersonId", "==", appUser.uid),
      where("date", "==", selectedDate),
    );

    const unsubOwn = onSnapshot(ownQuery, (snap) => {
      const logs = snap.docs.map(
        (d) => ({ id: d.id, ...d.data() }) as DailyVisitLog,
      );
      const primary = logs[0] || null;
      setTodayLog(primary);
      setEndNote(primary?.endOfDayNote || "");
    });

    return () => {
      unsubOwn();
    };
  }, [appUser, selectedDate]);

  useEffect(() => {
    if (!appUser) return;
    const ids = [
      appUser.uid,
      ...(todayLog?.sharedWith?.filter((id) => id !== appUser.uid) || []),
    ];
    const q = query(
      collection(db, "revisit_logs"),
      where("date", "==", selectedDate),
      where("salesPersonId", "in", ids),
    );
    return onSnapshot(q, (snap) => {
      const meta = todayLog?.sharedPartnerMeta || {};
      const logs = snap.docs.map((d) => ({ id: d.id, ...d.data() } as any));
      setTodayRevisitLogs(
        logs.filter((log) => {
          if (log.salesPersonId === appUser.uid) return true;
          const partnerMeta = meta[log.salesPersonId];
          if (!partnerMeta) return false;
          const cutoff = partnerMeta.parties?.[log.partyId];
          if (!cutoff) return false;
          return log.createdAt <= cutoff;
        }),
      );
    });
  }, [appUser, selectedDate, todayLog?.sharedWith?.join("|"), todayLog?.sharedPartnerMeta]);

  useEffect(() => {
    if (selectedProduct)
      setAllocPrice(String(selectedProduct.defaultPricePerUnit));
  }, [selectedProduct]);

  const openSharePanel = (partyId: string, partyName: string) => {
    setShareRequestPartyId(partyId);
    setShareRequestPartyName(partyName);
    setShareRequestTargets([]);
  };

  const closeSharePanel = () => {
    setShareRequestPartyId(null);
    setShareRequestPartyName("");
    setShareRequestTargets([]);
  };

  const toggleShareRequestTarget = (uid: string) => {
    setShareRequestTargets((prev) =>
      prev.includes(uid) ? prev.filter((id) => id !== uid) : [...prev, uid],
    );
  };

  const handleSendShareRequest = async () => {
    if (
      !appUser ||
      !todayLog?.id ||
      !shareRequestPartyId ||
      shareRequestTargets.length === 0 ||
      saving
    )
      return;
    const entries = visits.filter((v) => v.partyId === shareRequestPartyId);
    if (entries.length === 0) return;
    const recipientIds = Array.from(new Set(shareRequestTargets));

    setSaving(true);
    try {
      await Promise.all(
        recipientIds.map(async (targetUid) => {
          const newEntries = entries.filter((e) => !e.sharedWith?.includes(targetUid));
          if (newEntries.length === 0) return;
          const targetUser = salesUsers.find((u) => u.uid === targetUid);
          const reqRef = await addDoc(collection(db, "visit_share_requests"), {
            fromUid: appUser.uid,
            fromName: appUser.name,
            toUid: targetUid,
            toName: targetUser?.name || "",
            date: selectedDate,
            partyId: shareRequestPartyId,
            partyName: shareRequestPartyName,
            entries: newEntries,
            originalLogId: todayLog.id,
            status: "pending",
            createdAt: Date.now(),
          });
          await addDoc(collection(db, "alerts"), {
            type: "visit_share_requested",
            message: `📤 ${appUser.name} shared ${shareRequestPartyName}'s visit log with you for ${selectedDate}`,
            relatedId: reqRef.id,
            toUid: targetUid,
            read: false,
            createdAt: Date.now(),
          });
        }),
      );
      closeSharePanel();
    } finally {
      setSaving(false);
    }
  };

  const handleAcceptShareRequest = async (request: any) => {
    if (!appUser) return;
    const existingQuery = query(
      collection(db, "visit_logs"),
      where("salesPersonId", "==", appUser.uid),
      where("date", "==", request.date),
    );
    const snapshot = await getDocs(existingQuery);
    const acceptedCount = request.entries.length;
    const acceptedInterested = request.entries.filter(
      (e: VisitEntry) => e.outcome === "interested",
    ).length;
    const acceptedNotInterested = request.entries.filter(
      (e: VisitEntry) => e.outcome === "not_interested",
    ).length;

    const acceptedAt = Date.now();

    if (!snapshot.empty) {
      const logDoc = snapshot.docs[0];
      const entriesWithShared = request.entries.map((e: VisitEntry) => ({
        ...e,
        sharedWith: Array.from(new Set([request.fromUid, appUser.uid])),
      }));
      await updateDoc(doc(db, "visit_logs", logDoc.id), {
        visits: arrayUnion(...entriesWithShared),
        totalVisited: increment(acceptedCount),
        ...(acceptedInterested > 0 && { totalInterested: increment(acceptedInterested) }),
        ...(acceptedNotInterested > 0 && { totalNotInterested: increment(acceptedNotInterested) }),
        sharedWith: arrayUnion(request.fromUid),
        [`sharedPartnerMeta.${request.fromUid}.parties.${request.partyId}`]: acceptedAt,
        updatedAt: acceptedAt,
      });
    } else {
      await addDoc(collection(db, "visit_logs"), {
        salesPersonId: appUser.uid,
        salesPersonName: appUser.name,
        date: request.date,
        endOfDayNote: "",
        createdAt: acceptedAt,
        updatedAt: acceptedAt,
        sharedWith: Array.from(new Set([request.fromUid, appUser.uid])),
        sharedPartnerMeta: {
          [request.fromUid]: { parties: { [request.partyId]: acceptedAt } },
        },
        visits: request.entries.map((e: VisitEntry) => ({
          ...e,
          sharedWith: Array.from(new Set([request.fromUid, appUser.uid])),
        })),
        totalVisited: acceptedCount,
        totalInterested: acceptedInterested,
        totalNotInterested: acceptedNotInterested,
      });
    }

    // Update sender's log: mark entries accepted + write meta cutoff
    const senderLogSnap = await getDoc(doc(db, "visit_logs", request.originalLogId));
    if (senderLogSnap.exists()) {
      const senderLog = senderLogSnap.data() as DailyVisitLog;
      const updatedVisits = senderLog.visits.map((entry) =>
        entry.partyId === request.partyId
          ? { ...entry, sharedWith: Array.from(new Set([...(entry.sharedWith || []), appUser.uid])) }
          : entry,
      );
      await updateDoc(doc(db, "visit_logs", request.originalLogId), {
        visits: updatedVisits,
        sharedWith: arrayUnion(appUser.uid),
        [`sharedPartnerMeta.${appUser.uid}.parties.${request.partyId}`]: acceptedAt,
      });
    }

    await updateDoc(doc(db, "visit_share_requests", request.id), {
      status: "accepted",
      acceptedAt,
    });
  };

  const handleDeclineShareRequest = async (request: any) => {
    await updateDoc(doc(db, "visit_share_requests", request.id), {
      status: "rejected",
      rejectedAt: Date.now(),
    });
  };

  // ── Derived ───────────────────────────────────────────────────────────────
  const rawVisits: VisitEntry[] = todayLog?.visits || [];
  const visits: VisitEntry[] =
    appUser && todayLog && todayLog.salesPersonId !== appUser.uid
      ? rawVisits.filter((v) => v.sharedWith?.includes(appUser.uid))
      : rawVisits;

  const partyEntries = shareRequestPartyId
    ? visits.filter((v) => v.partyId === shareRequestPartyId)
    : [];

  // uid has nothing new to share when every entry for this party already has their uid in sharedWith
  const hasNothingNewFor = (uid: string) =>
    partyEntries.length > 0 && partyEntries.every((e) => e.sharedWith?.includes(uid));

  const isConfirmShareDisabled = shareRequestTargets.length === 0 || saving;

  const resetVisit = () => {
    setSelectedParty(null);
    setOutcome(null);
    setNotInterestedReason("");
    setOtherReason("");
    setSelectedProduct(null);
    setAllocQty("");
    setAllocPrice("");
    setAllocPayment("cash");
    setAllocDate(localDateOffset(2));
  };

  // ── REVISIT screen ────────────────────────────────────────────────────────
  const handleRevisitDone = async (
    revisitLogId: string,
    outcome: VisitOutcome,
  ) => {
    if (!selectedParty || !appUser) {
      resetVisit();
      setStep("home");
      return;
    }
    const entry: VisitEntry = {
      partyId: selectedParty.id!,
      partyName: selectedParty.name,
      isNew: false,
      outcome,
      isRevisit: true,
      revisitLogId,
      loggedAt: Date.now(),
    };
    try {
      if (todayLog?.id) {
        // Use spread instead of arrayUnion — arrayUnion deduplicates identical objects
        // which would drop a second visit to the same party in the same day
        await updateDoc(doc(db, "visit_logs", todayLog.id), {
          visits: [...(todayLog.visits || []), entry],
          totalVisited: increment(1),
          updatedAt: Date.now(),
        });
      } else {
        await addDoc(collection(db, "visit_logs"), {
          salesPersonId: appUser.uid,
          salesPersonName: appUser.name,
          date: selectedDate,
          endOfDayNote: "",
          createdAt: Date.now(),
          visits: [entry],
          totalVisited: 1,
          totalInterested: 0,
          totalNotInterested: 0,
          updatedAt: Date.now(),
        });
      }
    } catch (err) {
      console.error("Failed to log revisit:", err);
    }
    resetVisit();
    setStep("home");
  };

  if (step === "revisit" && selectedParty) {
    return (
      <RevisitLogger
        party={selectedParty}
        logDate={selectedDate}
        onBack={() => {
          resetVisit();
          setStep("home");
        }}
        onDone={handleRevisitDone}
      />
    );
  }

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleAddVisit = async () => {
    if (!selectedParty || !outcome) return;
    setSaving(true);
    setSaveError("");
    try {
      const entry: VisitEntry = {
        partyId: selectedParty.id!,
        partyName: selectedParty.name,
        isNew: false,
        outcome,
        loggedAt: Date.now(),
        ...(outcome === "not_interested" && {
          notInterestedReason: notInterestedReason as NotInterestedReason,
          ...(notInterestedReason === "Other" && { otherReason }),
        }),
      };

      if (outcome === "interested" && selectedProduct && allocQty) {
        const units = parseInt(allocQty);
        if (selectedParty.underDistributorId) {
          // Retailer under distributor — create indent, not allocation
          const indent: Omit<RetailerIndent, "id"> = {
            distributorId: selectedParty.underDistributorId,
            distributorName: selectedParty.underDistributorName || "",
            retailerId: selectedParty.id!,
            retailerName: selectedParty.name,
            productId: selectedProduct.id!,
            productName: selectedProduct.name,
            requestedPackets: units,
            fulfilledPackets: 0,
            status: "requested",
            requestedBy: appUser!.uid,
            requestedByName: appUser!.name,
            requestedAt: Date.now(),
          };
          const ref = await addDoc(collection(db, "retailer_indents"), indent);
          entry.productId = selectedProduct.id!;
          entry.productName = selectedProduct.name;
          entry.indentId = ref.id;
          await updateDoc(doc(db, "parties", selectedParty.id!), {
            status: "active",
          });
        } else {
          const price =
            parseFloat(allocPrice) || selectedProduct.defaultPricePerUnit;
          const ref = await addDoc(collection(db, "allocations_v2"), {
            partyId: selectedParty.id!,
            partyName: selectedParty.name,
            partyType: selectedParty.type,
            productId: selectedProduct.id!,
            productName: selectedProduct.name,
            packets: units,
            cartons: Math.floor(units / selectedProduct.unitsPerCarton),
            pricePerPacket: price,
            totalAmount: units * price,
            paymentType: allocPayment,
            plannedDate: allocDate,
            status: "pending",
            notes: "",
            createdBy: appUser!.uid,
            createdByName: appUser!.name,
            createdAt: Date.now(),
            month: allocDate.slice(0, 7),
          });
          entry.productId = selectedProduct.id!;
          entry.productName = selectedProduct.name;
          entry.allocationId = ref.id;
          await updateDoc(doc(db, "parties", selectedParty.id!), {
            status: "active",
          });
        }
      }

      if (outcome === "not_interested") {
        await updateDoc(doc(db, "parties", selectedParty.id!), {
          status: "prospect",
          lastVisited: selectedDate,
          lastVisitedBy: appUser!.name,
          notInterestedReason,
        });
      }

      if (todayLog?.id) {
        await updateDoc(doc(db, "visit_logs", todayLog.id), {
          visits: arrayUnion(entry),
          totalVisited: increment(1),
          ...(entry.outcome === "interested" && {
            totalInterested: increment(1),
          }),
          ...(entry.outcome === "not_interested" && {
            totalNotInterested: increment(1),
          }),
          updatedAt: Date.now(),
        });
      } else {
        await addDoc(collection(db, "visit_logs"), {
          salesPersonId: appUser!.uid,
          salesPersonName: appUser!.name,
          date: selectedDate,
          endOfDayNote: "",
          createdAt: Date.now(),
          visits: [entry],
          totalVisited: 1,
          totalInterested: entry.outcome === "interested" ? 1 : 0,
          totalNotInterested: entry.outcome === "not_interested" ? 1 : 0,
          updatedAt: Date.now(),
        });
      }
      resetVisit();
      setShareRequestTargets([]);
      setStep("home");
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : "Save failed. Try again.",
      );
    } finally {
      setSaving(false);
    }
  };

  const handleAddNewShop = async () => {
    if (!newShop.name.trim()) return;

    // Phone duplicate
    const phoneDup = parties.find(
      (p) =>
        p.phone.trim() === newShop.phone.trim() && newShop.phone.trim() !== "",
    );
    if (phoneDup) {
      alert(`Phone already registered to "${phoneDup.name}"`);
      return;
    }

    // Name + location duplicate
    if (newShop.pincode.trim()) {
      const locDup = parties.find(
        (p) =>
          p.name.trim().toLowerCase() === newShop.name.trim().toLowerCase() &&
          (p.place || "").toLowerCase() ===
            newShop.place.trim().toLowerCase() &&
          (p.district || "").toLowerCase() ===
            newShop.district.trim().toLowerCase() &&
          (p.pincode || "") === newShop.pincode.trim(),
      );
      if (locDup) {
        alert(
          `A ${locDup.type} named "${locDup.name}" already exists at this location`,
        );
        return;
      }
    }

    setSaving(true);
    try {
      const underDist = parties.find(
        (p) => p.id === newShop.underDistributorId,
      );
      const distLink =
        newShop.type === "retailer" && newShop.underDistributorId
          ? {
              underDistributorId: newShop.underDistributorId,
              underDistributorName: underDist?.name || "",
            }
          : {};
      const ref = await addDoc(collection(db, "parties"), {
        name: newShop.name.trim(),
        type: newShop.type,
        phone: newShop.phone,
        address: newShop.address,
        place: newShop.place,
        district: newShop.district.trim(),
        state: newShop.state.trim(),
        pincode: newShop.pincode.trim(),
        category: "General Store",
        pricePerPacket: 0,
        packetsAllocated: 0,
        cartonsAllocated: 0,
        lowStockThreshold: 0,
        status: "prospect",
        ...distLink,
        ...(newShop.email.trim() ? { email: newShop.email.trim() } : {}),
        addedBy: appUser!.uid,
        addedByName: appUser!.name,
        createdAt: Date.now(),
      });
      setSelectedParty({
        id: ref.id,
        name: newShop.name.trim(),
        type: newShop.type,
        category: "General Store",
        phone: newShop.phone,
        address: newShop.address,
        place: newShop.place,
        pricePerPacket: 0,
        packetsAllocated: 0,
        cartonsAllocated: 0,
        lowStockThreshold: 0,
        ...distLink,
        addedBy: appUser!.uid,
        addedByName: appUser!.name,
        createdAt: Date.now(),
      });
      setNewShop({
        name: "",
        phone: "",
        address: "",
        place: "",
        district: "",
        state: "",
        pincode: "",
        type: "retailer",
        underDistributorId: "",
        email: "",
      });
      setShowNewShopEmail(false);
      setStep("markOutcome");
    } finally {
      setSaving(false);
    }
  };

  const handleFinishDay = async () => {
    if (todayLog?.id) {
      if (endNote.trim()) {
        await updateDoc(doc(db, "visit_logs", todayLog.id), {
          endOfDayNote: endNote,
        });
      }
      const interested =
        todayLog.totalInterested ??
        visits.filter((v) => v.outcome === "interested").length;
      await addDoc(collection(db, "alerts"), {
        type: "visit_log_submitted",
        message: `📋 ${appUser!.name} submitted visit log · ${visits.length} visit${visits.length !== 1 ? "s" : ""} · ${interested} interested`,
        relatedId: todayLog.id,
        read: false,
        createdAt: Date.now(),
      });
    }
    onBack();
  };

  const statusLabel = (s: string) =>
    s === "active"
      ? "🟢 Active"
      : s === "inactive"
        ? "⛔ Inactive"
        : "🟡 Prospect";

  const partyOptions = parties
    .filter(
      (p) =>
        visitPartyStatus === "all" || (p as any).status === visitPartyStatus,
    )
    .map((p) => ({
      value: p.id!,
      label: `${p.type === "distributor" ? "🚚" : "🏪"} ${p.name}`,
      sub: `${statusLabel((p as any).status)} · ${p.place || p.address || ""}`,
      group: p.type === "distributor" ? "Distributors" : "Retailers",
    }));

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

  // ── HOME ──────────────────────────────────────────────────────────────────
  if (step === "home")
    return (
      <div style={{ minHeight: "100vh", background: t.bg, paddingBottom: 40 }}>
        {/* Confirm modal */}
        {showFinishModal && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.6)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 1000,
              padding: "20px 16px",
            }}
          >
            <div
              style={{
                background: t.card,
                borderRadius: 20,
                padding: "28px 20px",
                width: "100%",
                maxWidth: 420,
                boxShadow: "0 24px 64px rgba(0,0,0,0.4)",
                border: `1px solid ${t.border2}`,
              }}
            >
              <div
                style={{
                  fontSize: 20,
                  fontWeight: 900,
                  color: t.text,
                  marginBottom: 6,
                }}
              >
                Submit Log for {selectedDate}?
              </div>
              <div
                style={{
                  fontSize: 14,
                  color: t.text2,
                  marginBottom: 18,
                  lineHeight: 1.6,
                }}
              >
                {visits.length} visit{visits.length !== 1 ? "s" : ""} recorded
                for <strong style={{ color: t.text }}>{selectedDate}</strong>.
                {selectedDate === localDateStr()
                  ? " You can still add more visits today."
                  : ""}
              </div>
              <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
                {[
                  {
                    label: "Visited",
                    val: visits.length,
                    color: t.text,
                    bg: t.bg3,
                  },
                  {
                    label: "Interested",
                    val: visits.filter((v) => v.outcome === "interested")
                      .length,
                    color: "#16a34a",
                    bg: "rgba(22,163,74,0.1)",
                  },
                  {
                    label: "Declined",
                    val: visits.filter((v) => v.outcome === "not_interested")
                      .length,
                    color: "#dc2626",
                    bg: "rgba(220,38,38,0.08)",
                  },
                ].map((s) => (
                  <div
                    key={s.label}
                    style={{
                      flex: 1,
                      background: s.bg,
                      borderRadius: 10,
                      padding: "10px 6px",
                      textAlign: "center",
                    }}
                  >
                    <div
                      style={{ fontSize: 22, fontWeight: 900, color: s.color }}
                    >
                      {s.val}
                    </div>
                    <div style={{ fontSize: 12, color: t.text3, marginTop: 2 }}>
                      {s.label}
                    </div>
                  </div>
                ))}
              </div>
              {endNote.trim() && (
                <div
                  style={{
                    background: t.bg3,
                    borderRadius: 10,
                    padding: "10px 14px",
                    fontSize: 13,
                    color: t.text2,
                    marginBottom: 16,
                  }}
                >
                  Note: {endNote}
                </div>
              )}
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => setShowFinishModal(false)}
                  style={{
                    flex: 1,
                    background: t.bg3,
                    color: t.text2,
                    border: `1px solid ${t.border}`,
                    borderRadius: 14,
                    padding: "14px",
                    fontSize: 14,
                    fontWeight: 700,
                  }}
                >
                  Keep Logging
                </button>
                <button
                  onClick={async () => {
                    setShowFinishModal(false);
                    await handleFinishDay();
                  }}
                  style={{
                    flex: 2,
                    background: "linear-gradient(135deg,#065f46,#047857)",
                    color: "#fff",
                    border: "none",
                    borderRadius: 14,
                    padding: "14px",
                    fontSize: 15,
                    fontWeight: 900,
                  }}
                >
                  Done ✓
                </button>
              </div>
            </div>
          </div>
        )}

        <div
          style={{
            background: "linear-gradient(135deg,#0d3d2e,#1a5c42)",
            padding: "20px 20px 20px",
          }}
        >
          <div style={{ marginBottom: 14 }}>
            <button
              onClick={onBack}
              style={{
                background: "rgba(255,255,255,0.1)",
                border: "none",
                color: "#6ee7b7",
                padding: "6px 14px",
                borderRadius: 20,
                fontSize: 13,
              }}
            >
              ← Back
            </button>
          </div>
          <div
            style={{
              color: "#6ee7b7",
              fontSize: 11,
              letterSpacing: 3,
              textTransform: "uppercase",
              marginBottom: 4,
            }}
          >
            Visit Log
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 4,
            }}
          >
            <div style={{ fontSize: 22, fontWeight: 900, color: "#fff" }}>
              {selectedDate}
            </div>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => {
                if (e.target.value <= localDateStr())
                  setSelectedDate(e.target.value);
              }}
              max={localDateStr()}
              style={{
                background: "rgba(255,255,255,0.12)",
                border: "1px solid rgba(255,255,255,0.25)",
                borderRadius: 10,
                padding: "6px 10px",
                color: "#fff",
                fontSize: 13,
                outline: "none",
                colorScheme: "dark",
              }}
            />
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
            {[
              { label: "Visited", val: visits.length, color: "#fff" },
              {
                label: "Interested",
                val: visits.filter((v) => v.outcome === "interested").length,
                color: "#86efac",
              },
              {
                label: "Not Int.",
                val: visits.filter((v) => v.outcome === "not_interested")
                  .length,
                color: "#fca5a5",
              },
            ].map((s) => (
              <div
                key={s.label}
                style={{
                  flex: 1,
                  background: "rgba(0,0,0,0.2)",
                  borderRadius: 12,
                  padding: "12px 8px",
                  textAlign: "center",
                }}
              >
                <div style={{ fontSize: 24, fontWeight: 900, color: s.color }}>
                  {s.val}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: "rgba(255,255,255,0.6)",
                    marginTop: 2,
                  }}
                >
                  {s.label}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div
          style={{
            padding: "16px 16px",
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <button
            onClick={() => setStep("selectShop")}
            style={{
              background: "linear-gradient(135deg,#0d3d2e,#1a5c42)",
              color: "#fff",
              border: "none",
              borderRadius: 16,
              padding: "18px 20px",
              display: "flex",
              alignItems: "center",
              gap: 14,
              boxShadow: "0 8px 24px rgba(13,61,46,0.3)",
            }}
          >
            <span style={{ fontSize: 28 }}>📋</span>
            <div style={{ textAlign: "left" }}>
              <div style={{ fontWeight: 800, fontSize: 17 }}>Log a Visit</div>
              <div style={{ fontSize: 14, color: "#a7f3d0", marginTop: 2 }}>
                Distributor or Retailer visit
              </div>
            </div>
            <span style={{ marginLeft: "auto", fontSize: 22 }}>›</span>
          </button>
          {pendingShareRequests.length > 0 && (
            <div
              style={{
                background: "rgba(14,165,233,0.12)",
                borderRadius: 16,
                border: `1px solid rgba(14,165,233,0.25)`,
                padding: 16,
                display: "flex",
                flexDirection: "column",
                gap: 12,
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 700, color: "#0ea5e9" }}>
                Pending shared visit requests
              </div>
              {pendingShareRequests.map((request) => (
                <div
                  key={request.id}
                  style={{
                    background: t.card,
                    borderRadius: 14,
                    padding: 12,
                    border: `1px solid ${t.border}`,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 10,
                      alignItems: "center",
                    }}
                  >
                    <div>
                      <div
                        style={{ fontSize: 13, fontWeight: 700, color: t.text }}
                      >
                        {request.partyName}
                      </div>
                      <div style={{ fontSize: 12, color: t.text2 }}>
                        {request.fromName} sent a shared visit for{" "}
                        {request.date}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button
                        onClick={() => handleDeclineShareRequest(request)}
                        style={{
                          background: t.bg3,
                          border: `1px solid ${t.border}`,
                          borderRadius: 12,
                          padding: "8px 12px",
                          color: t.text2,
                          fontSize: 12,
                        }}
                      >
                        Decline
                      </button>
                      <button
                        onClick={() => handleAcceptShareRequest(request)}
                        style={{
                          background: "linear-gradient(135deg,#0d9488,#14b8a6)",
                          border: "none",
                          borderRadius: 12,
                          padding: "8px 12px",
                          color: "#fff",
                          fontSize: 12,
                        }}
                      >
                        Accept
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {shareRequestPartyId && (
            <div
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,0.55)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 1000,
                padding: "20px 16px",
              }}
            >
              <div
                style={{
                  background: t.card,
                  borderRadius: 20,
                  padding: "28px 20px",
                  width: "100%",
                  maxWidth: 520,
                  boxShadow: "0 24px 64px rgba(0,0,0,0.35)",
                  border: `1px solid ${t.border2}`,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 10,
                    alignItems: "center",
                    flexWrap: "wrap",
                    marginBottom: 16,
                  }}
                >
                  <div>
                    <div style={{ fontSize: 18, fontWeight: 900, color: t.text }}>
                      Share {shareRequestPartyName}'s visits
                    </div>
                    <div style={{ fontSize: 13, color: t.text2, marginTop: 4 }}>
                      Send this party's visits to one or more sales partners.
                    </div>
                  </div>
                  <button
                    onClick={closeSharePanel}
                    style={{
                      background: t.bg3,
                      border: `1px solid ${t.border}`,
                      borderRadius: 12,
                      padding: "8px 12px",
                      fontSize: 12,
                      color: t.text2,
                    }}
                  >
                    Cancel
                  </button>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
                  {salesUsers
                    .filter((u) => u.uid !== appUser?.uid)
                    .map((user) => {
                      const selected = shareRequestTargets.includes(user.uid);
                      const alreadyShared = hasNothingNewFor(user.uid);
                      const hasPendingForUser = outgoingPendingRequests.some(
                        (r) => r.toUid === user.uid && r.partyId === shareRequestPartyId && r.date === selectedDate,
                      );
                      const unavailable = alreadyShared || hasPendingForUser;
                      return (
                        <button
                          key={user.uid}
                          type="button"
                          disabled={unavailable}
                          onClick={() => !unavailable && toggleShareRequestTarget(user.uid)}
                          style={{
                            flex: "1 1 45%",
                            minWidth: 120,
                            textAlign: "left",
                            background: unavailable ? "rgba(255,255,255,0.03)" : selected ? "#0ea5e9" : t.bg3,
                            color: unavailable ? t.text3 : selected ? "#fff" : t.text,
                            border: `1px solid ${unavailable ? t.border : selected ? "#0d9488" : t.border}`,
                            borderRadius: 12,
                            padding: "10px 12px",
                            fontSize: 13,
                            cursor: unavailable ? "not-allowed" : "pointer",
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            gap: 8,
                            opacity: unavailable ? 0.5 : 1,
                          }}
                        >
                          <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                            <span>{user.name}</span>
                            {alreadyShared && (
                              <span style={{ fontSize: 11, color: "#16a34a" }}>✓ Already shared</span>
                            )}
                            {hasPendingForUser && (
                              <span style={{ fontSize: 11, color: "#f59e0b" }}>⏳ Awaiting response</span>
                            )}
                          </span>
                          {selected && !unavailable && (
                            <span style={{ fontSize: 12, opacity: 0.85 }}>✓</span>
                          )}
                        </button>
                      );
                    })}
                </div>
                <div style={{ fontSize: 12, color: t.text3, marginBottom: 12 }}>
                  {shareRequestTargets.length > 0
                    ? `Selected ${shareRequestTargets.length} partner${shareRequestTargets.length === 1 ? "" : "s"}`
                    : "Pick one or more sales partners to share with."}
                </div>
                <button
                  disabled={isConfirmShareDisabled}
                  onClick={handleSendShareRequest}
                  style={{
                    width: "100%",
                    background: isConfirmShareDisabled
                      ? t.bg3
                      : "linear-gradient(135deg,#0d9488,#14b8a6)",
                    color: isConfirmShareDisabled ? t.text2 : "#fff",
                    border: "none",
                    borderRadius: 14,
                    padding: "14px",
                    fontSize: 14,
                    fontWeight: 700,
                    cursor: isConfirmShareDisabled ? "not-allowed" : "pointer",
                  }}
                >
                  Confirm share
                </button>
              </div>
            </div>
          )}

          {/* Log visit button */}
          {visits.length > 0 && (
            <>
              <div
                style={{
                  fontSize: 13,
                  color: t.text2,
                  fontWeight: 700,
                  letterSpacing: 1,
                  textTransform: "uppercase",
                  marginTop: 4,
                }}
              >
                {selectedDate === localDateStr()
                  ? `Visits Today (${visits.length})`
                  : `Visits — ${selectedDate} (${visits.length})`}
              </div>
              {(() => {
                // Split each party's entries into shared (accepted) and unshared (new after share)
                const partyMap = new Map<string, { shared: VisitEntry[]; unshared: VisitEntry[] }>();
                visits.forEach((v) => {
                  const grp = partyMap.get(v.partyId) || { shared: [], unshared: [] };
                  const isSharedEntry = (v.sharedWith || []).some((uid) => uid !== appUser?.uid);
                  if (isSharedEntry) grp.shared.push(v);
                  else grp.unshared.push(v);
                  partyMap.set(v.partyId, grp);
                });

                type GroupType = 'normal' | 'shared' | 'new_after_share';
                const renderGroups: Array<{ partyId: string; entries: VisitEntry[]; groupType: GroupType }> = [];
                partyMap.forEach(({ shared, unshared }, partyId) => {
                  if (shared.length === 0) {
                    if (unshared.length > 0) renderGroups.push({ partyId, entries: unshared, groupType: 'normal' });
                    return;
                  }
                  // Recipient: own uid is in sharedWith (entries came FROM someone else)
                  // Show all entries in one shared card — unshared entries are their own independent visits
                  const isRecipient = !!appUser && shared.some(e => e.sharedWith?.includes(appUser.uid));
                  renderGroups.push({ partyId, entries: shared, groupType: 'shared' });
                  if (unshared.length > 0) {
                    // Recipient's own new visits → normal card (no "after share" label)
                    // Sender's new entries after sharing → new_after_share card
                    renderGroups.push({ partyId, entries: unshared, groupType: isRecipient ? 'normal' : 'new_after_share' });
                  }
                });

                const renderEntries = (entries: VisitEntry[]) =>
                  entries.map((v, vi) => {
                    const rl = v.revisitLogId
                      ? todayRevisitLogs.find((r) => r.id === v.revisitLogId)
                      : todayRevisitLogs.find((r) => r.partyId === v.partyId);
                    const timeStr = v.loggedAt
                      ? new Date(v.loggedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
                      : "";
                    const outcomeEmoji = v.outcome === "interested" ? "✅" : v.outcome === "not_interested" ? "❌" : "🔄";
                    return (
                      <div
                        key={vi}
                        style={{
                          paddingLeft: 10,
                          borderLeft: `2px solid ${t.border}`,
                          marginBottom: vi < entries.length - 1 ? 10 : 0,
                          paddingBottom: vi < entries.length - 1 ? 8 : 0,
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                          <span style={{ fontSize: 15 }}>{outcomeEmoji}</span>
                          {timeStr && <span style={{ fontSize: 11, color: t.text3, fontWeight: 600 }}>{timeStr}</span>}
                        </div>
                        {v.isRevisit && rl?.actions?.map((action: any, ai: number) => {
                          const label =
                            action.type === "stock_update" ? `📊 Stock Updated · Balance: ${action.balanceQty} pkts`
                            : action.type === "new_order" ? `📦 New Order · ${action.quantity} ${action.productName}`
                            : action.type === "payment_collection" ? `💰 Payment ₹${action.amount?.toLocaleString()}`
                            : action.type === "relationship_visit" ? `🤝 Relationship Visit${action.notes ? ` · ${action.notes}` : ""}`
                            : action.type === "no_longer_active" ? `⛔ No Longer Active · ${action.reason}`
                            : action.type === "distribute_to_retailers" ? `📋 Distributed to Retailers`
                            : null;
                          return label ? <div key={ai} style={{ fontSize: 13, color: t.text2, marginBottom: 2 }}>{label}</div> : null;
                        })}
                        {!v.isRevisit && v.outcome === "interested" && v.productName && (
                          <div style={{ fontSize: 13, color: "#16a34a" }}>{v.productName} — allocation created</div>
                        )}
                        {!v.isRevisit && v.outcome === "not_interested" && (
                          <div style={{ fontSize: 13, color: "#dc2626" }}>{v.notInterestedReason}</div>
                        )}
                        {!v.isRevisit && v.outcome === "follow_up" && (
                          <div style={{ fontSize: 13, color: "#d97706" }}>Follow up needed</div>
                        )}
                      </div>
                    );
                  });

                return renderGroups.map(({ partyId, entries, groupType }) => {
                  const vParty = parties.find((p) => p.id === partyId);
                  const typeLabel = vParty?.type === "distributor" ? "🚚 Distributor" : "🏪 Retailer";
                  const hasInterested = entries.some((v) => v.outcome === "interested");
                  const allNotInterested = entries.every((v) => v.outcome === "not_interested");
                  const borderColor = groupType === 'new_after_share'
                    ? "rgba(245,158,11,0.2)"
                    : hasInterested ? "rgba(22,163,74,0.25)"
                    : allNotInterested ? "rgba(220,38,38,0.15)"
                    : "rgba(217,119,6,0.2)";

                  // ── Shared card (read-only, entries already accepted by partner) ──
                  if (groupType === 'shared') {
                    const sharedWithNames = Array.from(new Set(entries.flatMap((v) => v.sharedWith || [])))
                      .filter((id) => id !== appUser?.uid)
                      .map((id) => salesUsers.find((u) => u.uid === id)?.name || id);
                    return (
                      <div key={`${partyId}_shared`} style={{ background: t.card, borderRadius: 14, padding: "14px 16px", border: `1px solid ${borderColor}` }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, gap: 10 }}>
                          <div>
                            <div style={{ fontWeight: 700, fontSize: 15, color: t.text }}>{entries[0].partyName}</div>
                            <div style={{ fontSize: 11, color: t.text3, marginTop: 1 }}>{typeLabel}</div>
                            {sharedWithNames.length > 0 && (
                              <div style={{ fontSize: 12, color: "#0ea5e9", marginTop: 4 }}>
                                Shared with {sharedWithNames.join(", ")}
                              </div>
                            )}
                          </div>
                          {entries.length > 1 && (
                            <span style={{ fontSize: 11, color: t.text3, fontWeight: 700 }}>{entries.length} visits</span>
                          )}
                        </div>
                        {renderEntries(entries)}
                      </div>
                    );
                  }

                  // ── Normal card (never shared) or New-after-share card ──
                  const pendingFor = appUser?.uid === todayLog?.salesPersonId
                    ? outgoingPendingRequests.filter((r) => r.partyId === partyId && r.date === selectedDate)
                    : [];

                  return (
                    <div key={groupType === 'new_after_share' ? `${partyId}_new` : partyId} style={{ background: t.card, borderRadius: 14, padding: "14px 16px", border: `1px solid ${borderColor}` }}>
                      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 10, gap: 10 }}>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 15, color: t.text }}>{entries[0].partyName}</div>
                          <div style={{ fontSize: 11, color: t.text3, marginTop: 1 }}>{typeLabel}</div>
                          {groupType === 'new_after_share' && (
                            <div style={{ fontSize: 11, color: "#f59e0b", marginTop: 3 }}>New log after share</div>
                          )}
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                          {appUser?.uid === todayLog?.salesPersonId && (
                            pendingFor.length > 0 ? (
                              <span style={{ fontSize: 12, background: "rgba(245,158,11,0.1)", color: "#f59e0b", border: "1px solid rgba(245,158,11,0.25)", borderRadius: 12, padding: "8px 10px", fontWeight: 600 }}>
                                ⏳ Awaiting {pendingFor.map((r) => r.toName?.split(" ")[0] || r.toName).join(", ")}
                              </span>
                            ) : (
                              <>
                                <button
                                  onClick={() => openSharePanel(partyId, entries[0].partyName)}
                                  style={{ fontSize: 12, background: "rgba(14,165,233,0.1)", color: "#0ea5e9", border: "1px solid rgba(14,165,233,0.25)", borderRadius: 12, padding: "8px 10px" }}
                                >
                                  Share with partner
                                </button>
                                {groupType === 'new_after_share' && (
                                  <span style={{ fontSize: 11, color: t.text3, textAlign: "right", maxWidth: 140 }}>
                                    Will merge into shared log on accept
                                  </span>
                                )}
                              </>
                            )
                          )}
                          {entries.length > 1 && (
                            <span style={{ fontSize: 11, color: t.text3, fontWeight: 700 }}>{entries.length} visits</span>
                          )}
                        </div>
                      </div>
                      {renderEntries(entries)}
                      {vParty && (vParty as any).status === "active" && (
                        <button
                          onClick={() => { setSelectedParty(vParty); setStep("revisit"); }}
                          style={{ marginTop: 10, width: "100%", background: "rgba(22,163,74,0.07)", border: `1px dashed rgba(22,163,74,0.35)`, borderRadius: 10, padding: "9px 14px", fontSize: 13, fontWeight: 700, color: "#16a34a", cursor: "pointer" }}
                        >
                          + Add More Log
                        </button>
                      )}
                    </div>
                  );
                });
              })()}
            </>
          )}

          {/* End of day note — always visible */}
          <div
            style={{
              background: t.card,
              borderRadius: 14,
              padding: 16,
              border: `1px solid ${t.border}`,
            }}
          >
            <div
              style={{
                fontSize: 14,
                color: t.text2,
                fontWeight: 700,
                marginBottom: 10,
              }}
            >
              End of Day Note
            </div>
            <textarea
              value={endNote}
              onChange={(e) => setEndNote(e.target.value)}
              placeholder="Anything to note for today? (optional)"
              rows={3}
              style={{
                width: "100%",
                background: t.bg3,
                border: `1px solid ${t.border}`,
                borderRadius: 10,
                padding: "12px 14px",
                fontSize: 14,
                color: t.text,
                outline: "none",
                resize: "none",
                boxSizing: "border-box",
              }}
            />
          </div>

          {/* Submit / update day log */}
          <button
            onClick={() =>
              visits.length > 0 ? setShowFinishModal(true) : handleFinishDay()
            }
            style={{
              width: "100%",
              background:
                visits.length > 0
                  ? "linear-gradient(135deg,#065f46,#047857)"
                  : t.bg3,
              color: visits.length > 0 ? "#fff" : t.text2,
              border: visits.length > 0 ? "none" : `1.5px solid ${t.border}`,
              borderRadius: 16,
              padding: "18px",
              fontSize: 17,
              fontWeight: 900,
              boxShadow:
                visits.length > 0 ? "0 8px 24px rgba(4,120,87,0.35)" : "none",
            }}
          >
            {visits.length === 0
              ? "← Back to Dashboard"
              : todayLog?.updatedAt && todayLog.updatedAt !== todayLog.createdAt
                ? `📝 Update Entry — ${visits.length} visit${visits.length > 1 ? "s" : ""}`
                : `✅ Submit Day Log — ${visits.length} visit${visits.length > 1 ? "s" : ""}`}
          </button>
        </div>
      </div>
    );

  // ── SELECT PARTY ─────────────────────────────────────────────────────────
  if (step === "selectShop")
    return (
      <div style={{ minHeight: "100vh", background: t.bg, paddingBottom: 40 }}>
        <div
          style={{
            background: "linear-gradient(135deg,#0d3d2e,#1a5c42)",
            padding: "20px 20px 20px",
          }}
        >
          <button
            onClick={() => setStep("home")}
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
          <div style={{ fontSize: 20, fontWeight: 900, color: "#fff" }}>
            Select Party
          </div>
          <div style={{ fontSize: 14, color: "#a7f3d0", marginTop: 4 }}>
            Active → Revisit · Prospect → Mark outcome
          </div>
        </div>

        <div
          style={{
            padding: "16px 16px",
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          {/* Status filter */}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {(
              [
                { val: "all", label: "All" },
                { val: "active", label: "🟢 Active" },
                { val: "prospect", label: "🟡 Prospect" },
                { val: "inactive", label: "⛔ Inactive" },
              ] as const
            ).map((s) => (
              <button
                key={s.val}
                onClick={() => setVisitPartyStatus(s.val)}
                style={{
                  background:
                    visitPartyStatus === s.val
                      ? s.val === "active"
                        ? "rgba(22,163,74,0.15)"
                        : s.val === "prospect"
                          ? "rgba(217,119,6,0.15)"
                          : s.val === "inactive"
                            ? "rgba(220,38,38,0.12)"
                            : "rgba(22,163,74,0.15)"
                      : t.bg3,
                  color:
                    visitPartyStatus === s.val
                      ? s.val === "active"
                        ? "#16a34a"
                        : s.val === "prospect"
                          ? "#d97706"
                          : s.val === "inactive"
                            ? "#dc2626"
                            : "#16a34a"
                      : t.text2,
                  border: `1px solid ${visitPartyStatus === s.val ? (s.val === "active" ? "#16a34a" : s.val === "prospect" ? "#d97706" : s.val === "inactive" ? "#dc2626" : "#16a34a") : t.border}`,
                  borderRadius: 20,
                  padding: "6px 14px",
                  fontSize: 13,
                  fontWeight: 700,
                  whiteSpace: "nowrap",
                }}
              >
                {s.label}
              </button>
            ))}
          </div>

          <CustomSelect
            value={selectedParty?.id || ""}
            onChange={(v) => {
              const p = parties.find((p) => p.id === v);
              if (!p) return;
              setSelectedParty(p);
              setStep(
                (p as any).status === "active" ? "revisit" : "markOutcome",
              );
            }}
            placeholder="🔍 Search by name, place, area..."
            options={partyOptions}
            searchable
          />

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ flex: 1, height: 1, background: t.border }} />
            <span style={{ fontSize: 13, color: t.text3 }}>or</span>
            <div style={{ flex: 1, height: 1, background: t.border }} />
          </div>

          <button
            onClick={() => setStep("addNewShop")}
            style={{
              background: t.card,
              border: `1.5px dashed ${t.border2}`,
              color: t.text,
              borderRadius: 14,
              padding: "18px 20px",
              display: "flex",
              alignItems: "center",
              gap: 12,
            }}
          >
            <span style={{ fontSize: 26 }}>🆕</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 16 }}>Add New Party</div>
              <div style={{ fontSize: 13, color: t.text2, marginTop: 2 }}>
                Not in the list yet
              </div>
            </div>
          </button>

          <div style={{ display: "flex", gap: 16 }}>
            <div style={{ fontSize: 13, color: t.text3 }}>Active → Revisit</div>
            <div style={{ fontSize: 13, color: t.text3 }}>
              Prospect → First outcome
            </div>
          </div>
        </div>
      </div>
    );

  // ── ADD NEW PARTY ─────────────────────────────────────────────────────────
  if (step === "addNewShop")
    return (
      <div style={{ minHeight: "100vh", background: t.bg, paddingBottom: 40 }}>
        <div
          style={{
            background: "linear-gradient(135deg,#0d3d2e,#1a5c42)",
            padding: "20px 20px 20px",
          }}
        >
          <button
            onClick={() => setStep("selectShop")}
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
          <div style={{ fontSize: 20, fontWeight: 900, color: "#fff" }}>
            New Party
          </div>
          <div style={{ fontSize: 13, color: "#a7f3d0", marginTop: 4 }}>
            Added as Prospect
          </div>
        </div>
        <div
          style={{
            padding: "16px 16px",
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          <div style={{ display: "flex", gap: 8 }}>
            {(["distributor", "retailer"] as const).map((tp) => (
              <button
                key={tp}
                onClick={() => setNewShop({ ...newShop, type: tp })}
                style={{
                  flex: 1,
                  background:
                    newShop.type === tp ? "rgba(8,145,178,0.15)" : t.bg3,
                  color: newShop.type === tp ? "#0891b2" : t.text2,
                  border: `1.5px solid ${newShop.type === tp ? "#0891b2" : t.border2}`,
                  borderRadius: 12,
                  padding: "13px",
                  fontSize: 15,
                  fontWeight: 800,
                }}
              >
                {tp === "distributor" ? "🚚 Distributor" : "🏪 Retailer"}
              </button>
            ))}
          </div>
          {newShop.type === "retailer" &&
            parties.some((p) => p.type === "distributor") && (
              <div>
                <div
                  style={{
                    fontSize: 12,
                    color: t.text2,
                    marginBottom: 6,
                    letterSpacing: 1,
                    textTransform: "uppercase",
                  }}
                >
                  Under Distributor
                </div>
                <CustomSelect
                  value={newShop.underDistributorId}
                  onChange={(v) =>
                    setNewShop({ ...newShop, underDistributorId: v })
                  }
                  placeholder="Independent — no distributor"
                  options={[
                    { value: "", label: "🟢 Independent retailer" },
                    ...parties
                      .filter((p) => p.type === "distributor")
                      .map((d) => ({ value: d.id!, label: `🚚 ${d.name}` })),
                  ]}
                />
                {newShop.underDistributorId && (
                  <div style={{ fontSize: 11, color: "#d97706", marginTop: 6 }}>
                    ⚠️ Allocation will be blocked — must go through the
                    distributor
                  </div>
                )}
              </div>
            )}

          {[
            {
              label: "Name *",
              key: "name",
              placeholder: "e.g. Rajan Enterprises",
              type: "text",
            },
            {
              label: "Phone Number",
              key: "phone",
              placeholder: "10-digit number",
              type: "tel",
            },
            {
              label: "Address",
              key: "address",
              placeholder: "Full address",
              type: "text",
            },
            {
              label: "Area / Place",
              key: "place",
              placeholder: "e.g. Ernakulam",
              type: "text",
            },
            {
              label: "District",
              key: "district",
              placeholder: "e.g. Ernakulam",
              type: "text",
            },
            {
              label: "Pincode",
              key: "pincode",
              placeholder: "6-digit pincode",
              type: "tel",
            },
          ].map((f) => (
            <div key={f.key}>
              <div
                style={{
                  fontSize: 12,
                  color: t.text2,
                  marginBottom: 6,
                  letterSpacing: 1,
                  textTransform: "uppercase",
                }}
              >
                {f.label}
              </div>
              <input
                type={f.type}
                value={(newShop as any)[f.key]}
                onChange={(e) => {
                  const val =
                    f.key === "pincode"
                      ? e.target.value.replace(/\D/g, "").slice(0, 6)
                      : e.target.value;
                  setNewShop({ ...newShop, [f.key]: val });
                }}
                placeholder={f.placeholder}
                style={inputStyle}
              />
            </div>
          ))}
          <div>
            <div
              style={{
                fontSize: 12,
                color: t.text2,
                marginBottom: 6,
                letterSpacing: 1,
                textTransform: "uppercase",
              }}
            >
              State
            </div>
            <CustomSelect
              value={newShop.state}
              onChange={(v) => setNewShop({ ...newShop, state: v })}
              placeholder="Select state"
              options={INDIAN_STATES.map((s) => ({ value: s, label: s }))}
              searchable
            />
          </div>
          {!showNewShopEmail ? (
            <button
              onClick={() => setShowNewShopEmail(true)}
              style={{
                background: "rgba(255,255,255,0.04)",
                border: "1.5px dashed rgba(255,255,255,0.12)",
                borderRadius: 12,
                padding: "12px 16px",
                fontSize: 13,
                color: t.text3,
                fontWeight: 700,
                textAlign: "left",
                width: "100%",
              }}
            >
              + Add Email Address{" "}
              <span style={{ fontSize: 11, color: t.text3, fontWeight: 400 }}>
                (optional)
              </span>
            </button>
          ) : (
            <div
              style={{
                background: t.bg3,
                border: `1.5px solid ${t.border2}`,
                borderRadius: 12,
                padding: 14,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 10,
                }}
              >
                <div
                  style={{
                    fontSize: 12,
                    color: t.text2,
                    letterSpacing: 1,
                    textTransform: "uppercase",
                  }}
                >
                  Email Address
                </div>
                <button
                  onClick={() => {
                    setShowNewShopEmail(false);
                    setNewShop({ ...newShop, email: "" });
                  }}
                  style={{
                    background: "none",
                    border: "none",
                    color: t.text3,
                    fontSize: 18,
                    cursor: "pointer",
                    lineHeight: 1,
                    padding: "0 2px",
                  }}
                >
                  ×
                </button>
              </div>
              <input
                type="email"
                value={newShop.email}
                onChange={(e) =>
                  setNewShop({ ...newShop, email: e.target.value })
                }
                placeholder="e.g. rajan@example.com"
                style={inputStyle}
              />
            </div>
          )}

          <button
            onClick={handleAddNewShop}
            disabled={saving || !newShop.name.trim()}
            style={{
              background:
                !newShop.name.trim() || saving
                  ? "#475569"
                  : "linear-gradient(135deg,#0d3d2e,#1a5c42)",
              color: "#fff",
              border: "none",
              borderRadius: 14,
              padding: 17,
              fontSize: 16,
              fontWeight: 800,
            }}
          >
            {saving ? "Saving..." : "Add & Continue →"}
          </button>
        </div>
      </div>
    );

  // ── MARK OUTCOME (prospect / first visit) ─────────────────────────────────
  if (step === "markOutcome" && selectedParty)
    return (
      <div style={{ minHeight: "100vh", background: t.bg, paddingBottom: 40 }}>
        <div
          style={{
            background: "linear-gradient(135deg,#0d3d2e,#1a5c42)",
            padding: "20px 20px 20px",
          }}
        >
          <button
            onClick={() => {
              setStep("selectShop");
              resetVisit();
            }}
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
          <div style={{ fontSize: 13, color: "#a7f3d0" }}>Prospect Visit</div>
          <div style={{ fontSize: 22, fontWeight: 900, color: "#fff" }}>
            {selectedParty.name}
          </div>
          <div style={{ fontSize: 13, color: "#a7f3d0", marginTop: 2 }}>
            {selectedParty.place || selectedParty.address}
          </div>
        </div>

        <div
          style={{
            padding: "16px 16px",
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          <div
            style={{
              fontSize: 14,
              color: t.text2,
              fontWeight: 700,
              letterSpacing: 1,
              textTransform: "uppercase",
            }}
          >
            Visit Outcome
          </div>

          {[
            {
              val: "interested",
              emoji: "✅",
              label: "Yes, Interested!",
              sub: "Will take our product — create allocation",
              color: "#16a34a",
            },
            {
              val: "not_interested",
              emoji: "❌",
              label: "Not Interested",
              sub: "Select reason below",
              color: "#dc2626",
            },
            {
              val: "follow_up",
              emoji: "🔄",
              label: "Follow Up Later",
              sub: "Needs more time to decide",
              color: "#d97706",
            },
          ].map((o) => (
            <button
              key={o.val}
              onClick={() => setOutcome(o.val as VisitOutcome)}
              style={{
                background: outcome === o.val ? `${o.color}22` : t.card,
                border: `2px solid ${outcome === o.val ? o.color : t.border}`,
                borderRadius: 14,
                padding: "17px 18px",
                display: "flex",
                alignItems: "center",
                gap: 14,
                textAlign: "left",
              }}
            >
              <span style={{ fontSize: 28 }}>{o.emoji}</span>
              <div>
                <div
                  style={{
                    fontWeight: 800,
                    fontSize: 16,
                    color: outcome === o.val ? o.color : t.text,
                  }}
                >
                  {o.label}
                </div>
                <div style={{ fontSize: 13, color: t.text2, marginTop: 2 }}>
                  {o.sub}
                </div>
              </div>
            </button>
          ))}

          {outcome === "not_interested" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ fontSize: 14, color: t.text2, fontWeight: 700 }}>
                Why not interested?
              </div>
              {NOT_INTERESTED_REASONS.map((r) => (
                <button
                  key={r}
                  onClick={() => setNotInterestedReason(r)}
                  style={{
                    background:
                      notInterestedReason === r
                        ? "rgba(220,38,38,0.12)"
                        : t.bg3,
                    color: notInterestedReason === r ? "#dc2626" : t.text2,
                    border: `1.5px solid ${notInterestedReason === r ? "#dc2626" : t.border}`,
                    borderRadius: 10,
                    padding: "12px 14px",
                    fontSize: 14,
                    textAlign: "left",
                    fontWeight: notInterestedReason === r ? 700 : 400,
                  }}
                >
                  {notInterestedReason === r ? "● " : "○ "}
                  {r}
                </button>
              ))}
              {notInterestedReason === "Other" && (
                <textarea
                  value={otherReason}
                  onChange={(e) => setOtherReason(e.target.value)}
                  placeholder="Please specify..."
                  rows={2}
                  style={{
                    width: "100%",
                    background: t.bg3,
                    border: `1.5px solid ${t.border2}`,
                    borderRadius: 10,
                    padding: "12px",
                    fontSize: 14,
                    color: t.text,
                    outline: "none",
                    resize: "none",
                    boxSizing: "border-box",
                  }}
                />
              )}
            </div>
          )}

          {outcome === "interested" && selectedParty.underDistributorId && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div
                style={{
                  background: "rgba(217,119,6,0.08)",
                  border: "1px solid rgba(217,119,6,0.2)",
                  borderRadius: 12,
                  padding: "12px 14px",
                }}
              >
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 800,
                    color: "#d97706",
                    marginBottom: 4,
                  }}
                >
                  Indent via {selectedParty.underDistributorName}
                </div>
                <div
                  style={{ fontSize: 12, color: "#fbbf24", lineHeight: 1.5 }}
                >
                  Stock flows through the distributor. An indent will be raised
                  — distributor fulfills it.
                </div>
              </div>
              <div style={{ fontSize: 14, color: t.text2, fontWeight: 700 }}>
                Which Product?
              </div>
              {products.length === 0 ? (
                <div
                  style={{
                    background: "rgba(220,38,38,0.08)",
                    borderRadius: 10,
                    padding: 14,
                    fontSize: 14,
                    color: "#dc2626",
                  }}
                >
                  No active products. Ask admin to add products first.
                </div>
              ) : (
                products.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setSelectedProduct(p)}
                    style={{
                      background:
                        selectedProduct?.id === p.id
                          ? "rgba(22,163,74,0.12)"
                          : t.bg3,
                      border: `1.5px solid ${selectedProduct?.id === p.id ? "#16a34a" : t.border}`,
                      borderRadius: 12,
                      padding: "14px 16px",
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      textAlign: "left",
                    }}
                  >
                    <span style={{ fontSize: 20 }}>📦</span>
                    <div style={{ flex: 1 }}>
                      <div
                        style={{
                          fontWeight: 700,
                          fontSize: 15,
                          color:
                            selectedProduct?.id === p.id ? "#16a34a" : t.text,
                        }}
                      >
                        {p.name}
                      </div>
                      <div style={{ fontSize: 13, color: t.text2 }}>
                        ₹{p.defaultPricePerUnit}/{p.unitLabel}
                      </div>
                    </div>
                    {selectedProduct?.id === p.id && (
                      <span style={{ color: "#16a34a", fontSize: 18 }}>✓</span>
                    )}
                  </button>
                ))
              )}
              {selectedProduct && (
                <input
                  type="number"
                  value={allocQty}
                  onChange={(e) => setAllocQty(e.target.value)}
                  placeholder={`Qty (${selectedProduct.unitLabel})`}
                  style={inputStyle}
                />
              )}
            </div>
          )}

          {outcome === "interested" && !selectedParty.underDistributorId && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ fontSize: 14, color: t.text2, fontWeight: 700 }}>
                Which Product?
              </div>
              {products.length === 0 ? (
                <div
                  style={{
                    background: "rgba(220,38,38,0.08)",
                    borderRadius: 10,
                    padding: 14,
                    fontSize: 14,
                    color: "#dc2626",
                  }}
                >
                  ⚠️ No active products found. Ask admin to add products first.
                </div>
              ) : (
                products.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setSelectedProduct(p)}
                    style={{
                      background:
                        selectedProduct?.id === p.id
                          ? "rgba(22,163,74,0.12)"
                          : t.bg3,
                      border: `1.5px solid ${selectedProduct?.id === p.id ? "#16a34a" : t.border}`,
                      borderRadius: 12,
                      padding: "14px 16px",
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      textAlign: "left",
                    }}
                  >
                    <span style={{ fontSize: 22 }}>📦</span>
                    <div style={{ flex: 1 }}>
                      <div
                        style={{
                          fontWeight: 700,
                          fontSize: 15,
                          color:
                            selectedProduct?.id === p.id ? "#16a34a" : t.text,
                        }}
                      >
                        {p.name}
                      </div>
                      <div style={{ fontSize: 13, color: t.text2 }}>
                        ₹{p.defaultPricePerUnit}/{p.unitLabel}
                      </div>
                    </div>
                    {selectedProduct?.id === p.id && (
                      <span style={{ color: "#16a34a", fontSize: 20 }}>✓</span>
                    )}
                  </button>
                ))
              )}
              {selectedProduct && (
                <>
                  <input
                    type="number"
                    value={allocQty}
                    onChange={(e) => setAllocQty(e.target.value)}
                    placeholder={`Qty (${selectedProduct.unitLabel})`}
                    style={inputStyle}
                  />
                  <input
                    type="number"
                    value={allocPrice}
                    onChange={(e) => setAllocPrice(e.target.value)}
                    placeholder={`Price per ${selectedProduct.unitLabel} (₹)`}
                    style={inputStyle}
                  />
                  {allocQty && allocPrice && (
                    <div
                      style={{
                        fontSize: 14,
                        color: "#6ee7b7",
                        fontWeight: 600,
                      }}
                    >
                      Total: ₹
                      {(
                        parseInt(allocQty) * parseFloat(allocPrice)
                      ).toLocaleString()}
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 8 }}>
                    {(
                      [
                        ["cash", "💵 Cash"],
                        ["credit", "📋 Credit"],
                      ] as const
                    ).map(([val, label]) => (
                      <button
                        key={val}
                        onClick={() => setAllocPayment(val)}
                        style={{
                          flex: 1,
                          background:
                            allocPayment === val
                              ? val === "cash"
                                ? "rgba(22,163,74,0.15)"
                                : "rgba(217,119,6,0.15)"
                              : t.bg3,
                          color:
                            allocPayment === val
                              ? val === "cash"
                                ? "#16a34a"
                                : "#d97706"
                              : t.text2,
                          border: `1.5px solid ${allocPayment === val ? (val === "cash" ? "#16a34a" : "#d97706") : t.border}`,
                          borderRadius: 12,
                          padding: "12px",
                          fontSize: 14,
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
                        color: t.text2,
                        marginBottom: 6,
                        letterSpacing: 1,
                        textTransform: "uppercase",
                      }}
                    >
                      Planned Delivery Date
                    </div>
                    <input
                      type="date"
                      value={allocDate}
                      onChange={(e) => setAllocDate(e.target.value)}
                      style={inputStyle}
                    />
                  </div>
                </>
              )}
            </div>
          )}

          {saveError && (
            <div
              style={{
                background: "rgba(220,38,38,0.1)",
                border: "1px solid rgba(220,38,38,0.3)",
                borderRadius: 10,
                padding: "10px 14px",
                fontSize: 13,
                color: "#dc2626",
              }}
            >
              ⚠️ {saveError}
            </div>
          )}

          {/* Save button */}
          {outcome && (
            <button
              onClick={handleAddVisit}
              disabled={
                saving ||
                (outcome === "not_interested" && !notInterestedReason) ||
                (outcome === "interested" && (!selectedProduct || !allocQty))
              }
              style={{
                background: saving
                  ? "#475569"
                  : "linear-gradient(135deg,#0d3d2e,#1a5c42)",
                color: "#fff",
                border: "none",
                borderRadius: 14,
                padding: 18,
                fontSize: 16,
                fontWeight: 800,
                marginTop: 4,
                opacity:
                  (outcome === "not_interested" && !notInterestedReason) ||
                  (outcome === "interested" && (!selectedProduct || !allocQty))
                    ? 0.4
                    : 1,
              }}
            >
              {saving ? "Saving..." : "Save Visit ✅"}
            </button>
          )}
        </div>
      </div>
    );

  return null;
}
