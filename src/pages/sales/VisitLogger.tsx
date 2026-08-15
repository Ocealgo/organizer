import React, { useState, useEffect } from "react";
import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  getDoc,
  query,
  where,
  arrayUnion,
  increment,
  getDocs,
} from "firebase/firestore";
import { onSnapshot } from "../../data/live";
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
  VisitLogAuditEntry,
  LeaveRecord,
  Holiday,
} from "../../types";
import { useConfirm } from "../../hooks/useConfirm";
import { useAuth } from "../../context/AuthContext";
import { useTheme } from "../../context/ThemeContext";
import CustomSelect from "../../components/CustomSelect";
import RevisitLogger from "./RevisitLogger";
import { localDateStr } from "../../utils/date";
import { INDIAN_STATES } from "../../data";
import DateInput from "../../components/DateInput";
import { PageHeader, StatGrid, StatCard } from "../../components/ui";

interface Props {
  onBack: () => void;
  initialDate?: string;
  onViewAllocation?: (allocationId: string) => void;
  onViewPayment?: (partyId: string, paymentId: string) => void;
}

type Step = "home" | "selectShop" | "addNewShop" | "revisit";

export default function VisitLogger({ onBack, initialDate, onViewAllocation, onViewPayment }: Props) {
  const { appUser } = useAuth();
  const { t } = useTheme();
  const [parties, setParties] = useState<Party[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [todayLog, setTodayLog] = useState<DailyVisitLog | null>(null);
  const [todayRevisitLogs, setTodayRevisitLogs] = useState<any[]>([]);
  const [allocations, setAllocations] = useState<any[]>([]);
  const [livePayments, setLivePayments] = useState<any[]>([]);
  const [salesUsers, setSalesUsers] = useState<AppUser[]>([]);
  const [shareRequestTargets, setShareRequestTargets] = useState<string[]>([]);
  const [shareRequestPartyId, setShareRequestPartyId] = useState<string | null>(
    null,
  );
  const [shareRequestPartyName, setShareRequestPartyName] = useState("");
  const [pendingShareRequests, setPendingShareRequests] = useState<any[]>([]);
  const [outgoingPendingRequests, setOutgoingPendingRequests] = useState<any[]>([]);
  const [editSimpleEntry, setEditSimpleEntry] = useState<VisitEntry | null>(null);
  const [editRevisitTarget, setEditRevisitTarget] = useState<{ revisitLog: any; visitEntry: VisitEntry } | null>(null);
  const [deleteModal, setDeleteModal] = useState<{
    entry: VisitEntry; rl: any | null;
    blocked: string[];
    deletable: { key: string; label: string; checked: boolean }[];
    isShared: boolean;
  } | null>(null);
  const [step, setStep] = useState<Step>("home");
  const { modal: confirmModal, showConfirm, showDanger, showAlert } = useConfirm();
  const [saving, setSaving] = useState(false);
  const [selectedParty, setSelectedParty] = useState<Party | null>(null);
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
  const [selectedDate, setSelectedDate] = useState(initialDate ?? localDateStr());
  const [isNewParty, setIsNewParty] = useState(false);

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
    const u3 = onSnapshot(collection(db, "allocations_v2"), (snap) =>
      setAllocations(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    );
    const u4 = onSnapshot(collection(db, "payment_transactions"), (snap) =>
      setLivePayments(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    );
    return () => {
      u1();
      u2();
      u3();
      u4();
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

  const [leaveRecords, setLeaveRecords] = useState<LeaveRecord[]>([])
  useEffect(() => {
    if (!appUser) return
    return onSnapshot(
      query(collection(db, 'leave_records'), where('uid', '==', appUser.uid), where('status', '==', 'active')),
      snap => setLeaveRecords(snap.docs.map(d => ({ id: d.id, ...d.data() } as LeaveRecord)))
    )
  }, [appUser?.uid])

  const [holidays, setHolidays] = useState<Holiday[]>([])
  useEffect(() => {
    return onSnapshot(collection(db, 'holidays'), snap => {
      setHolidays(snap.docs.map(d => ({ id: d.id, ...d.data() } as Holiday)))
    })
  }, [])

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
 message:` ${appUser.name} shared ${shareRequestPartyName}'s visit log with you for ${selectedDate}`,
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
  const rawVisits: VisitEntry[] = [...(todayLog?.visits || [])].sort((a, b) => (a.loggedAt || 0) - (b.loggedAt || 0));
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
    setIsNewParty(false);
  };

  // ── EDIT / DELETE helpers ─────────────────────────────────────────────────

  const auditWrite = (action: VisitLogAuditEntry['action'], entry: VisitEntry, detail?: string): VisitLogAuditEntry => ({
    action, by: appUser!.uid, byName: appUser!.name, at: Date.now(),
    partyId: entry.partyId, partyName: entry.partyName, detail,
  });

  const handleDeleteEntry = async (entry: VisitEntry) => {
    if (!todayLog?.id || !appUser) return;
    const rl = entry.isRevisit
      ? todayRevisitLogs.find((r) => r.id === entry.revisitLogId) ?? null
      : null;

    const blocked: string[] = [];
    const deletable: { key: string; label: string; checked: boolean }[] = [];

    for (const action of (rl?.actions || [])) {
      if (action.type === 'new_order') {
        if (action.allocationId) {
          const snap = await getDoc(doc(db, 'allocations_v2', action.allocationId));
          const status = snap.data()?.status;
          if (status && status !== 'pending' && status !== 'cancelled') {
            blocked.push(`New order — allocation already "${status}"`);
          } else if (status === 'pending') {
            deletable.push({ key: 'new_order', label: `Pending allocation for ${action.quantity} pkts will be cancelled`, checked: true });
          }
        } else {
          deletable.push({ key: 'new_order', label: `New order — ${action.quantity} pkts`, checked: true });
        }
      } else if (action.type === 'payment_collection') {
        if (action.transactionId) {
          const snap = await getDoc(doc(db, 'payment_transactions', action.transactionId));
          if (snap.data()?.confirmedAt) {
            blocked.push(`Payment ₹${action.amount?.toLocaleString()} — confirmed by admin`);
          } else {
            deletable.push({ key: 'payment_collection', label: `₹${action.amount?.toLocaleString()} payment will be reversed`, checked: true });
          }
        } else {
          deletable.push({ key: 'payment_collection', label: `₹${action.amount?.toLocaleString()} payment`, checked: true });
        }
      } else if (action.type === 'stock_update') {
        deletable.push({ key: 'stock_update', label: `Stock update · Balance: ${action.balanceQty} pkts`, checked: true });
      } else if (action.type === 'relationship_visit') {
        deletable.push({ key: 'relationship_visit', label: `Relationship visit${action.notes ? ` · "${action.notes}"` : ''}`, checked: true });
      } else if (action.type === 'no_longer_active') {
        deletable.push({ key: 'no_longer_active', label: `No longer active · ${action.reason}`, checked: true });
      } else if (action.type === 'distribute_to_retailers') {
        deletable.push({ key: 'distribute_to_retailers', label: 'Distribution to retailers', checked: true });
      }
    }

    const isShared = (entry.sharedWith || []).some((id) => id !== appUser.uid);

    // No revisit actions at all, or purely simple entry — just show a plain danger confirm
    if (blocked.length === 0 && deletable.length === 0) {
 const ok = await showDanger(`Delete visit to ${entry.partyName}?`, isShared ?'Partner will be notified' : undefined,'Delete');
      if (!ok) return;
      setSaving(true);
      try {
        await _executeDelete(entry, rl, [], false, isShared);
      } finally { setSaving(false); }
      return;
    }

    setDeleteModal({ entry, rl, blocked, deletable, isShared });
  };

  const handleConfirmDelete = async () => {
    if (!deleteModal || !todayLog?.id || !appUser) return;
    const { entry, rl, blocked, deletable, isShared } = deleteModal;
    setDeleteModal(null);

    const checkedKeys = new Set(deletable.filter((d) => d.checked).map((d) => d.key));
    const deleteAlloc = checkedKeys.has('new_order');
    const deletePay = checkedKeys.has('payment_collection');
    const deletableKeys = new Set(deletable.map((d) => d.key));

    // Keep action if: it's blocked (not in deletable list) OR it's deletable but unchecked
    const keepAction = (a: any) => {
 if (!deletableKeys.has(a.type)) return true; // blocked → always keep
 return !checkedKeys.has(a.type);             // deletable → keep if unchecked
    };
    const trueRemaining = (rl?.actions || []).filter((a: any) => keepAction(a));
    const partialDelete = trueRemaining.length > 0;

    setSaving(true);
    try {
      await _executeDelete(entry, rl, trueRemaining, partialDelete, isShared, deleteAlloc, deletePay);
    } finally { setSaving(false); }
  };

  const _executeDelete = async (
    entry: VisitEntry, rl: any, remainingActions: any[], partialDelete: boolean, isShared: boolean,
    deleteAlloc = true, deletePay = true,
  ) => {
    if (!todayLog?.id || !appUser) return;
    if (!partialDelete) {
      const newVisits = (todayLog.visits || []).filter((v) => v.loggedAt !== entry.loggedAt);
      await updateDoc(doc(db, 'visit_logs', todayLog.id), {
        visits: newVisits,
        totalVisited: Math.max(0, (todayLog.totalVisited || 0) - 1),
        ...(entry.outcome === 'interested' && { totalInterested: Math.max(0, (todayLog.totalInterested || 0) - 1) }),
        ...(entry.outcome === 'not_interested' && { totalNotInterested: Math.max(0, (todayLog.totalNotInterested || 0) - 1) }),
        auditLog: arrayUnion(auditWrite('entry_deleted', entry, entry.isRevisit ? 'revisit entry' : entry.outcome)),
        updatedAt: Date.now(),
      });
    } else {
      await updateDoc(doc(db, 'visit_logs', todayLog.id), {
        auditLog: arrayUnion(auditWrite('entry_deleted', entry, 'partial — blocked actions remain')),
        updatedAt: Date.now(),
      });
    }
    if (rl && entry.revisitLogId) {
      if (deleteAlloc) {
        const orderAction = rl.actions?.find((a: any) => a.type === 'new_order');
        if (orderAction?.allocationId) {
          const snap = await getDoc(doc(db, 'allocations_v2', orderAction.allocationId));
          if (snap.exists() && snap.data()?.status === 'pending')
            await updateDoc(doc(db, 'allocations_v2', orderAction.allocationId), { status: 'cancelled' });
        }
      }
      if (deletePay) {
        const payAction = rl.actions?.find((a: any) => a.type === 'payment_collection');
        if (payAction?.transactionId) {
          const txnSnap = await getDoc(doc(db, 'payment_transactions', payAction.transactionId));
          if (txnSnap.exists()) {
            for (const applied of (txnSnap.data()?.appliedTo || [])) {
              const aSnap = await getDoc(doc(db, 'allocations_v2', applied.allocId));
              if (aSnap.exists()) {
                const aData = aSnap.data()!;
                const newPaid = Math.max(0, (aData.paidAmount || 0) - applied.amount);
                await updateDoc(doc(db, 'allocations_v2', applied.allocId), {
                  paidAmount: newPaid,
                  ...(aData.status === 'paid' && { status: 'sent' }),
                });
              }
            }
            await deleteDoc(doc(db, 'payment_transactions', payAction.transactionId));
          }
        }
      }
      if (partialDelete) {
        await updateDoc(doc(db, 'revisit_logs', entry.revisitLogId), { actions: remainingActions, updatedAt: Date.now() });
      } else {
        await deleteDoc(doc(db, 'revisit_logs', entry.revisitLogId));
      }
    }
    if (isShared) {
      const partnerUids = (entry.sharedWith || []).filter((id) => id !== appUser.uid);
      for (const uid of partnerUids) {
        await addDoc(collection(db, 'alerts'), {
          type: 'visit_share_requested',
 message:` ${appUser.name} deleted a shared visit entry for ${entry.partyName} on ${selectedDate}`,
          relatedId: todayLog.id, toUid: uid, read: false, createdAt: Date.now(),
        });
      }
    }
  };

  const handleSaveSimpleEdit = async () => {
    if (!editSimpleEntry || !todayLog?.id || !appUser) return;
    setSaving(true);
    try {
      const editedAt = Date.now();
      const updatedEntry = { ...editSimpleEntry, loggedAt: editedAt };
      const newVisits = (todayLog.visits || []).map((v) =>
        v.loggedAt === editSimpleEntry.loggedAt ? updatedEntry : v,
      );
      const isShared = (updatedEntry.sharedWith || []).some((id) => id !== appUser.uid);
      await updateDoc(doc(db, 'visit_logs', todayLog.id), {
        visits: newVisits,
 auditLog: arrayUnion(auditWrite('entry_edited', updatedEntry,`outcome → ${updatedEntry.outcome}`)),
        updatedAt: Date.now(),
      });
      if (isShared) {
        const partnerUids = (editSimpleEntry.sharedWith || []).filter((id) => id !== appUser.uid);
        for (const uid of partnerUids) {
          await addDoc(collection(db, 'alerts'), {
            type: 'visit_share_requested',
 message:` ${appUser.name} edited a shared visit entry for ${editSimpleEntry.partyName} on ${selectedDate}`,
            relatedId: todayLog.id, toUid: uid, read: false, createdAt: Date.now(),
          });
        }
      }
      setEditSimpleEntry(null);
    } finally {
      setSaving(false);
    }
  };

  // ── REVISIT screen ────────────────────────────────────────────────────────
  const handleRevisitDone = async (revisitLogId: string) => {
    if (!appUser) { resetVisit(); setEditRevisitTarget(null); setStep("home"); return; }

    // Edit mode: update existing visit entry + write audit
    if (editRevisitTarget) {
      const oldEntry = editRevisitTarget.visitEntry;
      if (todayLog?.id) {
        const editedAt = Date.now();
        const newVisits = (todayLog.visits || []).map((v) =>
          v.loggedAt === oldEntry.loggedAt ? { ...v, loggedAt: editedAt } : v,
        );
        await updateDoc(doc(db, 'visit_logs', todayLog.id), {
          visits: newVisits,
          auditLog: arrayUnion(auditWrite('entry_edited', oldEntry, 'revisit updated')),
          updatedAt: Date.now(),
        });
        const isShared = (oldEntry.sharedWith || []).some((id) => id !== appUser.uid);
        if (isShared) {
          for (const uid of (oldEntry.sharedWith || []).filter((id) => id !== appUser.uid)) {
            await addDoc(collection(db, 'alerts'), {
              type: 'visit_share_requested',
 message:` ${appUser.name} edited a shared revisit entry for ${oldEntry.partyName} on ${selectedDate}`,
              relatedId: todayLog.id, toUid: uid, read: false, createdAt: Date.now(),
            });
          }
        }
      }
      resetVisit();
      setEditRevisitTarget(null);
      setStep("home");
      return;
    }

    if (!selectedParty) { resetVisit(); setStep("home"); return; }

    // For new parties, the visit_log entry was already written in handleSaveNewShop.
    // Only write the revisit entry for regular (non-new) revisits.
    if (!isNewParty) {
      const entry: VisitEntry = {
        partyId: selectedParty.id!,
        partyName: selectedParty.name,
        isNew: false,
        isRevisit: true,
        revisitLogId,
        loggedAt: Date.now(),
      };
      try {
        if (todayLog?.id) {
          await updateDoc(doc(db, "visit_logs", todayLog.id), {
            visits: [...(todayLog.visits || []), entry],
            totalVisited: increment(1),
            auditLog: arrayUnion(auditWrite('entry_added', entry, 'revisit')),
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
            updatedAt: Date.now(),
            auditLog: [auditWrite('entry_added', entry, 'revisit')],
          });
        }
      } catch (err) {
        console.error("Failed to log revisit:", err);
      }
    }

    resetVisit();
    setStep("home");
  };

  if (step === "revisit" && (selectedParty || editRevisitTarget)) {
    const party = selectedParty ?? parties.find((p) => p.id === editRevisitTarget?.visitEntry.partyId) ?? null;
    return party ? (
      <RevisitLogger
        party={party}
        logDate={selectedDate}
        onBack={() => { resetVisit(); setEditRevisitTarget(null); setStep("home"); }}
        onDone={handleRevisitDone}
        editMode={editRevisitTarget ? {
          revisitLogId: editRevisitTarget.revisitLog.id,
          existingActions: editRevisitTarget.revisitLog.actions,
          existingNotes: editRevisitTarget.revisitLog.notes || '',
        } : undefined}
      />
    ) : null;
  }

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
      setIsNewParty(true);

      // Log the new party immediately so it shows in My Activity
      const newPartyEntry: VisitEntry = {
        partyId: ref.id,
        partyName: newShop.name.trim(),
        isNew: true,
        isRevisit: false,
        loggedAt: Date.now(),
      };
      if (todayLog?.id) {
        await updateDoc(doc(db, "visit_logs", todayLog.id), {
          visits: [...(todayLog.visits || []), newPartyEntry],
          totalVisited: increment(1),
          updatedAt: Date.now(),
        });
      } else {
        await addDoc(collection(db, "visit_logs"), {
          salesPersonId: appUser!.uid,
          salesPersonName: appUser!.name,
          date: selectedDate,
          visits: [newPartyEntry],
          totalVisited: 1,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          auditLog: [],
        });
      }

      setStep("revisit");
    } finally {
      setSaving(false);
    }
  };

  const handleFinishDay = async () => {
    if (todayLog?.id) {
      const isPastLog = selectedDate !== localDateStr();
      const submitAudit: VisitLogAuditEntry = {
        action: isPastLog ? 'log_edited_after_submit' : 'log_submitted',
        by: appUser!.uid, byName: appUser!.name, at: Date.now(),
        detail: `${visits.length} visit${visits.length !== 1 ? 's' : ''}`,
      };
      await updateDoc(doc(db, "visit_logs", todayLog.id), {
        ...(endNote.trim() && { endOfDayNote: endNote }),
        auditLog: arrayUnion(submitAudit),
        updatedAt: Date.now(),
      });
      const interested = todayLog.totalInterested ?? visits.filter((v) => v.outcome === "interested").length;
      await addDoc(collection(db, "alerts"), {
        type: "visit_log_submitted",
 message:` ${appUser!.name} submitted visit log · ${visits.length} visit${visits.length !== 1 ?"s" :""} · ${interested} interested`,
        relatedId: todayLog.id, read: false, createdAt: Date.now(),
      });
    }
    onBack();
  };

  const statusLabel = (s: string) =>
    s === "active"
      ?"Active"
      : s === "inactive"
        ?"Inactive"
        :"Prospect";

  const partyOptions = parties
    .filter(
      (p) =>
        visitPartyStatus === "all" || (p as any).status === visitPartyStatus,
    )
    .map((p) => ({
      value: p.id!,
 label:`${p.type ==="distributor" ?"" :""} ${p.name}`,
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
  const isSundaySelected = new Date(selectedDate + 'T00:00:00').getDay() === 0
  const isLeaveDay = leaveRecords.some(l => l.date === selectedDate)
  const isHolidayDay = holidays.some(h => h.date === selectedDate)
  const isBlocked = isSundaySelected || isLeaveDay || isHolidayDay

  if (step === "home")
    return (
      <div style={{ minHeight: "100vh", background: t.bg, paddingBottom: 40 }}>
        {confirmModal}

        {/* Delete entry modal */}
        {deleteModal && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 16px' }}>
            <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }} onClick={() => setDeleteModal(null)} />
            <div style={{ position: 'relative', zIndex: 1, background: t.card, borderRadius: 20, padding: '24px 20px', width: '100%', maxWidth: 440, border: `1.5px solid ${t.border}`, boxShadow: '0 24px 64px rgba(0,0,0,0.5)', maxHeight: '90vh', overflowY: 'auto' }}>
              <div style={{ fontSize: 16, fontWeight: 500, color: t.text, marginBottom: 4 }}>Delete visit to {deleteModal.entry.partyName}</div>
              <div style={{ fontSize: 12, color: t.text3, marginBottom: 20 }}>Choose what to remove</div>

              {deleteModal.blocked.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 11, fontWeight: 500, color: t.warn, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Cannot be deleted</div>
                  {deleteModal.blocked.map((r, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', background: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.15)', borderRadius: 10, marginBottom: 6 }}>
                      <span style={{ fontSize: 13 }}></span>
                      <span style={{ fontSize: 13, color: t.warn }}>{r}</span>
                    </div>
                  ))}
                </div>
              )}

              {deleteModal.deletable.length > 0 && (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 11, fontWeight: 500, color: t.text3, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Choose what to delete</div>
                  {deleteModal.deletable.map((item, i) => (
                    <button
                      key={item.key}
                      onClick={() => setDeleteModal((prev) => prev ? {
                        ...prev,
                        deletable: prev.deletable.map((d, j) => j === i ? { ...d, checked: !d.checked } : d),
                      } : prev)}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', background: item.checked ? 'rgba(220,38,38,0.07)' : t.bg3, border: `1.5px solid ${item.checked ? 'rgba(220,38,38,0.3)' : t.border}`, borderRadius: 10, padding: '10px 12px', marginBottom: 6, textAlign: 'left', cursor: 'pointer' }}
                    >
                      <div style={{ width: 18, height: 18, borderRadius: 4, border: `2px solid ${item.checked ? t.warn : t.border}`, background: item.checked ? t.warn : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        {item.checked && <span style={{ color: t.bg, fontSize: 11, fontWeight: 500 }}></span>}
                      </div>
                      <span style={{ fontSize: 13, color: item.checked ? t.warn : t.text2 }}>{item.label}</span>
                    </button>
                  ))}
                </div>
              )}

              {deleteModal.isShared && (
                <div style={{ fontSize: 12, color: t.warn, marginBottom: 16 }}> Partner will be notified</div>
              )}

              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={() => setDeleteModal(null)} style={{ flex: 1, background: t.bg3, border: `1px solid ${t.border}`, borderRadius: 12, padding: '13px', fontSize: 14, fontWeight: 500, color: t.text2 }}>Cancel</button>
                <button
                  onClick={handleConfirmDelete}
                  disabled={saving || deleteModal.deletable.every((d) => !d.checked)}
                  style={{ flex: 2, background: t.text, color: t.bg, border: 'none', borderRadius: 12, padding: '13px', fontSize: 14, fontWeight: 500, opacity: deleteModal.deletable.every((d) => !d.checked) ? 0.4 : 1 }}
                >
                  {saving ?'Deleting...' : deleteModal.blocked.length > 0 ?'Remove selected' :'Delete'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Simple entry edit modal */}
        {editSimpleEntry && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
            <div style={{ background: t.card, borderRadius: '20px 20px 0 0', padding: '20px 16px 32px', maxHeight: '85vh', overflowY: 'auto' }}>
              <div style={{ fontWeight: 500, fontSize: 16, color: t.text, marginBottom: 4 }}>Edit Visit — {editSimpleEntry.partyName}</div>
              {selectedDate !== localDateStr() && (
                <div style={{ fontSize: 12, color: t.warn, marginBottom: 12 }}> Editing past log — {selectedDate}</div>
              )}
              <div style={{ fontSize: 13, color: t.text3, marginBottom: 14 }}>Outcome</div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                {(['interested', 'not_interested', 'follow_up'] as VisitOutcome[]).map((o) => (
                  <button key={o} onClick={() => setEditSimpleEntry({ ...editSimpleEntry, outcome: o })}
                    style={{ flex: 1, padding: '10px 4px', borderRadius: 10, fontSize: 12, fontWeight: 500,
                      background: editSimpleEntry.outcome === o ? 'rgba(22,163,74,0.15)' : t.bg3,
                      color: editSimpleEntry.outcome === o ? t.text2 : t.text2,
                      border: `1px solid ${editSimpleEntry.outcome === o ? 'rgba(22,163,74,0.3)' : t.border}` }}>
                    {o ==='interested' ?'Interested' : o ==='not_interested' ?'Not Int.' :'Follow Up'}
                  </button>
                ))}
              </div>
              {editSimpleEntry.outcome === 'not_interested' && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 13, color: t.text3, marginBottom: 8 }}>Reason</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {NOT_INTERESTED_REASONS.map((r) => (
                      <button key={r} onClick={() => setEditSimpleEntry({ ...editSimpleEntry, notInterestedReason: r as NotInterestedReason })}
                        style={{ padding: '6px 12px', borderRadius: 20, fontSize: 12, fontWeight: 500,
                          background: editSimpleEntry.notInterestedReason === r ? 'rgba(220,38,38,0.15)' : t.bg3,
                          color: editSimpleEntry.notInterestedReason === r ? t.warn : t.text2,
                          border: `1px solid ${editSimpleEntry.notInterestedReason === r ? 'rgba(220,38,38,0.3)' : t.border}` }}>
                        {r}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button onClick={() => setEditSimpleEntry(null)}
                  style={{ flex: 1, padding: '12px', borderRadius: 12, background: t.bg3, color: t.text2, border: `1px solid ${t.border}`, fontSize: 14, fontWeight: 500 }}>
                  Cancel
                </button>
                <button onClick={handleSaveSimpleEdit} disabled={saving}
                  style={{ flex: 2, padding: '12px', borderRadius: 12, background: t.text, color: t.bg, border: 'none', fontSize: 14, fontWeight: 500 }}>
                  {saving ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        )}

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
                  fontWeight: 500,
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
                    label: "Orders",
                    val: todayRevisitLogs.filter((rl) => rl.actions?.some((a: any) => a.type === "new_order")).length,
                    color: t.text2,
                    bg: "rgba(22,163,74,0.1)",
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
                      style={{ fontSize: 22, fontWeight: 500, color: s.color }}
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
                    fontWeight: 500,
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
                    background: t.text,
                    color: t.bg,
                    border: "none",
                    borderRadius: 14,
                    padding: "14px",
                    fontSize: 15,
                    fontWeight: 500,
                  }}
                >
 Done 
                </button>
              </div>
            </div>
          </div>
        )}

        <PageHeader
          eyebrow="Visit log"
          title={new Date(selectedDate + "T00:00:00").toLocaleDateString("en-IN", {
            weekday: "long", day: "numeric", month: "long",
          })}
          subtitle={
            new Date(selectedDate + "T00:00:00").getDay() === 0
              ? "Sunday is a day off"
              : undefined
          }
          onBack={onBack}
          right={
            <div style={{ width: 150 }}>
              <DateInput
                type="date"
                value={selectedDate}
                max={localDateStr()}
                onChange={(v) => { if (v <= localDateStr()) setSelectedDate(v); }}
              />
            </div>
          }
        />

        <div style={{ padding: "20px 20px 0" }}>
          <StatGrid>
            <StatCard value={visits.length} label="Outlets visited" />
            <StatCard
              value={todayRevisitLogs.filter((rl) => rl.actions?.some((a: any) => a.type === "new_order")).length}
              label="Orders booked"
            />
          </StatGrid>
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
            onClick={() => !isBlocked && setStep("selectShop")}
            disabled={isBlocked}
            style={{
              background: isBlocked ? t.tint : t.text,
              color: isBlocked ? t.text3 : t.bg,
              border: isBlocked ? `0.5px solid ${t.border}` : "none",
              borderRadius: 16,
              padding: "18px 20px",
              display: "flex",
              alignItems: "center",
              gap: 14,
              boxShadow: isBlocked ? 'none' : "0 8px 24px rgba(13,61,46,0.3)",
              cursor: isBlocked ? 'not-allowed' : 'pointer',
              opacity: isBlocked ? 0.5 : 1,
            }}
          >
            <span style={{ fontSize: 28 }}></span>
            <div style={{ textAlign: "left" }}>
              <div style={{ fontWeight: 500, fontSize: 17 }}>Log a Visit</div>
              <div style={{ fontSize: 14, color: isHolidayDay ? t.text2 : isLeaveDay ? t.warn : isSundaySelected ? t.text3 : t.text3, marginTop: 2 }}>
                {isSundaySelected ? 'Disabled on Sundays' : isLeaveDay ? "You're on leave today" : isHolidayDay ? "Public holiday" : 'Distributor or Retailer visit'}
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
              <div style={{ fontSize: 13, fontWeight: 500, color: t.text2 }}>
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
                        style={{ fontSize: 13, fontWeight: 500, color: t.text }}
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
                          background: t.text,
                          border: "none",
                          borderRadius: 12,
                          padding: "8px 12px",
                          color: t.bg,
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
                    <div style={{ fontSize: 18, fontWeight: 500, color: t.text }}>
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
                            background: unavailable ? t.tint : selected ? t.text2 : t.bg3,
                            color: unavailable ? t.text3 : selected ? t.bg : t.text,
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
                              <span style={{ fontSize: 11, color: t.text2 }}> Already shared</span>
                            )}
                            {hasPendingForUser && (
                              <span style={{ fontSize: 11, color: t.warn }}> Awaiting response</span>
                            )}
                          </span>
                          {selected && !unavailable && (
                            <span style={{ fontSize: 12, opacity: 0.85 }}></span>
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
                      : t.text,
                    color: isConfirmShareDisabled ? t.text2 : t.bg,
                    border: "none",
                    borderRadius: 14,
                    padding: "14px",
                    fontSize: 14,
                    fontWeight: 500,
                    cursor: isConfirmShareDisabled ? "not-allowed" : "pointer",
                  }}
                >
                  Confirm share
                </button>
              </div>
            </div>
          )}

          {/* Past log warning */}
          {selectedDate !== localDateStr() && visits.length > 0 && (
            <div style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: 12, padding: '10px 14px', fontSize: 13, color: t.warn, fontWeight: 500 }}>
 Editing past log — {selectedDate}. All changes are tracked.
            </div>
          )}

          {/* Log visit button */}
          {visits.length > 0 && (
            <>
              <div
                style={{
                  fontSize: 13,
                  color: t.text2,
                  fontWeight: 500,
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

                const renderEntries = (entries: VisitEntry[], canEdit = true) =>
                  entries.map((v, vi) => {
                    const isNew = !!(v as any).isNew
                    const rl = v.revisitLogId
                      ? todayRevisitLogs.find((r) => r.id === v.revisitLogId)
                      : todayRevisitLogs.find((r) => r.partyId === v.partyId);
                    const timeStr = v.loggedAt
                      ? new Date(v.loggedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
                      : "";
                    const actions: any[] = (v.isRevisit || isNew) && rl?.actions ? rl.actions : [];
                    return (
                      <div
                        key={vi}
                        style={{
                          paddingLeft: 10,
                          borderLeft: `2px solid ${isNew ? "rgba(99,102,241,0.4)" : t.border}`,
                          marginBottom: vi < entries.length - 1 ? 10 : 0,
                          paddingBottom: vi < entries.length - 1 ? 8 : 0,
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                          {isNew && <span style={{ fontSize: 10, fontWeight: 500, color: t.text2, background: 'rgba(99,102,241,0.12)', padding: '2px 7px', borderRadius: 99, letterSpacing: 1 }}>NEW</span>}
                          {timeStr && <span style={{ fontSize: 11, color: t.text3, fontWeight: 500 }}>{timeStr}</span>}
                          {canEdit && (
                            <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                              {!isNew && (
                                <button
                                  onClick={() => {
                                    if (v.isRevisit && rl) {
                                      setEditRevisitTarget({ revisitLog: rl, visitEntry: v });
                                      setSelectedParty(null);
                                      setStep('revisit');
                                    } else {
                                      setEditSimpleEntry({ ...v });
                                    }
                                  }}
                                  style={{ fontSize: 13, background: t.tint, border: `1px solid ${t.border}`, borderRadius: 6, padding: '2px 7px', color: t.text3, cursor: 'pointer' }}
                                ></button>
                              )}
                              <button
                                onClick={() => handleDeleteEntry(v)}
                                style={{ fontSize: 13, background: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.15)', borderRadius: 6, padding: '2px 7px', color: t.warn, cursor: 'pointer' }}
                              ></button>
                            </div>
                          )}
                        </div>
                        {(v.isRevisit || isNew) && rl?.actions?.map((action: any, ai: number) => {
                          const liveAlloc = action.allocationId ? allocations.find((a: any) => a.id === action.allocationId) : null;
                          const livePay = action.transactionId ? livePayments.find((p: any) => p.id === action.transactionId) : null;
                          const displayQty = liveAlloc?.packets ?? action.quantity;
                          const displayAmt = livePay?.amount ?? action.amount;
                          const label =
 action.type ==="stock_update" ?`Stock Updated · Balance: ${action.balanceQty} pkts`
                            : action.type ==="new_order" ?`New Order · ${displayQty} ${action.productName}`
                            : action.type ==="payment_collection" ?`Payment ₹${displayAmt?.toLocaleString()}`
                            : action.type ==="relationship_visit" ?`Relationship Visit${action.notes ?` · ${action.notes}` :""}`
                            : action.type ==="no_longer_active" ?`No Longer Active · ${action.reason}`
                            : null;
                          if (!label) return null;
                          const isOrder = action.type === "new_order" && !!action.allocationId && !!onViewAllocation;
                          const isPayment = action.type === "payment_collection" && !!action.transactionId && !!onViewPayment;
                          const isTappable = isOrder || isPayment;
                          return (
                            <div
                              key={ai}
                              onClick={isOrder ? () => onViewAllocation!(action.allocationId) : isPayment ? () => onViewPayment!(rl!.partyId, action.transactionId) : undefined}
                              style={{ fontSize: 13, color: isTappable ? t.text2 : t.text2, marginBottom: 2, display: "flex", alignItems: "center", gap: 4, cursor: isTappable ? "pointer" : "default" }}
                            >
                              {label}
                              {isTappable && <span style={{ fontSize: 11, color: t.text2 }}>↗</span>}
                            </div>
                          );
                        })}
                        {!v.isRevisit && !isNew && v.outcome === "interested" && v.productName && (
                          <div style={{ fontSize: 13, color: t.text2 }}>{v.productName} — allocation created</div>
                        )}
                        {!v.isRevisit && !isNew && v.outcome === "not_interested" && (
                          <div style={{ fontSize: 13, color: t.warn }}>{v.notInterestedReason}</div>
                        )}
                        {!v.isRevisit && !isNew && v.outcome === "follow_up" && (
                          <div style={{ fontSize: 13, color: t.warn }}>Follow up needed</div>
                        )}
                      </div>
                    );
                  });

                return renderGroups.map(({ partyId, entries, groupType }) => {
                  // Hide new-party groups with no actions — they appear in My Activity only
                  const allNew = entries.every(e => (e as any).isNew)
                  const hasRevisitLog = todayRevisitLogs.some(rl => rl.partyId === partyId && rl.actions?.length > 0)
                  if (allNew && !hasRevisitLog) return null

                  const vParty = parties.find((p) => p.id === partyId);
 const typeLabel = vParty?.type ==="distributor" ?"Distributor" :"Retailer";
                  const hasOrder = entries.some((v) => {
                    const rl = v.revisitLogId ? todayRevisitLogs.find((r) => r.id === v.revisitLogId) : null;
                    return rl?.actions?.some((a: any) => a.type === "new_order");
                  });
                  const borderColor = groupType === 'new_after_share'
                    ? "rgba(245,158,11,0.2)"
                    : hasOrder ? "rgba(22,163,74,0.25)"
                    : "rgba(99,102,241,0.15)";

                  // ── Shared card ──
                  if (groupType === 'shared') {
                    const sharedWithNames = Array.from(new Set(entries.flatMap((v) => v.sharedWith || [])))
                      .filter((id) => id !== appUser?.uid)
                      .map((id) => salesUsers.find((u) => u.uid === id)?.name || id);
                    return (
                      <div key={`${partyId}_shared`} style={{ background: t.card, borderRadius: 14, padding: "14px 16px", border: `1px solid ${borderColor}` }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, gap: 10 }}>
                          <div>
                            <div style={{ fontWeight: 500, fontSize: 15, color: t.text }}>{entries[0].partyName}</div>
                            <div style={{ fontSize: 11, color: t.text3, marginTop: 1 }}>{typeLabel}</div>
                            {sharedWithNames.length > 0 && (
                              <div style={{ fontSize: 12, color: t.text2, marginTop: 4 }}>
                                Shared with {sharedWithNames.join(", ")}
                              </div>
                            )}
                          </div>
                          {entries.length > 1 && (
                            <span style={{ fontSize: 11, color: t.text3, fontWeight: 500 }}>{entries.length} visits</span>
                          )}
                        </div>
                        {renderEntries(entries, true)}
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
                          <div style={{ fontWeight: 500, fontSize: 15, color: t.text }}>{entries[0].partyName}</div>
                          <div style={{ fontSize: 11, color: t.text3, marginTop: 1 }}>{typeLabel}</div>
                          {groupType === 'new_after_share' && (
                            <div style={{ fontSize: 11, color: t.warn, marginTop: 3 }}>New log after share</div>
                          )}
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                          {appUser?.uid === todayLog?.salesPersonId && (
                            pendingFor.length > 0 ? (
                              <span style={{ fontSize: 12, background: "rgba(245,158,11,0.1)", color: t.warn, border: "1px solid rgba(245,158,11,0.25)", borderRadius: 12, padding: "8px 10px", fontWeight: 500 }}>
 Awaiting {pendingFor.map((r) => r.toName?.split("")[0] || r.toName).join(",")}
                              </span>
                            ) : (
                              <>
                                <button
                                  onClick={() => openSharePanel(partyId, entries[0].partyName)}
                                  style={{ fontSize: 12, background: "rgba(14,165,233,0.1)", color: t.text2, border: "1px solid rgba(14,165,233,0.25)", borderRadius: 12, padding: "8px 10px" }}
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
                            <span style={{ fontSize: 11, color: t.text3, fontWeight: 500 }}>{entries.length} visits</span>
                          )}
                        </div>
                      </div>
                      {renderEntries(entries)}
                      {vParty && ((vParty as any).status === "active" || entries.some(e => (e as any).isNew)) && (
                        <button
                          onClick={() => { setSelectedParty(vParty); setStep("revisit"); }}
                          style={{ marginTop: 10, width: "100%", background: entries.some(e => (e as any).isNew) ? "rgba(99,102,241,0.07)" : "rgba(22,163,74,0.07)", border: `1px dashed ${entries.some(e => (e as any).isNew) ? "rgba(99,102,241,0.35)" : "rgba(22,163,74,0.35)"}`, borderRadius: 10, padding: "9px 14px", fontSize: 13, fontWeight: 500, color: entries.some(e => (e as any).isNew) ? t.text2 : t.text2, cursor: "pointer" }}
                        >
                          {entries.some(e => (e as any).isNew) ? "+ Log Actions for New Party" : "+ Add More Log"}
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
                fontWeight: 500,
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
              disabled={isBlocked}
              style={{
                width: "100%",
                background: t.bg3,
                border: `1px solid ${t.border}`,
                borderRadius: 10,
                padding: "12px 14px",
                fontSize: 14,
                color: isBlocked ? t.text3 : t.text,
                outline: "none",
                resize: "none",
                boxSizing: "border-box",
                cursor: isBlocked ? 'not-allowed' : 'auto',
                opacity: isBlocked ? 0.5 : 1,
              }}
            />
          </div>

          {/* Submit / update day log */}
          <button
            disabled={isSundaySelected && visits.length > 0}
            onClick={() =>
              !isSundaySelected && (visits.length > 0 ? setShowFinishModal(true) : handleFinishDay())
            }
            style={{
              width: "100%",
              background: isSundaySelected
                ? t.bg3
                : visits.length > 0
                  ? t.text
                  : t.bg3,
              color: isSundaySelected ? t.text3 : visits.length > 0 ? t.bg : t.text2,
              border: isSundaySelected || visits.length === 0 ? `1.5px solid ${t.border}` : "none",
              borderRadius: 16,
              padding: "18px",
              fontSize: 17,
              fontWeight: 500,
              cursor: isSundaySelected && visits.length > 0 ? 'not-allowed' : 'pointer',
              opacity: isSundaySelected && visits.length > 0 ? 0.5 : 1,
              boxShadow: !isSundaySelected && visits.length > 0 ? "0 8px 24px rgba(4,120,87,0.35)" : "none",
            }}
          >
            {visits.length === 0
              ?"← Back to Dashboard"
              : todayLog?.updatedAt && todayLog.updatedAt !== todayLog.createdAt
                ?`Update Entry — ${visits.length} visit${visits.length > 1 ?"s" :""}`
                :`Submit Day Log — ${visits.length} visit${visits.length > 1 ?"s" :""}`}
          </button>
        </div>
      </div>
    );

  // ── SELECT PARTY ─────────────────────────────────────────────────────────
  if (step === "selectShop")
    return (
      <div style={{ minHeight: "100vh", background: t.bg, paddingBottom: 40 }}>
        <PageHeader
          eyebrow="Visit log"
          title="Pick who you visited"
          subtitle="An active party opens a revisit. A prospect asks you for the outcome."
          onBack={() => setStep("home")}
        />

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
                { val:"active", label:"Active" },
                { val:"prospect", label:"Prospect" },
                { val:"inactive", label:"Inactive" },
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
                        ? t.text2
                        : s.val === "prospect"
                          ? t.warn
                          : s.val === "inactive"
                            ? t.warn
                            : t.text2
                      : t.text2,
                  border: `1px solid ${visitPartyStatus === s.val ? (s.val === "active" ? t.text2 : s.val === "prospect" ? t.warn : s.val === "inactive" ? t.warn : t.text2) : t.border}`,
                  borderRadius: 20,
                  padding: "6px 14px",
                  fontSize: 13,
                  fontWeight: 500,
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
              setStep("revisit");
            }}
 placeholder="Search by name, place, area..."
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
                        <div>
              <div style={{ fontWeight: 500, fontSize: 16 }}>Add New Party</div>
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
        <PageHeader
          eyebrow="Visit log"
          title="Add a new party"
          subtitle="They start as a prospect until they place an order."
          onBack={() => setStep("selectShop")}
        />
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
                  color: newShop.type === tp ? t.text2 : t.text2,
                  border: `1.5px solid ${newShop.type === tp ? t.text2 : t.border2}`,
                  borderRadius: 12,
                  padding: "13px",
                  fontSize: 15,
                  fontWeight: 500,
                }}
              >
                {tp ==="distributor" ?"Distributor" :"Retailer"}
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
                    { value:"", label:"Independent retailer" },
                    ...parties
                      .filter((p) => p.type === "distributor")
                      .map((d) => ({ value: d.id!, label:` ${d.name}` })),
                  ]}
                />
                {newShop.underDistributorId && (
                  <div style={{ fontSize: 11, color: t.warn, marginTop: 6 }}>
 Allocation will be blocked — must go through the
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
                background: t.tint,
                border: `0.5px dashed ${t.border2}`,
                borderRadius: 12,
                padding: "12px 16px",
                fontSize: 13,
                color: t.text3,
                fontWeight: 500,
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
                  ? t.text3
                  : t.text,
              color: t.bg,
              border: "none",
              borderRadius: 14,
              padding: 17,
              fontSize: 16,
              fontWeight: 500,
            }}
          >
            {saving ?"Saving..." :"Add & Continue →"}
          </button>
        </div>
      </div>
    );

  return null;
}
