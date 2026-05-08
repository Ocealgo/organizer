import React, { useState, useEffect } from 'react'
import * as XLSX from 'xlsx'
import {
  collection, addDoc, onSnapshot, query, where,
  updateDoc, doc, setDoc, getDoc, deleteDoc, getDocs,
} from 'firebase/firestore'
import { db } from '../../firebase'
import {
  AllowanceType, ExpenseCategory, ExpenseConfig,
  ExpenseReport, ExpenseEntry, LeaveRecord, AppUser, DailyVisitLog, Holiday,
} from '../../types'
import { useAuth } from '../../context/AuthContext'
import { useConfirm } from '../../hooks/useConfirm'
import { localDateStr } from '../../utils/date'

interface Props { onBack: () => void; onViewVisitLog?: (userName: string, date: string) => void; onLogVisit?: (date: string) => void }

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
const ALLOW_INFO: Record<AllowanceType, { label: string; sub: string; emoji: string }> = {
  HQ: { label: 'HQ', sub: 'Within 25km', emoji: '🏢' },
  EX: { label: 'EX', sub: '25km+',       emoji: '🗺️' },
  OS: { label: 'OS', sub: 'Outstation',  emoji: '🛏️' },
}

const VAR_CATS: { value: ExpenseCategory; label: string; emoji: string }[] = [
  { value: 'bus_fare', label: 'Bus Fare', emoji: '🚌' },
  { value: 'fuel',     label: 'Fuel',     emoji: '⛽' },
  { value: 'food',     label: 'Food',     emoji: '🍱' },
  { value: 'lodging',  label: 'Lodging',  emoji: '🏨' },
  { value: 'printing', label: 'Printing', emoji: '🖨️' },
  { value: 'other',    label: 'Other',    emoji: '📦' },
]

const DEFAULT_CONFIG: ExpenseConfig = { hq: 200, ex: 300, os: 450 }

// ── Root ──────────────────────────────────────────────────────────────────────
export default function ExpenseLogger({ onBack, onViewVisitLog, onLogVisit }: Props) {
  const { appUser } = useAuth()
  const isAdmin = appUser?.role === 'super_admin' || appUser?.role === 'admin'
  if (!appUser) return null
  return isAdmin
    ? <AdminView onBack={onBack} appUser={appUser} onViewVisitLog={onViewVisitLog} />
    : <SalesView onBack={onBack} appUser={appUser} onLogVisit={onLogVisit} />
}

// ─────────────────────────────────────────────────────────────────────────────
// SALES VIEW
// ─────────────────────────────────────────────────────────────────────────────
function SalesView({ onBack, appUser, onLogVisit }: { onBack: () => void; appUser: AppUser; onLogVisit?: (date: string) => void }) {
  const { modal, showAlert, showConfirm } = useConfirm()
  const [config, setConfig] = useState<ExpenseConfig>(DEFAULT_CONFIG)
  const [reports, setReports] = useState<ExpenseReport[]>([])
  const [entries, setEntries] = useState<ExpenseEntry[]>([])
  const [leaves, setLeaves] = useState<LeaveRecord[]>([])
  const [mainTab, setMainTab] = useState<'log' | 'reports'>('log')
  const [viewMode, setViewMode] = useState<'week' | 'day'>('week')
  const [weekStart, setWeekStart] = useState(getWeekStart())
  const [selectedDay, setSelectedDay] = useState(localDateStr())
  const [addVarDay, setAddVarDay] = useState<string | null>(null)
  const [varForm, setVarForm] = useState({ category: 'bus_fare' as ExpenseCategory, amount: '', customLabel: '', notes: '' })
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
      userId: appUser.uid, userName: appUser.name,
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
    if (!await showConfirm('Remove DA', `Remove the ${existing.allowanceType} allowance for ${fmtDate(date)}?`)) return
    await deleteDoc(doc(db, 'expense_entries', existing.id!))
    await syncReportTotal(existing.reportId, -existing.amount)
  }

  const handleAddVariable = async () => {
    if (!addVarDay) return
    const amount = parseFloat(varForm.amount)
    if (isNaN(amount) || amount <= 0) { await showAlert('Invalid Amount', 'Enter a valid amount.'); return }
    const rpt = await getOrCreateReport()
    await addDoc(collection(db, 'expense_entries'), {
      reportId: rpt.id!, userId: appUser.uid,
      date: addVarDay, type: 'variable',
      category: varForm.category,
      ...(varForm.category === 'other' && varForm.customLabel ? { customLabel: varForm.customLabel } : {}),
      amount,
      ...(varForm.notes ? { notes: varForm.notes } : {}),
      createdAt: Date.now(),
    })
    await syncReportTotal(rpt.id!, amount)
    setVarForm({ category: 'bus_fare', amount: '', customLabel: '', notes: '' })
    setAddVarDay(null)
  }

  const handleRemoveEntry = async (entry: ExpenseEntry) => {
    if (!await showConfirm('Remove entry', 'Remove this expense entry?')) return
    await deleteDoc(doc(db, 'expense_entries', entry.id!))
    await syncReportTotal(entry.reportId, -entry.amount)
  }

  const handleSubmitWeek = async () => {
    if (!report || weekEntries.length === 0) { await showAlert('Nothing to submit', 'Log at least one expense before submitting.'); return }
    if (!await showConfirm('Submit week', `Submit expenses for ${weekLabel(activeWeekStart)} for admin review?`)) return
    setSubmitting(true)
    try {
      const total = totalOf(weekEntries)
      await updateDoc(doc(db, 'expense_reports', report.id!), {
        status: 'submitted', totalAmount: total, submittedAt: Date.now(),
      })
      await addDoc(collection(db, 'alerts'), {
        type: 'expense_submitted',
        message: `💸 ${appUser.name} submitted expenses for ${weekLabel(activeWeekStart)} — ₹${total.toLocaleString()}`,
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
    if (!rows.length) { await showAlert('Invalid CSV', 'No valid rows found. Check the format.'); return }
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
            userId: appUser.uid, userName: appUser.name,
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
      await showAlert('Imported', `Entries imported successfully.`)
    } finally { setImporting(false) }
  }

  const weekTotal = totalOf(weekEntries.filter(e => !leaveDates.has(e.date)))
  const dayTotal = leaveDates.has(selectedDay) ? 0 : totalOf(weekEntries.filter(e => e.date === selectedDay))
  const displayTotal = viewMode === 'day' ? dayTotal : weekTotal
  const isLocked = report?.status === 'cleared'

  const C = { bg: '#0d1117', card: '#161b22', purple: '#7c3aed', purpleLight: '#a78bfa', purpleDim: 'rgba(124,58,237,0.15)' }

  return (
    <div style={{ minHeight: '100vh', background: C.bg, paddingBottom: 40 }}>
      {/* HEADER */}
      <div style={{ background: 'linear-gradient(135deg,#7c3aed,#6d28d9)', padding: '24px 20px 0' }}>
        <button onClick={onBack} style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: '#ddd6fe', padding: '6px 14px', borderRadius: 20, fontSize: 12, marginBottom: 16 }}>← Back</button>
        <div style={{ color: '#ddd6fe', fontSize: 11, letterSpacing: 3, textTransform: 'uppercase', marginBottom: 4 }}>My Expenses 💸</div>
        <div style={{ fontSize: 22, fontWeight: 900, marginBottom: 2 }}>{isCurrentWeek ? 'This Week' : weekLabel(activeWeekStart)}</div>
        <div style={{ fontSize: 26, fontWeight: 900, color: '#c4b5fd', marginBottom: 8 }}>₹{displayTotal.toLocaleString()}</div>

        {/* Main tab toggle */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
          {([['log', '📝 Log'], ['reports', '📋 Reports']] as const).map(([t, l]) => (
            <button key={t} onClick={() => setMainTab(t)}
              style={{ flex: 1, background: mainTab === t ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.06)', border: 'none', color: mainTab === t ? '#fff' : 'rgba(255,255,255,0.5)', borderRadius: '10px 10px 0 0', padding: '8px', fontSize: 12, fontWeight: 700 }}>
              {l}
            </button>
          ))}
        </div>

        {mainTab === 'log' && (
          <>
            {/* View mode toggle */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
              {(['week', 'day'] as const).map(m => (
                <button key={m} onClick={() => setViewMode(m)}
                  style={{ flex: 1, background: viewMode === m ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.06)', border: 'none', color: viewMode === m ? '#fff' : 'rgba(255,255,255,0.5)', borderRadius: 20, padding: '7px', fontSize: 12, fontWeight: 700 }}>
                  {m === 'week' ? '📅 Week' : '📆 Day'}
                </button>
              ))}
            </div>

            {/* Week navigation (week mode) */}
            {viewMode === 'week' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <button onClick={() => setWeekStart(w => addDays(w, -7))}
                  style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: '#ddd6fe', borderRadius: 20, padding: '6px 14px', fontSize: 16, fontWeight: 700 }}>‹</button>
                <div style={{ flex: 1, textAlign: 'center', fontSize: 12, color: '#ddd6fe', fontWeight: 600 }}>
                  {weekLabel(weekStart)}
                  {isCurrentWeek && <span style={{ marginLeft: 8, fontSize: 10, background: 'rgba(255,255,255,0.15)', padding: '2px 6px', borderRadius: 99 }}>This week</span>}
                </div>
                <button onClick={() => setWeekStart(w => addDays(w, 7))} disabled={isCurrentWeek}
                  style={{ background: isCurrentWeek ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.1)', border: 'none', color: isCurrentWeek ? 'rgba(255,255,255,0.25)' : '#ddd6fe', borderRadius: 20, padding: '6px 14px', fontSize: 16, fontWeight: 700 }}>›</button>
              </div>
            )}

            {/* Day picker (day mode) */}
            {viewMode === 'day' && (
              <div style={{ marginBottom: 10 }}>
                <input type="date" value={selectedDay} max={today}
                  onChange={e => setSelectedDay(e.target.value)}
                  style={{ width: '100%', background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 10, padding: '9px 14px', fontSize: 14, color: '#fff', outline: 'none', boxSizing: 'border-box' }} />
              </div>
            )}

            {report && (
              <div style={{ marginBottom: 12 }}>
                <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99,
                  background: report.status === 'draft' ? 'rgba(255,255,255,0.1)'
                    : report.status === 'submitted' ? 'rgba(217,119,6,0.3)'
                    : report.status === 'rejected' ? 'rgba(220,38,38,0.3)'
                    : 'rgba(22,163,74,0.3)',
                  color: report.status === 'draft' ? '#ddd6fe'
                    : report.status === 'submitted' ? '#fde68a'
                    : report.status === 'rejected' ? '#fca5a5'
                    : '#86efac' }}>
                  {report.status === 'draft' ? '📝 Draft'
                    : report.status === 'submitted' ? '⏳ Submitted – Pending Review'
                    : report.status === 'rejected' ? '❌ Rejected – Edit & Resubmit'
                    : '✅ Cleared'}
                </span>
              </div>
            )}
          </>
        )}
      </div>

      <div style={{ padding: '16px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>

        {/* ── REPORTS TAB ── */}
        {mainTab === 'reports' && (() => {
          const sorted = [...reports].sort((a, b) => b.createdAt - a.createdAt)
          if (!sorted.length) return (
            <div style={{ textAlign: 'center', padding: 40, color: '#475569' }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>💸</div>
              <div style={{ fontWeight: 700 }}>No expense reports yet</div>
            </div>
          )
          return sorted.map(r => {
            const rTotal = totalOf(entries.filter(e => e.reportId === r.id))
            const statusColor = r.status === 'submitted' ? { bg: 'rgba(217,119,6,0.15)', text: '#d97706', border: 'rgba(217,119,6,0.25)' }
              : r.status === 'rejected'  ? { bg: 'rgba(220,38,38,0.12)', text: '#f87171', border: 'rgba(220,38,38,0.25)' }
              : r.status === 'cleared'   ? { bg: 'rgba(22,163,74,0.1)',  text: '#86efac', border: 'rgba(22,163,74,0.2)' }
              : { bg: 'rgba(255,255,255,0.04)', text: '#94a3b8', border: 'rgba(255,255,255,0.06)' }
            const label = r.status === 'submitted' ? '⏳ Pending' : r.status === 'rejected' ? '❌ Rejected' : r.status === 'cleared' ? '✅ Cleared' : '📝 Draft'
            return (
              <button key={r.id} onClick={() => { setWeekStart(r.weekStart); setViewMode('week'); setMainTab('log') }}
                style={{ background: '#161b22', border: `1px solid ${statusColor.border}`, borderRadius: 14, padding: '14px 16px', textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0', marginBottom: 3 }}>{weekLabel(r.weekStart)}</div>
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: statusColor.bg, color: statusColor.text }}>{label}</span>
                  {r.status === 'rejected' && (r as any).rejectNote && (
                    <div style={{ fontSize: 11, color: '#f87171', marginTop: 4 }}>"{(r as any).rejectNote}"</div>
                  )}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 18, fontWeight: 900, color: '#a78bfa' }}>₹{rTotal.toLocaleString()}</div>
                  <div style={{ fontSize: 10, color: '#475569', marginTop: 2 }}>→ View week</div>
                </div>
              </button>
            )
          })
        })()}

        {/* CSV import */}
        {mainTab === 'log' && (<>
        {!isLocked && (
          <button onClick={() => setCsvMode(m => !m)}
            style={{ background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.2)', color: '#a78bfa', borderRadius: 10, padding: '10px 16px', fontSize: 13, fontWeight: 700 }}>
            📥 Import from CSV
          </button>
        )}

        {csvMode && (
          <div style={{ background: C.card, borderRadius: 14, padding: 16, border: '1px solid rgba(124,58,237,0.2)' }}>
            <div style={{ fontSize: 12, color: '#a78bfa', fontWeight: 700, marginBottom: 6 }}>Import CSV</div>
            <div style={{ fontSize: 11, color: '#64748b', marginBottom: 10, lineHeight: 1.6 }}>
              Format: <code style={{ background: 'rgba(255,255,255,0.06)', padding: '1px 5px', borderRadius: 4 }}>date,type,amount,notes</code><br />
              Types: HQ · EX · OS · bus_fare · fuel · food · lodging · printing · other
            </div>

            {/* File upload */}
            <label style={{ display: 'block', background: 'rgba(124,58,237,0.08)', border: '1.5px dashed rgba(124,58,237,0.3)', borderRadius: 10, padding: '14px', textAlign: 'center', cursor: 'pointer', marginBottom: 10 }}>
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
              <div style={{ fontSize: 22, marginBottom: 4 }}>📂</div>
              <div style={{ fontSize: 12, color: '#a78bfa', fontWeight: 700 }}>{csvText ? 'File loaded — tap to replace' : 'Tap to choose .csv or .xlsx file'}</div>
              <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>.csv · .xlsx · .xls</div>
            </label>

            {/* Preview / paste fallback */}
            <textarea value={csvText} onChange={e => { setCsvText(e.target.value); setFileLoaded(false) }} rows={4}
              placeholder={'Or paste CSV here...\ndate,type,amount,notes\n2026-05-01,HQ,,\n2026-05-01,bus_fare,45,Morning auto'}
              style={{ width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '10px 12px', fontSize: 11, color: '#94a3b8', outline: 'none', resize: 'vertical', fontFamily: 'monospace', boxSizing: 'border-box' }} />

            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button onClick={handleImportCsv} disabled={importing || !fileLoaded}
                style={{ flex: 1, background: importing || !fileLoaded ? '#475569' : 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.3)', color: importing || !fileLoaded ? '#64748b' : '#a78bfa', borderRadius: 10, padding: '10px', fontSize: 13, fontWeight: 700 }}>
                {importing ? 'Importing...' : 'Import'}
              </button>
              <button onClick={() => { setCsvMode(false); setCsvText(''); setFileLoaded(false) }}
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)', color: '#64748b', borderRadius: 10, padding: '10px 14px', fontSize: 13 }}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Daily rows */}
        {visibleDates.map(date => {
          const isHoliday = holidayDates.has(date)
          const isLeave = !isHoliday && leaveDates.has(date)
          const isWknd = isWeekend(date)
          const isToday = date === today
          const isWorking = !isLeave && !isHoliday && !isWknd
          const dayEntries = weekEntries.filter(e => e.date === date)
          const allowanceEntry = dayEntries.find(e => e.type === 'allowance')
          const variableEntries = dayEntries.filter(e => e.type === 'variable')
          const dayTotal = isLeave || isWknd ? 0 : totalOf(dayEntries)
          const isAddingVar = addVarDay === date
          const isFuture = date > today

          return (
            <div key={date} style={{ background: C.card, borderRadius: 14, border: isToday ? '1.5px solid rgba(124,58,237,0.4)' : '1px solid rgba(255,255,255,0.05)', overflow: 'hidden', opacity: isWknd ? 0.45 : 1 }}>
              {/* Day header */}
              <div style={{ padding: '11px 14px', display: 'flex', alignItems: 'center', gap: 8, background: isToday ? 'rgba(124,58,237,0.06)' : 'transparent', borderBottom: isWorking ? '1px solid rgba(255,255,255,0.04)' : 'none' }}>
                <div style={{ flex: 1, fontWeight: 700, fontSize: 13, color: isToday ? '#a78bfa' : '#e2e8f0' }}>
                  {fmtDate(date)}
                  {isToday && <span style={{ marginLeft: 6, fontSize: 10, background: 'rgba(124,58,237,0.2)', color: '#a78bfa', padding: '1px 6px', borderRadius: 99 }}>Today</span>}
                </div>
                {isHoliday && <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: 'rgba(34,197,94,0.12)', color: '#86efac' }}>🎉 Holiday</span>}
                {isLeave && <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: 'rgba(220,38,38,0.15)', color: '#fca5a5' }}>🏖️ Leave</span>}
                {isWknd && <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: 'rgba(255,255,255,0.06)', color: '#64748b' }}>Weekend</span>}
                {isFuture && isWorking && dayEntries.length === 0 && <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: 'rgba(255,255,255,0.04)', color: '#475569' }}>Yet to be added</span>}
                {dayTotal > 0 && <span style={{ fontSize: 13, fontWeight: 800, color: '#a78bfa' }}>₹{dayTotal.toLocaleString()}</span>}
              </div>

              {isWorking && (
                <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {/* Allowance row */}
                  {allowanceEntry ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ flex: 1, background: 'rgba(124,58,237,0.08)', borderRadius: 8, padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 15 }}>{ALLOW_INFO[allowanceEntry.allowanceType!].emoji}</span>
                        <div>
                          <span style={{ fontSize: 12, fontWeight: 700, color: '#a78bfa' }}>{ALLOW_INFO[allowanceEntry.allowanceType!].label}</span>
                          <span style={{ fontSize: 11, color: '#64748b', marginLeft: 6 }}>{ALLOW_INFO[allowanceEntry.allowanceType!].sub}</span>
                        </div>
                        <span style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 800, color: '#a78bfa' }}>₹{allowanceEntry.amount.toLocaleString()}</span>
                      </div>
                      {!isLocked && (['HQ', 'EX', 'OS'] as AllowanceType[]).map(t => (
                        <button key={t} onClick={() => handleSetAllowance(date, t)}
                          disabled={allowanceEntry.allowanceType === t}
                          style={{ background: allowanceEntry.allowanceType === t ? 'rgba(124,58,237,0.2)' : 'rgba(255,255,255,0.04)', border: `1px solid ${allowanceEntry.allowanceType === t ? 'rgba(124,58,237,0.35)' : 'rgba(255,255,255,0.06)'}`, color: allowanceEntry.allowanceType === t ? '#a78bfa' : '#64748b', borderRadius: 8, padding: '5px 8px', fontSize: 10, fontWeight: 700 }}>
                          {t}
                        </button>
                      ))}
                      {!isLocked && (
                        <button onClick={() => handleRemoveAllowance(date)}
                          style={{ background: 'rgba(220,38,38,0.1)', border: '1px solid rgba(220,38,38,0.2)', color: '#fca5a5', borderRadius: 8, padding: '6px 9px', fontSize: 13 }}>✕</button>
                      )}
                    </div>
                  ) : !isLocked && addDaDay === date ? (
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      {(['HQ', 'EX', 'OS'] as AllowanceType[]).map(t => (
                        <button key={t} onClick={async () => { await handleSetAllowance(date, t); setAddDaDay(null) }}
                          style={{ flex: 1, background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.25)', color: '#a78bfa', borderRadius: 8, padding: '8px 4px', fontSize: 11, fontWeight: 700 }}>
                          <div>{ALLOW_INFO[t].emoji} {t}</div>
                          <div style={{ fontSize: 9, color: '#64748b', marginTop: 2 }}>₹{config[t.toLowerCase() as 'hq' | 'ex' | 'os']}</div>
                        </button>
                      ))}
                      <button onClick={() => setAddDaDay(null)}
                        style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)', color: '#475569', borderRadius: 8, padding: '6px 10px', fontSize: 12 }}>✕</button>
                    </div>
                  ) : null}

                  {/* Variable entries */}
                  {variableEntries.map(e => {
                    const cat = VAR_CATS.find(c => c.value === e.category)
                    return (
                      <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '8px 10px' }}>
                        <span style={{ fontSize: 15 }}>{cat?.emoji ?? '📦'}</span>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 12, fontWeight: 600 }}>{e.customLabel || cat?.label}</div>
                          {e.notes && <div style={{ fontSize: 10, color: '#64748b' }}>{e.notes}</div>}
                        </div>
                        <span style={{ fontSize: 13, fontWeight: 800 }}>₹{e.amount.toLocaleString()}</span>
                        {!isLocked && (
                          <button onClick={() => handleRemoveEntry(e)}
                            style={{ background: 'rgba(220,38,38,0.1)', border: '1px solid rgba(220,38,38,0.2)', color: '#fca5a5', borderRadius: 6, padding: '4px 8px', fontSize: 11 }}>✕</button>
                        )}
                      </div>
                    )
                  })}

                  {/* Today nudges */}
                  {isToday && dayEntries.length === 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 8, background: 'rgba(124,58,237,0.06)', border: '1px solid rgba(124,58,237,0.15)' }}>
                      <span style={{ fontSize: 13 }}>💸</span>
                      <span style={{ fontSize: 11, color: '#a78bfa', fontWeight: 600 }}>Add today's expenses</span>
                    </div>
                  )}
                  {isToday && !visitedDates.has(date) && isAfter6pmIST && !isHoliday && (
                    <button onClick={() => onLogVisit?.(date)}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 8, background: 'rgba(217,119,6,0.08)', border: '1px solid rgba(217,119,6,0.18)', cursor: onLogVisit ? 'pointer' : 'default', width: '100%' }}>
                      <span style={{ fontSize: 13 }}>📋</span>
                      <span style={{ fontSize: 11, color: '#d97706', fontWeight: 600, flex: 1, textAlign: 'left' }}>Add today's visit log</span>
                      {onLogVisit && <span style={{ fontSize: 11, color: '#d97706' }}>Log now →</span>}
                    </button>
                  )}

                  {/* Past days — no visit log nudge */}
                  {!isToday && dayEntries.length > 0 && !visitedDates.has(date) && date < today && (
                    <button onClick={() => onLogVisit?.(date)}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 8, background: 'rgba(217,119,6,0.08)', border: '1px solid rgba(217,119,6,0.18)', cursor: onLogVisit ? 'pointer' : 'default', width: '100%' }}>
                      <span style={{ fontSize: 13 }}>📋</span>
                      <span style={{ fontSize: 11, color: '#d97706', fontWeight: 600, flex: 1, textAlign: 'left' }}>No visit log for this day</span>
                      {onLogVisit && <span style={{ fontSize: 11, color: '#d97706' }}>Log now →</span>}
                    </button>
                  )}

                  {/* Add variable form */}
                  {!isLocked && (
                    isAddingVar ? (
                      <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 10, padding: 12, border: '1px solid rgba(255,255,255,0.06)' }}>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                          {VAR_CATS.map(c => (
                            <button key={c.value} onClick={() => setVarForm(f => ({ ...f, category: c.value }))}
                              style={{ background: varForm.category === c.value ? 'rgba(124,58,237,0.15)' : 'rgba(255,255,255,0.04)', color: varForm.category === c.value ? '#a78bfa' : '#64748b', border: `1px solid ${varForm.category === c.value ? 'rgba(124,58,237,0.3)' : 'rgba(255,255,255,0.06)'}`, borderRadius: 20, padding: '4px 10px', fontSize: 11, fontWeight: 700 }}>
                              {c.emoji} {c.label}
                            </button>
                          ))}
                        </div>
                        {varForm.category === 'other' && (
                          <input value={varForm.customLabel} onChange={e => setVarForm(f => ({ ...f, customLabel: e.target.value }))}
                            placeholder="What is this expense?"
                            style={{ width: '100%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '8px 10px', fontSize: 13, color: '#fff', outline: 'none', boxSizing: 'border-box', marginBottom: 8 }} />
                        )}
                        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                          <input type="number" value={varForm.amount} onChange={e => setVarForm(f => ({ ...f, amount: e.target.value }))}
                            placeholder="₹ Amount"
                            style={{ flex: 1, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '8px 10px', fontSize: 15, fontWeight: 700, color: '#fff', outline: 'none', minWidth: 0 }} />
                          <input value={varForm.notes} onChange={e => setVarForm(f => ({ ...f, notes: e.target.value }))}
                            placeholder="Notes (optional)"
                            style={{ flex: 2, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '8px 10px', fontSize: 13, color: '#fff', outline: 'none', minWidth: 0 }} />
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button onClick={handleAddVariable}
                            style={{ flex: 1, background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.3)', color: '#a78bfa', borderRadius: 8, padding: '9px', fontSize: 13, fontWeight: 700 }}>
                            Add
                          </button>
                          <button onClick={() => { setAddVarDay(null); setVarForm({ category: 'bus_fare', amount: '', customLabel: '', notes: '' }) }}
                            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)', color: '#64748b', borderRadius: 8, padding: '9px 14px', fontSize: 13 }}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => { setAddVarDay(date); setAddDaDay(null) }}
                          style={{ flex: 1, background: 'transparent', border: '1px dashed rgba(255,255,255,0.1)', color: '#475569', borderRadius: 8, padding: '7px', fontSize: 12, fontWeight: 600 }}>
                          + Add Expense
                        </button>
                        {!allowanceEntry && (
                          <button onClick={() => { setAddDaDay(date); setAddVarDay(null) }}
                            style={{ background: 'transparent', border: '1px dashed rgba(124,58,237,0.2)', color: '#7c3aed', borderRadius: 8, padding: '7px 12px', fontSize: 12, fontWeight: 600 }}>
                            + DA
                          </button>
                        )}
                      </div>
                    )
                  )}
                </div>
              )}
            </div>
          )
        })}

        {/* Submit / status footer */}
        {(report?.status === 'draft' || report?.status === 'rejected') && weekEntries.length > 0 && viewMode === 'week' && (
          <div style={{ background: C.card, borderRadius: 14, padding: 16, border: '1px solid rgba(124,58,237,0.2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <span style={{ fontSize: 14, fontWeight: 700 }}>Week Total</span>
              <span style={{ fontSize: 20, fontWeight: 900, color: '#a78bfa' }}>₹{weekTotal.toLocaleString()}</span>
            </div>
            <button onClick={handleSubmitWeek} disabled={submitting}
              style={{ width: '100%', background: submitting ? '#475569' : 'linear-gradient(135deg,#7c3aed,#6d28d9)', color: '#fff', border: 'none', borderRadius: 12, padding: 14, fontSize: 15, fontWeight: 800 }}>
              {submitting ? 'Submitting...' : '📤 Submit Week for Review'}
            </button>
          </div>
        )}

        {report?.status === 'submitted' && (
          <div style={{ background: 'rgba(217,119,6,0.08)', border: '1px solid rgba(217,119,6,0.2)', borderRadius: 12, padding: 14, textAlign: 'center' }}>
            <div style={{ fontSize: 14, color: '#fde68a', fontWeight: 700 }}>⏳ Pending Admin Review</div>
            <div style={{ fontSize: 12, color: '#d97706', marginTop: 4 }}>
              Submitted {report.submittedAt ? new Date(report.submittedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : ''}
              {' · '}You can still edit entries.
            </div>
          </div>
        )}

        {report?.status === 'rejected' && (
          <div style={{ background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', borderRadius: 12, padding: 14 }}>
            <div style={{ fontSize: 14, color: '#fca5a5', fontWeight: 700, marginBottom: 4 }}>❌ Report Rejected</div>
            {(report as any).rejectNote && <div style={{ fontSize: 12, color: '#f87171', marginBottom: 4 }}>📝 {(report as any).rejectNote}</div>}
            <div style={{ fontSize: 12, color: '#64748b' }}>Edit your entries and resubmit.</div>
          </div>
        )}

        {report?.status === 'cleared' && (
          <div style={{ background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.2)', borderRadius: 12, padding: 14, textAlign: 'center' }}>
            <div style={{ fontSize: 14, color: '#86efac', fontWeight: 700 }}>✅ Expenses Cleared</div>
            <div style={{ fontSize: 12, color: '#16a34a', marginTop: 4 }}>
              {report.clearedAt ? new Date(report.clearedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : ''}
              {report.clearedByName && ` · by ${report.clearedByName}`}
            </div>
            {report.clearNote && <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>📝 {report.clearNote}</div>}
          </div>
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
  const { modal, showAlert, showConfirm } = useConfirm()
  const [tab, setTab] = useState<'reports' | 'config'>('reports')
  const [config, setConfig] = useState<ExpenseConfig>(DEFAULT_CONFIG)
  const [configForm, setConfigForm] = useState({ hq: '200', ex: '300', os: '450' })
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
        setConfigForm({ hq: String(d.hq ?? 200), ex: String(d.ex ?? 300), os: String(d.os ?? 450) })
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
    if ([hq, ex, os].some(isNaN)) { await showAlert('Invalid', 'Enter valid amounts for all tiers.'); return }
    setSavingConfig(true)
    try {
      await setDoc(doc(db, 'expense_config', 'main'), { hq, ex, os, updatedAt: Date.now(), updatedBy: appUser.uid })
    } finally { setSavingConfig(false) }
  }

  const handleClear = async (r: ExpenseReport) => {
    const liveTotal = reportTotal(r.id!)
    if (!await showConfirm('Clear expenses', `Mark ₹${liveTotal.toLocaleString()} expense report for ${r.userName} as cleared and paid?`)) return
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
        message: `✅ Your expenses for ${weekLabel(r.weekStart)} (₹${liveTotal.toLocaleString()}) have been cleared${clearNote ? ` — ${clearNote}` : ''}.`,
        relatedId: r.id!, read: false, toUid: r.userId, createdAt: Date.now(),
      })
      setClearNote('')
    } finally { setClearingId(null) }
  }

  const handleReject = async (r: ExpenseReport) => {
    if (!rejectNote.trim()) { await showAlert('Note required', 'Add a reason before rejecting.'); return }
    if (!await showConfirm('Reject report', `Reject ${r.userName}'s expense report? They will be notified.`)) return
    setRejectingId(r.id!)
    try {
      await updateDoc(doc(db, 'expense_reports', r.id!), {
        status: 'rejected', rejectedAt: Date.now(),
        rejectedBy: appUser.uid, rejectedByName: appUser.name,
        rejectNote: rejectNote.trim(),
      })
      await addDoc(collection(db, 'alerts'), {
        type: 'expense_submitted',
        message: `❌ Your expenses for ${weekLabel(r.weekStart)} were rejected — "${rejectNote.trim()}". Please edit and resubmit.`,
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

  return (
    <div style={{ minHeight: '100vh', background: '#0d1117', paddingBottom: 40 }}>
      {/* HEADER */}
      <div style={{ background: 'linear-gradient(135deg,#7c3aed,#6d28d9)', padding: '24px 20px 0' }}>
        <button onClick={onBack} style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: '#ddd6fe', padding: '6px 14px', borderRadius: 20, fontSize: 12, marginBottom: 16 }}>← Back</button>
        <div style={{ color: '#ddd6fe', fontSize: 11, letterSpacing: 3, textTransform: 'uppercase', marginBottom: 4 }}>Admin 💸</div>
        <div style={{ fontSize: 22, fontWeight: 900, marginBottom: 10 }}>Expense Management</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
          <div style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 12, padding: 12, textAlign: 'center' }}>
            <div style={{ fontSize: 18, fontWeight: 900, color: '#fde68a' }}>₹{pendingTotal.toLocaleString()}</div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', marginTop: 2 }}>Pending</div>
          </div>
          <div style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 12, padding: 12, textAlign: 'center' }}>
            <div style={{ fontSize: 18, fontWeight: 900, color: '#86efac' }}>₹{clearedTotal.toLocaleString()}</div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', marginTop: 2 }}>Cleared</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {([['reports', '📋 Reports'], ['config', '⚙️ Config']] as const).map(([t, l]) => (
            <button key={t} onClick={() => setTab(t)}
              style={{ flex: 1, background: tab === t ? 'rgba(255,255,255,0.2)' : 'transparent', color: tab === t ? '#fff' : 'rgba(255,255,255,0.5)', border: 'none', borderRadius: '10px 10px 0 0', padding: '9px 4px', fontSize: 11, fontWeight: 800 }}>
              {l}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: '16px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>

        {/* CONFIG TAB */}
        {tab === 'config' && (
          <div style={{ background: '#161b22', borderRadius: 14, padding: 16, border: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ fontSize: 12, color: '#64748b', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 16 }}>Daily Allowance Amounts</div>
            {([
              { key: 'hq' as const, label: '🏢 HQ', sub: 'Within 25km' },
              { key: 'ex' as const, label: '🗺️ EX', sub: '25km+' },
              { key: 'os' as const, label: '🛏️ OS', sub: 'Outstation stay' },
            ]).map(({ key, label, sub }) => (
              <div key={key} style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#a78bfa', marginBottom: 6 }}>
                  {label} <span style={{ color: '#64748b', fontWeight: 400 }}>— {sub}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: '#64748b', fontSize: 18, fontWeight: 700 }}>₹</span>
                  <input type="number" value={configForm[key]} onChange={e => setConfigForm(f => ({ ...f, [key]: e.target.value }))}
                    style={{ flex: 1, background: 'rgba(255,255,255,0.06)', border: '1.5px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '10px 14px', fontSize: 20, fontWeight: 800, color: '#fff', outline: 'none' }} />
                </div>
                <div style={{ fontSize: 10, color: '#475569', marginTop: 4 }}>Current: ₹{config[key]}</div>
              </div>
            ))}
            <button onClick={handleSaveConfig} disabled={savingConfig}
              style={{ width: '100%', background: savingConfig ? '#475569' : 'linear-gradient(135deg,#7c3aed,#6d28d9)', color: '#fff', border: 'none', borderRadius: 12, padding: 14, fontSize: 14, fontWeight: 800 }}>
              {savingConfig ? 'Saving...' : 'Save Config ⚙️'}
            </button>
          </div>
        )}

        {/* REPORTS TAB */}
        {tab === 'reports' && (
          <>
            <div style={{ display: 'flex', gap: 6 }}>
              {([
                { val: 'submitted' as const, label: '⏳ Pending' },
                { val: 'cleared'   as const, label: '✅ Cleared' },
                { val: 'rejected'  as const, label: '❌ Rejected' },
                { val: 'all'       as const, label: 'All' },
              ]).map(s => (
                <button key={s.val} onClick={() => setStatusFilter(s.val)}
                  style={{ flex: 1, background: statusFilter === s.val ? 'rgba(124,58,237,0.15)' : 'rgba(255,255,255,0.04)', color: statusFilter === s.val ? '#a78bfa' : '#64748b', border: `1px solid ${statusFilter === s.val ? 'rgba(124,58,237,0.3)' : 'rgba(255,255,255,0.06)'}`, borderRadius: 20, padding: '7px', fontSize: 12, fontWeight: 700 }}>
                  {s.label}
                </button>
              ))}
            </div>

            {filtered.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 40, color: '#475569' }}>
                <div style={{ fontSize: 36, marginBottom: 12 }}>💸</div>
                <div style={{ fontWeight: 700 }}>No {statusFilter === 'submitted' ? 'pending' : statusFilter === 'cleared' ? 'cleared' : ''} reports</div>
              </div>
            ) : filtered.map(r => {
              const rEntries = entries.filter(e => e.reportId === r.id)
              const isExpanded = expandedId === r.id

              return (
                <div key={r.id} style={{ background: '#161b22', borderRadius: 14, border: `1px solid ${r.status === 'submitted' ? 'rgba(217,119,6,0.2)' : 'rgba(22,163,74,0.15)'}`, overflow: 'hidden' }}>
                  {/* Header row */}
                  <div style={{ padding: '14px 16px', cursor: 'pointer', display: 'flex', alignItems: 'flex-start', gap: 10 }}
                    onClick={() => setExpandedId(isExpanded ? null : r.id!)}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 800, fontSize: 14 }}>{r.userName}</div>
                      <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{weekLabel(r.weekStart)}</div>
                      {/* Visit log summary pill */}
                      {(() => {
                        const key = `${r.userId}_${r.weekStart}`
                        const logged = visitLogMap.get(key)
                        if (!logged) return null
                        const today = localDateStr()
                        const userLeaveDates = new Set(allLeaves.filter(l => l.uid === r.userId).map(l => l.date))
                        const allHolidayDates = new Set(allHolidays.map(h => h.date))
                        const dueDays = getWeekDates(r.weekStart).filter(d => !isWeekend(d) && d <= today && !userLeaveDates.has(d) && !allHolidayDates.has(d))
                        const count = dueDays.filter(d => logged.has(d)).length
                        const total = dueDays.length
                        if (!total) return null
                        const all = count === total, none = count === 0
                        return (
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 5, padding: '2px 8px', borderRadius: 99, background: all ? 'rgba(22,163,74,0.12)' : none ? 'rgba(220,38,38,0.1)' : 'rgba(217,119,6,0.12)' }}>
                            <span style={{ fontSize: 10 }}>📋</span>
                            <span style={{ fontSize: 10, fontWeight: 700, color: all ? '#86efac' : none ? '#fca5a5' : '#fde68a' }}>{count}/{total} days logged</span>
                          </div>
                        )
                      })()}
                      {r.status === 'submitted' && r.submittedAt && (
                        <div style={{ fontSize: 10, color: '#d97706', marginTop: 2 }}>
                          Submitted {new Date(r.submittedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                        </div>
                      )}
                      {r.status === 'cleared' && r.clearedAt && (
                        <div style={{ fontSize: 10, color: '#16a34a', marginTop: 2 }}>
                          Cleared {new Date(r.clearedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                          {r.clearedByName && ` · ${r.clearedByName}`}
                        </div>
                      )}
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 20, fontWeight: 900, color: '#a78bfa' }}>₹{reportTotal(r.id!).toLocaleString()}</div>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99,
                        background: r.status === 'submitted' ? 'rgba(217,119,6,0.15)' : r.status === 'rejected' ? 'rgba(220,38,38,0.15)' : 'rgba(22,163,74,0.15)',
                        color: r.status === 'submitted' ? '#d97706' : r.status === 'rejected' ? '#fca5a5' : '#16a34a' }}>
                        {r.status === 'submitted' ? '⏳ Pending' : r.status === 'rejected' ? '❌ Rejected' : '✅ Cleared'}
                      </span>
                      <div style={{ fontSize: 10, color: '#475569', marginTop: 4 }}>{isExpanded ? '▲' : '▼'}</div>
                    </div>
                  </div>

                  {/* Expanded entries */}
                  {isExpanded && (
                    <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 4 }}>
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
                        const logKey = `${r.userId}_${r.weekStart}`
                        const loggedDates = visitLogMap.get(logKey)
                        const today = localDateStr()
                        const userLeaveDates = new Set(allLeaves.filter(l => l.uid === r.userId).map(l => l.date))
                        const adminHolidayDates = new Set(allHolidays.map(h => h.date))
                        const weekdays = getWeekDates(r.weekStart).filter(d => !isWeekend(d))
                        const visibleDates = weekdays.filter(d => userLeaveDates.has(d) || adminHolidayDates.has(d) || byDate.has(d))
                        if (visibleDates.length === 0) return (
                          <div style={{ fontSize: 12, color: '#475569', textAlign: 'center', padding: 12 }}>No entries</div>
                        )
                        return visibleDates.map(date => {
                          const isHolidayDate = adminHolidayDates.has(date)
                          const isLeave = !isHolidayDate && userLeaveDates.has(date)
                          const dayE = byDate.get(date) ?? []
                          const didLog = loggedDates?.has(date)
                          const isPast = date <= today
                          return (
                            <div key={date} style={{ marginBottom: 10 }}>
                              <div style={{ fontSize: 10, color: '#64748b', fontWeight: 700, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>{fmtDate(date)}</div>
                              {isHolidayDate ? (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', background: 'rgba(34,197,94,0.07)', border: '1px solid rgba(34,197,94,0.18)', borderRadius: 6 }}>
                                  <span style={{ fontSize: 13 }}>🎉</span>
                                  <span style={{ fontSize: 12, color: '#86efac', fontWeight: 600 }}>{allHolidays.find(h => h.date === date)?.name ?? 'Holiday'}</span>
                                </div>
                              ) : isLeave ? (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', background: 'rgba(251,191,36,0.07)', border: '1px solid rgba(251,191,36,0.18)', borderRadius: 6 }}>
                                  <span style={{ fontSize: 13 }}>🏖️</span>
                                  <span style={{ fontSize: 12, color: '#fbbf24', fontWeight: 600 }}>On Leave</span>
                                </div>
                              ) : (
                                <>
                                  {dayE.map(e => {
                                    const cat = VAR_CATS.find(c => c.value === e.category)
                                    return (
                                      <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                                        <span style={{ fontSize: 14 }}>{e.type === 'allowance' ? ALLOW_INFO[e.allowanceType!].emoji : cat?.emoji ?? '📦'}</span>
                                        <div style={{ flex: 1, fontSize: 12 }}>
                                          {e.type === 'allowance'
                                            ? `${ALLOW_INFO[e.allowanceType!].label} — ${ALLOW_INFO[e.allowanceType!].sub}`
                                            : (e.customLabel || cat?.label)}
                                          {e.notes && <span style={{ color: '#64748b', marginLeft: 6 }}>· {e.notes}</span>}
                                        </div>
                                        <span style={{ fontSize: 12, fontWeight: 700, color: e.type === 'allowance' ? '#a78bfa' : '#e2e8f0' }}>₹{e.amount.toLocaleString()}</span>
                                      </div>
                                    )
                                  })}
                                  {/* Visit log status for this day */}
                                  {loggedDates && isPast && (
                                    didLog ? (
                                      <button onClick={() => onViewVisitLog?.(r.userName, date)}
                                        style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 5, background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.18)', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', width: '100%' }}>
                                        <span style={{ fontSize: 11 }}>📋</span>
                                        <span style={{ fontSize: 11, color: '#86efac', fontWeight: 600, flex: 1 }}>Visit log added</span>
                                        <span style={{ fontSize: 10, color: '#16a34a' }}>View →</span>
                                      </button>
                                    ) : (
                                      <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 5, background: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.12)', borderRadius: 6, padding: '4px 8px' }}>
                                        <span style={{ fontSize: 11 }}>📋</span>
                                        <span style={{ fontSize: 11, color: '#f87171', fontWeight: 600 }}>No visit log</span>
                                      </div>
                                    )
                                  )}
                                </>
                              )}
                            </div>
                          )
                        })
                      })()}

                      {/* Day totals summary */}
                      <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 10, display: 'flex', justifyContent: 'space-between', fontSize: 14, fontWeight: 800 }}>
                        <span style={{ color: '#64748b' }}>Total</span>
                        <span style={{ color: '#a78bfa' }}>₹{reportTotal(r.id!).toLocaleString()}</span>
                      </div>

                      {/* Clear / Reject actions */}
                      {r.status === 'submitted' && (
                        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                          <div style={{ background: 'rgba(217,119,6,0.1)', border: '1px solid rgba(217,119,6,0.25)', borderRadius: 10, padding: '10px 12px', fontSize: 12, color: '#fbbf24', lineHeight: 1.5 }}>
                            ⚠️ Only clear after the expense amount has been <strong>physically paid</strong> to the salesperson and the payment is <strong>recorded in Zoho Inventory</strong>. This cannot be undone.
                          </div>
                          <input value={clearNote} onChange={e => setClearNote(e.target.value)}
                            placeholder="Clear note (optional) — e.g. Paid via UPI"
                            style={{ width: '100%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '8px 10px', fontSize: 13, color: '#fff', outline: 'none', boxSizing: 'border-box' }} />
                          <button onClick={() => handleClear(r)} disabled={!!clearingId || !!rejectingId}
                            style={{ width: '100%', background: (clearingId || rejectingId) ? '#475569' : 'rgba(22,163,74,0.12)', border: '1px solid rgba(22,163,74,0.3)', color: '#86efac', borderRadius: 10, padding: '11px', fontSize: 14, fontWeight: 800 }}>
                            {clearingId === r.id ? 'Processing...' : `✅ Clear ₹${reportTotal(r.id!).toLocaleString()}`}
                          </button>
                          <input value={rejectNote} onChange={e => setRejectNote(e.target.value)}
                            placeholder="Rejection reason (required)"
                            style={{ width: '100%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(220,38,38,0.2)', borderRadius: 8, padding: '8px 10px', fontSize: 13, color: '#fff', outline: 'none', boxSizing: 'border-box' }} />
                          <button onClick={() => handleReject(r)} disabled={!!clearingId || !!rejectingId}
                            style={{ width: '100%', background: (clearingId || rejectingId) ? '#475569' : 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.25)', color: '#fca5a5', borderRadius: 10, padding: '11px', fontSize: 13, fontWeight: 700 }}>
                            {rejectingId === r.id ? 'Processing...' : '❌ Reject'}
                          </button>
                        </div>
                      )}
                      {r.status === 'cleared' && r.clearNote && (
                        <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>📝 {r.clearNote}</div>
                      )}
                      {r.status === 'rejected' && (r as any).rejectNote && (
                        <div style={{ fontSize: 12, color: '#f87171', marginTop: 4 }}>❌ {(r as any).rejectNote}</div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </>
        )}
      </div>
      {modal}
    </div>
  )
}
