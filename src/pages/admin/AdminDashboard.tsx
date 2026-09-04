import { useState, useEffect, ReactNode } from "react";
import DateInput from "../../components/DateInput";
import {
  collection,
  addDoc,
  doc,
  updateDoc,
  getDoc,
  setDoc,
  getDocs,
  writeBatch,
  query,
  where,
} from "firebase/firestore";
import { onSnapshot } from "../../data/live";
import { db } from "../../firebase";
import { usePostStatuses, useStockConfig } from "../../hooks/useFirebase";
import {
  MAY_POSTS,
  STATUS_CONFIG,
} from "../../data";
import { CheckIn, AppUser, Party, LeaveRecord, Permission, Product } from "../../types";
import { can, isAdminRole, ROLE_LABELS_PLAIN } from "../../auth/permissions";
import { survey, resetPerson, ResetSurvey, ResetProgress } from "../../data/resetPerson";
import SalesReport from "../reports/SalesReport";
import ReportsHome from "../reports/ReportsHome";
import OpportunitiesScreen from "../reports/OpportunitiesScreen";
import FieldReport from "./FieldReport";
import BeatManager from "../planner/BeatManager";
import Planner from "../planner/Planner";
import BeatImporter from "../planner/BeatImporter";
import {
  Eyebrow, PageHeader, Section, StatGrid, StatCard, EmptyState,
  Field, GhostButton, PrimaryButton, inputStyle,
} from "../../components/ui";
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
  | "leaves"
  | "reports"
  | "field"
  | "reportsHome"
  | "opportunities"
  | "settings"
  | "beats"
  | "planner"
  | "beatImport";

function isValidUrl(url: string): boolean {
  try { return ['http:', 'https:'].includes(new URL(url).protocol) }
  catch { return false }
}

export default function AdminDashboard() {
  const { t, theme } = useTheme();
  const { appUser } = useAuth();
  const { modal: adminLeaveModal, showConfirm: showAdminLeaveConfirm } =
    useConfirm();
  const [subScreen, setSubScreen] = useState<SubScreen>("dashboard");
  /** Set when Field activity is opened from a person's row, so it lands filtered. */
  const [fieldReportWho, setFieldReportWho] = useState<string | undefined>();
  const [allocations, setAllocations] = useState<any[]>([]);
  const [visitLogs, setVisitLogs] = useState<any[]>([]);
  /**
   * Shop visits from the field app, this month.
   *
   * `visit_logs` is the older screen's collection and the outlet flow never
   * writes one, so every count on this dashboard drawn from it read zero no
   * matter how many shops the team walked into. Bounded to the current month:
   * everything here asks about today or this month, and the whole team's
   * history is not something a dashboard should stream.
   */
  const [outletVisits, setOutletVisits] = useState<any[]>([]);
  const [revisitLogs, setRevisitLogs] = useState<any[]>([]);
  const [pendingPayments, setPendingPayments] = useState<any[]>([]);
  const [allAdminPayments, setAllAdminPayments] = useState<any[]>([])
  const [allExpenses, setAllExpenses] = useState<any[]>([])
  const [expandedAdminDays, setExpandedAdminDays] = useState<Set<string>>(new Set([localDateStr()]))
  const [collapsedAdminSections, setCollapsedAdminSections] = useState<Set<string>>(new Set())
  const [leaveRecords, setLeaveRecords] = useState<LeaveRecord[]>([]);
  const [parties, setParties] = useState<Party[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [routeCount, setRouteCount] = useState(0);
  const [plannedThisWeek, setPlannedThisWeek] = useState(0);
  const [mainTab, setMainTab] = useState<MainTab>("overview");
  const [salesTab, setSalesTab] = useState<SalesTab>("offline");
  const [marketingTab, setMarketingTab] = useState<MarketingTab>("offline");
  const { statuses } = usePostStatuses(MONTH);
  const { config } = useStockConfig();

  // Sales filters
  const [salesUsers, setSalesUsers] = useState<AppUser[]>([]);
  const [selectedUser, setSelectedUser] = useState<string>("all");
  const [dateMode, setDateMode] = useState<"day" | "month" | "period">("day");
  const [expandedAllocPerson, setExpandedAllocPerson] = useState<string | null>(null);
  const [expandedPaymentPerson, setExpandedPaymentPerson] = useState<string | null>(null);
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
  const [settingsMapperLink, setSettingsMapperLink] = useState('');
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [dangerSelected, setDangerSelected] = useState<Set<string>>(new Set())
  const [dangerConfirm, setDangerConfirm] = useState('')
  const [dangerClearing, setDangerClearing] = useState(false)
  const [dangerStep, setDangerStep] = useState<'idle' | 'confirm'>('idle')
  const [dangerDone, setDangerDone] = useState<string[]>([])
  const [dangerError, setDangerError] = useState<string | null>(null)

  // Reset one person — see src/data/resetPerson.ts for what it actually does.
  const [resetUid, setResetUid] = useState('')
  const [resetSurvey, setResetSurvey] = useState<ResetSurvey | null>(null)
  const [resetBusy, setResetBusy] = useState<string | null>(null)
  const [resetConfirm, setResetConfirm] = useState('')
  const [resetDone, setResetDone] = useState<string[] | null>(null)
  const [resetError, setResetError] = useState<string | null>(null)

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
    const u4b = onSnapshot(
      query(collection(db, "outlet_visits"), where("date", ">=", localMonthStr() + "-01")),
      (snap) => setOutletVisits(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    );
    const u5 = onSnapshot(collection(db, "revisit_logs"), (snap) => {
      const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as any);
      setRevisitLogs(all);
    });
    const u5b = onSnapshot(collection(db, "payment_transactions"), (snap) => {
      setPendingPayments(
        snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((p: any) => p.status === "pending_approval"),
      );
    });
    const u6 = onSnapshot(collection(db, "leave_records"), (snap) => {
      setLeaveRecords(
        snap.docs.map((d) => ({ id: d.id, ...d.data() }) as LeaveRecord),
      );
    });
    const u7 = onSnapshot(collection(db, "payment_transactions"), (snap) =>
      setAllAdminPayments(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
    );
    const u8 = onSnapshot(collection(db, "expense_entries"), (snap) =>
      setAllExpenses(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
    );
    const u9 = onSnapshot(collection(db, "products"), (snap) =>
      setProducts(
        snap.docs
          .map((d) => ({ id: d.id, ...d.data() }) as Product)
          .filter((p) => p.active),
      )
    );
    const u10 = onSnapshot(collection(db, "sales_routes"), (snap) =>
      setRouteCount(snap.docs.length)
    );
    // This week's assignments, for the tile's count. Monday to Saturday —
    // Sunday cannot be worked, so it is never planned.
    const mon = new Date();
    mon.setDate(mon.getDate() - (mon.getDay() === 0 ? 6 : mon.getDay() - 1));
    const monStr = localDateStr(mon);
    const sat = new Date(mon); sat.setDate(sat.getDate() + 5);
    const u11 = onSnapshot(
      query(
        collection(db, "work_plans"),
        where("date", ">=", monStr),
        where("date", "<=", localDateStr(sat)),
      ),
      (snap) => setPlannedThisWeek(snap.docs.length),
      () => setPlannedThisWeek(0),
    );
    return () => {
      u0(); u3(); u4(); u4b(); u5(); u5b(); u6(); u7(); u8(); u9(); u10(); u11();
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

  // Who is out in the field right now. Scoped to today so it stays cheap.
  const [todayDuty, setTodayDuty] = useState<any[]>([]);
  useEffect(() => {
    const today = localDateStr();
    return onSnapshot(
      query(collection(db, "duty_sessions"), where("date", "==", today)),
      // No error callback needed — data/live.ts logs the path and surfaces it.
      (snap: any) => setTodayDuty(snap.docs.map((d: any) => ({ id: d.id, ...d.data() }))),
    );
  }, []);

  useEffect(() => {
    if (appUser?.role !== 'super_admin') return;
    getDoc(doc(db, 'config', 'settings')).then(snap => {
      if (snap.exists()) setSettingsMapperLink(snap.data().mapperLink || '');
    }).catch(() => {});
  }, [appUser?.role]);

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

  if (subScreen === "settings") return (
    <div style={{ minHeight: 'var(--oc-screen)', background: t.bg, paddingBottom: 40 }}>
      <PageHeader
        eyebrow="Super admin"
        title="Settings"
        subtitle="App configuration and links."
        onBack={() => setSubScreen('dashboard')}
      />

      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 28 }}>
        <Section label="Mapper link">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 560 }}>
            <div style={{ fontSize: 14, fontWeight: 400, color: t.text3, lineHeight: 1.6 }}>
              The mapper turns a Zoho export into the column layout the importer expects. Whatever you
              put here shows up as a step in the Import screen.
            </div>
            <Field label="Link"
              error={settingsMapperLink && !isValidUrl(settingsMapperLink)
                ? 'Enter a URL starting with https://'
                : undefined}>
              <input
                type="url"
                value={settingsMapperLink}
                onChange={e => { setSettingsMapperLink(e.target.value); setSettingsSaved(false); }}
                placeholder="https://docs.google.com/spreadsheets/..."
                style={inputStyle(t)}
              />
              {settingsMapperLink && isValidUrl(settingsMapperLink) && (
                <a href={settingsMapperLink} target="_blank" rel="noopener noreferrer"
                  style={{ display: 'block', marginTop: 8, fontSize: 13, fontWeight: 400,
                           color: t.accent, wordBreak: 'break-all', textDecoration: 'none' }}>
                  Open it
                </a>
              )}
            </Field>
            <div>
              <PrimaryButton
                onClick={async () => {
                  setSettingsSaving(true);
                  try {
                    await setDoc(doc(db, 'config', 'settings'), { mapperLink: settingsMapperLink.trim() }, { merge: true });
                    setSettingsSaved(true);
                  } finally {
                    setSettingsSaving(false);
                  }
                }}
                disabled={settingsSaving || (!!settingsMapperLink && !isValidUrl(settingsMapperLink))}>
                {settingsSaving ? 'Saving' : settingsSaved ? 'Saved' : 'Save'}
              </PrimaryButton>
            </div>
          </div>
        </Section>

        {/* ── Reset one person ── */}
        {(() => {
          const person = salesUsers.find(u => u.uid === resetUid)
          const armed = !!person && resetConfirm.trim() === person.name.trim()

          const runSurvey = async () => {
            setResetError(null); setResetDone(null); setResetSurvey(null)
            setResetBusy('Reading their records…')
            try {
              setResetSurvey(await survey(resetUid))
            } catch (e: any) {
              setResetError(e?.message || 'Could not read their records.')
            } finally { setResetBusy(null) }
          }

          const runReset = async () => {
            setResetError(null)
            setResetBusy('Starting…')
            try {
              const done = await resetPerson(resetUid, (p: ResetProgress) => setResetBusy(p.step))
              setResetDone(done)
              setResetSurvey(null); setResetConfirm(''); setResetUid('')
            } catch (e: any) {
              setResetError(
                (e?.code === 'permission-denied'
                  ? 'Firestore refused part of this. '
                  : '') +
                (e?.message || 'It stopped partway.') +
                ' Some of it may already be done — run the preview again to see what is left.',
              )
            } finally { setResetBusy(null) }
          }

          return (
            <div style={{
              background: 'rgba(220,38,38,0.05)', borderRadius: 16, padding: 20,
              border: '1.5px solid rgba(220,38,38,0.25)', marginBottom: 28,
            }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: t.warn, marginBottom: 4 }}>
                Reset one person
              </div>
              <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 16, lineHeight: 1.5 }}>
                Erases everything a rep has ever done and puts back what it moved — stock returns to
                the company, locked packets are released, and bills they settled are owed again.
                Meant for handing a test account back clean.
                <br /><br />
                Their shops go too. Look at the preview before you confirm: if a colleague has
                traded with one of those shops, that work is left pointing at a shop that no longer
                exists.
              </div>

              {resetError && (
                <div style={{ background: 'rgba(220,38,38,0.12)', border: '1px solid rgba(220,38,38,0.4)', borderRadius: 10, padding: '10px 14px', marginBottom: 14, fontSize: 12, color: '#f87171', lineHeight: 1.5 }}>
                  {resetError}
                </div>
              )}

              {resetDone && (
                <div style={{ background: 'rgba(22,163,74,0.1)', border: '1px solid rgba(22,163,74,0.25)', borderRadius: 10, padding: '10px 14px', marginBottom: 14, fontSize: 12, color: '#6ee7b7', lineHeight: 1.6 }}>
                  Done — {resetDone.join(' · ')}
                </div>
              )}

              <div style={{ maxWidth: 460, marginBottom: 14 }}>
                <CustomSelect
                  value={resetUid}
                  onChange={v => { setResetUid(v); setResetSurvey(null); setResetConfirm(''); setResetDone(null) }}
                  options={salesUsers.map(u => ({ value: u.uid, label: u.name, sub: ROLE_LABELS_PLAIN[u.role] }))}
                  placeholder="Choose a person"
                />
              </div>

              {resetUid && !resetSurvey && (
                <GhostButton onClick={runSurvey} disabled={!!resetBusy}>
                  {resetBusy || 'Show me what this would delete'}
                </GhostButton>
              )}

              {resetSurvey && (
                <div style={{ background: 'rgba(220,38,38,0.08)', border: '1.5px solid rgba(220,38,38,0.3)', borderRadius: 12, padding: 16 }}>
                  {resetSurvey.unreadable.length > 0 && (
                    <div style={{ background: 'rgba(220,38,38,0.15)', borderRadius: 8, padding: '10px 12px', marginBottom: 10, fontSize: 12, color: '#fca5a5', lineHeight: 1.6 }}>
                      <strong>Could not read: {resetSurvey.unreadable.join(', ')}.</strong> The
                      deployed rules refuse it, so those are not counted below and the reset will
                      not clear them. Deploy the current firestore.rules and try again.
                    </div>
                  )}

                  {resetSurvey.total === 0 && resetSurvey.unreadable.length === 0 ? (
                    <div style={{ fontSize: 13, color: '#94a3b8' }}>
                      {person?.name} has no records. Nothing to reset.
                    </div>
                  ) : (
                    <>
                      <div style={{ fontSize: 12, color: '#f87171', marginBottom: 10, lineHeight: 1.7 }}>
                        <strong>{person?.name}</strong> — {resetSurvey.total} records will be
                        permanently deleted:
                        <br />
                        {resetSurvey.counts.map(c => `${c.n} ${c.label.toLowerCase()}`).join(' · ')}
                      </div>

                      {resetSurvey.collected > 0 && (
                        <div style={{ fontSize: 12, color: '#f87171', marginBottom: 10, lineHeight: 1.6 }}>
                          ₹{resetSurvey.collected.toLocaleString('en-IN')} of collections will be
                          undone
                          {resetSurvey.foreignBillsTouched > 0
                            ? `, putting ${resetSurvey.foreignBillsTouched} bill(s) raised by other people back into what is owed.`
                            : '.'}
                        </div>
                      )}

                      {Object.keys(resetSurvey.stockReturned).length > 0 && (
                        <div style={{ fontSize: 12, color: '#f87171', marginBottom: 10, lineHeight: 1.6 }}>
                          {Object.entries(resetSurvey.stockReturned)
                            .map(([pid, n]) => `${n} packets of ${products.find(p => p.id === pid)?.name || 'a product'}`)
                            .join(', ')} will be taken back off the shops and returned to company stock.
                        </div>
                      )}

                      {resetSurvey.partiesUsedByOthers.length > 0 && (
                        <div style={{ background: 'rgba(220,38,38,0.15)', borderRadius: 8, padding: '10px 12px', marginBottom: 10, fontSize: 12, color: '#fca5a5', lineHeight: 1.6 }}>
                          <strong>{resetSurvey.partiesUsedByOthers.length} of their shops are used
                          by other people</strong> and will still be deleted:
                          <br />
                          {resetSurvey.partiesUsedByOthers.map(p => `${p.name} (${p.why})`).join('; ')}
                        </div>
                      )}

                      <div style={{ fontSize: 12, color: '#f87171', marginBottom: 10 }}>
                        Type <strong>{person?.name}</strong> to confirm.
                      </div>
                      <input
                        value={resetConfirm}
                        onChange={e => setResetConfirm(e.target.value)}
                        placeholder={person?.name}
                        style={{ width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,0.06)', border: '1.5px solid rgba(220,38,38,0.4)', borderRadius: 10, padding: '12px 14px', fontSize: 16, minHeight: 44, color: '#fff', outline: 'none', marginBottom: 10 }}
                      />
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          onClick={() => { setResetSurvey(null); setResetConfirm('') }}
                          style={{ flex: 1, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#94a3b8', borderRadius: 10, padding: '12px', fontSize: 13, fontWeight: 500, minHeight: 44, cursor: 'pointer' }}>
                          Cancel
                        </button>
                        <button
                          onClick={runReset}
                          disabled={!armed || !!resetBusy}
                          style={{ flex: 2, background: armed ? '#dc2626' : 'rgba(220,38,38,0.2)', border: 'none', color: '#fff', borderRadius: 10, padding: '12px', fontSize: 13, fontWeight: 500, minHeight: 44, cursor: armed ? 'pointer' : 'not-allowed', opacity: resetBusy ? 0.6 : 1 }}>
                          {resetBusy || `Erase everything ${person?.name} has done`}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          )
        })()}

        {/* ── Danger Zone ── */}
        {(() => {
          /**
           * What "clear this" means, per group.
           *
           * Grouped rather than one box per collection, because these records
           * refer to each other and half a clear is worse than none. Orders
           * without their receipts leave payments pointing at bills that no
           * longer exist; visits without their duty sessions leave days on
           * which nobody went anywhere. A group is the smallest unit that
           * leaves the data consistent.
           *
           * Both generations of the field app are listed together on purpose.
           * Visits used to be `revisit_logs` and are now `outlet_visits`, and
           * a super admin clearing "field work" means all of it — not whichever
           * half the app happened to be writing when this list was last edited.
           */
          const CLEARABLE: { id: string; label: string; desc: string; collections: string[] }[] = [
            {
              id: 'field_work',
              label: 'Field work',
              desc: 'Visits, punch in and out, odometer readings, phone and WhatsApp orders, shared visits, check-ins',
              collections: [
                'outlet_visits', 'duty_sessions', 'remote_contacts',
                'revisit_logs', 'visit_logs', 'visit_share_requests', 'checkins',
              ],
            },
            {
              id: 'orders',
              label: 'Orders and stock movement',
              desc: 'Allocations, dispatches, the stock ledger and every indent. Also puts locked stock back to zero',
              collections: [
                'allocations_v2', 'dispatches', 'stock_ledger', 'stock_movements',
                'credits', 'retailer_indents',
              ],
            },
            { id: 'money', label: 'Payments', desc: 'Every recorded collection and its confirmation',
              collections: ['payment_transactions'] },
            { id: 'expenses', label: 'Expenses', desc: 'Claims and the weekly submissions that wrap them',
              collections: ['expense_entries', 'expense_reports'] },
            { id: 'leave', label: 'Leave', desc: 'All leave requests and approvals',
              collections: ['leave_records'] },
            { id: 'parties', label: 'Parties', desc: 'Retailers, distributors and the stock they hold',
              collections: ['parties'] },
            // password_requests is deliberately not here. Its rule is
            // `allow write: if false` — only the Cloud Function that raises a
            // request may touch it, and that runs on admin credentials. Adding
            // it would make this whole group fail with permission-denied, and
            // loosening a rule that tight for a housekeeping button is the
            // wrong trade. Those rows are small and close themselves when a
            // password is next reset.
            { id: 'alerts', label: 'Notifications', desc: 'The alert queue — every notification raised so far',
              collections: ['alerts'] },
            {
              id: 'users',
              label: 'User records',
              desc: 'Every account record except super admins. Does not remove their sign-in — see below',
              collections: ['users'],
            },
          ]

          const toggleAll = (checked: boolean) =>
            setDangerSelected(checked ? new Set(CLEARABLE.map(c => c.id)) : new Set())

          const handleClear = async () => {
            setDangerClearing(true)
            setDangerError(null)
            const cleared: string[] = []
            try {
              for (const groupId of Array.from(dangerSelected)) {
                const group = CLEARABLE.find(c => c.id === groupId)
                if (!group) continue
                for (const colId of group.collections) {
                  const snap = await getDocs(collection(db, colId))
                  // Super admins are excluded here as well as in the rules. The
                  // rule is what actually stops it; this stops a whole batch
                  // dying on one document it was never going to be allowed to
                  // delete, taking the other 498 with it.
                  const docs = colId === 'users'
                    ? snap.docs.filter(d => (d.data() as any).role !== 'super_admin')
                    : snap.docs
                  for (let i = 0; i < docs.length; i += 499) {
                    const batch = writeBatch(db)
                    docs.slice(i, i + 499).forEach(d => batch.delete(d.ref))
                    await batch.commit()
                  }
                }
                // Locked stock is a reservation an allocation holds. Delete the
                // allocations and nothing stands behind the reservation — the
                // packets stay unavailable for good, and no screen explains
                // why. Releasing it belongs to clearing the orders, not to a
                // tidy-up somebody has to remember afterwards.
                if (groupId === 'orders') {
                  const stockSnap = await getDoc(doc(db, 'config', 'stock'))
                  const productStock = (stockSnap.data() as any)?.productStock
                  if (productStock) {
                    const release: Record<string, unknown> = { updatedAt: Date.now() }
                    Object.keys(productStock).forEach(id => {
                      release[`productStock.${id}.locked`] = 0
                    })
                    await updateDoc(doc(db, 'config', 'stock'), release)
                  }
                }
                cleared.push(group.label)
              }
              setDangerDone(cleared)
              setDangerSelected(new Set())
              setDangerConfirm('')
              setDangerStep('idle')
            } catch (e: any) {
              // Without this it failed in silence: the button span back to
              // normal, nothing was deleted, and there was no way to tell that
              // apart from success.
              setDangerError(
                (cleared.length > 0
                  ? `Cleared ${cleared.join(', ')}, then stopped. `
                  : 'Nothing was deleted. ') +
                (e?.code === 'permission-denied'
                  ? 'Firestore refused the delete. Check the deployed rules still let a super admin remove these.'
                  : e?.message || 'Firestore rejected the request.'),
              )
              setDangerDone(cleared)
            } finally {
              setDangerClearing(false)
            }
          }

          return (
            <div style={{ background: 'rgba(220,38,38,0.05)', borderRadius: 16, padding: 20, border: '1.5px solid rgba(220,38,38,0.25)' }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: t.warn, marginBottom: 4 }}>Danger zone</div>
              <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 16, lineHeight: 1.5 }}>
                Permanently deletes data from Firestore. There is no undo and no backup taken.
                <br /><br />
                Clearing <strong>User records</strong> removes the account record — the role, the
                permissions, the name — but not the sign-in itself, which lives in Firebase Auth and
                cannot be removed from here. Those people can still log in, and will land on the
                screen for an account that has not been set up. Remove them in User management first
                if you want them actually gone.
              </div>

              {dangerError && (
                <div style={{ background: 'rgba(220,38,38,0.12)', border: '1px solid rgba(220,38,38,0.4)', borderRadius: 10, padding: '10px 14px', marginBottom: 14, fontSize: 12, color: '#f87171', lineHeight: 1.5 }}>
                  {dangerError}
                </div>
              )}

              {dangerDone.length > 0 && (
                <div style={{ background: 'rgba(22,163,74,0.1)', border: '1px solid rgba(22,163,74,0.25)', borderRadius: 10, padding: '10px 14px', marginBottom: 14, fontSize: 12, color: '#6ee7b7' }}>
                  Cleared: {dangerDone.join(', ')}
                </div>
              )}

              {/* Collection checkboxes */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
                {/* The label wraps the box and the words, so the whole row is
                    the target — it just has to be tall enough to be one. */}
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', minHeight: 44, paddingBottom: 8, borderBottom: '1px solid rgba(220,38,38,0.15)' }}>
                  <input type="checkbox"
                    checked={dangerSelected.size === CLEARABLE.length}
                    onChange={e => toggleAll(e.target.checked)}
                    style={{ width: 20, height: 20, accentColor: '#dc2626' }} />
                  <span style={{ fontSize: 12, fontWeight: 500, color: '#dc2626' }}>Select all</span>
                </label>
                {CLEARABLE.map(c => (
                  <label key={c.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, minHeight: 44, paddingTop: 2, cursor: 'pointer' }}>
                    <input type="checkbox"
                      checked={dangerSelected.has(c.id)}
                      onChange={e => {
                        const next = new Set(dangerSelected)
                        e.target.checked ? next.add(c.id) : next.delete(c.id)
                        setDangerSelected(next)
                        setDangerStep('idle')
                        setDangerDone([])
                      }}
                      style={{ width: 20, height: 20, marginTop: 2, accentColor: '#dc2626' }} />
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 500, color: '#e2e8f0' }}>{c.label}</div>
                      <div style={{ fontSize: 11, color: '#64748b' }}>{c.desc}</div>
                    </div>
                  </label>
                ))}
              </div>

              {dangerSelected.size > 0 && dangerStep === 'idle' && (
                <button
                  onClick={() => setDangerStep('confirm')}
                  style={{ width: '100%', background: 'rgba(220,38,38,0.12)', border: '1.5px solid rgba(220,38,38,0.35)', color: '#dc2626', borderRadius: 12, padding: '12px', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>
 Delete {dangerSelected.size} collection{dangerSelected.size > 1 ?'s' :''} →
                </button>
              )}

              {dangerStep === 'confirm' && (
                <div style={{ background: 'rgba(220,38,38,0.08)', border: '1.5px solid rgba(220,38,38,0.3)', borderRadius: 12, padding: 16 }}>
                  <div style={{ fontSize: 12, color: '#f87171', marginBottom: 10, lineHeight: 1.5 }}>
                    You are about to permanently delete all data from:<br />
                    <strong>{Array.from(dangerSelected).join(', ')}</strong><br /><br />
                    Type <strong>DELETE</strong> below to confirm.
                  </div>
                  <input
                    value={dangerConfirm}
                    onChange={e => setDangerConfirm(e.target.value)}
                    placeholder="Type DELETE to confirm"
                    style={{ width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,0.06)', border: '1.5px solid rgba(220,38,38,0.4)', borderRadius: 10, padding: '12px 14px', fontSize: 16, minHeight: 44, color: '#fff', outline: 'none', marginBottom: 10 }}
                  />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={() => { setDangerStep('idle'); setDangerConfirm('') }}
                      style={{ flex: 1, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#94a3b8', borderRadius: 10, padding: '12px', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>
                      Cancel
                    </button>
                    <button
                      onClick={handleClear}
                      disabled={dangerConfirm !== 'DELETE' || dangerClearing}
                      style={{ flex: 2, background: dangerConfirm === 'DELETE' ? '#dc2626' : 'rgba(220,38,38,0.2)', border: 'none', color: '#fff', borderRadius: 10, padding: '12px', fontSize: 13, fontWeight: 500, cursor: dangerConfirm === 'DELETE' ? 'pointer' : 'not-allowed', opacity: dangerClearing ? 0.6 : 1 }}>
                      {dangerClearing ? 'Clearing…' : 'Confirm delete'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })()}
      </div>
    </div>
  );

  if (subScreen === "stock")
    return <StockManager onBack={() => setSubScreen("dashboard")} />;
  if (subScreen === "allocations")
    return (
      <AllocationManager
        onBack={() => setSubScreen("dashboard")}
        parties={parties}
        isAdmin={can(appUser, "dispatch_allocations")}
      />
    );
  // The reports front door. Both screens below it existed and neither was
  // findable — this is a way in, not a third report.
  if (subScreen === "reportsHome")
    return (
      <ReportsHome
        onBack={() => setSubScreen("dashboard")}
        onOpenField={() => setSubScreen("field")}
        onOpenSales={() => setSubScreen("reports")}
        onOpenOpportunities={() => setSubScreen("opportunities")}
      />
    );
  if (subScreen === "opportunities")
    return <OpportunitiesScreen onBack={() => setSubScreen("reportsHome")} />;
  if (subScreen === "reports")
    return <SalesReport onBack={() => setSubScreen("reportsHome")} />;
  if (subScreen === "field")
    return (
      <FieldReport
        // Remounts when the person changes. initialWho seeds useState, which
        // only runs on mount — without this, opening one rep and then another
        // would leave the first one's filter in place.
        key={fieldReportWho ?? "all"}
        initialWho={fieldReportWho}
        onBack={() => {
          // Back to wherever it was opened from: the dashboard row, or the
          // reports menu.
          const to: SubScreen = fieldReportWho ? "dashboard" : "reportsHome";
          setFieldReportWho(undefined);
          setSubScreen(to);
        }}
      />
    );
  if (subScreen === "products")
    return <ProductManager onBack={() => setSubScreen("dashboard")} />;
  if (subScreen === "parties")
    return <PartyManager onBack={() => setSubScreen("dashboard")} />;
  if (subScreen === "credits")
    return <CreditBook onBack={() => setSubScreen("dashboard")} />;
  if (subScreen === "expenses")
    return <ExpenseLogger onBack={() => setSubScreen("dashboard")}
      onViewVisitLog={(userName, date) => {
        setSelectedUser(userName)
        setDateMode("day")
        setDateDay(date)
        setMainTab("sales")
        setSubScreen("dashboard")
      }} />;
  if (subScreen === "leaves")
    return <LeaveTracker onBack={() => setSubScreen("dashboard")} />;

  if (subScreen === "beats")
    return <BeatManager onBack={() => setSubScreen("dashboard")} />;

  if (subScreen === "planner")
    return <Planner onBack={() => setSubScreen("dashboard")} />;

  if (subScreen === "beatImport")
    return <BeatImporter onBack={() => setSubScreen("dashboard")} />;

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

  // ── Figures behind the attention line, stats and module rows ─────────────
  const inr = (n: number) =>
    n >= 1e7 ? `₹${(n / 1e7).toFixed(2)} Cr`
    : n >= 1e5 ? `₹${(n / 1e5).toFixed(2)} L`
    : n >= 1e3 ? `₹${(n / 1e3).toFixed(1)} K`
    : `₹${Math.round(n)}`;

  // Packed and past their planned send date — the things actually waiting.
  const readyToSend = allocations.filter(
    (a: any) => a.status === "pending" && a.plannedDate <= todayStr,
  ).length;

  const owedByParty = new Map<string, number>();
  allocations
    .filter((a: any) => a.status === "sent" && a.paymentType === "credit")
    .forEach((a: any) => {
      const due = (a.totalAmount || 0) - (a.paidAmount || 0);
      if (due > 0) owedByParty.set(a.partyId, (owedByParty.get(a.partyId) ?? 0) + due);
    });
  const owedTotal = Array.from(owedByParty.values()).reduce((s, v) => s + v, 0);
  const owedAccounts = owedByParty.size;

  const thisMonth = localMonthStr();
  const monthSpend = allExpenses
    .filter((e: any) => (e.date || "").startsWith(thisMonth))
    .reduce((s: number, e: any) => s + (e.amount || 0), 0);
  // Both flows, so the number is right whichever screen the team is using.
  // An abandoned visit never collected an outcome and is not counted, the same
  // exclusion the sales report makes.
  const visitsThisMonth =
    visitLogs
      .filter((l: any) => (l.date || "").startsWith(thisMonth))
      .reduce((s: number, l: any) => s + (l.visits?.length || 0), 0) +
    outletVisits.filter((v: any) => v.status !== "abandoned").length;

  const stockUnits = config.productStock && Object.keys(config.productStock).length
    ? Object.values(config.productStock).reduce((s, p) => s + (p.total - p.locked), 0)
    : Math.max(0, (config.total || 0) - (config.locked || 0));

  const districts = new Set(parties.map((p) => p.district).filter(Boolean)).size;
  const distCount = parties.filter((p) => p.type === "distributor").length;
  const retailCount = parties.filter((p) => p.type === "retailer").length;
  const linkedRetailers = parties.filter(
    (p) => p.type === "retailer" && (p as any).underDistributorId,
  ).length;
  const activeCount = parties.filter((p) => (p as any).status === "active").length;
  const prospectCount = parties.filter((p) => (p as any).status === "prospect").length;

  // Which permission each module row requires. Admins hold all of them;
  // a sales_manager only sees the rows they have been granted.
  //
  // A tile with no entry here is dropped for managers and shown to admins,
  // because can() returns true for an admin whatever it is handed — including
  // undefined. Whoever adds a tile is usually an admin, so it looks like it
  // works and is invisible to exactly the people it was built for. Add the row
  // here at the same time as the tile.
  const SCREEN_PERMISSION: Record<string, Permission> = {
    stock: "view_stock",
    parties: "view_parties",
    allocations: "view_allocations",
    products: "view_products",
    credits: "view_credit",
    expenses: "view_expenses",
    leaves: "view_leave",
    reports: "view_reports",
    field: "view_reports",
    reportsHome: "view_reports",
    opportunities: "view_reports",
    beats: "assign_work",
    planner: "assign_work",
    beatImport: "assign_work",
  };

  // The nav doubles as a status board: every row carries its own live number,
  // so you can see which module needs you before clicking into it.
  const modules = [
    {
      name: "Stock",
      desc: "Count, adjust and reconcile inventory",
      screen: "stock" as SubScreen,
      value: `${stockUnits.toLocaleString("en-IN")} units`,
    },
    {
      name: "Distributors & retailers",
      desc: "Add accounts and keep their details current",
      screen: "parties" as SubScreen,
      value: `${parties.length} accounts`,
    },
    {
      name: "Allocations",
      desc: "Plan, dispatch and track every stock movement",
      screen: "allocations" as SubScreen,
      value: readyToSend > 0 ? `${readyToSend} waiting` : "All sent",
      warn: readyToSend > 0,
    },
    {
      name: "Products",
      desc: "Set what you sell, and the price you sell it at",
      screen: "products" as SubScreen,
      value: `${products.length} products`,
    },
    {
      name: "Credit book",
      desc: "See who owes what, and settle it",
      screen: "credits" as SubScreen,
      value: owedTotal > 0 ? `${inr(owedTotal)} due` : "Nothing due",
      warn: owedTotal > 0,
    },
    {
      name: "Expenses",
      desc: "Team spend, logged and approved",
      screen: "expenses" as SubScreen,
      value: `${inr(monthSpend)} this month`,
    },
    {
      name: "Beats",
      desc: "The areas your team works, and the shops in each",
      screen: "beats" as SubScreen,
      value: routeCount > 0 ? `${routeCount} beats` : "None yet",
    },
    {
      name: "The week",
      desc: "Give each rep their beats for the days ahead",
      screen: "planner" as SubScreen,
      value: plannedThisWeek > 0 ? `${plannedThisWeek} days planned` : "Nothing planned",
      warn: plannedThisWeek === 0 && routeCount > 0,
    },
    {
      name: "Import a beat sheet",
      desc: "The spreadsheet from the group — shops and their beats in one pass",
      screen: "beatImport" as SubScreen,
      value: "From Excel",
    },
    {
      name: "Leave tracker",
      desc: "Approve time off and see who is out",
      screen: "leaves" as SubScreen,
      value:
        pendingLeaveCount > 0
          ? `${pendingLeaveCount} to approve`
          : onLeaveTodayCount > 0
            ? `${onLeaveTodayCount} out today`
            : "Nobody out",
      warn: pendingLeaveCount > 0,
    },
    // One door instead of two. Field activity and the sales report both still
    // exist and are unchanged — they were simply two tiles that sounded alike,
    // so nobody knew which one held the answer they were after.
    {
      name: "Reports",
      desc: "Growth against last period, attendance, and every visit in detail",
      screen: "reportsHome" as SubScreen,
      value: todayDuty.filter((d: any) => d.status === "active").length > 0
        ? `${todayDuty.filter((d: any) => d.status === "active").length} out now`
        : `${visitsThisMonth} visits`,
      warn: todayDuty.filter((d: any) => d.status === "active").length > 0,
    },
    ...(appUser?.role === "super_admin"
      ? [{
          name: "Settings",
          desc: "Mapper links and app configuration",
          screen: "settings" as SubScreen,
          value: "—",
        }]
      : []),
  ].filter(
    (m) => m.screen === "settings" || can(appUser, SCREEN_PERMISSION[m.screen]),
  );

  const allocWord = (s: string) =>
    ({ pending: "Pending", sent: "Sent", paid: "Paid", overdue: "Overdue", cancelled: "Cancelled" } as Record<string, string>)[s] ?? s;
  const payWord = (s: string) =>
    ({ pending_approval: "Pending approval", approved: "Approved", rejected: "Rejected" } as Record<string, string>)[s] ?? s;

  // Neutral filter chip — selection is shown by border and text weight, not colour.
  const chipStyle = (active: boolean) => ({
    background: "none",
    border: `0.5px solid ${active ? t.text2 : t.border}`,
    borderRadius: 99,
    padding: "6px 13px",
    fontSize: 12,
    fontWeight: 400 as const,
    color: active ? t.text : t.text3,
    cursor: "pointer",
    whiteSpace: "nowrap" as const,
  });

  // An inline link on a number in the attention line.
  const numLink = (label: ReactNode, to: SubScreen) => (
    <button
      className="oc-action"
      onClick={() => setSubScreen(to)}
      style={{
        background: "none",
        border: "none",
        padding: 0,
        font: "inherit",
        color: t.warn,
        textDecoration: "underline",
        textUnderlineOffset: 3,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );

  const attention: ReactNode[] = [];
  if (readyToSend > 0)
    attention.push(
      <span key="alloc">
        {numLink(readyToSend, "allocations")}
        {readyToSend === 1 ? " allocation is" : " allocations are"} packed and
        waiting to go out
      </span>,
    );
  if (owedTotal > 0)
    attention.push(
      <span key="credit">
        {numLink(inr(owedTotal), "credits")} is still owed across {owedAccounts}{" "}
        {owedAccounts === 1 ? "account" : "accounts"}
      </span>,
    );
  if (attention.length < 2 && pendingPayments.length > 0)
    attention.push(
      <span key="pay">
        {numLink(pendingPayments.length, "credits")}
        {pendingPayments.length === 1
          ? " collected payment needs"
          : " collected payments need"}{" "}
        your confirmation
      </span>,
    );
  if (attention.length < 2 && pendingLeaveCount > 0)
    attention.push(
      <span key="leave">
        {numLink(pendingLeaveCount, "leaves")}
        {pendingLeaveCount === 1
          ? " leave request is"
          : " leave requests are"}{" "}
        waiting on you
      </span>,
    );

  const tabs = [
    { id: "overview", label: "Overview" },
    { id: "sales", label: "Sales" },
    ...(isAdminRole(appUser) ? [{ id: "marketing", label: "Marketing" }] : []),
    ...(can(appUser, "view_workspace")
      ? [{ id: "workspace", label: "Workspace" }]
      : []),
  ] as { id: MainTab; label: string }[];

  return (
    <div style={{ minHeight: "var(--oc-screen)", background: t.bg }}>
      {/* Attention line — what is actually waiting, in one sentence */}
      <div style={{ padding: "30px 20px 10px", maxWidth: 720 }}>
        <div
          style={{
            fontSize: 11,
            letterSpacing: "0.09em",
            textTransform: "uppercase",
            color: t.text3,
            marginBottom: 10,
          }}
        >
          Needs you today
        </div>
        <p
          style={{
            fontSize: 21,
            lineHeight: 1.5,
            fontWeight: 400,
            color: t.text,
            margin: 0,
          }}
        >
          {attention.length === 0 ? (
            "Nothing is waiting on you. The team's activity is up to date."
          ) : (
            <>
              {attention[0]}
              {attention[1] && <>, and {attention[1]}</>}.
            </>
          )}
        </p>
      </div>

      {/* Tabs */}
      <div
        style={{
          padding: "0 20px",
          borderBottom: `0.5px solid ${t.border}`,
        }}
      >
        <div className="oc-scroll-x" style={{ display: "flex", gap: 24 }}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className="oc-action"
              onClick={() => setMainTab(tab.id)}
              style={{
                background: "none",
                border: "none",
                padding: "15px 0 13px",
                fontSize: 14,
                fontWeight: mainTab === tab.id ? 500 : 400,
                color: mainTab === tab.id ? t.text : t.text2,
                borderBottom: `2px solid ${mainTab === tab.id ? t.text : "transparent"}`,
                marginBottom: "-0.5px",
                cursor: "pointer",
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
          padding: "26px 20px 56px",
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
            style={{ display: "flex", flexDirection: "column", gap: 30 }}
          >
            {/* Stats */}
            <div className="oc-stats">
              {[
                {
                  n: distCount,
                  label: "Distributors",
                  ctx:
                    districts > 0
                      ? `Across ${districts} ${districts === 1 ? "district" : "districts"}`
                      : "No districts recorded yet",
                },
                {
                  n: retailCount,
                  label: "Retailers",
                  ctx: `${linkedRetailers} linked to a distributor`,
                },
                {
                  n: activeCount,
                  label: "Active accounts",
                  ctx: `${prospectCount} still prospects`,
                },
              ].map((s) => (
                <div
                  key={s.label}
                  style={{
                    background: t.tint,
                    borderRadius: 6,
                    padding: "16px 16px 14px",
                  }}
                >
                  <div
                    style={{
                      fontSize: 26,
                      fontWeight: 500,
                      color: t.text,
                      lineHeight: 1.1,
                    }}
                  >
                    {s.n}
                  </div>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 400,
                      color: t.text,
                      marginTop: 6,
                    }}
                  >
                    {s.label}
                  </div>
                  <div style={{ fontSize: 12, color: t.text3, marginTop: 2 }}>
                    {s.ctx}
                  </div>
                </div>
              ))}
            </div>

            {/* Modules — the nav doubles as a status board */}
            <div
              className="oc-modules"
              style={{ borderBottom: `0.5px solid ${t.border}` }}
            >
              {modules.map((m) => (
                <button
                  key={m.screen}
                  className="oc-row"
                  onClick={() => setSubScreen(m.screen)}
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: 16,
                    width: "100%",
                    textAlign: "left",
                    background: "none",
                    border: "none",
                    borderTop: `0.5px solid ${t.border}`,
                    padding: "16px 14px",
                    cursor: "pointer",
                  }}
                >
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span
                      style={{
                        display: "block",
                        fontSize: 15,
                        fontWeight: 500,
                        color: t.text,
                      }}
                    >
                      {m.name}
                    </span>
                    <span
                      style={{
                        display: "block",
                        fontSize: 13,
                        fontWeight: 400,
                        color: t.text3,
                        marginTop: 3,
                      }}
                    >
                      {m.desc}
                    </span>
                  </span>
                  <span
                    style={{
                      fontSize: 14,
                      fontWeight: 400,
                      color: (m as any).warn ? t.warn : t.text2,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {m.value}
                  </span>
                </button>
              ))}
            </div>

            {/* Visits today */}
            {(() => {
              /**
               * One row per rep who has been into a shop today, from both flows.
               *
               * This read `visit_logs` alone, which the outlet flow never
               * writes — so it said "nobody has logged a visit yet today" to a
               * manager whose team had been round thirty shops.
               */
              const byRep = new Map<string, { name: string; visits: number; orders: number }>();
              // Distance is claimed off the odometer, so it lives on the duty
              // session rather than on any visit.
              const kmByRep = new Map<string, number>();
              todayDuty.forEach((s: any) => {
                if (typeof s.claimedDistanceKm === "number")
                  kmByRep.set(s.uid, (kmByRep.get(s.uid) ?? 0) + s.claimedDistanceKm);
              });
              visitLogs
                .filter((l: any) => l.date === todayStr && !l.isNoEntry)
                .forEach((l: any) => {
                  const row = byRep.get(l.salesPersonId) ?? {
                    name: l.salesPersonName, visits: 0, orders: 0,
                  };
                  row.visits += l.totalVisited || 0;
                  row.orders += l.totalInterested || 0;
                  byRep.set(l.salesPersonId, row);
                });
              outletVisits
                .filter((v: any) => v.date === todayStr && v.status !== "abandoned")
                .forEach((v: any) => {
                  const row = byRep.get(v.uid) ?? { name: v.name, visits: 0, orders: 0 };
                  row.visits += 1;
                  if (v.orderPlaced) row.orders += 1;
                  byRep.set(v.uid, row);
                });
              const todayLogs = [...byRep.entries()]
                .map(([uid, r]) => ({ id: uid, ...r }))
                .sort((a, b) => b.visits - a.visits);
              return (
                <div>
                  <div
                    style={{
                      fontSize: 11,
                      letterSpacing: "0.09em",
                      textTransform: "uppercase",
                      color: t.text3,
                      marginBottom: 12,
                    }}
                  >
                    Visits today
                  </div>
                  {todayLogs.length === 0 ? (
                    <div style={{ fontSize: 14, color: t.text3 }}>
                      Nobody has logged a visit yet today.
                    </div>
                  ) : (
                    todayLogs.map((log: any) => (
                      // Opens the day it summarises. Everything a manager wants
                      // next — the stops on a map, times, distances, remarks,
                      // what was ordered — is already in Field activity, so this
                      // points at it rather than growing a second copy here.
                      <button
                        key={log.id}
                        className="oc-row"
                        onClick={() => { setFieldReportWho(log.id); setSubScreen("field"); }}
                        style={{
                          display: "flex",
                          alignItems: "baseline",
                          justifyContent: "space-between",
                          gap: 16,
                          width: "100%",
                          textAlign: "left",
                          background: "none",
                          border: "none",
                          padding: "11px 0",
                          borderTop: `0.5px solid ${t.border}`,
                          cursor: "pointer",
                        }}
                      >
                        <span
                          style={{
                            fontSize: 14,
                            fontWeight: 400,
                            color: t.text,
                          }}
                        >
                          {log.name}
                        </span>
                        <span
                          style={{
                            fontSize: 13,
                            color: t.text2,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {log.visits} {log.visits === 1 ? "visit" : "visits"}
                          {log.orders > 0
                            ? `, ${log.orders} ${log.orders === 1 ? "order" : "orders"}`
                            : ""}
                          {kmByRep.get(log.id)
                            ? ` · ${kmByRep.get(log.id)} km`
                            : ""}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              );
            })()}

            {/* Online marketing */}
            {isAdminRole(appUser) && (
              <div>
                <div
                  style={{
                    fontSize: 11,
                    letterSpacing: "0.09em",
                    textTransform: "uppercase",
                    color: t.text3,
                    marginBottom: 12,
                  }}
                >
                  Online marketing
                </div>
                <div style={{ fontSize: 15, fontWeight: 400, color: t.text }}>
                  {done} of {MAY_POSTS.length} posts published
                  {missed > 0 && (
                    <span style={{ color: t.warn }}> · {missed} missed</span>
                  )}
                </div>
                <div
                  style={{
                    background: t.tint,
                    borderRadius: 99,
                    height: 2,
                    marginTop: 12,
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${pct}%`,
                      height: "100%",
                      background: t.text2,
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── SALES TAB ───────────────────────────────────────────────────── */}
        {mainTab === "sales" && (
          <div
            className="fade-in"
            style={{ display: "flex", flexDirection: "column", gap: 24 }}
          >
            {/* Offline | Online */}
            <div style={{ display: "flex", gap: 6 }}>
              {(
                [
                  ["offline", "Offline"],
                  ["online", "Online"],
                ] as [SalesTab, string][]
              ).map(([val, label]) => (
                <button
                  key={val}
                  className="oc-action"
                  onClick={() => setSalesTab(val)}
                  style={chipStyle(salesTab === val)}
                >
                  {label}
                </button>
              ))}
            </div>

            {salesTab === "online" && (
              <EmptyState
                title="Online sales"
                body="E-commerce orders and digital campaigns will land here. Offline sales is where the activity is today."
                actionLabel="View offline sales"
                onAction={() => setSalesTab("offline")}
              />
            )}

            {/* Offline Sales — filters + check-ins */}
            {salesTab === "offline" && (
              <>
                {/* Filters */}
                <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

                  {/* Who */}
                  <div>
                    <div style={{ marginBottom: 8 }}><Eyebrow>Who</Eyebrow></div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <button className="oc-action" onClick={() => setSelectedUser("all")}
                        style={chipStyle(selectedUser === "all")}>
                        Everyone
                      </button>
                      {salesUsers.map((u) => {
                        const onLeave = leaveRecords.some(
                          (l) => l.uid === u.uid && l.date === todayStr &&
                            (l.status === "active" || l.status === "unmark_requested"),
                        );
                        return (
                          <button key={u.uid} className="oc-action"
                            onClick={() => setSelectedUser(u.name)}
                            style={chipStyle(selectedUser === u.name)}>
                            {u.name}{onLeave ? " · out today" : ""}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* When */}
                  <div>
                    <div style={{ marginBottom: 8 }}><Eyebrow>When</Eyebrow></div>
                    <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
                      {(
                        [
                          ["day", "Day"],
                          ["month", "Month"],
                          ["period", "Range"],
                        ] as [typeof dateMode, string][]
                      ).map(([val, label]) => (
                        <button key={val} className="oc-action" onClick={() => setDateMode(val)}
                          style={chipStyle(dateMode === val)}>
                          {label}
                        </button>
                      ))}
                    </div>

                    {dateMode === "day" && (
                      <>
                        {/* Last seven days */}
                        {/* Seven fixed cells. They share the width when there is
                            width to share and scroll when there is not. */}
                        <div className="oc-scroll-x" style={{ display: "flex", gap: 4, marginBottom: 10 }}>
                          {Array.from({ length: 7 }, (_, i) => {
                            const offset = 6 - i;
                            const d = new Date();
                            d.setDate(d.getDate() - offset);
                            const dateStr = localDateStr(d);
                            const dayName = d.toLocaleDateString("en-IN", { weekday: "short" });
                            const isSunday = d.getDay() === 0;
                            const isSelected = dateDay === dateStr;
                            return (
                              <button key={dateStr} className="oc-row"
                                onClick={() => setDateDay(dateStr)}
                                style={{
                                  flex: "1 0 42px", display: "flex", flexDirection: "column",
                                  alignItems: "center", gap: 2, padding: "8px 2px",
                                  background: isSelected ? t.tint : "none",
                                  border: `0.5px solid ${isSelected ? t.text2 : t.border}`,
                                  borderRadius: 4, cursor: "pointer",
                                }}>
                                <span style={{
                                  fontSize: 11,
                                  fontWeight: isSelected ? 500 : 400,
                                  color: isSelected ? t.text : t.text2,
                                }}>
                                  {offset === 0 ? "Today" : dayName}
                                </span>
                                <span style={{ fontSize: 10, color: t.text3 }}>
                                  {isSunday ? "Off" : d.getDate()}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                        {new Date(dateDay + "T00:00:00").getDay() === 0 && (
                          <div style={{ fontSize: 12, color: t.text3, marginBottom: 10 }}>
                            Sunday — a scheduled off day, so nothing is expected.
                          </div>
                        )}
                        <DateInput type="date" value={dateDay} onChange={setDateDay} />
                      </>
                    )}

                    {dateMode === "month" && (
                      <DateInput type="month" value={dateMonth} onChange={setDateMonth} />
                    )}

                    {dateMode === "period" && (
                      <div style={{ display: "flex", gap: 8 }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 12, color: t.text3, marginBottom: 5 }}>From</div>
                          <DateInput type="date" value={datePeriodFrom} onChange={setDatePeriodFrom} />
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 12, color: t.text3, marginBottom: 5 }}>To</div>
                          <DateInput type="date" value={datePeriodTo} onChange={setDatePeriodTo} />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Which accounts */}
                  <div>
                    <div style={{ marginBottom: 8 }}><Eyebrow>Which accounts</Eyebrow></div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {(
                        [
                          ["all", "All types"],
                          ["distributor", "Distributors"],
                          ["retailer", "Retailers"],
                        ] as [string, string][]
                      ).map(([val, label]) => (
                        <button key={val} className="oc-action"
                          onClick={() => { setVisitPartyType(val as any); setVisitDistSub("all"); }}
                          style={chipStyle(visitPartyType === val)}>
                          {label}
                        </button>
                      ))}
                    </div>

                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                      {(
                        [
                          ["all", "Any status"],
                          ["active", "Active"],
                          ["prospect", "Prospect"],
                          ["inactive", "Inactive"],
                        ] as [string, string][]
                      ).map(([val, label]) => (
                        <button key={val} className="oc-action"
                          onClick={() => setVisitPartyStatus(val as any)}
                          style={chipStyle(visitPartyStatus === val)}>
                          {label}
                        </button>
                      ))}
                    </div>

                    {visitPartyType === "retailer" && (
                      <div style={{ marginTop: 10 }}>
                        <CustomSelect
                          value={visitDistSub}
                          onChange={setVisitDistSub}
                          placeholder="All retailers"
                          options={[
                            { value: "all", label: "All retailers" },
                            { value: "independent", label: "Independent retailers" },
                            ...distributorList.map((d) => ({
                              value: d.id!,
                              label: d.name,
                              sub: d.place || d.address,
                            })),
                          ]}
                        />
                      </div>
                    )}
                  </div>
                </div>

                {/* Summary */}
                {filteredLogsWithVisits.length > 0 && (
                  <StatGrid>
                    <StatCard value={allFV.length} label="Visits"
                      context={`Across ${filteredLogsWithVisits.length} ${filteredLogsWithVisits.length === 1 ? "day" : "days"}`} />
                    <StatCard value={fvInterested} label="Interested"
                      context={allFV.length > 0 ? `${Math.round((fvInterested / allFV.length) * 100)}% of visits` : undefined} />
                    <StatCard value={fvDistCount + fvRetailCount} label="Unique accounts"
                      context={`${fvDistCount} distributors, ${fvRetailCount} retailers`} />
                  </StatGrid>
                )}

                {/* Allocations created, by person */}
                {(() => {
                  const byPerson: Record<
                    string,
                    { count: number; total: number; packets: number; allocs: any[] }
                  > = {};
                  allocations
                    .filter((a: any) => {
                      if (selectedUser !== "all" && a.createdByName !== selectedUser) return false;
                      const createdDate = a.createdAt ? localDateStr(new Date(a.createdAt)) : "";
                      if (dateMode === "day") return createdDate === dateDay;
                      if (dateMode === "month") return createdDate.startsWith(dateMonth);
                      if (dateMode === "period")
                        return createdDate >= datePeriodFrom && createdDate <= datePeriodTo;
                      return true;
                    })
                    .forEach((a: any) => {
                      const name = a.createdByName || "Unknown";
                      if (!byPerson[name]) byPerson[name] = { count: 0, total: 0, packets: 0, allocs: [] };
                      byPerson[name].count++;
                      byPerson[name].total += a.totalAmount || 0;
                      byPerson[name].packets += a.packets || 0;
                      byPerson[name].allocs.push(a);
                    });
                  const entries = Object.entries(byPerson);
                  if (entries.length === 0) return null;

                  return (
                    <div>
                      <div style={{ marginBottom: 12 }}><Eyebrow>Allocations created</Eyebrow></div>
                      <div style={{ borderBottom: `0.5px solid ${t.border}` }}>
                        {entries.map(([name, data]) => {
                          const isExpanded = expandedAllocPerson === name;
                          return (
                            <div key={name} style={{ borderTop: `0.5px solid ${t.border}` }}>
                              <button className="oc-row"
                                onClick={() => setExpandedAllocPerson(isExpanded ? null : name)}
                                aria-expanded={isExpanded}
                                style={{
                                  width: "100%", display: "flex", alignItems: "baseline", gap: 16,
                                  background: "none", border: "none", padding: "15px 10px",
                                  textAlign: "left", cursor: "pointer",
                                }}>
                                <span style={{ flex: 1, minWidth: 0 }}>
                                  <span style={{ display: "block", fontSize: 15, fontWeight: 500, color: t.text }}>
                                    {name}
                                  </span>
                                  <span style={{ display: "block", fontSize: 13, color: t.text3, marginTop: 3 }}>
                                    {data.count} {data.count === 1 ? "allocation" : "allocations"} · {data.packets} pkts
                                  </span>
                                </span>
                                <span style={{ fontSize: 14, color: t.text2, whiteSpace: "nowrap" }}>
                                  {inr(data.total)}
                                </span>
                              </button>

                              {isExpanded && (
                                <div style={{ padding: "0 10px 14px" }}>
                                  {data.allocs
                                    .sort((a: any, b: any) => (b.createdAt || 0) - (a.createdAt || 0))
                                    .map((a: any, i: number) => (
                                      <div key={a.id || i}
                                        style={{
                                          display: "flex", alignItems: "baseline",
                                          justifyContent: "space-between", gap: 12,
                                          padding: "10px 0", borderTop: `0.5px solid ${t.border}`,
                                        }}>
                                        <span style={{ minWidth: 0 }}>
                                          <span style={{ display: "block", fontSize: 14, color: t.text }}>
                                            {a.partyName || "—"}
                                          </span>
                                          <span style={{ display: "block", fontSize: 12, color: t.text3, marginTop: 2 }}>
                                            {a.productName || "—"} · {a.packets} pkts ·{" "}
                                            {a.paymentType === "credit" ? "Credit" : "Cash"}
                                            {a.plannedDate ? ` · ${a.plannedDate}` : ""}
                                          </span>
                                        </span>
                                        <span style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                                          <span style={{ display: "block", fontSize: 13, color: t.text }}>
                                            {inr(a.totalAmount || 0)}
                                          </span>
                                          <span style={{
                                            display: "block", fontSize: 12, marginTop: 2,
                                            color: a.status === "pending" || a.status === "overdue" ? t.warn : t.text3,
                                          }}>
                                            {allocWord(a.status)}
                                          </span>
                                        </span>
                                      </div>
                                    ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}

                {/* Payments collected, by person */}
                {(() => {
                  const byPerson: Record<string, { count: number; total: number; payments: any[] }> = {};
                  allAdminPayments
                    .filter((p: any) => {
                      if (!p.collectedByName) return false;
                      if (selectedUser !== "all" && p.collectedByName !== selectedUser) return false;
                      if (dateMode === "day") return p.date === dateDay;
                      if (dateMode === "month") return p.date?.startsWith(dateMonth);
                      if (dateMode === "period")
                        return p.date >= datePeriodFrom && p.date <= datePeriodTo;
                      return true;
                    })
                    .forEach((p: any) => {
                      const name = p.collectedByName || "Unknown";
                      if (!byPerson[name]) byPerson[name] = { count: 0, total: 0, payments: [] };
                      byPerson[name].count++;
                      byPerson[name].total += p.amount || 0;
                      byPerson[name].payments.push(p);
                    });
                  const entries = Object.entries(byPerson);
                  if (entries.length === 0) return null;

                  const methodLabel: Record<string, string> = {
                    cash: "Cash", cheque: "Cheque",
                    bank_transfer: "Bank transfer", upi: "UPI",
                  };

                  return (
                    <div>
                      <div style={{ marginBottom: 12 }}><Eyebrow>Payments collected</Eyebrow></div>
                      <div style={{ borderBottom: `0.5px solid ${t.border}` }}>
                        {entries.map(([name, data]) => {
                          const isExpanded = expandedPaymentPerson === name;
                          return (
                            <div key={name} style={{ borderTop: `0.5px solid ${t.border}` }}>
                              <button className="oc-row"
                                onClick={() => setExpandedPaymentPerson(isExpanded ? null : name)}
                                aria-expanded={isExpanded}
                                style={{
                                  width: "100%", display: "flex", alignItems: "baseline", gap: 16,
                                  background: "none", border: "none", padding: "15px 10px",
                                  textAlign: "left", cursor: "pointer",
                                }}>
                                <span style={{ flex: 1, minWidth: 0 }}>
                                  <span style={{ display: "block", fontSize: 15, fontWeight: 500, color: t.text }}>
                                    {name}
                                  </span>
                                  <span style={{ display: "block", fontSize: 13, color: t.text3, marginTop: 3 }}>
                                    {data.count} {data.count === 1 ? "payment" : "payments"}
                                  </span>
                                </span>
                                <span style={{ fontSize: 14, color: t.text2, whiteSpace: "nowrap" }}>
                                  {inr(data.total)}
                                </span>
                              </button>

                              {isExpanded && (
                                <div style={{ padding: "0 10px 14px" }}>
                                  {data.payments
                                    .sort((a: any, b: any) => (b.createdAt || 0) - (a.createdAt || 0))
                                    .map((p: any, i: number) => (
                                      <div key={p.id || i}
                                        style={{
                                          display: "flex", alignItems: "baseline",
                                          justifyContent: "space-between", gap: 12,
                                          padding: "10px 0", borderTop: `0.5px solid ${t.border}`,
                                        }}>
                                        <span style={{ minWidth: 0 }}>
                                          <span style={{ display: "block", fontSize: 14, color: t.text }}>
                                            {p.partyName || "—"}
                                          </span>
                                          <span style={{ display: "block", fontSize: 12, color: t.text3, marginTop: 2 }}>
                                            {methodLabel[p.paymentMethod] || p.paymentMethod}
                                            {p.date ? ` · ${p.date}` : ""}
                                            {p.notes ? ` · ${p.notes}` : ""}
                                          </span>
                                        </span>
                                        <span style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                                          <span style={{ display: "block", fontSize: 13, color: t.text }}>
                                            {inr(p.amount || 0)}
                                          </span>
                                          <span style={{
                                            display: "block", fontSize: 12, marginTop: 2,
                                            color: p.status === "pending_approval" ? t.warn : t.text3,
                                          }}>
                                            {payWord(p.status)}
                                          </span>
                                        </span>
                                      </div>
                                    ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}

                {/* Activity log — ActivityScreen style */}
                {(() => {
                  const rangeStart = dateMode === 'day' ? dateDay : dateMode === 'month' ? dateMonth + '-01' : datePeriodFrom
                  const rangeEnd   = dateMode === 'day' ? dateDay : dateMode === 'month' ? dateMonth + '-31' : datePeriodTo
                  const inRange = (d: string) => !!d && d >= rangeStart && d <= rangeEnd
                  const tsToDate = (ts: number) => new Date(ts).toLocaleDateString('en-CA')

                  const aStyle = (s: string) => ({ pending: { label: 'Pending', color: t.warn }, sent: { label: 'Sent', color: t.text3 }, paid: { label: 'Paid', color: t.text3 }, overdue: { label: 'Overdue', color: t.warn }, cancelled: { label: 'Cancelled', color: t.text3 } } as any)[s] ?? { label: s, color: t.text3 }
                  const pStyle = (s: string) => ({ pending_approval: { label: 'Pending approval', color: t.warn }, approved: { label: 'Approved', color: t.text3 }, rejected: { label: 'Rejected', color: t.text3 } } as any)[s] ?? { label: s, color: t.text3 }

                  type PersonData = { visitLog: any; revisitLogs: any[]; allocations: any[]; payments: any[]; expenses: any[] }
                  const dayPersonMap: Record<string, Record<string, PersonData>> = {}
                  const ensure = (date: string, uid: string): PersonData => {
                    if (!dayPersonMap[date]) dayPersonMap[date] = {}
                    if (!dayPersonMap[date][uid]) dayPersonMap[date][uid] = { visitLog: null, revisitLogs: [], allocations: [], payments: [], expenses: [] }
                    return dayPersonMap[date][uid]
                  }

                  visitLogs.forEach((log: any) => {
                    if (!inRange(log.date)) return
                    if (selectedUser !== 'all' && log.salesPersonName !== selectedUser) return
                    ensure(log.date, log.salesPersonId).visitLog = log
                  })
                  revisitLogs.forEach((rl: any) => {
                    if (!inRange(rl.date)) return
                    const u = salesUsers.find(u => u.uid === rl.salesPersonId)
                    if (!u) return
                    if (selectedUser !== 'all' && u.name !== selectedUser) return
                    ensure(rl.date, rl.salesPersonId).revisitLogs.push(rl)
                  })
                  // Shared visits: Rep B's visit_log references Rep A's revisit_logs via revisitLogId
                  visitLogs.forEach((log: any) => {
                    if (!inRange(log.date)) return
                    if (selectedUser !== 'all' && log.salesPersonName !== selectedUser) return
                    ;(log.visits || []).forEach((v: any) => {
                      if (!v.isRevisit || !v.revisitLogId) return
                      const rl = revisitLogs.find((r: any) => r.id === v.revisitLogId)
                      if (!rl || rl.salesPersonId === log.salesPersonId) return
                      const pd = ensure(log.date, log.salesPersonId)
                      if (!pd.revisitLogs.some((r: any) => r.id === rl.id)) pd.revisitLogs.push(rl)
                    })
                  })
                  allocations.forEach((a: any) => {
                    const d = tsToDate(a.createdAt)
                    if (!inRange(d)) return
                    const u = salesUsers.find(u => u.uid === a.createdBy)
                    if (!u) return
                    if (selectedUser !== 'all' && u.name !== selectedUser) return
                    ensure(d, a.createdBy).allocations.push(a)
                  })
                  allAdminPayments.forEach((p: any) => {
                    if (!inRange(p.date || '')) return
                    if (!p.collectedBy) return
                    if (selectedUser !== 'all') {
                      const u = salesUsers.find(u => u.uid === p.collectedBy)
                      if (!u || u.name !== selectedUser) return
                    }
                    ensure(p.date, p.collectedBy).payments.push(p)
                  })
                  allExpenses.forEach((e: any) => {
                    if (!inRange(e.date || '')) return
                    const u = salesUsers.find(u => u.uid === e.userId)
                    if (!u) return
                    if (selectedUser !== 'all' && u.name !== selectedUser) return
                    ensure(e.date, e.userId).expenses.push(e)
                  })
                  fullDayLeaveCards.forEach((l: any) => {
                    const u = salesUsers.find(u => u.uid === l.uid)
                    if (!u) return
                    if (selectedUser !== 'all' && u.name !== selectedUser) return
                    ensure(l.date, l.uid)
                  })

                  const sortedDates = Object.keys(dayPersonMap).sort((a, b) => b.localeCompare(a))
                  if (sortedDates.length === 0) return (
                    <div style={{ padding: '40px 0', maxWidth: 420 }}>
                      <div style={{ fontSize: 17, fontWeight: 500, color: t.text, marginBottom: 6 }}>
                        No activity in this range
                      </div>
                      <div style={{ fontSize: 14, color: t.text3, lineHeight: 1.6, marginBottom: 18 }}>
                        Nobody logged a visit, order or expense between {rangeStart} and {rangeEnd}.
                      </div>
                      <button
                        className="oc-action"
                        onClick={() => { setDateMode('month'); setDateMonth(localMonthStr()) }}
                        style={{
                          background: 'none',
                          border: `0.5px solid ${t.border2}`,
                          borderRadius: 6,
                          padding: '9px 14px',
                          fontSize: 13,
                          fontWeight: 400,
                          color: t.text,
                          cursor: 'pointer',
                        }}
                      >
                        Show this month
                      </button>
                    </div>
                  )

                  const dFmt = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' })
                  const toggleDay = (d: string) => setExpandedAdminDays(prev => { const n = new Set(prev); n.has(d) ? n.delete(d) : n.add(d); return n })
                  const toggleSec = (k: string) => setCollapsedAdminSections(prev => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n })
                  const secOpen = (k: string) => !collapsedAdminSections.has(k)

                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {sortedDates.map(date => {
                        const personMap = dayPersonMap[date]
                        const personIds = Object.keys(personMap)
                        const isExpanded = expandedAdminDays.has(date)
                        const totalVisits = personIds.reduce((s, uid) => s + personMap[uid].revisitLogs.filter(rl => !rl.actions?.every((a: any) => a.removed || a.type === 'relationship_visit' || a.type === 'no_longer_active')).length, 0)
                        const totalAct = personIds.reduce((s, uid) => s + personMap[uid].allocations.length + personMap[uid].payments.length, 0)
                        const totalExp = personIds.reduce((s, uid) => s + personMap[uid].expenses.reduce((es: number, e: any) => es + e.amount, 0), 0)
                        const isToday = date === todayStr

                        return (
                          <div key={date} style={{ background: t.card, borderRadius: 16, border: `1px solid ${isToday ? 'rgba(16,185,129,0.35)' : t.border}`, overflow: 'hidden' }}>
                            <button onClick={() => toggleDay(date)} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', background: 'none', border: 'none', cursor: 'pointer' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                {isToday && <span style={{ background: 'rgba(16,185,129,0.15)', color: '#10b981', fontSize: 10, fontWeight: 500, padding: '2px 8px', borderRadius: 99 }}>TODAY</span>}
                                <span style={{ fontSize: 15, fontWeight: 500, color: t.text }}>{dFmt(date)}</span>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <div style={{ display: 'flex', gap: 6 }}>
                                  {totalVisits > 0 && <span style={{ fontSize: 11, color: t.text3 }}>{totalVisits}</span>}
                                  {totalAct > 0 && <span style={{ fontSize: 11, color: t.text3 }}>{totalAct}</span>}
                                  {totalExp > 0 && <span style={{ fontSize: 11, color: t.text3 }}>₹{totalExp.toLocaleString('en-IN')}</span>}
                                </div>
                                <span style={{ fontSize: 16, color: t.text3 }}>{isExpanded ?'▾' :'▸'}</span>
                              </div>
                            </button>

                            {isExpanded && (
                              <div style={{ borderTop: `1px solid ${t.border}`, padding: '0 16px 12px' }}>
                                {personIds.map(uid => {
                                  const data = personMap[uid]
                                  const person = salesUsers.find(u => u.uid === uid)
                                  const personName = data.visitLog?.salesPersonName || person?.name || uid
                                  const isOnLeave = fullDayLeaveCards.some((l: any) => l.uid === uid && l.date === date)
                                  const halfDayLeave = leaveRecords.find(l => l.uid === uid && l.date === date && l.leaveType === 'half_day' && (l.status === 'active' || l.status === 'pending_approval' || l.status === 'unmark_requested'))
                                  const newPartyEntries = data.visitLog?.visits?.filter((v: any) => v.isNew) ?? []
                                  const visitCount = data.revisitLogs.filter(rl => !rl.actions?.every((a: any) => a.removed || a.type === 'relationship_visit' || a.type === 'no_longer_active')).length
                                  const actCount = newPartyEntries.length + data.allocations.length + data.payments.length
                                  const expTotal = data.expenses.reduce((s: number, e: any) => s + e.amount, 0)
                                  const pk = `${date}-${uid}`
                                  const vKey = `${pk}-v`, aKey = `${pk}-a`, eKey = `${pk}-e`, npKey = `${pk}-np`

                                  const secHdr = (label: string, key: string, count: number) => (
                                    <button onClick={() => toggleSec(key)} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'none', border: 'none', padding: '10px 0 6px', cursor: 'pointer' }}>
                                      <span style={{ fontSize: 12, fontWeight: 500, color: t.text3, letterSpacing: 1, textTransform: 'uppercase' as const }}>{label} ({count})</span>
                                      <span style={{ fontSize: 13, color: t.text3 }}>{secOpen(key) ?'▾' :'▸'}</span>
                                    </button>
                                  )

                                  return (
                                    <div key={uid} style={{ marginTop: 12, background: theme === 'dark' ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.015)', borderRadius: 12, padding: '10px 12px', border: `1px solid ${t.border}` }}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                                        <div style={{ width: 28, height: 28, background: t.tint, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 400, fontSize: 12, color: t.text2, flexShrink: 0 }}>
                                          {personName?.[0] || '?'}
                                        </div>
                                        <span style={{ fontSize: 14, fontWeight: 500, color: t.text }}>{personName}</span>
                                        {isOnLeave && <span style={{ fontSize: 10, fontWeight: 500, background: 'transparent', color: t.warn, border: `0.5px solid ${t.border}`, padding: '2px 8px', borderRadius: 99 }}>On leave</span>}
                                        {halfDayLeave && <span style={{ fontSize: 10, fontWeight: 500, background: 'transparent', color: t.text3, border: `0.5px solid ${t.border}`, padding: '2px 8px', borderRadius: 99 }}>Half day</span>}
                                        {data.visitLog && <span style={{ marginLeft: 'auto', fontSize: 11, color: t.text3 }}>{data.visitLog.totalVisited || 0} visits</span>}
                                      </div>

                                      {isOnLeave && visitCount === 0 && actCount === 0 && data.expenses.length === 0 && (
                                        <div style={{ fontSize: 12, color: t.text3, paddingLeft: 36 }}>Full day leave — nothing logged</div>
                                      )}

                                      {visitCount > 0 && (
                                        <>
                                          {secHdr('Visits', vKey, visitCount)}
                                          {secOpen(vKey) && (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 8 }}>
                                              {data.revisitLogs.map((rl: any) => {
                                                const allInvis = rl.actions?.every((a: any) => a.removed || a.type === 'relationship_visit' || a.type === 'no_longer_active')
                                                if (allInvis) return null
                                                return (
                                                  <div key={rl.id} style={{ background: t.bg3, borderRadius: 12, border: `1px solid ${t.border}` }}>
                                                    <div style={{ padding: '12px 14px 8px', display: 'flex', alignItems: 'center', gap: 8 }}>
                                                      <span style={{ fontSize: 10, fontWeight: 500, color: t.text3, background: 'transparent', border: `0.5px solid ${t.border}`, padding: '2px 8px', borderRadius: 99 }}>Revisit</span>
                                                      <span style={{ fontSize: 14, fontWeight: 500, color: t.text }}>{rl.partyName}</span>
                                                    </div>
                                                    <div style={{ padding: '0 14px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                                                      {rl.actions?.map((action: any, ai: number) => {
                                                        if (action.removed) return null
                                                        if (action.type === 'relationship_visit') return <div key={ai} style={{ fontSize: 12, color: t.text2 }}>Relationship visit{action.notes ? ` · ${action.notes}` : ''}</div>
                                                        if (action.type === 'no_longer_active') return <div key={ai} style={{ fontSize: 12, color: t.text3 }}>No longer active{action.reason ? ` · ${action.reason}` : ''}</div>
                                                        const liveAlloc = action.allocationId ? allocations.find((a: any) => a.id === action.allocationId) : null
                                                        const livePay = action.transactionId ? allAdminPayments.find((p: any) => p.id === action.transactionId) : null
                                                        if (action.type === 'stock_update') return (
                                                          <div key={ai} style={{ background: theme === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)', borderRadius: 8, padding: '10px 12px', border: `1px solid ${t.border}` }}>
                                                            <div style={{ fontSize: 13, fontWeight: 500, color: t.text, marginBottom: 4 }}>Stock update · {action.productName}</div>
                                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px' }}>
                                                              {([['Opening', action.openingQty], ['Purchased', action.purchasedQty], ['Sold', action.soldQty], ['Balance', `${action.balanceQty} pkts`]] as [string,any][]).map(([lbl, val]) => (
                                                                <div key={lbl} style={{ fontSize: 12 }}><span style={{ color: t.text3 }}>{lbl} </span><span style={{ fontWeight: 500, color: t.text }}>{val}</span></div>
                                                              ))}
                                                            </div>
                                                          </div>
                                                        )
                                                        if (action.type === 'new_order') {
                                                          const displayPkts = liveAlloc?.packets ?? action.quantity
                                                          const displayTotal = liveAlloc ? liveAlloc.totalAmount : (action.totalAmount || 0)
                                                          const s = liveAlloc ? aStyle(liveAlloc.status) : null
                                                          return (
                                                            <div key={ai} style={{ background: theme === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)', borderRadius: 8, padding: '10px 12px', border: `1px solid ${t.border}` }}>
                                                              <div style={{ fontSize: 13, fontWeight: 500, color: t.text, marginBottom: 4 }}>New order · {action.productName}</div>
                                                              <div style={{ fontSize: 12, color: t.text2 }}>{displayPkts} pkts · ₹{displayTotal.toLocaleString('en-IN')} · <span style={{ color: t.text3 }}>{action.paymentType}</span></div>
                                                              {s && <span style={{ marginTop: 6, display: 'inline-block', fontSize: 11, fontWeight: 500, color: s.color, borderRadius: 0, padding: 0 }}>{s.label}</span>}
                                                            </div>
                                                          )
                                                        }
                                                        if (action.type === 'payment_collection') {
                                                          const displayAmt = livePay?.amount ?? action.amount
                                                          const displayStatus = livePay?.status ?? action.status
                                                          return (
                                                            <div key={ai} style={{ background: theme === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)', borderRadius: 8, padding: '10px 12px', border: `1px solid ${t.border}` }}>
                                                              <div style={{ fontSize: 13, fontWeight: 500, color: t.text, marginBottom: 4 }}>Payment collected · {rl.partyName}</div>
                                                              <div style={{ fontSize: 12, color: t.text2 }}>₹{displayAmt?.toLocaleString('en-IN')} · <span style={{ color: displayStatus === 'pending_approval' ? t.warn : t.text3 }}>{displayStatus === 'pending_approval' ? 'Pending' : 'Approved'}</span></div>
                                                            </div>
                                                          )
                                                        }
                                                        return null
                                                      })}
                                                    </div>
                                                  </div>
                                                )
                                              })}
                                            </div>
                                          )}
                                        </>
                                      )}

                                      {newPartyEntries.length > 0 && (
                                        <>
                                          {secHdr('New parties', npKey, newPartyEntries.length)}
                                          {secOpen(npKey) && (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
                                              {newPartyEntries.map((v: any, i: number) => (
                                                <div key={i} style={{ background: t.bg3, borderRadius: 12, border: `1px solid ${t.border}`, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
                                                  <span style={{ fontSize: 10, fontWeight: 500, color: t.text3, background: 'transparent', border: `0.5px solid ${t.border}`, padding: '2px 8px', borderRadius: 99 }}>New party</span>
                                                  <span style={{ fontSize: 14, fontWeight: 500, color: t.text }}>{v.partyName}</span>
                                                </div>
                                              ))}
                                            </div>
                                          )}
                                        </>
                                      )}

                                      {(data.allocations.length > 0 || data.payments.length > 0) && (
                                        <>
                                          {secHdr('Activity', aKey, data.allocations.length + data.payments.length)}
                                          {secOpen(aKey) && (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
                                              {data.allocations.map((a: any) => {
                                                const s = aStyle(a.status)
                                                return (
                                                  <div key={a.id} style={{ background: t.bg3, borderRadius: 12, padding: '12px 14px', border: `1px solid ${t.border}` }}>
                                                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                                                      <div style={{ flex: 1 }}>
                                                        <div style={{ fontSize: 13, fontWeight: 500, color: t.text }}>Allocation · {a.partyName}</div>
                                                        <div style={{ fontSize: 12, color: t.text2, marginTop: 3 }}>{a.productName} · {a.packets} pkts · ₹{a.totalAmount.toLocaleString('en-IN')}</div>
                                                        <div style={{ fontSize: 11, color: t.text3, marginTop: 2 }}>{a.paymentType === 'credit' ? 'Credit' : 'Cash'}</div>
                                                      </div>
                                                      <span style={{ fontSize: 11, fontWeight: 500, color: s.color, borderRadius: 0, padding: 0, flexShrink: 0 }}>{s.label}</span>
                                                    </div>
                                                  </div>
                                                )
                                              })}
                                              {data.payments.map((p: any) => {
                                                const s = pStyle(p.status)
                                                return (
                                                  <div key={p.id} style={{ background: t.bg3, borderRadius: 12, padding: '12px 14px', border: `1px solid ${t.border}` }}>
                                                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                                                      <div style={{ flex: 1 }}>
                                                        <div style={{ fontSize: 13, fontWeight: 500, color: t.text }}>Payment · {p.partyName}</div>
                                                        <div style={{ fontSize: 12, color: t.text2, marginTop: 3 }}>₹{p.amount.toLocaleString('en-IN')} · {p.paymentMethod?.replace('_', ' ')}</div>
                                                        {p.notes && <div style={{ fontSize: 11, color: t.text3, marginTop: 2 }}>{p.notes}</div>}
                                                      </div>
                                                      <span style={{ fontSize: 11, fontWeight: 500, color: s.color, flexShrink: 0 }}>{s.label}</span>
                                                    </div>
                                                  </div>
                                                )
                                              })}
                                            </div>
                                          )}
                                        </>
                                      )}

                                      {data.expenses.length > 0 && (
                                        <>
                                          {secHdr(`Expense · ₹${expTotal.toLocaleString('en-IN')}`, eKey, data.expenses.length)}
                                          {secOpen(eKey) && (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
                                              {data.expenses.map((e: any) => (
                                                <div key={e.id} style={{ background: t.bg3, borderRadius: 10, padding: '10px 12px', border: `1px solid ${t.border}` }}>
                                                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                                    <div>
                                                      <div style={{ fontSize: 13, fontWeight: 500, color: t.text }}>{e.category || 'Expense'}</div>
                                                      {e.description && <div style={{ fontSize: 12, color: t.text2, marginTop: 2 }}>{e.description}</div>}
                                                    </div>
                                                    <div style={{ fontSize: 15, fontWeight: 500, color: t.text3 }}>₹{e.amount.toLocaleString('en-IN')}</div>
                                                  </div>
                                                </div>
                                              ))}
                                            </div>
                                          )}
                                        </>
                                      )}

                                      {data.visitLog?.endOfDayNote && (
                                        <div style={{ background: theme === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)', borderRadius: 8, padding: '8px 10px', marginTop: 4 }}>
                                          <div style={{ fontSize: 11, color: t.text3, marginBottom: 2 }}>End of day note</div>
                                          <div style={{ fontSize: 13, color: t.text2 }}>{data.visitLog.endOfDayNote}</div>
                                        </div>
                                      )}
                                    </div>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )
                })()}

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
                    fontWeight: 500,
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Offline Marketing — Coming Soon */}
            {marketingTab === "offline" && (
              <div style={{ padding: "44px 0", maxWidth: 420 }}>
                <div
                  style={{ fontSize: 17, fontWeight: 500, color: t.text, marginBottom: 6 }}
                >
                  Offline marketing
                </div>
                <div
                  style={{ fontSize: 14, color: t.text3, lineHeight: 1.6, marginBottom: 18 }}
                >
                  On-ground campaigns, events and sampling will live here.
                  The online calendar is running today.
                </div>
                <button
                  className="oc-action"
                  onClick={() => setMarketingTab("online")}
                  style={{
                    background: "none",
                    border: `0.5px solid ${t.border2}`,
                    borderRadius: 6,
                    padding: "9px 14px",
                    fontSize: 13,
                    fontWeight: 400,
                    color: t.text,
                    cursor: "pointer",
                  }}
                >
                  Open the content calendar
                </button>
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
                        fontWeight: 500,
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
                        fontWeight: 500,
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
                        <span style={{ fontWeight: 500, fontSize: 14 }}>
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
                                color: "#dc2626",
                                background: "#dc262220",
                                padding: "2px 8px",
                                borderRadius: 99,
                              }}
                            >
                              {w.missed} missed
                            </span>
                          )}
                          <span
                            style={{
                              color: "#6ee7b7",
                              fontWeight: 500,
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
                                : t.text2,
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
                  return (
                    <div
                      key={post.id}
                      style={{
                        display: "flex",
                        alignItems: "baseline",
                        gap: 16,
                        borderTop: `0.5px solid ${t.border}`,
                        padding: "13px 0",
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: 14,
                            fontWeight: 400,
                            color: t.text,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {post.topic}
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 400, color: t.text3, marginTop: 3 }}>
                          {post.date} · {post.pillar} · {post.format}
                        </div>
                      </div>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 400,
                          color: sc.needsAttention ? t.warn : t.text3,
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
