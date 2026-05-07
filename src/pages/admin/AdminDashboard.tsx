import { useState, useEffect } from "react";
import DateInput from "../../components/DateInput";
import {
  collection,
  onSnapshot,
  addDoc,
  doc,
  updateDoc,
} from "firebase/firestore";
import { db } from "../../firebase";
import { usePostStatuses } from "../../hooks/useFirebase";
import {
  MAY_POSTS,

  PILLAR_COLORS,
  STATUS_CONFIG,
} from "../../data";
import { CheckIn, AppUser, Party, LeaveRecord } from "../../types";
import StockManager from "../stock/StockManager";
import WorkspaceDashboard from "../workspace/WorkspaceDashboard";
import PartyManager from "../distributors/PartyManager";
import CreditBook from "../credit/CreditBook";
import ExpenseLogger from "../stock/ExpenseLogger";
import AllocationManager from "../distributors/AllocationManager";
import ProductManager from "../products/ProductManager";
import LeaveTracker from "../sales/LeaveTracker";
import CustomSelect from "../../components/CustomSelect";
import { useTheme } from "../../context/ThemeContext";
import { useAuth } from "../../context/AuthContext";
import { useConfirm } from "../../hooks/useConfirm";
import { localDateStr, localMonthStr } from "../../utils/date";

const MONTH = "2026-05";

type MainTab = "overview" | "sales" | "marketing" | "workspace";
type SalesTab = "offline" | "online";
type MarketingTab = "offline" | "online";
type SubScreen =
  | "dashboard"
  | "stock"
  | "parties"
  | "credits"
  | "expenses"
  | "allocations"
  | "products"
  | "leaves";

export default function AdminDashboard() {
  const { t, theme } = useTheme();
  const { appUser } = useAuth();
  const { modal: adminLeaveModal, showConfirm: showAdminLeaveConfirm } =
    useConfirm();
  const [subScreen, setSubScreen] = useState<SubScreen>("dashboard");
  const [allocations, setAllocations] = useState<any[]>([]);
  const [visitLogs, setVisitLogs] = useState<any[]>([]);
  const [revisitLogs, setRevisitLogs] = useState<any[]>([]);
  const [pendingPayments, setPendingPayments] = useState<any[]>([]);
  const [leaveRecords, setLeaveRecords] = useState<LeaveRecord[]>([]);
  const [parties, setParties] = useState<Party[]>([]);
  const [mainTab, setMainTab] = useState<MainTab>("overview");
  const [salesTab, setSalesTab] = useState<SalesTab>("offline");
  const [marketingTab, setMarketingTab] = useState<MarketingTab>("offline");
  const { statuses } = usePostStatuses(MONTH);

  // Sales filters
  const [salesUsers, setSalesUsers] = useState<AppUser[]>([]);
  const [selectedUser, setSelectedUser] = useState<string>("all");
  const [dateMode, setDateMode] = useState<"day" | "month" | "period">("day");
  const [expandedAllocPerson, setExpandedAllocPerson] = useState<string | null>(
    null,
  );
  const [visitPartyType, setVisitPartyType] = useState<
    "all" | "distributor" | "retailer"
  >("all");
  const [visitDistSub, setVisitDistSub] = useState<string>("all");
  const [visitPartyStatus, setVisitPartyStatus] = useState<
    "all" | "active" | "inactive" | "prospect"
  >("all");
  const [dateDay, setDateDay] = useState(localDateStr());
  const [dateMonth, setDateMonth] = useState(localMonthStr());
  const [datePeriodFrom, setDatePeriodFrom] = useState(localDateStr());
  const [datePeriodTo, setDatePeriodTo] = useState(localDateStr());
  const [allCheckIns, setAllCheckIns] = useState<CheckIn[]>([]);

  useEffect(() => {
    const u0 = onSnapshot(collection(db, "parties"), (snap) => {
      setParties(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Party));
    });
    const u3 = onSnapshot(collection(db, "allocations_v2"), (snap) => {
      setAllocations(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    const u4 = onSnapshot(collection(db, "visit_logs"), (snap) => {
      setVisitLogs(
        snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a: any, b: any) => b.createdAt - a.createdAt),
      );
    });
    const u5 = onSnapshot(collection(db, "revisit_logs"), (snap) => {
      const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as any);
      setRevisitLogs(all);
      const pending: any[] = [];
      all.forEach((log) => {
        log.actions?.forEach((action: any) => {
          if (
            action.type === "payment_collection" &&
            action.status === "pending_approval"
          ) {
            pending.push({
              ...action,
              logId: log.id,
              partyName: log.partyName,
              salesPersonName: log.salesPersonName,
              date: log.date,
            });
          }
        });
      });
      setPendingPayments(pending);
    });
    const u6 = onSnapshot(collection(db, "leave_records"), (snap) => {
      setLeaveRecords(
        snap.docs.map((d) => ({ id: d.id, ...d.data() }) as LeaveRecord),
      );
    });
    return () => {
      u0();
      u3();
      u4();
      u5();
      u6();
    };
  }, []);

  useEffect(() => {
    // Fetch offline sales users
    const unsub = onSnapshot(collection(db, "users"), (snap) => {
      setSalesUsers(
        snap.docs
          .map((d) => ({ uid: d.id, ...d.data() }) as AppUser)
          .filter(
            (u) =>
              u.status === "approved" &&
              (u.role === "offline_sales" || u.role === "online_sales"),
          ),
      );
    });
    return unsub;
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "checkins"), (snap) => {
      setAllCheckIns(
        snap.docs
          .map((d) => ({ id: d.id, ...d.data() }) as CheckIn)
          .sort((a, b) => b.createdAt - a.createdAt),
      );
    });
    return unsub;
  }, []);

  // Filter check-ins
  const filteredCheckIns = allCheckIns.filter((ci) => {
    if (selectedUser !== "all" && ci.name !== selectedUser) return false;
    if (dateMode === "day") return ci.date === dateDay;
    if (dateMode === "month") return ci.date.startsWith(dateMonth);
    if (dateMode === "period")
      return ci.date >= datePeriodFrom && ci.date <= datePeriodTo;
    return true;
  });

  // Filter visit logs by date/user
  const filteredVisitLogs = visitLogs.filter((log: any) => {
    if (selectedUser !== "all" && log.salesPersonName !== selectedUser)
      return false;
    if (dateMode === "day") return log.date === dateDay;
    if (dateMode === "month") return log.date?.startsWith(dateMonth);
    if (dateMode === "period")
      return log.date >= datePeriodFrom && log.date <= datePeriodTo;
    return true;
  });

  // Party lookup map for visit-level filtering
  const partyMap = new Map(parties.map((p) => [p.id!, p]));
  const distributorList = parties.filter((p) => p.type === "distributor");

  const visitMatchesPartyFilter = (v: any): boolean => {
    if (visitPartyType === "all" && visitPartyStatus === "all") return true;
    const party = partyMap.get(v.partyId) as any;
    if (visitPartyType !== "all" && party?.type !== visitPartyType)
      return false;
    if (visitPartyType === "retailer" && visitDistSub !== "all") {
      const underDistId = party?.underDistributorId;
      if (visitDistSub === "independent" && underDistId) return false;
      if (visitDistSub !== "independent" && underDistId !== visitDistSub)
        return false;
    }
    if (visitPartyStatus !== "all" && party?.status !== visitPartyStatus)
      return false;
    return true;
  };

  // Full day leave cards — always take priority over visit logs
  const fullDayLeaveCards = leaveRecords.filter((l) => {
    if (
      l.leaveType !== "full_day" ||
      l.status === "removed" ||
      l.status === "rejected"
    )
      return false;
    const uName = salesUsers.find((u) => u.uid === l.uid)?.name;
    if (selectedUser !== "all" && uName !== selectedUser) return false;
    if (dateMode === "day") return l.date === dateDay;
    if (dateMode === "month") return l.date.startsWith(dateMonth);
    if (dateMode === "period")
      return l.date >= datePeriodFrom && l.date <= datePeriodTo;
    return true;
  });

  const fullDayLeaveUidDates = new Set(
    fullDayLeaveCards.map((l) => `${l.uid}|${l.date}`),
  );

  const filteredLogsWithVisits = filteredVisitLogs
    .filter(
      (log: any) =>
        !fullDayLeaveUidDates.has(`${log.salesPersonId}|${log.date}`),
    )
    .map((log: any) => ({
      ...log,
      _fv: (log.visits || []).filter(visitMatchesPartyFilter),
    }))
    .filter((log: any) => log._fv.length > 0);

  const allFV: any[] = filteredLogsWithVisits.flatMap((l: any) => l._fv);
  const fvInterested = allFV.filter((v) => v.outcome === "interested").length;
  const fvDistCount = new Set(
    allFV
      .filter((v) => partyMap.get(v.partyId)?.type === "distributor")
      .map((v) => v.partyId),
  ).size;
  const fvRetailCount = new Set(
    allFV
      .filter((v) => partyMap.get(v.partyId)?.type === "retailer")
      .map((v) => v.partyId),
  ).size;

  const todayStr = localDateStr();

  // Marketing stats
  const done = MAY_POSTS.filter((p) => statuses[p.id] === "posted").length;
  const missed = MAY_POSTS.filter((p) => statuses[p.id] === "missed").length;
  const pct = Math.round((done / MAY_POSTS.length) * 100);
  const weekStats = [1, 2, 3, 4].map((w) => {
    const wp = MAY_POSTS.filter((p) => p.week === w);
    return {
      week: w,
      total: wp.length,
      done: wp.filter((p) => statuses[p.id] === "posted").length,
      missed: wp.filter((p) => statuses[p.id] === "missed").length,
    };
  });

  if (subScreen === "stock")
    return <StockManager onBack={() => setSubScreen("dashboard")} />;
  if (subScreen === "allocations")
    return (
      <AllocationManager
        onBack={() => setSubScreen("dashboard")}
        parties={parties}
        isAdmin
      />
    );
  if (subScreen === "products")
    return <ProductManager onBack={() => setSubScreen("dashboard")} />;
  if (subScreen === "parties")
    return <PartyManager onBack={() => setSubScreen("dashboard")} />;
  if (subScreen === "credits")
    return <CreditBook onBack={() => setSubScreen("dashboard")} />;
  if (subScreen === "expenses")
    return <ExpenseLogger onBack={() => setSubScreen("dashboard")} />;
  if (subScreen === "leaves")
    return <LeaveTracker onBack={() => setSubScreen("dashboard")} />;

  const handleAdminMarkLeave = async (
    uid: string,
    name: string,
    role: string,
    date: string,
    type: "full_day" | "half_day",
  ) => {
    const existing = leaveRecords.find(
      (l) =>
        l.uid === uid &&
        l.date === date &&
        l.status !== "removed" &&
        l.status !== "rejected",
    );
    if (existing) {
      await showAdminLeaveConfirm(
        "Already on leave",
        "This person already has a leave record for this date.",
      );
      return;
    }
    const confirmed = await showAdminLeaveConfirm(
      `Mark ${type === "full_day" ? "Full Day" : "Half Day"} Leave?`,
      `${name} on ${date}`,
    );
    if (!confirmed) return;
    await addDoc(collection(db, "leave_records"), {
      uid,
      name,
      role,
      date,
      leaveType: type,
      markedAt: Date.now(),
      markedBy: appUser!.uid,
      markedByName: appUser!.name,
      status: "active",
      auditLog: [
        {
          action: "admin_marked",
          by: appUser!.uid,
          byName: appUser!.name,
          at: Date.now(),
        },
      ],
    });
  };

  const onLeaveTodayCount = leaveRecords.filter(
    (l) => l.date === todayStr && l.status === "active",
  ).length;
  const pendingLeaveCount = leaveRecords.filter(
    (l) => l.status === "pending_approval",
  ).length;

  const quickLinks = [
    {
      label: "Stock",
      sub: "Manage inventory",
      screen: "stock" as SubScreen,
      color: "#16a34a",
    },
    {
      label: "Distributors/Retailers",
      sub: "View & manage network",
      screen: "parties" as SubScreen,
      color: "#0891b2",
    },
    {
      label: "Allocations",
      sub: "Stock sending events",
      screen: "allocations" as SubScreen,
      color: "#d97706",
    },
    {
      label: "Products",
      sub: "Add & manage products",
      screen: "products" as SubScreen,
      color: "#7c3aed",
    },
    {
      label: "Credit Book",
      sub: "Outstanding payments",
      screen: "credits" as SubScreen,
      color: "#8b5cf6",
    },
    {
      label: "Expenses",
      sub: "Team expenses log",
      screen: "expenses" as SubScreen,
      color: "#dc2626",
    },
    {
      label: "Leave Tracker",
      sub:
        pendingLeaveCount > 0
          ? `${pendingLeaveCount} pending approval`
          : onLeaveTodayCount > 0
            ? `${onLeaveTodayCount} on leave today`
            : "Sales team attendance",
      screen: "leaves" as SubScreen,
      color: "#0f766e",
      badge:
        pendingLeaveCount > 0
          ? String(pendingLeaveCount)
          : onLeaveTodayCount > 0
            ? String(onLeaveTodayCount)
            : undefined,
    },
  ];

  return (
    <div style={{ minHeight: "100vh", background: t.bg }}>
      {/* Header */}
      <div
        style={{
          background: "#000000",
          padding: "16px 20px 0",
        }}
      >
        <div
          style={{
            color: "rgba(255,255,255,0.45)",
            fontSize: 13,
            letterSpacing: 3,
            textTransform: "uppercase",
            marginBottom: 2,
          }}
        >
          Founders
        </div>
        <div style={{ fontSize: 20, fontWeight: 900, marginBottom: 14, color: "#ffffff" }}>
          Admin Dashboard
        </div>
        <div style={{ display: "flex", gap: 0, overflowX: "auto" }}>
          {(
            [
              { id: "overview", label: "Overview" },
              { id: "sales", label: "Sales" },
              { id: "marketing", label: "Marketing" },
              { id: "workspace", label: "Workspace" },
            ] as { id: MainTab; label: string }[]
          ).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setMainTab(tab.id)}
              style={{
                flex: "1 0 auto",
                background:
                  mainTab === tab.id ? "rgba(255,255,255,0.12)" : "transparent",
                color: mainTab === tab.id ? "#fff" : "rgba(255,255,255,0.45)",
                border: "none",
                borderRadius: "12px 12px 0 0",
                padding: "10px 12px",
                fontSize: 13,
                fontWeight: 800,
                whiteSpace: "nowrap",
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div
        style={{
          padding: "14px 14px",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        {/* ── WORKSPACE ── */}
        {mainTab === "workspace" && <WorkspaceDashboard />}

        {/* ── OVERVIEW ────────────────────────────────────────────────────── */}
        {mainTab === "overview" && (
          <div
            className="fade-in"
            style={{ display: "flex", flexDirection: "column", gap: 12 }}
          >
            {/* Quick links */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 10,
              }}
            >
              {quickLinks.map((q) => (
                <button
                  key={q.screen}
                  onClick={() => setSubScreen(q.screen)}
                  style={{
                    background: t.card,
                    border: `1px solid ${(q as any).badge ? q.color + "55" : q.color + "33"}`,
                    borderRadius: 14,
                    padding: 14,
                    textAlign: "left",
                    color: t.text,
                    position: "relative",
                  }}
                >
                  {(q as any).badge && (
                    <div
                      style={{
                        position: "absolute",
                        top: 10,
                        right: 10,
                        background: q.color,
                        color: "#fff",
                        fontSize: 10,
                        fontWeight: 900,
                        width: 18,
                        height: 18,
                        borderRadius: "50%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      {(q as any).badge}
                    </div>
                  )}
                  <div
                    style={{ fontWeight: 800, fontSize: 13, color: q.color }}
                  >
                    {q.label}
                  </div>
                  <div style={{ fontSize: 12, color: t.text3, marginTop: 2 }}>
                    {q.sub}
                  </div>
                </button>
              ))}
            </div>

            {/* Network stats */}
            {(() => {
              const distCount = parties.filter(
                (p) => p.type === "distributor",
              ).length;
              const retailerCount = parties.filter(
                (p) => p.type === "retailer",
              ).length;
              const activeCount = parties.filter(
                (p) => (p as any).status === "active",
              ).length;
              return (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr 1fr",
                    gap: 8,
                  }}
                >
                  {[
                    {
                      label: "Distributors",
                      val: distCount,
                      color: "#0891b2",
                    },
                    {
                      label: "Retailers",
                      val: retailerCount,
                      color: "#16a34a",
                    },
                    {
                      label: "Active",
                      val: activeCount,
                      color: "#d97706",
                    },
                  ].map((s) => (
                    <button
                      key={s.label}
                      onClick={() => setSubScreen("parties")}
                      style={{
                        background: t.card,
                        borderRadius: 12,
                        padding: "10px 6px",
                        textAlign: "center",
                        border: `1px solid ${s.color}22`,
                      }}
                    >
                      <div
                        style={{
                          fontSize: 20,
                          fontWeight: 900,
                          color: s.color,
                        }}
                      >
                        {s.val}
                      </div>
                      <div
                        style={{ fontSize: 12, color: t.text3, marginTop: 1 }}
                      >
                        {s.label}
                      </div>
                    </button>
                  ))}
                </div>
              );
            })()}

            {/* Allocation summary */}
            {(() => {
              const today = localDateStr();
              const pending = allocations.filter(
                (a) => a.status === "pending" && a.plannedDate >= today,
              ).length;
              const overdue = allocations.filter(
                (a) => a.status === "pending" && a.plannedDate < today,
              ).length;
              const creditDue = allocations
                .filter(
                  (a) => a.status === "sent" && a.paymentType === "credit",
                )
                .reduce((s: number, a: any) => s + a.totalAmount, 0);
              return (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr 1fr",
                    gap: 8,
                  }}
                >
                  {[
                    {
                      label: "Overdue",
                      val: overdue,
                      color: "#ef4444",
                      bg: "rgba(239,68,68,0.08)",
                    },
                    {
                      label: "Pending",
                      val: pending,
                      color: "#f59e0b",
                      bg: "rgba(245,158,11,0.08)",
                    },
                    {
                      label: "Credit Due",
                      val:
                        creditDue > 0
                          ? `₹${(creditDue / 1000).toFixed(0)}k`
                          : "0",
                      color: "#7c3aed",
                      bg: "rgba(124,58,237,0.08)",
                    },
                  ].map((s) => (
                    <button
                      key={s.label}
                      onClick={() => setSubScreen("allocations")}
                      style={{
                        background: s.bg,
                        borderRadius: 12,
                        padding: "10px 6px",
                        textAlign: "center",
                        border: `1px solid ${s.color}33`,
                      }}
                    >
                      <div
                        style={{
                          fontSize: 18,
                          fontWeight: 900,
                          color: s.color,
                        }}
                      >
                        {s.val}
                      </div>
                      <div
                        style={{ fontSize: 12, color: t.text3, marginTop: 1 }}
                      >
                        {s.label}
                      </div>
                    </button>
                  ))}
                </div>
              );
            })()}

            {/* Today's sales snapshot */}
            {(() => {
              const todayLogs = visitLogs.filter(
                (l: any) => l.date === todayStr,
              );
              return (
                <div
                  style={{
                    background: t.card,
                    borderRadius: 16,
                    padding: 16,
                    border: `1px solid ${t.border}`,
                  }}
                >
                  <div
                    style={{
                      fontSize: 13,
                      color: t.text3,
                      marginBottom: 10,
                      fontWeight: 700,
                      letterSpacing: 1,
                      textTransform: "uppercase",
                    }}
                  >
                    Sales Today
                  </div>
                  {todayLogs.length === 0 ? (
                    <div style={{ color: t.text3, fontSize: 14 }}>
                      No visit logs yet today
                    </div>
                  ) : (
                    todayLogs.map((log: any) => (
                      <div
                        key={log.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          marginBottom: 8,
                        }}
                      >
                        <div
                          style={{
                            width: 36,
                            height: 36,
                            background:
                              "linear-gradient(135deg,#0891b2,#0e7490)",
                            borderRadius: "50%",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontWeight: 900,
                            fontSize: 14,
                            flexShrink: 0,
                          }}
                        >
                          {log.salesPersonName?.[0] || "?"}
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 700, fontSize: 14 }}>
                            {log.salesPersonName}
                          </div>
                          <div style={{ fontSize: 12, color: "#22c55e" }}>
                            {log.totalVisited || 0} visited · {log.totalInterested || 0} interested
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              );
            })()}

            {/* Marketing snapshot */}
            <div
              style={{
                background: t.card,
                borderRadius: 16,
                padding: 16,
                border: `1px solid ${t.border}`,
                display: "flex",
                alignItems: "center",
                gap: 14,
              }}
            >
              <div
                style={{
                  position: "relative",
                  width: 56,
                  height: 56,
                  flexShrink: 0,
                }}
              >
                <svg
                  width="56"
                  height="56"
                  style={{ transform: "rotate(-90deg)" }}
                >
                  <circle
                    cx="28"
                    cy="28"
                    r="22"
                    fill="none"
                    stroke={t.border2}
                    strokeWidth="5"
                  />
                  <circle
                    cx="28"
                    cy="28"
                    r="22"
                    fill="none"
                    stroke="#22c55e"
                    strokeWidth="5"
                    strokeDasharray={`${2 * Math.PI * 22}`}
                    strokeDashoffset={`${2 * Math.PI * 22 * (1 - pct / 100)}`}
                    strokeLinecap="round"
                  />
                </svg>
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 12,
                    fontWeight: 900,
                    color: "#22c55e",
                  }}
                >
                  {pct}%
                </div>
              </div>
              <div>
                <div
                  style={{ color: t.text3, fontSize: 12, letterSpacing: 1 }}
                >
                  ONLINE MARKETING — MAY
                </div>
                <div style={{ fontSize: 22, fontWeight: 900, lineHeight: 1, color: t.text }}>
                  {done}
                  <span style={{ fontSize: 13, color: t.text3 }}>
                    /{MAY_POSTS.length}
                  </span>
                </div>
                <div style={{ color: t.text3, fontSize: 12 }}>
                  posts {missed > 0 ? `· ${missed} missed` : "· on track"}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── SALES TAB ───────────────────────────────────────────────────── */}
        {mainTab === "sales" && (
          <div
            className="fade-in"
            style={{ display: "flex", flexDirection: "column", gap: 12 }}
          >
            {/* Offline | Online sub-tabs */}
            <div
              style={{
                display: "flex",
                background:
                  theme === "dark"
                    ? "rgba(255,255,255,0.04)"
                    : "rgba(0,0,0,0.03)",
                borderRadius: 12,
                padding: 4,
                gap: 4,
              }}
            >
              {(
                [
                  ["offline", "Offline"],
                  ["online", "Online"],
                ] as [SalesTab, string][]
              ).map(([val, label]) => (
                <button
                  key={val}
                  onClick={() => setSalesTab(val)}
                  style={{
                    flex: 1,
                    background: salesTab === val ? t.card : "transparent",
                    color: salesTab === val ? t.text : t.text3,
                    border:
                      salesTab === val
                        ? `1px solid ${t.border2}`
                        : "1px solid transparent",
                    borderRadius: 8,
                    padding: "9px",
                    fontSize: 13,
                    fontWeight: 700,
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Online Sales — placeholder */}
            {salesTab === "online" && (
              <div
                style={{
                  background: t.card,
                  borderRadius: 16,
                  padding: 32,
                  textAlign: "center",
                  border: "1px dashed rgba(217,119,6,0.3)",
                }}
              >
                <div style={{ marginBottom: 12 }}></div>
                <div
                  style={{
                    background: "rgba(217,119,6,0.2)",
                    color: "#d97706",
                    fontSize: 11,
                    fontWeight: 800,
                    padding: "3px 10px",
                    borderRadius: 99,
                    display: "inline-block",
                    marginBottom: 10,
                  }}
                >
                  COMING SOON
                </div>
                <div
                  style={{
                    fontSize: 16,
                    fontWeight: 700,
                    color: t.text,
                    marginBottom: 8,
                  }}
                >
                  Online Sales Analytics
                </div>
                <div style={{ fontSize: 13, color: t.text3 }}>
                  E-commerce orders, digital campaign tracking and online sales
                  performance will appear here.
                </div>
              </div>
            )}

            {/* Offline Sales — filters + check-ins */}
            {salesTab === "offline" && (
              <>
                {/* Filters */}
                <div
                  style={{
                    background: t.card,
                    borderRadius: 14,
                    padding: 14,
                    border: `1px solid ${t.border}`,
                  }}
                >
                  <div
                    style={{
                      fontSize: 13,
                      color: t.text3,
                      marginBottom: 8,
                      letterSpacing: 1,
                      textTransform: "uppercase",
                    }}
                  >
                    Filters
                  </div>

                  {/* User filter */}
                  <div style={{ marginBottom: 10 }}>
                    <div
                      style={{ fontSize: 13, color: t.text3, marginBottom: 6 }}
                    >
                      Team Member
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <button
                        onClick={() => setSelectedUser("all")}
                        style={{
                          background:
                            selectedUser === "all"
                              ? "#0891b2"
                              : theme === "dark"
                                ? "rgba(255,255,255,0.04)"
                                : "rgba(0,0,0,0.03)",
                          color: selectedUser === "all" ? "#fff" : t.text3,
                          border: `1px solid ${selectedUser === "all" ? "#0891b2" : t.border}`,
                          borderRadius: 20,
                          padding: "5px 14px",
                          fontSize: 13,
                          fontWeight: 700,
                        }}
                      >
                        All
                      </button>
                      {salesUsers.map((u) => {
                        const onLeave = leaveRecords.some(
                          (l) => l.uid === u.uid && l.date === todayStr,
                        );
                        return (
                          <button
                            key={u.uid}
                            onClick={() => setSelectedUser(u.name)}
                            style={{
                              background:
                                selectedUser === u.name
                                  ? "#0891b2"
                                  : theme === "dark"
                                    ? "rgba(255,255,255,0.04)"
                                    : "rgba(0,0,0,0.03)",
                              color: selectedUser === u.name ? "#fff" : t.text3,
                              border: `1px solid ${selectedUser === u.name ? "#0891b2" : t.border}`,
                              borderRadius: 20,
                              padding: "5px 14px",
                              fontSize: 13,
                              fontWeight: 700,
                              display: "flex",
                              alignItems: "center",
                              gap: 5,
                            }}
                          >
                            {u.name}
                            {onLeave && (
                              <span
                                style={{ fontSize: 10, background: 'rgba(245,158,11,0.15)', color: '#f59e0b', padding: '1px 6px', borderRadius: 99, fontWeight: 700 }}
                                title="On leave today"
                              >
                                Leave
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Date mode */}
                  <div>
                    <div
                      style={{ fontSize: 13, color: t.text3, marginBottom: 6 }}
                    >
                      Date Filter
                    </div>
                    <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                      {(
                        [
                          ["day", "Day"],
                          ["month", "Month"],
                          ["period", "Period"],
                        ] as [typeof dateMode, string][]
                      ).map(([val, label]) => (
                        <button
                          key={val}
                          onClick={() => setDateMode(val)}
                          style={{
                            flex: 1,
                            background:
                              dateMode === val
                                ? "rgba(217,119,6,0.2)"
                                : theme === "dark"
                                  ? "rgba(255,255,255,0.04)"
                                  : "rgba(0,0,0,0.03)",
                            color: dateMode === val ? "#d97706" : t.text3,
                            border: `1px solid ${dateMode === val ? "rgba(217,119,6,0.3)" : t.border}`,
                            borderRadius: 8,
                            padding: "7px",
                            fontSize: 13,
                            fontWeight: 700,
                          }}
                        >
                          {label}
                        </button>
                      ))}
                    </div>

                    {dateMode === "day" && (
                      <DateInput
                        type="date"
                        value={dateDay}
                        onChange={setDateDay}
                      />
                    )}
                    {dateMode === "month" && (
                      <DateInput
                        type="month"
                        value={dateMonth}
                        onChange={setDateMonth}
                      />
                    )}
                    {dateMode === "period" && (
                      <div style={{ display: "flex", gap: 8 }}>
                        <div style={{ flex: 1 }}>
                          <div
                            style={{
                              fontSize: 12,
                              color: t.text3,
                              marginBottom: 4,
                            }}
                          >
                            From
                          </div>
                          <DateInput
                            type="date"
                            value={datePeriodFrom}
                            onChange={setDatePeriodFrom}
                          />
                        </div>
                        <div style={{ flex: 1 }}>
                          <div
                            style={{
                              fontSize: 12,
                              color: t.text3,
                              marginBottom: 4,
                            }}
                          >
                            To
                          </div>
                          <DateInput
                            type="date"
                            value={datePeriodTo}
                            onChange={setDatePeriodTo}
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Party type filter */}
                  <div style={{ marginTop: 12 }}>
                    <div
                      style={{ fontSize: 13, color: t.text3, marginBottom: 6 }}
                    >
                      Party Type
                    </div>
                    <div
                      style={{
                        display: "flex",
                        gap: 6,
                        marginBottom: visitPartyType === "retailer" ? 8 : 0,
                      }}
                    >
                      {(
                        [
                          ["all", "All"],
                          ["distributor", "Dist."],
                          ["retailer", "Retailers"],
                        ] as [string, string][]
                      ).map(([val, label]) => (
                        <button
                          key={val}
                          onClick={() => {
                            setVisitPartyType(val as any);
                            setVisitDistSub("all");
                          }}
                          style={{
                            flex: 1,
                            background:
                              visitPartyType === val
                                ? "rgba(8,145,178,0.2)"
                                : theme === "dark"
                                  ? "rgba(255,255,255,0.04)"
                                  : "rgba(0,0,0,0.03)",
                            color: visitPartyType === val ? "#0891b2" : t.text3,
                            border: `1px solid ${visitPartyType === val ? "rgba(8,145,178,0.3)" : t.border}`,
                            borderRadius: 8,
                            padding: "7px 4px",
                            fontSize: 13,
                            fontWeight: 700,
                          }}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    {visitPartyType === "retailer" && (
                      <CustomSelect
                        value={visitDistSub}
                        onChange={setVisitDistSub}
                        placeholder="All retailers"
                        options={[
                          { value: "all", label: "All retailers" },
                          {
                            value: "independent",
                            label: "Independent retailers",
                          },
                          ...distributorList.map((d) => ({
                            value: d.id!,
                            label: d.name,
                            sub: d.place || d.address,
                          })),
                        ]}
                      />
                    )}
                  </div>

                  {/* Party status filter */}
                  <div style={{ marginTop: 12 }}>
                    <div
                      style={{ fontSize: 13, color: t.text3, marginBottom: 6 }}
                    >
                      Status
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      {(
                        [
                          ["all", "All"],
                          ["active", "Active"],
                          ["prospect", "Prospect"],
                          ["inactive", "Inactive"],
                        ] as [string, string][]
                      ).map(([val, label]) => (
                        <button
                          key={val}
                          onClick={() => setVisitPartyStatus(val as any)}
                          style={{
                            flex: 1,
                            background:
                              visitPartyStatus === val
                                ? "rgba(22,163,74,0.15)"
                                : theme === "dark"
                                  ? "rgba(255,255,255,0.04)"
                                  : "rgba(0,0,0,0.03)",
                            color:
                              visitPartyStatus === val ? "#16a34a" : t.text3,
                            border: `1px solid ${visitPartyStatus === val ? "rgba(22,163,74,0.25)" : t.border}`,
                            borderRadius: 8,
                            padding: "6px 2px",
                            fontSize: 12,
                            fontWeight: 700,
                          }}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Summary pills */}
                {filteredLogsWithVisits.length > 0 && (
                  <>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr 1fr",
                        gap: 8,
                      }}
                    >
                      {[
                        {
                          label: "Days",
                          val: filteredLogsWithVisits.length,
                          color: t.text,
                        },
                        {
                          label: "Visits",
                          val: allFV.length,
                          color: "#0891b2",
                        },
                        {
                          label: "Interested",
                          val: fvInterested,
                          color: "#16a34a",
                        },
                      ].map((s) => (
                        <div
                          key={s.label}
                          style={{
                            background: t.card,
                            borderRadius: 12,
                            padding: "12px 10px",
                            textAlign: "center",
                            border: `1px solid ${t.border}`,
                          }}
                        >
                          <div
                            style={{
                              fontSize: 20,
                              fontWeight: 900,
                              color: s.color,
                            }}
                          >
                            {s.val}
                          </div>
                          <div
                            style={{
                              fontSize: 12,
                              color: t.text3,
                              marginTop: 2,
                            }}
                          >
                            {s.label}
                          </div>
                        </div>
                      ))}
                    </div>
                    {(fvDistCount > 0 || fvRetailCount > 0) && (
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr 1fr",
                          gap: 8,
                        }}
                      >
                        <div
                          style={{
                            background: "rgba(8,145,178,0.08)",
                            borderRadius: 12,
                            padding: "10px",
                            textAlign: "center",
                            border: "1px solid rgba(8,145,178,0.15)",
                          }}
                        >
                          <div
                            style={{
                              fontSize: 18,
                              fontWeight: 900,
                              color: "#0891b2",
                            }}
                          >
                            {fvDistCount}
                          </div>
                          <div
                            style={{
                              fontSize: 12,
                              color: t.text3,
                              marginTop: 2,
                            }}
                          >
                            Unique Distributors
                          </div>
                        </div>
                        <div
                          style={{
                            background: "rgba(22,163,74,0.08)",
                            borderRadius: 12,
                            padding: "10px",
                            textAlign: "center",
                            border: "1px solid rgba(22,163,74,0.15)",
                          }}
                        >
                          <div
                            style={{
                              fontSize: 18,
                              fontWeight: 900,
                              color: "#16a34a",
                            }}
                          >
                            {fvRetailCount}
                          </div>
                          <div
                            style={{
                              fontSize: 12,
                              color: t.text3,
                              marginTop: 2,
                            }}
                          >
                            Unique Retailers
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                )}

                {/* Allocation per sales person */}
                {(() => {
                  const byPerson: Record<
                    string,
                    {
                      count: number;
                      total: number;
                      packets: number;
                      allocs: any[];
                    }
                  > = {};
                  allocations
                    .filter((a: any) => {
                      if (
                        selectedUser !== "all" &&
                        a.createdByName !== selectedUser
                      )
                        return false;
                      const createdDate = a.createdAt
                        ? localDateStr(new Date(a.createdAt))
                        : "";
                      if (dateMode === "day") return createdDate === dateDay;
                      if (dateMode === "month")
                        return createdDate.startsWith(dateMonth);
                      if (dateMode === "period")
                        return (
                          createdDate >= datePeriodFrom &&
                          createdDate <= datePeriodTo
                        );
                      return true;
                    })
                    .forEach((a: any) => {
                      const name = a.createdByName || "Unknown";
                      if (!byPerson[name])
                        byPerson[name] = {
                          count: 0,
                          total: 0,
                          packets: 0,
                          allocs: [],
                        };
                      byPerson[name].count++;
                      byPerson[name].total += a.totalAmount || 0;
                      byPerson[name].packets += a.packets || 0;
                      byPerson[name].allocs.push(a);
                    });
                  const entries = Object.entries(byPerson);
                  if (entries.length === 0) return null;
                  return (
                    <div
                      style={{
                        background: t.card,
                        borderRadius: 14,
                        border: "1px solid rgba(217,119,6,0.15)",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          fontSize: 13,
                          color: "#d97706",
                          padding: "12px 14px 10px",
                          fontWeight: 700,
                          letterSpacing: 1,
                          textTransform: "uppercase",
                          borderBottom: "1px solid rgba(217,119,6,0.1)",
                        }}
                      >
                        Allocations Created
                      </div>
                      {entries.map(([name, data]) => {
                        const isExpanded = expandedAllocPerson === name;
                        return (
                          <div
                            key={name}
                            style={{ borderBottom: `1px solid ${t.border}` }}
                          >
                            <button
                              onClick={() =>
                                setExpandedAllocPerson(isExpanded ? null : name)
                              }
                              style={{
                                width: "100%",
                                background: "none",
                                border: "none",
                                padding: "12px 14px",
                                display: "flex",
                                alignItems: "center",
                                gap: 10,
                                cursor: "pointer",
                                textAlign: "left",
                              }}
                            >
                              <div
                                style={{
                                  width: 32,
                                  height: 32,
                                  background: "rgba(217,119,6,0.15)",
                                  borderRadius: "50%",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  fontWeight: 900,
                                  fontSize: 14,
                                  flexShrink: 0,
                                  color: "#d97706",
                                }}
                              >
                                {name[0]}
                              </div>
                              <div style={{ flex: 1 }}>
                                <div
                                  style={{
                                    fontSize: 14,
                                    fontWeight: 700,
                                    color: t.text,
                                  }}
                                >
                                  {name}
                                </div>
                                <div style={{ fontSize: 12, color: t.text3 }}>
                                  {data.count} allocation
                                  {data.count > 1 ? "s" : ""} • {data.packets}{" "}
                                  pkts
                                </div>
                              </div>
                              <div
                                style={{
                                  fontSize: 14,
                                  fontWeight: 900,
                                  color: "#d97706",
                                  marginRight: 6,
                                }}
                              >
                                ₹{data.total.toLocaleString()}
                              </div>
                              <span style={{ color: t.text3, fontSize: 13 }}>
                                {isExpanded ? "▲" : "▼"}
                              </span>
                            </button>
                            {isExpanded && (
                              <div
                                style={{
                                  padding: "0 14px 12px",
                                  display: "flex",
                                  flexDirection: "column",
                                  gap: 6,
                                }}
                              >
                                {data.allocs
                                  .sort(
                                    (a: any, b: any) =>
                                      (b.createdAt || 0) - (a.createdAt || 0),
                                  )
                                  .map((a: any, i: number) => {
                                    const statusColor =
                                      a.status === "dispatched"
                                        ? "#16a34a"
                                        : a.status === "approved"
                                          ? "#0891b2"
                                          : a.status === "cancelled"
                                            ? "#dc2626"
                                            : "#d97706";
                                    const partyTypeLabel =
                                      a.partyType === "distributor"
                                        ? "Dist."
                                        : "Retail.";
                                    return (
                                      <div
                                        key={a.id || i}
                                        style={{
                                          background:
                                            theme === "dark"
                                              ? "rgba(255,255,255,0.04)"
                                              : "rgba(0,0,0,0.03)",
                                          borderRadius: 10,
                                          padding: "10px 12px",
                                        }}
                                      >
                                        <div
                                          style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: 8,
                                            marginBottom: 6,
                                          }}
                                        >
                                          <span style={{ fontSize: 11, color: t.text3, fontWeight: 600 }}>
                                            {partyTypeLabel}
                                          </span>
                                          <div style={{ flex: 1 }}>
                                            <div
                                              style={{
                                                fontSize: 14,
                                                fontWeight: 700,
                                                color: t.text,
                                              }}
                                            >
                                              {a.partyName || "—"}
                                            </div>
                                            <div
                                              style={{
                                                fontSize: 12,
                                                color: t.text2,
                                              }}
                                            >
                                              {a.productName || "—"}
                                            </div>
                                          </div>
                                          <span
                                            style={{
                                              fontSize: 11,
                                              fontWeight: 700,
                                              color: statusColor,
                                              background: `${statusColor}20`,
                                              padding: "2px 8px",
                                              borderRadius: 99,
                                              textTransform: "uppercase",
                                            }}
                                          >
                                            {a.status || "pending"}
                                          </span>
                                        </div>
                                        <div
                                          style={{
                                            display: "flex",
                                            gap: 8,
                                            flexWrap: "wrap",
                                          }}
                                        >
                                          <span
                                            style={{
                                              fontSize: 12,
                                              color: t.text2,
                                            }}
                                          >
                                            {a.packets} pkts
                                          </span>
                                          <span
                                            style={{
                                              fontSize: 12,
                                              color: "#f59e0b",
                                              fontWeight: 700,
                                            }}
                                          >
                                            ₹
                                            {(
                                              a.totalAmount || 0
                                            ).toLocaleString()}
                                          </span>
                                          <span
                                            style={{
                                              fontSize: 12,
                                              color: t.text3,
                                            }}
                                          >
                                            {a.paymentType === "cash"
                                              ? "Cash"
                                              : a.paymentType === "credit"
                                                ? "Credit"
                                                : a.paymentType === "upi"
                                                  ? "UPI"
                                                  : a.paymentType || ""}
                                          </span>
                                          {a.plannedDate && (
                                            <span
                                              style={{
                                                fontSize: 12,
                                                color: t.text3,
                                              }}
                                            >
                                              {a.plannedDate}
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                    );
                                  })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}

                {/* Visit log list */}
                <div
                  style={{
                    fontSize: 13,
                    color: t.text3,
                    fontWeight: 700,
                    letterSpacing: 1,
                    textTransform: "uppercase",
                  }}
                >
                  {filteredLogsWithVisits.length + fullDayLeaveCards.length}{" "}
                  {filteredLogsWithVisits.length + fullDayLeaveCards.length !==
                  1
                    ? "entries"
                    : "entry"}{" "}
                  logged
                </div>

                {filteredLogsWithVisits.length === 0 &&
                fullDayLeaveCards.length === 0 ? (
                  <div
                    style={{ textAlign: "center", padding: 32, color: t.text3 }}
                  >
                    <div style={{ fontWeight: 700 }}>
                      No visit logs for this filter
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Full day leave-only cards (no visit log) */}
                    {fullDayLeaveCards.map((leave) => (
                      <div
                        key={leave.id}
                        style={{
                          background: "rgba(245,158,11,0.06)",
                          borderRadius: 14,
                          padding: 14,
                          border: "1.5px solid rgba(245,158,11,0.2)",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                          }}
                        >
                          <div
                            style={{
                              width: 40,
                              height: 40,
                              background:
                                "linear-gradient(135deg,#d97706,#f59e0b)",
                              borderRadius: "50%",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontWeight: 900,
                              fontSize: 16,
                              flexShrink: 0,
                            }}
                          >
                            {leave.name?.[0] || "?"}
                          </div>
                          <div style={{ flex: 1 }}>
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 6,
                              }}
                            >
                              <div
                                style={{
                                  fontWeight: 800,
                                  fontSize: 14,
                                  color: t.text,
                                }}
                              >
                                {leave.name}
                              </div>
                              <span
                                style={{
                                  fontSize: 10,
                                  fontWeight: 800,
                                  background: "rgba(245,158,11,0.2)",
                                  color: "#d97706",
                                  padding: "2px 8px",
                                  borderRadius: 99,
                                }}
                              >
                                Full Day Leave
                                {leave.status === "unmark_requested"
                                  ? " (unmark pending)"
                                  : ""}
                              </span>
                            </div>
                            <div style={{ fontSize: 12, color: t.text3 }}>
                              {leave.date} · marked at{" "}
                              {new Date(leave.markedAt).toLocaleTimeString(
                                "en-IN",
                                { hour: "2-digit", minute: "2-digit" },
                              )}
                            </div>
                          </div>
                          <div
                            style={{
                              textAlign: "center",
                              background: "rgba(245,158,11,0.1)",
                              borderRadius: 8,
                              padding: "8px 12px",
                            }}
                          >
                            <div
                              style={{
                                fontSize: 11,
                                color: "#f59e0b",
                                fontWeight: 700,
                              }}
                            >
                              On Leave
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}

                    {/* Visit log cards */}
                    {filteredLogsWithVisits.map((log: any) => {
                      const fv: any[] = log._fv;
                      const fvInt = fv.filter(
                        (v: any) => v.outcome === "interested",
                      ).length;
                      const fvNot = fv.filter(
                        (v: any) => v.outcome === "not_interested",
                      ).length;
                      const halfDayLeave = leaveRecords.find(
                        (l) =>
                          l.uid === log.salesPersonId &&
                          l.date === log.date &&
                          l.leaveType === "half_day" &&
                          (l.status === "active" ||
                            l.status === "pending_approval" ||
                            l.status === "unmark_requested"),
                      );
                      return (
                        <div
                          key={log.id}
                          style={{
                            background: halfDayLeave
                              ? "rgba(59,130,246,0.04)"
                              : t.card,
                            borderRadius: 14,
                            padding: 14,
                            border: halfDayLeave
                              ? "1.5px solid rgba(59,130,246,0.18)"
                              : `1px solid ${t.border}`,
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 10,
                              marginBottom: 10,
                            }}
                          >
                            <div
                              style={{
                                width: 40,
                                height: 40,
                                background:
                                  "linear-gradient(135deg,#0891b2,#0e7490)",
                                borderRadius: "50%",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontWeight: 900,
                                fontSize: 16,
                                flexShrink: 0,
                                color: "#fff",
                              }}
                            >
                              {log.salesPersonName?.[0] || "?"}
                            </div>
                            <div style={{ flex: 1 }}>
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 6,
                                  flexWrap: "wrap",
                                }}
                              >
                                <div
                                  style={{
                                    fontWeight: 800,
                                    fontSize: 14,
                                    color: t.text,
                                  }}
                                >
                                  {log.salesPersonName}
                                </div>
                                {halfDayLeave && (
                                  <span
                                    style={{
                                      fontSize: 10,
                                      fontWeight: 800,
                                      background: "rgba(59,130,246,0.15)",
                                      color: "#3b82f6",
                                      padding: "2px 8px",
                                      borderRadius: 99,
                                    }}
                                  >
                                    Half Day Leave
                                  </span>
                                )}
                              </div>
                              <div style={{ fontSize: 12, color: t.text3 }}>
                                {log.date}
                              </div>
                            </div>
                            <div style={{ display: "flex", gap: 6 }}>
                              <div
                                style={{
                                  textAlign: "center",
                                  background: "rgba(8,145,178,0.1)",
                                  borderRadius: 8,
                                  padding: "6px 10px",
                                }}
                              >
                                <div
                                  style={{
                                    fontWeight: 900,
                                    fontSize: 16,
                                    color: "#0891b2",
                                  }}
                                >
                                  {fv.length}
                                </div>
                                <div style={{ fontSize: 11, color: t.text3 }}>
                                  visited
                                </div>
                              </div>
                              <div
                                style={{
                                  textAlign: "center",
                                  background: "rgba(22,163,74,0.1)",
                                  borderRadius: 8,
                                  padding: "6px 10px",
                                }}
                              >
                                <div
                                  style={{
                                    fontWeight: 900,
                                    fontSize: 16,
                                    color: "#16a34a",
                                  }}
                                >
                                  {fvInt}
                                </div>
                                <div style={{ fontSize: 11, color: t.text3 }}>
                                  interested
                                </div>
                              </div>
                              <div
                                style={{
                                  textAlign: "center",
                                  background: "rgba(220,38,38,0.1)",
                                  borderRadius: 8,
                                  padding: "6px 10px",
                                }}
                              >
                                <div
                                  style={{
                                    fontWeight: 900,
                                    fontSize: 16,
                                    color: "#dc2626",
                                  }}
                                >
                                  {fvNot}
                                </div>
                                <div style={{ fontSize: 11, color: t.text3 }}>
                                  declined
                                </div>
                              </div>
                            </div>
                          </div>
                          {(() => {
                            const partyGroups = new Map<string, any[]>()
                            fv.forEach((v: any) => {
                              const grp = partyGroups.get(v.partyId) || []
                              partyGroups.set(v.partyId, [...grp, v])
                            })
                            return Array.from(partyGroups.entries()).map(([partyId, entries]) => {
                              const party = partyMap.get(partyId) as any
                              const typeLabel = party?.type === 'distributor' ? 'Dist' : 'Ret'
                              return (
                                <div key={partyId} style={{ background: theme === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)', borderRadius: 10, padding: '10px 12px', marginBottom: 6 }}>
                                  {/* Party header — shown once */}
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                                    <span style={{ fontSize: 10, background: party?.type === 'distributor' ? 'rgba(99,102,241,0.15)' : 'rgba(34,197,94,0.12)', color: party?.type === 'distributor' ? '#818cf8' : '#22c55e', padding: '1px 6px', borderRadius: 99, fontWeight: 700 }}>{typeLabel}</span>
                                    <span style={{ fontSize: 14, fontWeight: 800, color: t.text }}>{entries[0].partyName}</span>
                                    {entries[0].isNew && <span style={{ fontSize: 10, background: 'rgba(99,102,241,0.18)', color: '#818cf8', padding: '1px 7px', borderRadius: 99, fontWeight: 800 }}>NEW</span>}
                                    {party?.underDistributorName && party.type === 'retailer' && (
                                      <span style={{ fontSize: 11, color: t.text3 }}>· {party.underDistributorName}</span>
                                    )}
                                    {entries.length > 1 && (
                                      <span style={{ fontSize: 11, color: t.text3, marginLeft: 'auto', fontWeight: 700 }}>{entries.length} visits</span>
                                    )}
                                  </div>
                                  {/* Each visit entry with timestamp */}
                                  {entries.map((v: any, vi: number) => {
                                    const revisitLog = v.isRevisit
                                      ? (v.revisitLogId
                                          ? revisitLogs.find((rl: any) => rl.id === v.revisitLogId)
                                          : revisitLogs.find((rl: any) => rl.partyId === v.partyId && rl.salesPersonId === log.salesPersonId && rl.date === log.date))
                                      : null
                                    const outcomeColor = v.outcome === 'interested' ? '#22c55e' : v.outcome === 'not_interested' ? '#ef4444' : '#f59e0b'
                                    const outcomeLabel = v.outcome === 'interested' ? 'Interested' : v.outcome === 'not_interested' ? 'Not Interested' : 'Follow Up'
                                    const timeStr = v.loggedAt
                                      ? new Date(v.loggedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
                                      : ''
                                    return (
                                      <div key={vi} style={{ paddingLeft: 10, borderLeft: `2px solid ${theme === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`, marginBottom: vi < entries.length - 1 ? 10 : 0, paddingBottom: vi < entries.length - 1 ? 8 : 0 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                                          <span style={{ fontSize: 11, background: `${outcomeColor}18`, color: outcomeColor, padding: '1px 7px', borderRadius: 99, fontWeight: 700 }}>{outcomeLabel}</span>
                                          {timeStr && <span style={{ fontSize: 11, color: t.text3, fontWeight: 600 }}>{timeStr}</span>}
                                        </div>
                                        {/* Revisit action details */}
                                        {revisitLog?.actions?.map((action: any, ai: number) => {
                                          if (action.type === 'stock_update') return (
                                            <div key={ai} style={{ fontSize: 12, color: t.text2, marginBottom: 3 }}>
                                              <span style={{ fontWeight: 700 }}>Stock Updated</span>
                                              {' · '}Opening: {action.openingQty} · Sold: {action.soldQty}
                                              {' · '}<span style={{ fontWeight: 700, color: '#0891b2' }}>Balance: {action.balanceQty} pkts</span>
                                              {action.balanceValue > 0 && <span style={{ color: t.text3 }}> (₹{action.balanceValue.toLocaleString()})</span>}
                                            </div>
                                          )
                                          if (action.type === 'new_order') return (
                                            <div key={ai} style={{ fontSize: 12, color: t.text2, marginBottom: 3 }}>
                                              <span style={{ fontWeight: 700 }}>New Order</span>
                                              {' · '}{action.quantity} {action.productName}
                                              {action.totalAmount > 0 && <span> · <span style={{ fontWeight: 700, color: '#16a34a' }}>₹{action.totalAmount?.toLocaleString()}</span></span>}
                                              {' · '}<span style={{ color: action.paymentType === 'credit' ? '#f59e0b' : t.text3 }}>{action.paymentType}</span>
                                              {action.plannedDate && <span style={{ color: t.text3 }}> · dispatch {action.plannedDate}</span>}
                                            </div>
                                          )
                                          if (action.type === 'payment_collection') return (
                                            <div key={ai} style={{ fontSize: 12, color: t.text2, marginBottom: 3 }}>
                                              <span style={{ fontWeight: 700 }}>Payment Collected</span>
                                              {' · '}<span style={{ fontWeight: 700, color: '#16a34a' }}>₹{action.amount?.toLocaleString()}</span>
                                              {' · '}<span style={{ color: action.status === 'pending_approval' ? '#f59e0b' : t.text3 }}>
                                                {action.status === 'pending_approval' ? 'Pending approval' : 'Approved'}
                                              </span>
                                              {action.notes && <span style={{ color: t.text3 }}> · {action.notes}</span>}
                                            </div>
                                          )
                                          if (action.type === 'relationship_visit') return (
                                            <div key={ai} style={{ fontSize: 12, color: t.text2, marginBottom: 3 }}>
                                              <span style={{ fontWeight: 700 }}>Relationship Visit</span>
                                              {action.notes && <span style={{ color: t.text3 }}> · {action.notes}</span>}
                                            </div>
                                          )
                                          if (action.type === 'no_longer_active') return (
                                            <div key={ai} style={{ fontSize: 12, color: '#ef4444', marginBottom: 3 }}>
                                              <span style={{ fontWeight: 700 }}>No Longer Active</span>
                                              {action.reason && <span> · {action.reason}</span>}
                                            </div>
                                          )
                                          return null
                                        })}
                                        {revisitLog?.notes && (
                                          <div style={{ fontSize: 12, color: t.text3, marginTop: 2 }}>{revisitLog.notes}</div>
                                        )}
                                        {/* Non-revisit outcomes */}
                                        {!v.isRevisit && v.outcome === 'interested' && (
                                          <div style={{ fontSize: 12, color: '#16a34a', fontWeight: 600 }}>
                                            Interested{v.productName ? ` · ${v.productName}` : ''}
                                          </div>
                                        )}
                                        {!v.isRevisit && v.outcome === 'not_interested' && (
                                          <div style={{ fontSize: 12, color: '#dc2626' }}>
                                            Not Interested · {v.notInterestedReason === 'Other' && v.otherReason ? v.otherReason : v.notInterestedReason}
                                          </div>
                                        )}
                                        {!v.isRevisit && v.outcome === 'follow_up' && (
                                          <div style={{ fontSize: 12, color: '#f59e0b', fontWeight: 600 }}>Follow up needed</div>
                                        )}
                                        {v.notes && <div style={{ fontSize: 12, color: t.text3, marginTop: 2 }}>{v.notes}</div>}
                                      </div>
                                    )
                                  })}
                                </div>
                              )
                            })
                          })()}
                          {log.endOfDayNote && (
                            <div
                              style={{
                                background:
                                  theme === "dark"
                                    ? "rgba(255,255,255,0.04)"
                                    : "rgba(0,0,0,0.03)",
                                borderRadius: 8,
                                padding: "8px 10px",
                                marginTop: 4,
                              }}
                            >
                              <div
                                style={{
                                  fontSize: 11,
                                  color: t.text3,
                                  marginBottom: 2,
                                }}
                              >
                                End of day note
                              </div>
                              <div style={{ fontSize: 13, color: t.text2 }}>
                                {log.endOfDayNote}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </>
                )}
              </>
            )}
          </div>
        )}

        {/* ── MARKETING TAB ───────────────────────────────────────────────── */}
        {mainTab === "marketing" && (
          <div
            className="fade-in"
            style={{ display: "flex", flexDirection: "column", gap: 12 }}
          >
            {/* Offline | Online sub-tabs */}
            <div
              style={{
                display: "flex",
                background:
                  theme === "dark"
                    ? "rgba(255,255,255,0.04)"
                    : "rgba(0,0,0,0.03)",
                borderRadius: 12,
                padding: 4,
                gap: 4,
              }}
            >
              {(
                [
                  ["offline", "Offline"],
                  ["online", "Online"],
                ] as [MarketingTab, string][]
              ).map(([val, label]) => (
                <button
                  key={val}
                  onClick={() => setMarketingTab(val)}
                  style={{
                    flex: 1,
                    background: marketingTab === val ? t.card : "transparent",
                    color: marketingTab === val ? t.text : t.text3,
                    border:
                      marketingTab === val
                        ? `1px solid ${t.border2}`
                        : "1px solid transparent",
                    borderRadius: 8,
                    padding: "9px",
                    fontSize: 13,
                    fontWeight: 700,
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Offline Marketing — Coming Soon */}
            {marketingTab === "offline" && (
              <div
                style={{
                  background: t.card,
                  borderRadius: 16,
                  padding: 32,
                  textAlign: "center",
                  border: "1px dashed rgba(217,119,6,0.3)",
                }}
              >
                <div style={{ marginBottom: 12 }}></div>
                <div
                  style={{
                    background: "rgba(217,119,6,0.2)",
                    color: "#d97706",
                    fontSize: 11,
                    fontWeight: 800,
                    padding: "3px 10px",
                    borderRadius: 99,
                    display: "inline-block",
                    marginBottom: 10,
                  }}
                >
                  COMING SOON
                </div>
                <div
                  style={{
                    fontSize: 16,
                    fontWeight: 700,
                    color: t.text,
                    marginBottom: 8,
                  }}
                >
                  Offline Marketing Dashboard
                </div>
                <div style={{ fontSize: 13, color: t.text3 }}>
                  On-ground campaigns, events, BTL activities and physical
                  marketing will appear here.
                </div>
              </div>
            )}

            {/* Online Marketing — calendar tracker */}
            {marketingTab === "online" && (
              <>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 10,
                  }}
                >
                  <div
                    style={{
                      background: t.card,
                      borderRadius: 14,
                      padding: 14,
                      border: "1px solid rgba(22,163,74,0.2)",
                    }}
                  >
                    <div
                      style={{ fontSize: 13, color: t.text3, marginBottom: 4 }}
                    >
                      POSTED
                    </div>
                    <div
                      style={{
                        fontSize: 24,
                        fontWeight: 900,
                        color: "#16a34a",
                      }}
                    >
                      {done}/{MAY_POSTS.length}
                    </div>
                  </div>
                  <div
                    style={{
                      background: t.card,
                      borderRadius: 14,
                      padding: 14,
                      border: `1px solid ${missed > 0 ? "rgba(220,38,38,0.2)" : t.border}`,
                    }}
                  >
                    <div
                      style={{ fontSize: 13, color: t.text3, marginBottom: 4 }}
                    >
                      MISSED
                    </div>
                    <div
                      style={{
                        fontSize: 24,
                        fontWeight: 900,
                        color: missed > 0 ? "#dc2626" : "#16a34a",
                      }}
                    >
                      {missed}
                    </div>
                  </div>
                </div>

                {weekStats.map((w) => {
                  const wp = Math.round((w.done / w.total) * 100);
                  return (
                    <div
                      key={w.week}
                      style={{
                        background: t.card,
                        borderRadius: 12,
                        padding: "12px 14px",
                        border: `1px solid ${w.missed > 0 ? "#dc262222" : t.border}`,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          marginBottom: 8,
                        }}
                      >
                        <span style={{ fontWeight: 800, fontSize: 14 }}>
                          Week {w.week}
                        </span>
                        <div
                          style={{
                            display: "flex",
                            gap: 8,
                            alignItems: "center",
                          }}
                        >
                          {w.missed > 0 && (
                            <span
                              style={{
                                fontSize: 12,
                                color: "#ef4444",
                                background: "rgba(239,68,68,0.12)",
                                padding: "2px 8px",
                                borderRadius: 99,
                              }}
                            >
                              {w.missed} missed
                            </span>
                          )}
                          <span
                            style={{
                              color: "#22c55e",
                              fontWeight: 800,
                              fontSize: 13,
                            }}
                          >
                            {w.done}/{w.total}
                          </span>
                        </div>
                      </div>
                      <div
                        style={{
                          background: t.border2,
                          borderRadius: 99,
                          height: 6,
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            width: `${wp}%`,
                            height: "100%",
                            background:
                              wp === 100
                                ? "#22c55e"
                                : "linear-gradient(90deg,#1a5c42,#6ee7b7)",
                            borderRadius: 99,
                          }}
                        />
                      </div>
                    </div>
                  );
                })}

                {MAY_POSTS.map((post) => {
                  const s = statuses[post.id] || "pending";
                  const sc = STATUS_CONFIG[s];
                  const pc = PILLAR_COLORS[post.pillar] || "#1a5c42";
                  return (
                    <div
                      key={post.id}
                      style={{
                        background: t.card,
                        borderRadius: 10,
                        padding: "10px 12px",
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        border: `1px solid ${s === "missed" ? "#dc262630" : s === "posted" ? "#16a34a20" : t.border}`,
                      }}
                    >
                      <div style={{ fontSize: 11, color: t.text3 }}>
                        {post.format}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: 13,
                            fontWeight: 600,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {post.topic}
                        </div>
                        <div style={{ display: "flex", gap: 6, marginTop: 2 }}>
                          <span style={{ fontSize: 12, color: t.text3 }}>
                            {post.date}
                          </span>
                          <span style={{ fontSize: 12, color: pc }}>
                            {post.pillar}
                          </span>
                        </div>
                      </div>
                      <div
                        style={{
                          background: sc.bg,
                          color: sc.color,
                          fontSize: 11,
                          fontWeight: 700,
                          padding: "2px 8px",
                          borderRadius: 99,
                          border: `1px solid ${sc.color}44`,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {sc.label}
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        )}
      </div>
      <div style={{ height: 40 }} />
      {adminLeaveModal}
    </div>
  );
}
