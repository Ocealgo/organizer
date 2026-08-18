import React, { useState, useEffect } from 'react'
import * as XLSX from 'xlsx'
import {
  collection,
  addDoc,
  query,
  where,
  updateDoc,
  doc,
  setDoc,
  getDoc,
  deleteDoc,
  getDocs,
} from 'firebase/firestore'
import { onSnapshot } from '../../data/live'
import { db } from '../../firebase'
import {
  AllowanceType, ExpenseCategory, ExpenseConfig,
  ExpenseReport, ExpenseEntry, LeaveRecord, AppUser, DailyVisitLog, Holiday,
} from '../../types'
import { useAuth } from '../../context/AuthContext'
import { can, maySignOffFor } from '../../auth/permissions'
import { useTheme } from '../../context/ThemeContext'
import { useConfirm } from '../../hooks/useConfirm'
import { localDateStr } from '../../utils/date'
import DateInput from '../../components/DateInput'
import {
  PageHeader, TabBar, StatGrid, StatCard, Section, EmptyState,
  Field, ChipGroup, Note, GhostButton, PrimaryButton, inputStyle,
} from '../../components/ui'

interface Props { onBack: () => void; onViewVisitLog?: (userName: string, date: string) => void; onLogVisit?: (date: string) => void; defaultToDay?: boolean }

// ── Week helpers ──────────────────────────────────────────────────────────────
function getWeekStart(d: Date = new Date()): string {
  const day = d.getDay()
  const mon = new Date(d)
  mon.setDate(d.getDate() - (day === 0 ? 6 : day - 1))
  return localDateStr(mon)
}

function addDays(s: string, n: number): string {
  const d = new Date(s + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return localDateStr(d)
}

function getWeekDates(ws: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(ws, i))
}

function fmtDate(s: string): string {
  return new Date(s + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })
}

function isWeekend(s: string): boolean {
  return new Date(s + 'T00:00:00').getDay() === 0 // Sunday only
}

function weekLabel(ws: string): string {
  const we = addDays(ws, 6)
  const s = new Date(ws + 'T00:00:00')
  const e = new Date(we + 'T00:00:00')
  return `${s.getDate()} ${s.toLocaleString('en-IN', { month: 'short' })} – ${e.getDate()} ${e.toLocaleString('en-IN', { month: 'short' })} ${e.getFullYear()}`
}

// ── Ocealgo sheet format parser ───────────────────────────────────────────────
function parseDDMMYY(s: string): string | null {
  const m = String(s).trim().match(/^(\d{1,2})[./](\d{1,2})[./](\d{2,4})$/)
  if (!m) return null
  const day = parseInt(m[1]), month = parseInt(m[2])
  let year = parseInt(m[3])
  if (year < 100) year += 2000
  if (isNaN(day) || isNaN(month) || isNaN(year) || month > 12 || day > 31) return null
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function isOcealgoFormat(rows: unknown[][]): boolean {
  return rows.slice(0, 10).some(row =>
    row.some(cell => /AREA WORKED|EXPENSE STATEMENT/i.test(String(cell ?? '')))
  )
}

function parseOcealgoSheet(rows: unknown[][]): Array<{ date: string; type: string; amount: string; notes: string }> {
  const result: Array<{ date: string; type: string; amount: string; notes: string }> = []
  const num = (v: unknown) => { const n = parseFloat(String(v ?? '').replace(/[^0-9.]/g, '')); return isNaN(n) ? 0 : n }

  for (const row of rows) {
    const date = parseDDMMYY(String(row[0] ?? ''))
    if (!date) continue

    const area = String(row[1] ?? '').trim()
    const bus      = num(row[5])
    const train    = num(row[6])
    const incident = num(row[7])
    const roomMet  = num(row[8])
    const roomOth  = num(row[9])
    const daHQ     = num(row[10])
    const daEX     = num(row[11])
    const daOS     = num(row[12])
    const misc     = num(row[13])

    if (daOS > 0)      result.push({ date, type: 'OS', amount: '', notes: area })
    else if (daEX > 0) result.push({ date, type: 'EX', amount: '', notes: area })
    else if (daHQ > 0) result.push({ date, type: 'HQ', amount: '', notes: area })

    if (bus      > 0) result.push({ date, type: 'bus_fare', amount: String(bus),      notes: area })
    if (train    > 0) result.push({ date, type: 'bus_fare', amount: String(train),    notes: `Train — ${area}` })
    if (incident > 0) result.push({ date, type: 'other',    amount: String(incident), notes: 'Incidental charges' })
    if (roomMet  > 0) result.push({ date, type: 'lodging',  amount: String(roomMet),  notes: 'Metro room rent' })
    if (roomOth  > 0) result.push({ date, type: 'lodging',  amount: String(roomOth),  notes: 'Room rent' })
    if (misc     > 0) result.push({ date, type: 'other',    amount: String(misc),     notes: 'Miscellaneous' })
  }
  return result
}

function rowsToCsvText(rows: Array<{ date: string; type: string; amount: string; notes: string }>): string {
  const esc = (s: string) => s.includes(',') ? `"${s.replace(/"/g, '""')}"` : s
  return ['date,type,amount,notes', ...rows.map(r => `${r.date},${r.type},${r.amount},${esc(r.notes)}`)].join('\n')
}

function parseExpenseCsv(text: string): Array<{ date: string; type: string; amount: string; notes: string }> {
  const lines = text.trim().split(/\r?\n/)
  if (lines.length < 2) return []
  const hdr = lines[0].split(',').map(h => h.trim().toLowerCase())
  const idx = (k: string) => hdr.indexOf(k)
  return lines.slice(1).filter(l => l.trim()).map(line => {
    const v = line.split(',').map(s => s.trim())
    return { date: v[idx('date')] ?? '', type: v[idx('type')] ?? '', amount: v[idx('amount')] ?? '', notes: v[idx('notes')] ?? '' }
  })
}

// Deduplicates allowances (one per date) before summing — guards against duplicate Firestore docs
function totalOf(ents: ExpenseEntry[]): number {
  const seenAllowance = new Set<string>()
  return ents.reduce((s, e) => {
    if (e.type === 'allowance') {
      if (seenAllowance.has(e.date)) return s
      seenAllowance.add(e.date)
    }
    return s + e.amount
  }, 0)
}

// ── Constants ─────────────────────────────────────────────────────────────────
const ALLOW_INFO: Record<AllowanceType, { label: string; sub: string }> = {
  HQ: { label: 'HQ', sub: 'Within 25 km' },
  EX: { label: 'EX', sub: 'Beyond 25 km' },
  OS: { label: 'OS', sub: 'Outstation, staying over' },
}

const VAR_CATS: { value: ExpenseCategory; label: string }[] = [
  { value: 'bus_fare', label: 'Bus fare' },
  { value: 'fuel',     label: 'Fuel' },
  { value: 'food',     label: 'Food' },
  { value: 'lodging',  label: 'Lodging' },
  { value: 'printing', label: 'Printing' },
  { value: 'other',    label: 'Other' },
]

const DEFAULT_CONFIG: ExpenseConfig = { hq: 200, ex: 300, os: 450 }

/** Money, to the paisa. Keeps 13 km x 4.5 off the floating-point tail. */
const round2 = (n: number) => Math.round(n * 100) / 100

// ── Root ──────────────────────────────────────────────────────────────────────
export default function ExpenseLogger({ onBack, onViewVisitLog, onLogVisit, defaultToDay }: Props) {
  const { appUser } = useAuth()
  // Whole-team expense view is permission-gated; everyone else logs their own.
  const isAdmin = can(appUser, 'view_expenses')
  if (!appUser) return null
  return isAdmin
    ? <AdminView onBack={onBack} appUser={appUser} onViewVisitLog={onViewVisitLog} />
    : <SalesView onBack={onBack} appUser={appUser} onLogVisit={onLogVisit} defaultToDay={defaultToDay} />
}

// ─────────────────────────────────────────────────────────────────────────────
// SALES VIEW
// ─────────────────────────────────────────────────────────────────────────────
function SalesView({ onBack, appUser, onLogVisit, defaultToDay }: { onBack: () => void; appUser: AppUser; onLogVisit?: (date: string) => void; defaultToDay?: boolean }) {
  const { t } = useTheme()
  const { modal, showAlert, showConfirm } = useConfirm()
  const [config, setConfig] = useState<ExpenseConfig>(DEFAULT_CONFIG)
  const [reports, setReports] = useState<ExpenseReport[]>([])
  const [entries, setEntries] = useState<ExpenseEntry[]>([])
  const [leaves, setLeaves] = useState<LeaveRecord[]>([])
  const [mainTab, setMainTab] = useState<'log' | 'reports'>('log')
  const [viewMode, setViewMode] = useState<'week' | 'day'>(defaultToDay ? 'day' : 'week')
  const [weekStart, setWeekStart] = useState(getWeekStart())
  const [selectedDay, setSelectedDay] = useState(localDateStr())
  const [addVarDay, setAddVarDay] = useState<string | null>(null)
  const [varForm, setVarForm] = useState({ category: 'bus_fare' as ExpenseCategory, amount: '', km: '', customLabel: '', notes: '' })
  const [addDaDay, setAddDaDay] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [csvMode, setCsvMode] = useState(false)
  const [csvText, setCsvText] = useState('')
  const [fileLoaded, setFileLoaded] = useState(false)
  const [importing, setImporting] = useState(false)
  const [visitedDates, setVisitedDates] = useState<Set<string>>(new Set())
  const [holidays, setHolidays] = useState<Holiday[]>([])

  // In day mode derive the week from the selected day
  const activeWeekStart = viewMode === 'day' ? getWeekStart(new Date(selectedDay + 'T00:00:00')) : weekStart
  const weekEnd = addDays(activeWeekStart, 6)
  const weekDates = getWeekDates(activeWeekStart)
  const today = localDateStr()
  const isCurrentWeek = activeWeekStart === getWeekStart()
  const isAfter6pmIST = new Date(Date.now() + 19800000).getUTCHours() >= 18

  const report = reports.find(r => r.weekStart === activeWeekStart) ?? null
  const weekEntries = entries.filter(e => e.reportId === report?.id)
  const holidayDates = new Set(holidays.map(h => h.date))
  const leaveDates = new Set([
    ...leaves.filter(l => weekDates.includes(l.date) && l.status === 'active').map(l => l.date),
    ...holidays.filter(h => weekDates.includes(h.date)).map(h => h.date),
  ])
  const allLeaveDates = new Set([
    ...leaves.filter(l => l.status === 'active').map(l => l.date),
    ...holidays.map(h => h.date),
  ])

  // In day mode only show the selected day's entries
  const visibleDates = viewMode === 'day' ? [selectedDay] : weekDates

  useEffect(() => {
    const u1 = onSnapshot(doc(db, 'expense_config', 'main'), snap => {
      if (snap.exists()) setConfig({ ...DEFAULT_CONFIG, ...(snap.data() as ExpenseConfig) })
    })
    const u2 = onSnapshot(query(collection(db, 'expense_reports'), where('userId', '==', appUser.uid)), snap => {
      setReports(snap.docs.map(d => ({ id: d.id, ...d.data() } as ExpenseReport)))
    })
    const u3 = onSnapshot(query(collection(db, 'expense_entries'), where('userId', '==', appUser.uid)), snap => {
      setEntries(snap.docs.map(d => ({ id: d.id, ...d.data() } as ExpenseEntry)))
    })
    const u4 = onSnapshot(query(collection(db, 'leave_records'), where('uid', '==', appUser.uid)), snap => {
      setLeaves(snap.docs.map(d => ({ id: d.id, ...d.data() } as LeaveRecord)))
    })
    const u5 = onSnapshot(collection(db, 'holidays'), snap => {
      setHolidays(snap.docs.map(d => ({ id: d.id, ...d.data() } as Holiday)))
    })
    return () => { u1(); u2(); u3(); u4(); u5() }
  }, [appUser.uid])

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'visit_logs'),
        where('salesPersonId', '==', appUser.uid),
        where('date', 'in', weekDates),
      ),
      snap => setVisitedDates(new Set(snap.docs.map(d => d.data().date as string)))
    )
    return unsub
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWeekStart, appUser.uid])

  const getOrCreateReport = async (): Promise<ExpenseReport> => {
    if (report) return report
    return getOrCreateReportForWeek()
  }

  // Standalone version used by auto-init (avoids stale closure on `report`)
  const getOrCreateReportForWeek = async (): Promise<ExpenseReport> => {
    const existing = reports.find(r => r.weekStart === activeWeekStart)
    if (existing) return existing
    const newReport: Omit<ExpenseReport, 'id'> = {
      userId: appUser.uid, userName: appUser.name, userRole: appUser.role,
      weekStart: activeWeekStart, weekEnd, status: 'draft', totalAmount: 0, createdAt: Date.now(),
    }
    const ref = await addDoc(collection(db, 'expense_reports'), newReport)
    return { id: ref.id, ...newReport }
  }

  const syncReportTotal = async (reportId: string, delta: number) => {
    const base = totalOf(entries.filter(e => e.reportId === reportId))
    await updateDoc(doc(db, 'expense_reports', reportId), { totalAmount: base + delta })
  }

  const handleSetAllowance = async (date: string, type: AllowanceType) => {
    const rpt = await getOrCreateReport()
    const existing = weekEntries.find(e => e.date === date && e.type === 'allowance')
    const amount = config[type.toLowerCase() as 'hq' | 'ex' | 'os']
    if (existing) {
      if (existing.allowanceType === type) return
      await updateDoc(doc(db, 'expense_entries', existing.id!), { allowanceType: type, amount })
      await syncReportTotal(rpt.id!, amount - existing.amount)
    } else {
      await addDoc(collection(db, 'expense_entries'), {
        reportId: rpt.id!, userId: appUser.uid,
        date, type: 'allowance', allowanceType: type, amount, createdAt: Date.now(),
      })
      await syncReportTotal(rpt.id!, amount)
    }
  }

  const handleRemoveAllowance = async (date: string) => {
    const existing = weekEntries.find(e => e.date === date && e.type === 'allowance')
    if (!existing) return
    if (!await showConfirm('Remove the allowance?', `The ${existing.allowanceType} allowance for ${fmtDate(date)} is removed from this week.`, 'Remove')) return
    await deleteDoc(doc(db, 'expense_entries', existing.id!))
    await syncReportTotal(existing.reportId, -existing.amount)
  }

  const handleAddVariable = async () => {
    if (!addVarDay) return

    // Fuel is claimed as a distance and priced by the rate, so the rep never
    // types a rupee figure and the amount cannot drift from the rate the
    // manager set. Without a rate configured it falls back to a typed amount.
    const km = parseFloat(varForm.km)
    if (fuelByDistance) {
      if (isNaN(km) || km <= 0) { await showAlert('Distance needed', 'Enter how many kilometres you travelled.'); return }
    }
    const amount = fuelByDistance ? round2(km * fuelRate!) : parseFloat(varForm.amount)
    if (isNaN(amount) || amount <= 0) { await showAlert('Amount needed', 'Enter an amount above zero.'); return }

    const rpt = await getOrCreateReport()
    await addDoc(collection(db, 'expense_entries'), {
      reportId: rpt.id!, userId: appUser.uid,
      date: addVarDay, type: 'variable',
      category: varForm.category,
      ...(varForm.category === 'other' && varForm.customLabel ? { customLabel: varForm.customLabel } : {}),
      amount,
      // The rate is recorded on the entry, not just applied to it. A rate
      // change later must not silently restate what was already claimed.
      ...(fuelByDistance ? { autoCalculated: true, distanceKm: km, ratePerKm: fuelRate } : {}),
      ...(varForm.notes ? { notes: varForm.notes } : {}),
      createdAt: Date.now(),
    })
    await syncReportTotal(rpt.id!, amount)
    setVarForm({ category: 'bus_fare', amount: '', km: '', customLabel: '', notes: '' })
    setAddVarDay(null)
  }

  const handleRemoveEntry = async (entry: ExpenseEntry) => {
    if (!await showConfirm('Remove this entry?', 'It comes off the weekly total straight away.', 'Remove')) return
    await deleteDoc(doc(db, 'expense_entries', entry.id!))
    await syncReportTotal(entry.reportId, -entry.amount)
  }

  /**
   * A week with nothing to claim, declared rather than left blank.
   *
   * Without this, a rep who genuinely spent nothing — company vehicle, on
   * leave, worked out of HQ — leaves no report at all, and looks exactly like
   * a rep who forgot. The reviewer cannot tell those apart, so a missing week
   * stops meaning anything. Declaring zero closes the week the same way any
   * other week closes: submitted, then cleared.
   */
  const handleSubmitNil = async () => {
    if (weekEntries.length > 0) return
    if (!await showConfirm(
      'Nothing to claim this week?',
      `You are declaring that you had no expenses for ${weekLabel(activeWeekStart)}. It goes to an admin like any other week, and you can still add entries and resubmit if that changes.`,
      'Declare nil',
    )) return

    setSubmitting(true)
    try {
      const rpt = await getOrCreateReport()
      await updateDoc(doc(db, 'expense_reports', rpt.id!), {
        status: 'submitted', totalAmount: 0, nilReturn: true, submittedAt: Date.now(),
      })
      await addDoc(collection(db, 'alerts'), {
        type: 'expense_submitted',
        message: `${appUser.name} declared nothing to claim for ${weekLabel(activeWeekStart)}`,
        relatedId: rpt.id!, read: false, toRole: 'admin_group', createdAt: Date.now(),
      })
    } finally { setSubmitting(false) }
  }

  const handleSubmitWeek = async () => {
    if (!report || weekEntries.length === 0) { await showAlert('Nothing to submit yet', 'Log at least one expense for the week first.'); return }
    if (!await showConfirm('Submit this week?', `Expenses for ${weekLabel(activeWeekStart)} go to an admin for review. You can still edit them afterwards.`, 'Submit')) return
    setSubmitting(true)
    try {
      const total = totalOf(weekEntries)
      await updateDoc(doc(db, 'expense_reports', report.id!), {
        status: 'submitted', totalAmount: total, nilReturn: false, submittedAt: Date.now(),
      })
      await addDoc(collection(db, 'alerts'), {
        type: 'expense_submitted',
        message: `${appUser.name} submitted expenses for ${weekLabel(activeWeekStart)} — ₹${total.toLocaleString('en-IN')}`,
        relatedId: report.id!, read: false, toRole: 'admin_group', createdAt: Date.now(),
      })
    } finally { setSubmitting(false) }
  }

  const handleImportCsv = async () => {
    const rows = parseExpenseCsv(csvText).filter(r =>
      r.date.match(/^\d{4}-\d{2}-\d{2}$/) &&
      !allLeaveDates.has(r.date) &&
      !isWeekend(r.date)
    )
    if (!rows.length) { await showAlert('No usable rows', 'Nothing in that file could be read. Check the four columns, and note that weekends, holidays and leave days are skipped.'); return }
    setImporting(true)
    try {
      const weekMap = new Map<string, typeof rows>()
      for (const row of rows) {
        const ws = getWeekStart(new Date(row.date + 'T00:00:00'))
        if (!weekMap.has(ws)) weekMap.set(ws, [])
        weekMap.get(ws)!.push(row)
      }
      for (const [ws, weekRows] of weekMap.entries()) {
        const existingRpt = reports.find(r => r.weekStart === ws)
        let rptId: string
        if (existingRpt) {
          rptId = existingRpt.id!
        } else {
          const ref = await addDoc(collection(db, 'expense_reports'), {
            userId: appUser.uid, userName: appUser.name, userRole: appUser.role,
            weekStart: ws, weekEnd: addDays(ws, 6),
            status: 'draft', totalAmount: 0, createdAt: Date.now(),
          })
          rptId = ref.id
        }
        let importedDelta = 0
        const addedAllowanceDates = new Set<string>()
        for (const row of weekRows) {
          const typeUp = row.type.toUpperCase()
          if (['HQ', 'EX', 'OS'].includes(typeUp)) {
            // Skip duplicate: check both persisted entries and those added earlier in this loop
            const isDup = addedAllowanceDates.has(row.date)
              || entries.some(e => e.reportId === rptId && e.date === row.date && e.type === 'allowance')
            if (isDup) continue
            const at = typeUp as AllowanceType
            const amt = config[at.toLowerCase() as 'hq' | 'ex' | 'os']
            await addDoc(collection(db, 'expense_entries'), {
              reportId: rptId, userId: appUser.uid, date: row.date,
              type: 'allowance', allowanceType: at,
              amount: amt, createdAt: Date.now(),
            })
            addedAllowanceDates.add(row.date)
            importedDelta += amt
          } else {
            const amt = parseFloat(row.amount)
            if (isNaN(amt) || amt <= 0) continue
            const cat = VAR_CATS.find(c => c.value === row.type.toLowerCase())?.value ?? 'other'
            // Skip duplicate: same date + category + amount already exists
            const isDup = entries.some(e =>
              e.reportId === rptId && e.date === row.date &&
              e.type === 'variable' && e.category === cat && e.amount === amt
            )
            if (isDup) continue
            await addDoc(collection(db, 'expense_entries'), {
              reportId: rptId, userId: appUser.uid, date: row.date,
              type: 'variable', category: cat,
              ...(cat === 'other' && row.type ? { customLabel: row.type } : {}),
              amount: amt,
              ...(row.notes ? { notes: row.notes } : {}),
              createdAt: Date.now(),
            })
            importedDelta += amt
          }
        }
        if (importedDelta > 0) await syncReportTotal(rptId, importedDelta)
      }
      setCsvMode(false); setCsvText(''); setFileLoaded(false)
      await showAlert('Imported', 'The entries were added to the matching weeks.')
    } finally { setImporting(false) }
  }

  const weekTotal = totalOf(weekEntries.filter(e => !leaveDates.has(e.date)))
  const dayTotal = leaveDates.has(selectedDay) ? 0 : totalOf(weekEntries.filter(e => e.date === selectedDay))
  const displayTotal = viewMode === 'day' ? dayTotal : weekTotal
  const isLocked = report?.status === 'cleared'

  const money = (n: number) => `₹${n.toLocaleString('en-IN')}`

  // Fuel is priced by the rate a manager set, not by what the rep types. No
  // rate configured means the feature is simply off and the old typed amount
  // stands — a zero rate would otherwise make every fuel claim worth nothing.
  const fuelRate = config.ratePerKm && config.ratePerKm > 0 ? config.ratePerKm : null
  const fuelByDistance = varForm.category === 'fuel' && fuelRate !== null

  const STATUS_TEXT: Record<string, string> = {
    draft: 'Draft',
    submitted: 'Submitted, awaiting review',
    rejected: 'Sent back — edit and resubmit',
    cleared: 'Cleared',
  }

  const action = (label: string, onClick: () => void, disabled?: boolean) => (
    <button className="oc-action" onClick={onClick} disabled={disabled}
      style={{ background: 'none', border: 'none', padding: 0, fontSize: 13, fontWeight: 400,
               color: t.text2, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1 }}>
      {label}
    </button>
  )

  return (
    <div style={{ minHeight: '100vh', background: t.bg, paddingBottom: 40 }}>
      <PageHeader
        eyebrow="My expenses"
        title={isCurrentWeek && viewMode === 'week' ? 'This week' : weekLabel(activeWeekStart)}
        subtitle={
          report
            ? `${money(displayTotal)} ${viewMode === 'day' ? 'that day' : 'this week'} · ${STATUS_TEXT[report.status] ?? report.status}`
            : `${money(displayTotal)} ${viewMode === 'day' ? 'that day' : 'this week'}`
        }
        onBack={onBack}
        divider={false}
      />
      <TabBar
        value={mainTab}
        onChange={setMainTab}
        tabs={[{ id: 'log', label: 'Log' }, { id: 'reports', label: 'Reports' }]}
      />

      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 28 }}>

        {/* ── REPORTS ── */}
        {mainTab === 'reports' && (() => {
          const sorted = [...reports].sort((a, b) => b.createdAt - a.createdAt)
          if (!sorted.length) return (
            <EmptyState
              title="No expense reports yet"
              body="Log a day under the Log tab and a weekly report is created for you."
              actionLabel="Start logging"
              onAction={() => setMainTab('log')}
            />
          )
          return (
            <div style={{ borderBottom: `0.5px solid ${t.border}` }}>
              {sorted.map(r => {
                const rTotal = totalOf(entries.filter(e => e.reportId === r.id))
                const needsAction = r.status === 'draft' || r.status === 'rejected'
                return (
                  <button key={r.id} className="oc-row"
                    onClick={() => { setWeekStart(r.weekStart); setViewMode('week'); setMainTab('log') }}
                    style={{
                      display: 'flex', alignItems: 'baseline', gap: 16, width: '100%', textAlign: 'left',
                      background: 'none', border: 'none', borderTop: `0.5px solid ${t.border}`,
                      padding: '16px 14px', cursor: 'pointer',
                    }}>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 15, fontWeight: 500, color: t.text }}>
                        {weekLabel(r.weekStart)}
                      </span>
                      <span style={{ display: 'block', fontSize: 13, fontWeight: 400, color: t.text3, marginTop: 3 }}>
                        {STATUS_TEXT[r.status] ?? r.status}
                      </span>
                      {r.status === 'rejected' && (r as any).rejectNote && (
                        <span style={{ display: 'block', fontSize: 13, fontWeight: 400, color: t.warn, marginTop: 3 }}>
                          {(r as any).rejectNote}
                        </span>
                      )}
                    </span>
                    <span style={{ fontSize: 14, fontWeight: 400, whiteSpace: 'nowrap',
                                   color: needsAction ? t.warn : t.text2 }}>
                      {money(rTotal)}
                    </span>
                  </button>
                )
              })}
            </div>
          )
        })()}

        {/* ── LOG ── */}
        {mainTab === 'log' && (<>
          <Section label="View">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <ChipGroup
                value={viewMode}
                onChange={setViewMode}
                options={[
                  { id: 'week' as const, label: 'A whole week' },
                  { id: 'day' as const, label: 'One day' },
                ]}
              />
              {viewMode === 'week' ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <GhostButton onClick={() => setWeekStart(w => addDays(w, -7))}>Earlier</GhostButton>
                  <span style={{ fontSize: 13, fontWeight: 400, color: t.text3 }}>
                    {weekLabel(weekStart)}{isCurrentWeek ? ' · this week' : ''}
                  </span>
                  <GhostButton onClick={() => setWeekStart(w => addDays(w, 7))} disabled={isCurrentWeek}>
                    Later
                  </GhostButton>
                </div>
              ) : (
                <div style={{ maxWidth: 220 }}>
                  <DateInput type="date" value={selectedDay} max={today} onChange={setSelectedDay} />
                </div>
              )}
            </div>
          </Section>

          {!isLocked && (
            csvMode ? (
              <Section label="Import from a file" right={action('Cancel', () => { setCsvMode(false); setCsvText(''); setFileLoaded(false) })}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 560 }}>
                  <div style={{ fontSize: 13, fontWeight: 400, color: t.text3, lineHeight: 1.6 }}>
                    Four columns: date, type, amount, notes. Type is one of HQ, EX, OS, bus_fare,
                    fuel, food, lodging, printing or other. Weekends, holidays and days you were on
                    leave are skipped.
                  </div>

                  <label style={{ display: 'block', border: `0.5px dashed ${t.border2}`, borderRadius: 6,
                                  padding: 18, cursor: 'pointer' }}>
                    <input type="file" accept=".csv,.xlsx,.xls,text/csv" style={{ display: 'none' }}
                      onChange={e => {
                        const file = e.target.files?.[0]
                        if (!file) return
                        const isExcel = file.name.match(/\.xlsx?$/i)
                        const reader = new FileReader()
                        reader.onload = ev => {
                          const result = ev.target?.result
                          if (!result) return
                          if (isExcel) {
                            const wb = XLSX.read(result, { type: 'array' })
                            const ws = wb.Sheets[wb.SheetNames[0]]
                            const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1 })
                            if (isOcealgoFormat(rows)) {
                              setCsvText(rowsToCsvText(parseOcealgoSheet(rows)))
                            } else {
                              setCsvText(XLSX.utils.sheet_to_csv(ws))
                            }
                          } else {
                            setCsvText(result as string)
                          }
                          setFileLoaded(true)
                        }
                        isExcel ? reader.readAsArrayBuffer(file) : reader.readAsText(file)
                        e.target.value = ''
                      }} />
                    <div style={{ fontSize: 14, fontWeight: 400, color: t.text }}>
                      {csvText ? 'File loaded. Tap to replace it.' : 'Choose a .csv or .xlsx file'}
                    </div>
                  </label>

                  <Field label="Or paste the rows here">
                    <textarea value={csvText} onChange={e => { setCsvText(e.target.value); setFileLoaded(false) }} rows={5}
                      placeholder={'date,type,amount,notes\n2026-05-01,HQ,,\n2026-05-01,bus_fare,45,Morning auto'}
                      style={{ ...inputStyle(t), resize: 'vertical', fontFamily: 'monospace', fontSize: 12, lineHeight: 1.6 }} />
                  </Field>

                  <div>
                    <PrimaryButton onClick={handleImportCsv} disabled={importing || !fileLoaded}>
                      {importing ? 'Importing' : 'Import'}
                    </PrimaryButton>
                  </div>
                </div>
              </Section>
            ) : (
              <div>
                <GhostButton onClick={() => setCsvMode(true)}>Import from a file</GhostButton>
              </div>
            )
          )}

          {/* Daily rows */}
          <div style={{ borderBottom: `0.5px solid ${t.border}` }}>
            {visibleDates.map(date => {
              const isHoliday = holidayDates.has(date)
              const isLeave = !isHoliday && leaveDates.has(date)
              const isWknd = isWeekend(date)
              const isToday = date === today
              const isWorking = !isLeave && !isHoliday && !isWknd
              const dayEntries = weekEntries.filter(e => e.date === date)
              const allowanceEntry = dayEntries.find(e => e.type === 'allowance')
              const variableEntries = dayEntries.filter(e => e.type === 'variable')
              const dayTot = isLeave || isWknd ? 0 : totalOf(dayEntries)
              const isAddingVar = addVarDay === date
              const isFuture = date > today

              const note = isHoliday ? 'Holiday'
                : isLeave ? 'On leave'
                : isWknd ? 'Weekend'
                : isFuture && dayEntries.length === 0 ? 'Not yet'
                : null

              return (
                <div key={date} style={{ borderTop: `0.5px solid ${t.border}`, padding: '16px 0',
                                         opacity: isWknd ? 0.5 : 1 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 500, color: t.text }}>
                        {fmtDate(date)}
                        {isToday && (
                          <span style={{ fontSize: 13, fontWeight: 400, color: t.text3, marginLeft: 8 }}>Today</span>
                        )}
                      </div>
                      {note && (
                        <div style={{ fontSize: 13, fontWeight: 400, color: t.text3, marginTop: 3 }}>{note}</div>
                      )}
                    </div>
                    {dayTot > 0 && (
                      <div style={{ fontSize: 15, fontWeight: 500, color: t.text, whiteSpace: 'nowrap' }}>
                        {money(dayTot)}
                      </div>
                    )}
                  </div>

                  {isWorking && (
                    <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
                      {/* Daily allowance */}
                      {allowanceEntry ? (
                        <div>
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
                            <span style={{ flex: 1, fontSize: 14, fontWeight: 400, color: t.text }}>
                              {ALLOW_INFO[allowanceEntry.allowanceType!].label} allowance
                              <span style={{ color: t.text3 }}>
                                {' · '}{ALLOW_INFO[allowanceEntry.allowanceType!].sub}
                              </span>
                            </span>
                            <span style={{ fontSize: 14, fontWeight: 400, color: t.text2, whiteSpace: 'nowrap' }}>
                              {money(allowanceEntry.amount)}
                            </span>
                          </div>
                          {!isLocked && (
                            <div style={{ display: 'flex', gap: 14, marginTop: 8, flexWrap: 'wrap' }}>
                              {(['HQ', 'EX', 'OS'] as AllowanceType[])
                                .filter(a => a !== allowanceEntry.allowanceType)
                                .map(a => action(`Change to ${a}`, () => handleSetAllowance(date, a)))}
                              {action('Remove', () => handleRemoveAllowance(date))}
                            </div>
                          )}
                        </div>
                      ) : !isLocked && addDaDay === date ? (
                        <Field label="Which allowance applies">
                          <ChipGroup
                            value={'' as AllowanceType}
                            onChange={async (a: AllowanceType) => { await handleSetAllowance(date, a); setAddDaDay(null) }}
                            options={(['HQ', 'EX', 'OS'] as AllowanceType[]).map(a => ({
                              id: a,
                              label: `${a} · ${ALLOW_INFO[a].sub} · ${money(config[a.toLowerCase() as 'hq' | 'ex' | 'os'])}`,
                            }))}
                          />
                          <div style={{ marginTop: 10 }}>{action('Cancel', () => setAddDaDay(null))}</div>
                        </Field>
                      ) : null}

                      {/* Variable entries */}
                      {variableEntries.map(e => {
                        const cat = VAR_CATS.find(c => c.value === e.category)
                        return (
                          <div key={e.id} style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
                            <span style={{ flex: 1, minWidth: 0 }}>
                              <span style={{ display: 'block', fontSize: 14, fontWeight: 400, color: t.text }}>
                                {e.customLabel || cat?.label}
                              </span>
                              {/* Shows its own arithmetic, so a claim can be
                                  checked without knowing today's rate. */}
                              {e.distanceKm !== undefined && (
                                <span style={{ display: 'block', fontSize: 13, fontWeight: 400, color: t.text3, marginTop: 3 }}>
                                  {e.distanceKm} km{e.ratePerKm ? ` at ${money(e.ratePerKm)} per km` : ''}
                                </span>
                              )}
                              {e.notes && (
                                <span style={{ display: 'block', fontSize: 13, fontWeight: 400, color: t.text3, marginTop: 3 }}>
                                  {e.notes}
                                </span>
                              )}
                            </span>
                            <span style={{ fontSize: 14, fontWeight: 400, color: t.text2, whiteSpace: 'nowrap' }}>
                              {money(e.amount)}
                            </span>
                            {!isLocked && action('Remove', () => handleRemoveEntry(e))}
                          </div>
                        )
                      })}

                      {/* Nudges */}
                      {isToday && dayEntries.length === 0 && (
                        <Note>Nothing logged for today yet.</Note>
                      )}
                      {isToday && !visitedDates.has(date) && isAfter6pmIST && !isHoliday && (
                        <div>
                          <Note tone="warn">Today has no visit log.</Note>
                          {onLogVisit && (
                            <div style={{ marginTop: 10 }}>{action('Log the visit now', () => onLogVisit(date))}</div>
                          )}
                        </div>
                      )}
                      {!isToday && dayEntries.length > 0 && !visitedDates.has(date) && date < today && (
                        <div>
                          <Note tone="warn">This day has expenses but no visit log.</Note>
                          {onLogVisit && (
                            <div style={{ marginTop: 10 }}>{action('Log the visit now', () => onLogVisit(date))}</div>
                          )}
                        </div>
                      )}

                      {/* Add an expense */}
                      {!isLocked && (
                        isAddingVar ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 460,
                                        borderTop: `0.5px solid ${t.border}`, paddingTop: 16 }}>
                            <Field label="What was it for">
                              <ChipGroup
                                value={varForm.category}
                                onChange={c => setVarForm(f => ({ ...f, category: c }))}
                                options={VAR_CATS.map(c => ({ id: c.value, label: c.label }))}
                              />
                            </Field>
                            {varForm.category === 'other' && (
                              <Field label="Describe it">
                                <input value={varForm.customLabel}
                                  onChange={e => setVarForm(f => ({ ...f, customLabel: e.target.value }))}
                                  placeholder="What was this expense" style={inputStyle(t)} />
                              </Field>
                            )}

                            {fuelByDistance ? (
                              <Field label="Distance travelled"
                                hint={`Paid at ${money(fuelRate!)} per km. You do not enter the amount — it is worked out from this.`}>
                                <input type="number" inputMode="decimal" value={varForm.km}
                                  onChange={e => setVarForm(f => ({ ...f, km: e.target.value }))}
                                  placeholder="Kilometres" style={inputStyle(t)} />
                                <div style={{ fontSize: 13, fontWeight: 400, color: t.text3, marginTop: 7 }}>
                                  {parseFloat(varForm.km) > 0
                                    ? `That is ${money(round2(parseFloat(varForm.km) * fuelRate!))}.`
                                    : 'Enter the distance to see what it comes to.'}
                                </div>
                              </Field>
                            ) : (
                              <Field label="Amount"
                                hint={varForm.category === 'fuel'
                                  ? 'No ₹ per km rate has been set, so enter the amount yourself.'
                                  : undefined}>
                                <input type="number" inputMode="decimal" value={varForm.amount}
                                  onChange={e => setVarForm(f => ({ ...f, amount: e.target.value }))}
                                  placeholder="45" style={inputStyle(t)} />
                              </Field>
                            )}
                            <Field label="Notes">
                              <input value={varForm.notes}
                                onChange={e => setVarForm(f => ({ ...f, notes: e.target.value }))}
                                placeholder="Optional" style={inputStyle(t)} />
                            </Field>
                            <div style={{ display: 'flex', gap: 10 }}>
                              <PrimaryButton onClick={handleAddVariable}>Add</PrimaryButton>
                              <GhostButton onClick={() => {
                                setAddVarDay(null)
                                setVarForm({ category: 'bus_fare', amount: '', km: '', customLabel: '', notes: '' })
                              }}>
                                Cancel
                              </GhostButton>
                            </div>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', gap: 14 }}>
                            {action('Add an expense', () => { setAddVarDay(date); setAddDaDay(null) })}
                            {!allowanceEntry && action('Add the daily allowance', () => { setAddDaDay(date); setAddVarDay(null) })}
                          </div>
                        )
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Submit / status */}
          {(report?.status === 'draft' || report?.status === 'rejected') && weekEntries.length > 0 && viewMode === 'week' && (
            <Section label="Submit">
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
                            gap: 16, marginBottom: 14, maxWidth: 460 }}>
                <span style={{ fontSize: 14, fontWeight: 400, color: t.text2 }}>Total for the week</span>
                <span style={{ fontSize: 15, fontWeight: 500, color: t.text }}>{money(weekTotal)}</span>
              </div>
              <PrimaryButton onClick={handleSubmitWeek} disabled={submitting}>
                {submitting ? 'Submitting' : 'Submit this week for review'}
              </PrimaryButton>
            </Section>
          )}

          {viewMode === 'week' && weekEntries.length === 0 && !isLocked
            && (!report || report.status === 'draft' || report.status === 'rejected') && (
            <Section label="Submit">
              <div style={{ maxWidth: 460 }}>
                <div style={{ fontSize: 14, fontWeight: 400, color: t.text3, lineHeight: 1.6, marginBottom: 14 }}>
                  Nothing is logged for this week. If you genuinely had no expenses, say so — left
                  blank it is indistinguishable from a week you forgot to fill in.
                </div>
                <PrimaryButton onClick={handleSubmitNil} disabled={submitting}>
                  {submitting ? 'Submitting' : 'Nothing to claim this week'}
                </PrimaryButton>
              </div>
            </Section>
          )}

          {report?.status === 'submitted' && (
            <Note>
              {report.nilReturn && weekTotal === 0 ? 'Declared as nothing to claim' : 'Submitted'}
              {report.submittedAt
                ? ` on ${new Date(report.submittedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`
                : ''} and waiting on an admin. You can still edit entries.
            </Note>
          )}

          {report?.status === 'rejected' && (
            <Note tone="warn">
              This week was sent back{(report as any).rejectNote ? `: ${(report as any).rejectNote}` : '.'}
              {' '}Edit the entries and submit again.
            </Note>
          )}

          {report?.status === 'cleared' && (
            <Note>
              Cleared{report.clearedAt
                ? ` on ${new Date(report.clearedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`
                : ''}{report.clearedByName ? ` by ${report.clearedByName}` : ''}.
              {report.clearNote ? ` ${report.clearNote}` : ''}
            </Note>
          )}
        </>)}
      </div>
      {modal}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN VIEW
// ─────────────────────────────────────────────────────────────────────────────
function AdminView({ onBack, appUser, onViewVisitLog }: { onBack: () => void; appUser: AppUser; onViewVisitLog?: (userName: string, date: string) => void }) {
  const { t } = useTheme()
  const { modal, showAlert, showConfirm } = useConfirm()
  const [tab, setTab] = useState<'reports' | 'config'>('reports')
  const [config, setConfig] = useState<ExpenseConfig>(DEFAULT_CONFIG)
  const [configForm, setConfigForm] = useState({ hq: '200', ex: '300', os: '450', ratePerKm: '' })
  const canSetRates = can(appUser, 'clear_expenses')
  const [savingConfig, setSavingConfig] = useState(false)
  const [reports, setReports] = useState<ExpenseReport[]>([])
  const [entries, setEntries] = useState<ExpenseEntry[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<'submitted' | 'cleared' | 'rejected' | 'all'>('submitted')
  const [clearingId, setClearingId] = useState<string | null>(null)
  const [clearNote, setClearNote] = useState('')
  const [rejectingId, setRejectingId] = useState<string | null>(null)
  const [rejectNote, setRejectNote] = useState('')
  const [visitLogMap, setVisitLogMap] = useState<Map<string, Set<string>>>(new Map())
  const [allLeaves, setAllLeaves] = useState<LeaveRecord[]>([])
  const [allHolidays, setAllHolidays] = useState<Holiday[]>([])

  useEffect(() => {
    const u1 = onSnapshot(doc(db, 'expense_config', 'main'), snap => {
      if (snap.exists()) {
        const d = snap.data() as ExpenseConfig
        setConfig({ ...DEFAULT_CONFIG, ...d })
        setConfigForm({
          hq: String(d.hq ?? 200), ex: String(d.ex ?? 300), os: String(d.os ?? 450),
          ratePerKm: d.ratePerKm !== undefined ? String(d.ratePerKm) : '',
        })
      }
    })
    const u2 = onSnapshot(collection(db, 'expense_reports'), snap => {
      setReports(snap.docs.map(d => ({ id: d.id, ...d.data() } as ExpenseReport)).sort((a, b) => b.createdAt - a.createdAt))
    })
    const u3 = onSnapshot(collection(db, 'expense_entries'), snap => {
      setEntries(snap.docs.map(d => ({ id: d.id, ...d.data() } as ExpenseEntry)))
    })
    const u4 = onSnapshot(query(collection(db, 'leave_records'), where('status', '==', 'active')), snap => {
      setAllLeaves(snap.docs.map(d => ({ id: d.id, ...d.data() } as LeaveRecord)))
    })
    const u5 = onSnapshot(collection(db, 'holidays'), snap => {
      setAllHolidays(snap.docs.map(d => ({ id: d.id, ...d.data() } as Holiday)))
    })
    return () => { u1(); u2(); u3(); u4(); u5() }
  }, [])

  const handleSaveConfig = async () => {
    const hq = parseFloat(configForm.hq), ex = parseFloat(configForm.ex), os = parseFloat(configForm.os)
    if ([hq, ex, os].some(isNaN)) { await showAlert('Amounts needed', 'Enter a number for each of the three rates.'); return }

    // Left blank the ₹/km rate is simply unset, and the fuel claim falls back
    // to a typed amount. Zero is not the same as unset and is rejected — it
    // would silently make every fuel claim worth nothing.
    const rateRaw = configForm.ratePerKm.trim()
    const ratePerKm = rateRaw === '' ? undefined : parseFloat(rateRaw)
    if (ratePerKm !== undefined && (isNaN(ratePerKm) || ratePerKm <= 0)) {
      await showAlert('Check the fuel rate', 'Enter a rate above zero, or leave it blank to let reps type the amount themselves.')
      return
    }

    setSavingConfig(true)
    try {
      await setDoc(doc(db, 'expense_config', 'main'), {
        hq, ex, os,
        ...(ratePerKm !== undefined ? { ratePerKm } : {}),
        updatedAt: Date.now(), updatedBy: appUser.uid,
      })
    } catch (e: any) {
      await showAlert('Could not save',
        e?.code === 'permission-denied'
          ? 'Setting the rates needs the clear_expenses permission.'
          : 'Something went wrong. Try again.')
    } finally { setSavingConfig(false) }
  }

  const handleClear = async (r: ExpenseReport) => {
    if (!can(appUser, 'clear_expenses')) {
      await showAlert('Not allowed', 'Clearing an expense report needs the clear_expenses permission.')
      return
    }
    if (!maySignOffFor(appUser, 'clear_expenses', { uid: r.userId, role: r.userRole })) {
      await showAlert(
        'An admin has to clear this one',
        r.userId === appUser.uid
          ? 'You cannot clear your own claim, whatever else you can clear.'
          : `${r.userName} is at your own level, so their claim goes to an admin.`,
      )
      return
    }
    const liveTotal = reportTotal(r.id!)
    const isNil = r.nilReturn && liveTotal === 0
    if (!await showConfirm(
      isNil ? 'Acknowledge this week?' : 'Clear this report?',
      isNil
        ? `${r.userName} declared nothing to claim for ${weekLabel(r.weekStart)}. Nothing is paid — this just closes the week off.

This cannot be undone.`
        : `${r.userName} is marked as paid ₹${liveTotal.toLocaleString('en-IN')} for ${weekLabel(r.weekStart)}.

This cannot be undone.`,
      isNil ? 'Acknowledge' : 'Clear it')) return
    setClearingId(r.id!)
    try {
      await updateDoc(doc(db, 'expense_reports', r.id!), {
        status: 'cleared', clearedAt: Date.now(),
        totalAmount: liveTotal,
        clearedBy: appUser.uid, clearedByName: appUser.name,
        ...(clearNote ? { clearNote } : {}),
      })
      await addDoc(collection(db, 'alerts'), {
        type: 'expense_submitted',
        message: isNil
          ? `Your nil return for ${weekLabel(r.weekStart)} was acknowledged${clearNote ? `. ${clearNote}` : '.'}`
          : `Your expenses for ${weekLabel(r.weekStart)} were cleared — ₹${liveTotal.toLocaleString('en-IN')}${clearNote ? `. ${clearNote}` : '.'}`,
        relatedId: r.id!, read: false, toUid: r.userId, createdAt: Date.now(),
      })
      setClearNote('')
    } finally { setClearingId(null) }
  }

  const handleReject = async (r: ExpenseReport) => {
    if (!can(appUser, 'clear_expenses')) {
      await showAlert('Not allowed', 'Sending a report back needs the clear_expenses permission.')
      return
    }
    // Sending back is the same authority as clearing — it decides whether
    // somebody gets paid this week — so it answers to the same question.
    if (!maySignOffFor(appUser, 'clear_expenses', { uid: r.userId, role: r.userRole })) {
      await showAlert(
        'An admin has to handle this one',
        r.userId === appUser.uid
          ? 'You cannot action your own claim, whatever else you can action.'
          : `${r.userName} is at your own level, so their claim goes to an admin.`,
      )
      return
    }
    if (!rejectNote.trim()) { await showAlert('Reason needed', 'Say why it is going back, so they know what to fix.'); return }
    if (!await showConfirm('Send this back?', `${r.userName} is notified and can edit and resubmit the week.`, 'Send back')) return
    setRejectingId(r.id!)
    try {
      await updateDoc(doc(db, 'expense_reports', r.id!), {
        status: 'rejected', rejectedAt: Date.now(),
        rejectedBy: appUser.uid, rejectedByName: appUser.name,
        rejectNote: rejectNote.trim(),
      })
      await addDoc(collection(db, 'alerts'), {
        type: 'expense_submitted',
        message: `Your expenses for ${weekLabel(r.weekStart)} were sent back: ${rejectNote.trim()} Please edit and submit again.`,
        relatedId: r.id!, read: false, toUid: r.userId, createdAt: Date.now(),
      })
      setRejectNote('')
    } finally { setRejectingId(null) }
  }

  const reportTotal = (rId: string) => totalOf(entries.filter(e => e.reportId === rId))

  const filtered = reports.filter(r =>
    statusFilter === 'all' ? r.status !== 'draft' : r.status === statusFilter
  )

  useEffect(() => {
    if (!expandedId) return
    const r = reports.find(x => x.id === expandedId)
    if (!r) return
    const key = `${r.userId}_${r.weekStart}`
    const weekDates = getWeekDates(r.weekStart)
    getDocs(query(
      collection(db, 'visit_logs'),
      where('salesPersonId', '==', r.userId),
      where('date', 'in', weekDates),
    )).then(snap => {
      const logged = new Set(
        snap.docs
          .map(d => d.data() as DailyVisitLog)
          .filter(l => !l.isNoEntry)
          .map(l => l.date)
      )
      setVisitLogMap(prev => new Map(prev).set(key, logged))
    })
  }, [expandedId])

  const pendingTotal = reports.filter(r => r.status === 'submitted').reduce((s, r) => s + reportTotal(r.id!), 0)
  const clearedTotal = reports.filter(r => r.status === 'cleared').reduce((s, r) => s + reportTotal(r.id!), 0)

  const money = (n: number) => `₹${n.toLocaleString('en-IN')}`

  const STATUS_TEXT: Record<string, string> = {
    submitted: 'Awaiting review',
    rejected: 'Sent back',
    cleared: 'Cleared',
    draft: 'Draft',
  }

  const action = (label: string, onClick: () => void, disabled?: boolean) => (
    <button className="oc-action" onClick={onClick} disabled={disabled}
      style={{ background: 'none', border: 'none', padding: 0, fontSize: 13, fontWeight: 400,
               color: t.text2, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1 }}>
      {label}
    </button>
  )

  const pendingCount = reports.filter(r => r.status === 'submitted').length

  return (
    <div style={{ minHeight: '100vh', background: t.bg, paddingBottom: 40 }}>
      <PageHeader
        eyebrow="Admin"
        title="Expenses"
        subtitle={pendingCount > 0
          ? `${money(pendingTotal)} across ${pendingCount} report${pendingCount > 1 ? 's' : ''} waiting on you`
          : 'Nothing is waiting for review'}
        onBack={onBack}
        divider={false}
      />
      <TabBar
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'reports', label: 'Reports' },
          // Setting what a day is worth is a money decision, so it follows the
          // same permission as signing one off.
          ...(canSetRates ? [{ id: 'config' as const, label: 'Rates' }] : []),
        ]}
      />

      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 28 }}>

        {/* ── ALLOWANCE CONFIG ── */}
        {tab === 'config' && (
          <Section label="Daily allowance rates">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 460 }}>
              <div style={{ fontSize: 14, fontWeight: 400, color: t.text3, lineHeight: 1.6 }}>
                What a salesperson is paid per working day, depending on how far they travelled.
                Changing a rate affects new entries only.
              </div>
              {(['hq', 'ex', 'os'] as const).map(key => {
                const info = ALLOW_INFO[key.toUpperCase() as AllowanceType]
                return (
                  <Field key={key} label={`${info.label} — ${info.sub}`}
                    hint={`Currently ${money(config[key])}.`}>
                    <input type="number" inputMode="decimal" value={configForm[key]}
                      onChange={e => setConfigForm(f => ({ ...f, [key]: e.target.value }))}
                      style={inputStyle(t)} />
                  </Field>
                )
              })}
              <div style={{ borderTop: `0.5px solid ${t.border}`, paddingTop: 20 }}>
                <Field label="Fuel rate — ₹ per km"
                  hint={config.ratePerKm
                    ? `Currently ${money(config.ratePerKm)} per km. A rep logging fuel enters the distance and the amount is worked out from it.`
                    : 'Not set. Until it is, a rep logging fuel types the amount themselves.'}>
                  <input type="number" inputMode="decimal" value={configForm.ratePerKm}
                    onChange={e => setConfigForm(f => ({ ...f, ratePerKm: e.target.value }))}
                    placeholder="Leave blank to let reps type the amount" style={inputStyle(t)} />
                </Field>
              </div>

              <div>
                <PrimaryButton onClick={handleSaveConfig} disabled={savingConfig}>
                  {savingConfig ? 'Saving' : 'Save rates'}
                </PrimaryButton>
              </div>
            </div>
          </Section>
        )}

        {/* ── REPORTS ── */}
        {tab === 'reports' && (
          <>
            <StatGrid>
              <StatCard value={money(pendingTotal)} label="Awaiting review"
                context={pendingCount > 0 ? `${pendingCount} report${pendingCount > 1 ? 's' : ''}` : undefined} />
              <StatCard value={money(clearedTotal)} label="Cleared" context="Paid out so far" />
              <StatCard value={reports.filter(r => r.status === 'rejected').length} label="Sent back"
                context="Waiting on a rep to fix" />
            </StatGrid>

            <Section label="Filter">
              <ChipGroup
                value={statusFilter}
                onChange={setStatusFilter}
                options={[
                  { id: 'submitted' as const, label: 'Awaiting review' },
                  { id: 'cleared' as const, label: 'Cleared' },
                  { id: 'rejected' as const, label: 'Sent back' },
                  { id: 'all' as const, label: 'Everything' },
                ]}
              />
            </Section>

            {filtered.length === 0 ? (
              <EmptyState
                title="Nothing here"
                body={statusFilter === 'submitted'
                  ? 'No expense report is waiting for review.'
                  : 'No report matches that filter.'}
              />
            ) : (
              <div style={{ borderBottom: `0.5px solid ${t.border}` }}>
                {filtered.map(r => {
                  const rEntries = entries.filter(e => e.reportId === r.id)
                  const isExpanded = expandedId === r.id
                  const key = `${r.userId}_${r.weekStart}`
                  const logged = visitLogMap.get(key)

                  // How many of the days they were due to log a visit actually have one.
                  let logSummary: string | null = null
                  let logShort = false
                  if (logged) {
                    const todayStr = localDateStr()
                    const userLeaveDates = new Set(allLeaves.filter(l => l.uid === r.userId).map(l => l.date))
                    const allHolidayDates = new Set(allHolidays.map(h => h.date))
                    const dueDays = getWeekDates(r.weekStart).filter(d =>
                      !isWeekend(d) && d <= todayStr && !userLeaveDates.has(d) && !allHolidayDates.has(d))
                    if (dueDays.length) {
                      const count = dueDays.filter(d => logged.has(d)).length
                      logSummary = `${count} of ${dueDays.length} days have a visit log`
                      logShort = count < dueDays.length
                    }
                  }

                  return (
                    <div key={r.id} style={{ borderTop: `0.5px solid ${t.border}`, padding: '18px 0' }}>
                      <button className="oc-action" onClick={() => setExpandedId(isExpanded ? null : r.id!)}
                        style={{ display: 'flex', alignItems: 'baseline', gap: 16, width: '100%',
                                 textAlign: 'left', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ display: 'block', fontSize: 15, fontWeight: 500, color: t.text }}>
                            {r.userName}
                          </span>
                          <span style={{ display: 'block', fontSize: 13, fontWeight: 400, color: t.text3, marginTop: 3 }}>
                            {weekLabel(r.weekStart)}
                            {r.nilReturn && reportTotal(r.id!) === 0 && ' · nothing to claim'}
                            {r.status === 'submitted' && r.submittedAt &&
                              ` · submitted ${new Date(r.submittedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`}
                            {r.status === 'cleared' && r.clearedAt &&
                              ` · cleared ${new Date(r.clearedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}${r.clearedByName ? ` by ${r.clearedByName}` : ''}`}
                          </span>
                          {logSummary && (
                            <span style={{ display: 'block', fontSize: 13, fontWeight: 400, marginTop: 3,
                                           color: logShort ? t.warn : t.text3 }}>
                              {logSummary}
                            </span>
                          )}
                        </span>
                        <span style={{ textAlign: 'right', flexShrink: 0 }}>
                          <span style={{ display: 'block', fontSize: 15, fontWeight: 500, color: t.text }}>
                            {money(reportTotal(r.id!))}
                          </span>
                          <span style={{ display: 'block', fontSize: 13, fontWeight: 400, marginTop: 3,
                                         color: r.status === 'submitted' ? t.warn : t.text3 }}>
                            {STATUS_TEXT[r.status] ?? r.status}
                          </span>
                        </span>
                      </button>

                      {isExpanded && (
                        <div style={{ marginTop: 16 }}>
                          {(() => {
                            const byDate = new Map<string, ExpenseEntry[]>()
                            const seenAllowance = new Set<string>()
                            rEntries.sort((a, b) => a.date.localeCompare(b.date)).forEach(e => {
                              if (e.type === 'allowance') {
                                if (seenAllowance.has(e.date)) return
                                seenAllowance.add(e.date)
                              }
                              if (!byDate.has(e.date)) byDate.set(e.date, [])
                              byDate.get(e.date)!.push(e)
                            })
                            const loggedDates = logged
                            const todayStr = localDateStr()
                            const userLeaveDates = new Set(allLeaves.filter(l => l.uid === r.userId).map(l => l.date))
                            const adminHolidayDates = new Set(allHolidays.map(h => h.date))
                            const weekdays = getWeekDates(r.weekStart).filter(d => !isWeekend(d))
                            const visibleDates = weekdays.filter(d =>
                              userLeaveDates.has(d) || adminHolidayDates.has(d) || byDate.has(d))
                            if (visibleDates.length === 0) return (
                              <div style={{ fontSize: 13, fontWeight: 400, color: t.text3 }}>
                                Nothing was logged in this week.
                              </div>
                            )
                            return visibleDates.map(date => {
                              const isHolidayDate = adminHolidayDates.has(date)
                              const isLeave = !isHolidayDate && userLeaveDates.has(date)
                              const dayE = byDate.get(date) ?? []
                              const didLog = loggedDates?.has(date)
                              const isPast = date <= todayStr
                              return (
                                <div key={date} style={{ marginBottom: 18 }}>
                                  <div style={{ fontSize: 11, letterSpacing: '0.09em', textTransform: 'uppercase',
                                                color: t.text3, marginBottom: 8 }}>
                                    {fmtDate(date)}
                                  </div>
                                  {isHolidayDate ? (
                                    <div style={{ fontSize: 14, fontWeight: 400, color: t.text3 }}>
                                      {allHolidays.find(h => h.date === date)?.name ?? 'Holiday'}
                                    </div>
                                  ) : isLeave ? (
                                    <div style={{ fontSize: 14, fontWeight: 400, color: t.text3 }}>On leave</div>
                                  ) : (
                                    <>
                                      {dayE.map(e => {
                                        const cat = VAR_CATS.find(c => c.value === e.category)
                                        return (
                                          <div key={e.id} style={{ display: 'flex', alignItems: 'baseline',
                                                                   gap: 16, marginTop: 5 }}>
                                            <span style={{ flex: 1, fontSize: 14, fontWeight: 400, color: t.text }}>
                                              {e.type === 'allowance'
                                                ? `${ALLOW_INFO[e.allowanceType!].label} allowance · ${ALLOW_INFO[e.allowanceType!].sub}`
                                                : (e.customLabel || cat?.label)}
                                              {/* The claim carries its own working, so the
                                                  rate in force then is what is shown now. */}
                                              {e.distanceKm !== undefined && (
                                                <span style={{ color: t.text3 }}>
                                                  {' · '}{e.distanceKm} km
                                                  {e.ratePerKm ? ` at ${money(e.ratePerKm)}/km` : ''}
                                                </span>
                                              )}
                                              {e.notes && (
                                                <span style={{ color: t.text3 }}>{' · '}{e.notes}</span>
                                              )}
                                            </span>
                                            <span style={{ fontSize: 14, fontWeight: 400, color: t.text2, whiteSpace: 'nowrap' }}>
                                              {money(e.amount)}
                                            </span>
                                          </div>
                                        )
                                      })}
                                      {loggedDates && isPast && (
                                        didLog ? (
                                          <div style={{ marginTop: 8 }}>
                                            {action('View the visit log', () => onViewVisitLog?.(r.userName, date))}
                                          </div>
                                        ) : (
                                          <div style={{ fontSize: 13, fontWeight: 400, color: t.warn, marginTop: 8 }}>
                                            No visit log for this day.
                                          </div>
                                        )
                                      )}
                                    </>
                                  )}
                                </div>
                              )
                            })
                          })()}

                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                                        gap: 16, borderTop: `0.5px solid ${t.border}`, paddingTop: 14 }}>
                            <span style={{ fontSize: 14, fontWeight: 400, color: t.text2 }}>Total</span>
                            <span style={{ fontSize: 15, fontWeight: 500, color: t.text }}>
                              {money(reportTotal(r.id!))}
                            </span>
                          </div>

                          {r.status === 'submitted' && (
                            <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 460 }}>
                              {r.nilReturn && reportTotal(r.id!) === 0 ? (
                                <Note>
                                  They declared nothing to claim for this week. Nothing is paid —
                                  acknowledging it just closes the week off.
                                </Note>
                              ) : (
                                <Note tone="warn">
                                  Clear this only once the money has physically reached the salesperson
                                  and the payment is recorded in Zoho Inventory. It cannot be undone.
                                </Note>
                              )}

                              <Field label="Note on clearing" hint="Optional. How it was paid, for example.">
                                <input value={clearNote} onChange={e => setClearNote(e.target.value)}
                                  placeholder="Paid via UPI" style={inputStyle(t)} />
                              </Field>
                              <div>
                                <PrimaryButton onClick={() => handleClear(r)} disabled={!!clearingId || !!rejectingId}>
                                  {clearingId === r.id ? 'Clearing'
                                    : r.nilReturn && reportTotal(r.id!) === 0 ? 'Acknowledge the week'
                                    : `Clear ${money(reportTotal(r.id!))}`}
                                </PrimaryButton>
                              </div>

                              <Field label="Reason for sending it back" hint="Required if you send it back.">
                                <input value={rejectNote} onChange={e => setRejectNote(e.target.value)}
                                  placeholder="Fuel bill missing for Tuesday" style={inputStyle(t)} />
                              </Field>
                              <div>
                                <GhostButton onClick={() => handleReject(r)} disabled={!!clearingId || !!rejectingId}>
                                  {rejectingId === r.id ? 'Sending back' : 'Send back for edits'}
                                </GhostButton>
                              </div>
                            </div>
                          )}

                          {r.status === 'cleared' && r.clearNote && (
                            <div style={{ fontSize: 13, fontWeight: 400, color: t.text3, marginTop: 12 }}>
                              {r.clearNote}
                            </div>
                          )}
                          {r.status === 'rejected' && (r as any).rejectNote && (
                            <div style={{ fontSize: 13, fontWeight: 400, color: t.warn, marginTop: 12 }}>
                              {(r as any).rejectNote}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>
      {modal}
    </div>
  )
}
