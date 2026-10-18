import { useState, useEffect, useMemo } from 'react'
import {
  collection, query, where, writeBatch, doc, deleteDoc, updateDoc, setDoc,
} from 'firebase/firestore'
import { onSnapshot } from '../../data/live'
import { db } from '../../firebase'
import {
  AppUser, SalesRoute, WorkPlan, Holiday, LeaveRecord, SalesTarget, UnifiedAllocation,
  Product,
  workPlanId, routePlaces, salesTargetId, packetsOrdered, packetsOrderedOn,
  dailyTargetFor, divideAcrossDays, sumByProduct,
  divideByProductAcrossDays, dayTotalsFromProducts,
} from '../../types'
import { useAuth } from '../../context/AuthContext'
import { useTheme } from '../../context/ThemeContext'
import { useConfirm } from '../../hooks/useConfirm'
import CustomSelect from '../../components/CustomSelect'
import {
  PageHeader, TabBar, Eyebrow, EmptyState, Note, Field,
  GhostButton, PrimaryButton, inputStyle,
} from '../../components/ui'
import { localDateStr, localMonthStr, isSunday } from '../../utils/date'

interface Props { onBack: () => void }

type Tab = 'assign' | 'assigned' | 'targets'

/** Monday of the week containing `d`. */
function mondayOf(d: string): string {
  const x = new Date(d + 'T00:00:00')
  x.setDate(x.getDate() - (x.getDay() === 0 ? 6 : x.getDay() - 1))
  return localDateStr(x)
}
function addDays(d: string, n: number): string {
  const x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() + n); return localDateStr(x)
}
const dayLabel = (d: string) =>
  new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' })
const longDay = (d: string) =>
  new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' })
const monthLabel = (d: string) =>
  new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })

/**
 * The week's work.
 *
 * Two tabs over one week: assigning it, and reading it back. They were one
 * screen and it grew unusable — every rep's six days expanded at once, so a
 * team of five was thirty rows of mostly-empty before you reached the button
 * you came for.
 *
 * Assigning is one rep at a time, because that is the Monday-morning motion: a
 * manager sits with one person's week, not with a spreadsheet. Reading it back
 * is by day, because the question then is "who is where on Wednesday".
 *
 * A plan is advisory. It says what a day was meant to cover; where the rep
 * actually went is the visits, and the two are compared afterwards. Nothing
 * here stops a rep working a shop that is not on the list, and it should not:
 * an unplanned call is usually prospecting.
 */
export default function Planner({ onBack }: Props) {
  const { t } = useTheme()
  const { appUser } = useAuth()
  const { modal, showConfirm } = useConfirm()

  const [tab, setTab] = useState<Tab>('assign')
  const [weekStart, setWeekStart] = useState(mondayOf(localDateStr()))
  const [reps, setReps] = useState<AppUser[]>([])
  const [routes, setRoutes] = useState<SalesRoute[]>([])
  const [plans, setPlans] = useState<WorkPlan[]>([])
  const [holidays, setHolidays] = useState<Holiday[]>([])
  const [leaves, setLeaves] = useState<LeaveRecord[]>([])
  const [readError, setReadError] = useState<string | null>(null)

  // Monthly targets. Their own month, not the week above them — a target is
  // set once for a month and the week navigator would make it look as though
  // it changed every Monday.
  const [targets, setTargets] = useState<SalesTarget[]>([])
  const [allocations, setAllocations] = useState<UnifiedAllocation[]>([])
  const [targetMonth, setTargetMonth] = useState(localMonthStr())
  const [products, setProducts] = useState<Product[]>([])
  /**
   * uid → product → what is being typed, so a half-typed number is never saved.
   *
   * The total is not in here because the total is not typed. It is the sum of
   * these, which is the whole reason there is one place to set a target and
   * nothing for a second number to disagree with.
   */
  const [targetDraft, setTargetDraft] = useState<Record<string, Record<string, string>>>({})
  const [targetNote, setTargetNote] = useState<Record<string, string>>({})
  const [targetSaving, setTargetSaving] = useState<string | null>(null)
  const [targetError, setTargetError] = useState<string | null>(null)
  /** Whose day-by-day breakdown is open. One at a time — a month of boxes for
   *  five reps at once is a spreadsheet, and a worse one than a spreadsheet. */
  const [daysOpenFor, setDaysOpenFor] = useState<string | null>(null)
  /**
   * uid → product → date → what is being typed.
   *
   * A product dimension deeper than it was, because each product carries its
   * own days now. Keyed by product id throughout, so a product added next
   * month simply appears as another key.
   */
  const [dayDraft, setDayDraft] =
    useState<Record<string, Record<string, Record<string, string>>>>({})
  /** Which product's grid is on screen inside an open breakdown. */
  const [dayProduct, setDayProduct] = useState<Record<string, string>>({})

  /** '' means everybody. Shared by both tabs — a filter you set once holds. */
  const [whoFilter, setWhoFilter] = useState('')
  const [beatFilter, setBeatFilter] = useState('')

  // Assign panel — which rep is open, and what is being given to them.
  const [openRep, setOpenRep] = useState<string | null>(null)
  const [routeId, setRouteId] = useState('')
  const [days, setDays] = useState<Set<string>>(new Set())
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [blocked, setBlocked] = useState<string | null>(null)

  /** Which single day's note is open for editing, keyed `${uid}_${date}`. */
  const [noteFor, setNoteFor] = useState<string | null>(null)
  const [noteDraft, setNoteDraft] = useState('')

  /** Monday to Saturday. Sunday is a day off and cannot be worked, so it is never offered. */
  const week = useMemo(
    () => Array.from({ length: 6 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  )
  const weekEnd = week[week.length - 1]

  useEffect(() => {
    const u1 = onSnapshot(collection(db, 'users'), s =>
      setReps(s.docs.map(d => ({ uid: d.id, ...d.data() } as AppUser))
        .filter(u => u.status === 'approved'
          && (u.role === 'offline_sales' || u.role === 'online_sales'))
        .sort((a, b) => a.name.localeCompare(b.name))))
    const u2 = onSnapshot(collection(db, 'sales_routes'), s =>
      setRoutes(s.docs.map(d => ({ id: d.id, ...d.data() } as SalesRoute))
        .filter(r => r.active !== false)
        .sort((a, b) => a.name.localeCompare(b.name))))
    const u3 = onSnapshot(collection(db, 'holidays'), s =>
      setHolidays(s.docs.map(d => ({ id: d.id, ...d.data() } as Holiday))))
    // Whole collection, filtered here, because what counts toward a target is
    // the month the money arrived — which is on the allocation, not in its id.
    const u4 = onSnapshot(collection(db, 'allocations_v2'), s =>
      setAllocations(s.docs.map(d => ({ id: d.id, ...d.data() } as UnifiedAllocation))))
    const u5 = onSnapshot(collection(db, 'products'), s =>
      setProducts(s.docs.map(d => ({ id: d.id, ...d.data() } as Product))
        .filter(x => x.active)
        .sort((a, b) => a.name.localeCompare(b.name))))
    return () => { u1(); u2(); u3(); u4(); u5() }
  }, [])

  useEffect(() => {
    setTargetError(null)
    return onSnapshot(
      query(collection(db, 'sales_targets'), where('month', '==', targetMonth)),
      s => {
        setTargets(s.docs.map(d => ({ id: d.id, ...d.data() } as SalesTarget)))
        // Only seed the boxes that are not being typed in, so a listener
        // firing mid-edit does not snatch the number back.
        setTargetDraft(prev => {
          const next = { ...prev }
          s.docs.forEach(d => {
            const v = d.data() as SalesTarget
            if (next[v.uid] !== undefined) return
            // A target set before products were asked about has `units` and no
            // breakdown. Rather than guess how to split it, the boxes open
            // empty and the old total goes on showing until somebody sets one.
            next[v.uid] = Object.fromEntries(
              Object.entries(v.byProduct ?? {}).map(([id, n]) => [id, String(n)]))
          })
          return next
        })
        setDayDraft(prev => {
          const next = { ...prev }
          s.docs.forEach(d => {
            const v = d.data() as SalesTarget
            if (next[v.uid] !== undefined) return
            if (v.daysByProduct) {
              next[v.uid] = Object.fromEntries(
                Object.entries(v.daysByProduct).map(([pid, perDay]) =>
                  [pid, Object.fromEntries(
                    Object.entries(perDay).map(([k, n]) => [k, String(n)]))]))
            }
            // A document from before products had their own splits keeps its
            // `days`, and the boxes open empty rather than guessing which
            // product those packets were for. Dividing fills them.
          })
          return next
        })
      },
      err => setTargetError(err?.code === 'permission-denied'
        ? 'Firestore turned down the read. The deployed rules may be older than this build.'
        : 'Could not load the targets.'),
    )
  }, [targetMonth])

  useEffect(() => {
    setReadError(null)
    const u1 = onSnapshot(
      query(collection(db, 'work_plans'),
        where('date', '>=', weekStart), where('date', '<=', weekEnd)),
      s => setPlans(s.docs.map(d => ({ id: d.id, ...d.data() } as WorkPlan))),
      err => setReadError(err?.code === 'permission-denied'
        ? 'Firestore turned down the read. The deployed rules may be older than this build.'
        : 'Could not load the week.'),
    )
    const u2 = onSnapshot(
      query(collection(db, 'leave_records'),
        where('date', '>=', weekStart), where('date', '<=', weekEnd)),
      s => setLeaves(s.docs.map(d => ({ id: d.id, ...d.data() } as LeaveRecord))),
      () => {},
    )
    return () => { u1(); u2() }
  }, [weekStart, weekEnd])

  const planFor = (uid: string, date: string) =>
    plans.find(p => p.uid === uid && p.date === date)
  const leaveOn = (uid: string, date: string) =>
    leaves.find(l => l.uid === uid && l.date === date && l.status === 'active')

  /** Why this day cannot be worked at all — nothing to do with who is on it. */
  const dayOff = (date: string) => {
    if (isSunday(date)) return 'Sunday'
    return holidays.find(h => h.date === date)?.name ?? null
  }

  const shownReps = useMemo(
    () => (whoFilter ? reps.filter(r => r.uid === whoFilter) : reps),
    [reps, whoFilter],
  )

  const openAssign = (uid: string) => {
    setOpenRep(uid); setRouteId(''); setNote(''); setBlocked(null)
    // Opens on the days that are workable and not already planned — filling the
    // gaps is the usual intent, overwriting what is there is not.
    setDays(new Set(week.filter(d => !dayOff(d) && !planFor(uid, d))))
  }

  const toggleDay = (d: string) =>
    setDays(prev => { const n = new Set(prev); n.has(d) ? n.delete(d) : n.add(d); return n })

  const assign = async () => {
    const rep = reps.find(r => r.uid === openRep)
    const route = routes.find(r => r.id === routeId)
    if (!rep) return
    if (!route) { setBlocked('Choose a beat.'); return }
    const chosen = [...days].filter(d => !dayOff(d))
    if (chosen.length === 0) { setBlocked('Tick at least one day.'); return }

    setBlocked(null); setSaving(true)
    try {
      const batch = writeBatch(db)
      for (const date of chosen) {
        batch.set(doc(db, 'work_plans', workPlanId(rep.uid, date)), {
          uid: rep.uid,
          name: rep.name,
          date,
          routeId: route.id,
          routeName: route.name,
          // Copied, not referenced. Editing the beat later must not rewrite
          // what a day already gone was measured against.
          ...(route.defaultTargets ? { targets: route.defaultTargets } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
          assignedBy: appUser!.uid,
          assignedByName: appUser!.name,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        })
      }
      await batch.commit()
      setOpenRep(null)
    } catch (e: any) {
      setBlocked(e?.code === 'permission-denied'
        ? 'Firestore refused that. Your account may not hold "Plan beats & assign the week".'
        : e?.message || 'Could not save the week.')
    } finally { setSaving(false) }
  }

  /**
   * A note on one day, after the fact.
   *
   * The note in the assign panel is written to every day that was ticked,
   * which is right for "start at the far end" and wrong for "collect from
   * Anand Stores" — an errand belongs to one day, not to the whole week. This
   * is how a single day gets its own without reassigning it.
   */
  const saveNote = async (p: WorkPlan) => {
    await updateDoc(doc(db, 'work_plans', workPlanId(p.uid, p.date)), {
      note: noteDraft.trim(),
      updatedAt: Date.now(),
    })
    setNoteFor(null); setNoteDraft('')
  }

  const openNote = (p: WorkPlan) => {
    setNoteFor(workPlanId(p.uid, p.date))
    setNoteDraft(p.note ?? '')
  }

  const noteEditor = (p: WorkPlan) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
      <input
        value={noteDraft}
        onChange={e => setNoteDraft(e.target.value)}
        placeholder="Collect payment from Anand Stores"
        style={inputStyle(t)}
      />
      <div className="oc-wrap" style={{ gap: 10 }}>
        <GhostButton onClick={() => saveNote(p)}>Save note</GhostButton>
        <GhostButton onClick={() => { setNoteFor(null); setNoteDraft('') }}>Cancel</GhostButton>
      </div>
    </div>
  )

  const clearDay = async (p: WorkPlan) => {
    const ok = await showConfirm(
      'Clear this day?',
      `${p.name} has no beat on ${monthLabel(p.date)} after this. Anything they have already ` +
      'logged that day stays exactly as it is.',
      'Clear it',
    )
    if (!ok) return
    await deleteDoc(doc(db, 'work_plans', workPlanId(p.uid, p.date)))
  }

  const shiftWeek = (n: number) => setWeekStart(addDays(weekStart, n * 7))
  const thisWeek = mondayOf(localDateStr())

  const repOptions = [
    { value: '', label: 'Everybody', sub: `${reps.length} reps` },
    ...reps.map(r => ({ value: r.uid, label: r.name })),
  ]
  const beatOptions = [
    { value: '', label: 'Any beat' },
    ...routes.map(r => ({ value: r.id!, label: r.name })),
  ]

  // ── shared chrome ─────────────────────────────────────────────────────────
  const weekNav = (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
      <button className="oc-action" onClick={() => shiftWeek(-1)} aria-label="Previous week"
        style={{ background: 'none', border: 'none', fontSize: 18, color: t.text2, cursor: 'pointer' }}>‹</button>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 15, fontWeight: 500, color: t.text }}>
          {monthLabel(weekStart)} – {monthLabel(weekEnd)}
        </div>
        {weekStart !== thisWeek && (
          <button className="oc-action" onClick={() => setWeekStart(thisWeek)}
            style={{ background: 'none', border: 'none', fontSize: 12, color: t.text3, cursor: 'pointer' }}>
            Back to this week
          </button>
        )}
      </div>
      <button className="oc-action" onClick={() => shiftWeek(1)} aria-label="Next week"
        style={{ background: 'none', border: 'none', fontSize: 18, color: t.text2, cursor: 'pointer' }}>›</button>
    </div>
  )

  const dayRow = (rep: AppUser, date: string) => {
    const off = dayOff(date)
    const plan = planFor(rep.uid, date)
    const leave = leaveOn(rep.uid, date)
    return (
      <div key={date} style={{
        display: 'flex', alignItems: 'baseline', gap: 14,
        borderTop: `0.5px solid ${t.border}`, padding: '12px 0',
        opacity: off ? 0.55 : 1,
      }}>
        <span style={{ fontSize: 13, color: t.text3, width: 74, flexShrink: 0 }}>{dayLabel(date)}</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          {off ? (
            <span style={{ fontSize: 14, color: t.text3 }}>{off}</span>
          ) : plan ? (
            <>
              <span style={{ fontSize: 14, color: t.text }}>{plan.routeName}</span>
              {leave && (
                <span style={{ display: 'block', fontSize: 12, color: t.warn, marginTop: 2 }}>
                  On {leave.leaveType === 'full_day' ? 'full day' : 'half day'} leave
                </span>
              )}
              {plan.note && (
                <span style={{ display: 'block', fontSize: 12, color: t.text3, marginTop: 2 }}>{plan.note}</span>
              )}
              {noteFor === workPlanId(plan.uid, plan.date) && noteEditor(plan)}
            </>
          ) : (
            <span style={{ fontSize: 14, color: leave ? t.warn : t.text3 }}>
              {leave
                ? `On ${leave.leaveType === 'full_day' ? 'full day' : 'half day'} leave`
                : 'Nothing assigned'}
            </span>
          )}
        </span>
        {plan && (
          <>
            <button className="oc-action" onClick={() => openNote(plan)}
              style={{ background: 'none', border: 'none', fontSize: 13, color: t.text3, cursor: 'pointer' }}>
              {plan.note ? 'Edit note' : 'Note'}
            </button>
            <button className="oc-action" onClick={() => clearDay(plan)}
              style={{ background: 'none', border: 'none', fontSize: 13, color: t.text3, cursor: 'pointer' }}>
              Clear
            </button>
          </>
        )}
      </div>
    )
  }

  /**
   * Set or clear one rep's month.
   *
   * Written at a deterministic id so the same rep-month cannot end up with two
   * targets, the way work plans are keyed. A blank box or a zero is a real
   * answer meaning "no target this month", and it is stored rather than
   * deleted — a zero says somebody decided, an absence says nobody looked.
   */
  const saveTarget = async (rep: AppUser) => {
    const boxes = targetDraft[rep.uid] ?? {}
    const byProduct: Record<string, number> = {}
    for (const prod of products) {
      const raw = (boxes[prod.id!] ?? '').trim()
      if (raw === '') continue
      const n = Number(raw)
      if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
        setTargetError(`${rep.name}, ${prod.name}: packets has to be a whole number, zero or more.`)
        return
      }
      byProduct[prod.id!] = n
    }
    // The total is not typed and not trusted from anywhere else: it is this sum,
    // written beside the breakdown so every screen that does not care about
    // products can read one field.
    const units = sumByProduct(byProduct)

    setTargetError(null)
    setTargetSaving(rep.uid)
    try {
      const note = (targetNote[rep.uid] ?? '').trim()
      const existing = targets.find(x => x.uid === rep.uid)
      await setDoc(doc(db, 'sales_targets', salesTargetId(rep.uid, targetMonth)), {
        uid: rep.uid,
        name: rep.name,
        month: targetMonth,
        byProduct,
        units,
        ...(note ? { note } : {}),
        setBy: appUser!.uid,
        setByName: appUser!.name,
        setAt: existing?.setAt ?? Date.now(),
        ...(existing ? { updatedAt: Date.now() } : {}),
      }, { merge: true })
    } catch (e: any) {
      setTargetError(e?.code === 'permission-denied'
        ? 'Firestore refused that. Setting a target needs the same permission as assigning the week.'
        : e?.message || 'Could not save it.')
    } finally { setTargetSaving(null) }
  }

  /**
   * The days of the chosen month a rep could actually work.
   *
   * Sundays are off and a public holiday is off, so neither can carry a
   * target — dividing a month across days nobody works would hand back a
   * figure that was wrong on every one of them.
   *
   * Approved leave is deliberately not excluded. Leave is decided and changed
   * after a month is planned, so a breakdown that moved every time somebody
   * took a day would never match what the rep was told at the start.
   */
  const workableDays = useMemo(() => {
    const [y, m] = targetMonth.split('-').map(Number)
    const last = new Date(y, m, 0).getDate()
    const out: string[] = []
    for (let d = 1; d <= last; d++) {
      const date = `${targetMonth}-${String(d).padStart(2, '0')}`
      if (isSunday(date)) continue
      if (holidays.some(h => h.date === date)) continue
      out.push(date)
    }
    return out
  }, [targetMonth, holidays])

  /** One product's day boxes for one rep. */
  const dayBoxes = (uid: string, productId: string) => dayDraft[uid]?.[productId] ?? {}
  /** Every product's day boxes for one rep. */
  const allDayBoxes = (uid: string) => dayDraft[uid] ?? {}
  /** Which product's grid is showing — the first product until one is picked. */
  const shownProduct = (uid: string) => dayProduct[uid] ?? products[0]?.id ?? ''
  const productBoxes = (uid: string) => targetDraft[uid] ?? {}
  /** What the product boxes currently add up to — the month's figure. */
  const draftTotal = (uid: string) =>
    Object.values(productBoxes(uid)).reduce((n, v) => n + (Number((v ?? '').trim()) || 0), 0)

  /**
   * Fill every product's days from its own month. Not saved until Save is.
   *
   * Every product in one press, each divided by its own figure, because the
   * alternative is a manager dividing four products one at a time and
   * discovering on the fifth that the button only did one of them.
   *
   * Each product is divided independently so its remainder lands inside its
   * own days — dividing the total once and sharing it out afterwards would put
   * the rounding error across products, where it belongs to nobody.
   */
  const divideEqually = (rep: AppUser) => {
    const typedBoxes = productBoxes(rep.uid)
    const stored = targets.find(x => x.uid === rep.uid)?.byProduct ?? {}
    const byProduct: Record<string, number> = {}
    for (const prod of products) {
      const raw = (typedBoxes[prod.id!] ?? '').trim()
      const n = raw === '' ? (stored[prod.id!] ?? 0) : Number(raw)
      if (Number.isFinite(n) && n > 0) byProduct[prod.id!] = n
    }
    if (Object.keys(byProduct).length === 0) {
      setTargetError(`${rep.name}: set a product's packets first — there is nothing to divide.`)
      return
    }
    setTargetError(null)
    const split = divideByProductAcrossDays(byProduct, workableDays)
    setDayDraft(prev => ({
      ...prev,
      [rep.uid]: Object.fromEntries(Object.entries(split).map(([pid, perDay]) =>
        [pid, Object.fromEntries(Object.entries(perDay).map(([d, n]) => [d, String(n)]))])),
    }))
  }

  /**
   * Save one rep's day-by-day breakdown.
   *
   * Written as a whole map rather than day by day: the breakdown is one
   * decision about a month, and a half-written one is a month that adds up to
   * the wrong number. A box left blank clears that day rather than storing a
   * zero — absent means nobody set it, zero means somebody said today does not
   * count, and those read differently on the rep's screen.
   */
  const saveDays = async (rep: AppUser) => {
    const all = allDayBoxes(rep.uid)
    const daysByProduct: Record<string, Record<string, number>> = {}
    for (const prod of products) {
      const boxes = all[prod.id!] ?? {}
      const perDay: Record<string, number> = {}
      for (const [date, raw] of Object.entries(boxes)) {
        const v = (raw ?? '').trim()
        if (v === '') continue
        const n = Number(v)
        if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
          setTargetError(
            `${rep.name}, ${prod.name}, ${date}: packets has to be a whole number, zero or more.`)
          return
        }
        perDay[date] = n
      }
      if (Object.keys(perDay).length) daysByProduct[prod.id!] = perDay
    }
    // `days` is the sum, written beside the breakdown so the screens that do
    // not care which product still read one field.
    const days = dayTotalsFromProducts(daysByProduct)

    setTargetError(null)
    setTargetSaving(rep.uid)
    try {
      const existing = targets.find(x => x.uid === rep.uid)
      await setDoc(doc(db, 'sales_targets', salesTargetId(rep.uid, targetMonth)), {
        uid: rep.uid,
        name: rep.name,
        month: targetMonth,
        units: existing?.units ?? 0,
        daysByProduct,
        days,
        setBy: appUser!.uid,
        setByName: appUser!.name,
        setAt: existing?.setAt ?? Date.now(),
        ...(existing ? { updatedAt: Date.now() } : {}),
      }, { merge: true })
    } catch (e: any) {
      setTargetError(e?.code === 'permission-denied'
        ? 'Firestore refused that. Setting a target needs the same permission as assigning the week.'
        : e?.message || 'Could not save the days.')
    } finally { setTargetSaving(null) }
  }

  const shiftTargetMonth = (delta: number) => {
    const [y, m] = targetMonth.split('-').map(Number)
    const d = new Date(y, m - 1 + delta, 1)
    setTargetMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    // The boxes belong to the month that was on screen, so they go with it.
    setTargetDraft({})
    setTargetNote({})
    setDayDraft({})
    setDayProduct({})
    setDaysOpenFor(null)
  }

  return (
    <div style={{ minHeight: 'var(--oc-screen)', background: t.bg, paddingBottom: 56 }}>
      {modal}
      <PageHeader
        eyebrow="Planner"
        title="The week"
        subtitle="Give each rep their beats. Advisory — it never stops them working elsewhere."
        onBack={onBack}
      />
      <TabBar
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'assign' as Tab, label: 'Assign' },
          { id: 'assigned' as Tab, label: 'Everything assigned' },
          { id: 'targets' as Tab, label: 'Targets' },
        ]}
      />

      <div style={{ padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 760 }}>
        {tab !== 'targets' && weekNav}
        {tab !== 'targets' && readError && <Note tone="warn">{readError}</Note>}

        {/* ── ASSIGN ────────────────────────────────────────────────────── */}
        {tab === 'assign' && (
          routes.length === 0 ? (
            <EmptyState
              title="No beats to assign yet"
              body="Build a beat first — it is the areas a rep works and the shops in them. Beats live on the dashboard."
            />
          ) : reps.length === 0 ? (
            <EmptyState title="No sales reps yet" body="Approve a sales officer and they will appear here." />
          ) : (
            <>
              <Field label="Who">
                <CustomSelect value={whoFilter} onChange={v => { setWhoFilter(v); setOpenRep(null) }}
                  options={repOptions} placeholder="Everybody" />
              </Field>

              {shownReps.map(rep => {
                const planned = week.filter(d => planFor(rep.uid, d)).length
                const workable = week.filter(d => !dayOff(d)).length
                const expanded = openRep === rep.uid || !!whoFilter
                return (
                  <div key={rep.uid}>
                    {/* Collapsed by default. With a team of five, six expanded
                        day-lists is thirty rows of mostly-nothing between the
                        manager and the button they came for. */}
                    <button className="oc-row"
                      onClick={() => (expanded && !whoFilter ? setOpenRep(null) : openAssign(rep.uid))}
                      style={{
                        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
                        gap: 16, width: '100%', textAlign: 'left', background: 'none',
                        border: 'none', borderTop: `0.5px solid ${t.border}`,
                        borderBottom: expanded ? 'none' : `0.5px solid ${t.border}`,
                        padding: '14px 0', cursor: 'pointer', minHeight: 44,
                      }}>
                      <span style={{ fontSize: 15, fontWeight: 500, color: t.text }}>{rep.name}</span>
                      <span style={{ fontSize: 13, color: planned === 0 ? t.warn : t.text2, whiteSpace: 'nowrap' }}>
                        {planned} of {workable} days
                      </span>
                    </button>

                    {expanded && (
                      <>
                        <div style={{ borderBottom: `0.5px solid ${t.border}` }}>
                          {week.map(date => dayRow(rep, date))}
                        </div>

                        {openRep === rep.uid ? (
                          <div style={{
                            marginTop: 14, background: t.tint, borderRadius: 6, padding: 16,
                            display: 'flex', flexDirection: 'column', gap: 16,
                          }}>
                            <Field label="Beat">
                              <CustomSelect value={routeId} onChange={setRouteId}
                                options={routes.map(r => ({
                                  value: r.id!,
                                  label: r.name,
                                  sub: `${routePlaces(r).join(', ')} · ${(r.outletIds || []).length} shops`,
                                }))}
                                placeholder="Choose a beat" />
                            </Field>

                            <Field label={`Days · ${days.size} chosen`}
                              hint="Days off are not offered. A day that already has a beat is replaced.">
                              <div className="oc-wrap" style={{ gap: 8 }}>
                                {week.map(date => {
                                  const off = dayOff(date)
                                  const on = days.has(date)
                                  const taken = planFor(rep.uid, date)
                                  return (
                                    <button key={date} className="oc-action"
                                      onClick={() => !off && toggleDay(date)}
                                      disabled={!!off} aria-pressed={on}
                                      style={{
                                        background: on ? t.bg2 : 'none',
                                        border: `0.5px solid ${on ? t.text2 : t.border2}`,
                                        borderRadius: 6, padding: '8px 12px', fontSize: 13,
                                        fontWeight: on ? 500 : 400,
                                        color: off ? t.text3 : on ? t.text : t.text2,
                                        cursor: off ? 'not-allowed' : 'pointer',
                                        opacity: off ? 0.5 : 1,
                                      }}>
                                      {dayLabel(date)}{taken ? ' ·' : ''}
                                    </button>
                                  )
                                })}
                              </div>
                            </Field>

                            <Field label="Note" hint="Anything the beat cannot say. Optional.">
                              <input value={note} onChange={e => setNote(e.target.value)}
                                placeholder="Start at the far end · chase Anand Stores"
                                style={inputStyle(t)} />
                            </Field>

                            {blocked && <Note tone="warn">{blocked}</Note>}

                            <div className="oc-wrap" style={{ gap: 10 }}>
                              <PrimaryButton onClick={assign} disabled={saving}>
                                {saving ? 'Saving…' : `Assign ${days.size} day${days.size === 1 ? '' : 's'}`}
                              </PrimaryButton>
                              <GhostButton onClick={() => setOpenRep(null)}>Cancel</GhostButton>
                            </div>
                          </div>
                        ) : (
                          <div style={{ marginTop: 12 }}>
                            <GhostButton onClick={() => openAssign(rep.uid)}>
                              Assign a beat to {rep.name.split(' ')[0]}
                            </GhostButton>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )
              })}
            </>
          )
        )}

        {/* ── EVERYTHING ASSIGNED ───────────────────────────────────────── */}
        {tab === 'assigned' && (
          <>
            <div className="oc-wrap" style={{ gap: 16 }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <Field label="Who">
                  <CustomSelect value={whoFilter} onChange={setWhoFilter}
                    options={repOptions} placeholder="Everybody" />
                </Field>
              </div>
              <div style={{ flex: 1, minWidth: 200 }}>
                <Field label="Beat">
                  <CustomSelect value={beatFilter} onChange={setBeatFilter}
                    options={beatOptions} placeholder="Any beat" />
                </Field>
              </div>
            </div>

            {/* By day, because the question here is "who is where on Wednesday"
                rather than "what does Ravi have on". */}
            {week.map(date => {
              const off = dayOff(date)
              const rows = plans
                .filter(p => p.date === date)
                .filter(p => !whoFilter || p.uid === whoFilter)
                .filter(p => !beatFilter || p.routeId === beatFilter)
                .sort((a, b) => a.name.localeCompare(b.name))
              return (
                <div key={date}>
                  <div style={{
                    display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
                    gap: 16, marginBottom: 10,
                  }}>
                    <Eyebrow>{longDay(date)}</Eyebrow>
                    <span style={{ fontSize: 12, color: t.text3 }}>
                      {off ? off : rows.length === 0 ? 'Nobody assigned' : `${rows.length} assigned`}
                    </span>
                  </div>
                  {!off && rows.length > 0 && (
                    <div style={{ borderBottom: `0.5px solid ${t.border}` }}>
                      {rows.map(p => {
                        const leave = leaveOn(p.uid, p.date)
                        return (
                          <div key={p.id} style={{
                            display: 'flex', alignItems: 'baseline', gap: 14,
                            borderTop: `0.5px solid ${t.border}`, padding: '12px 0',
                          }}>
                            <span style={{ flex: 1, minWidth: 0 }}>
                              <span style={{ display: 'block', fontSize: 14, color: t.text }}>{p.name}</span>
                              <span style={{ display: 'block', fontSize: 12, color: t.text3, marginTop: 2 }}>
                                {p.routeName}
                                {p.note ? ` · ${p.note}` : ''}
                              </span>
                              {leave && (
                                <span style={{ display: 'block', fontSize: 12, color: t.warn, marginTop: 2 }}>
                                  On {leave.leaveType === 'full_day' ? 'full day' : 'half day'} leave
                                </span>
                              )}
                              {noteFor === workPlanId(p.uid, p.date) && noteEditor(p)}
                            </span>
                            <button className="oc-action" onClick={() => openNote(p)}
                              style={{ background: 'none', border: 'none', fontSize: 13, color: t.text3, cursor: 'pointer' }}>
                              {p.note ? 'Edit note' : 'Note'}
                            </button>
                            <button className="oc-action" onClick={() => clearDay(p)}
                              style={{ background: 'none', border: 'none', fontSize: 13, color: t.text3, cursor: 'pointer' }}>
                              Clear
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </>
        )}

        {/* ── TARGETS ───────────────────────────────────────────────────── */}
        {tab === 'targets' && (
          <>
            <div className="oc-wrap" style={{ alignItems: 'center', gap: 10 }}>
              <button className="oc-action" onClick={() => shiftTargetMonth(-1)}
                aria-label="Previous month"
                style={{ background: 'none', border: 'none', padding: '0 6px', fontSize: 18, color: t.text2, cursor: 'pointer' }}>
                ‹
              </button>
              <span style={{ fontSize: 15, fontWeight: 500, color: t.text, minWidth: 140 }}>
                {new Date(targetMonth + '-02').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
              </span>
              <button className="oc-action" onClick={() => shiftTargetMonth(1)}
                aria-label="Next month"
                style={{ background: 'none', border: 'none', padding: '0 6px', fontSize: 18, color: t.text2, cursor: 'pointer' }}>
                ›
              </button>
            </div>

            <Note>
              Packets each rep is expected to sell this month. Progress counts packets on
              orders they placed, in the month they placed them, and a cancelled order
              counts for nothing — the figure is worked out from the orders every time,
              so cancelling one takes its packets straight back out.
              <br /><br />
              Open <strong>Day by day</strong> on a rep to say what each day owes.
              <strong> Divide equally</strong> spreads the month across the days that can be
              worked — Sundays and holidays are left out, and the remainder goes to the
              earliest days so the dailies still add up to the month. Change any of them
              afterwards: a day off the usual round still owes its packets, so the figure
              belongs to the rep and the day rather than to a beat.
            </Note>

            {targetError && <Note tone="warn">{targetError}</Note>}

            {reps.length === 0 ? (
              <EmptyState
                title="Nobody to set a target for"
                body="Approved sales officers appear here."
              />
            ) : (
              <div style={{ borderBottom: `0.5px solid ${t.border}` }}>
                {reps.map(r => {
                  const existing = targets.find(x => x.uid === r.uid)
                  const ordered = packetsOrdered(allocations as any, r.uid, targetMonth)
                  // Cancelled orders are simply absent from the count above,
                  // which is the whole reason it is derived rather than stored.
                  // Said out loud so the number is not only a number.
                  const cancelled = allocations
                    .filter(a => a.createdBy === r.uid && a.status === 'cancelled').length
                  const goal = existing?.units ?? 0
                  const pct = goal > 0 ? Math.round((ordered / goal) * 100) : null
                  // Compared breakdown against breakdown. A total would call
                  // 600/400 the same as 400/600, which is a different month.
                  const storedBy = existing?.byProduct ?? {}
                  const boxes = productBoxes(r.uid)
                  const dirty = products.some(prod =>
                    (boxes[prod.id!] ?? '').trim() !== String(storedBy[prod.id!] ?? ''))
                    || (targetNote[r.uid] ?? '') !== ''

                  return (
                    <div key={r.uid} style={{
                      borderTop: `0.5px solid ${t.border}`, padding: '15px 0',
                      display: 'flex', flexDirection: 'column', gap: 10,
                    }}>
                      <div className="oc-wrap" style={{ alignItems: 'flex-end', gap: 14 }}>
                        <span style={{ flex: '1 1 180px', minWidth: 0 }}>
                          <span style={{ display: 'block', fontSize: 15, fontWeight: 500, color: t.text }}>
                            {r.name}
                          </span>
                          <span style={{ display: 'block', fontSize: 13, color: t.text3, marginTop: 3 }}>
                            {goal > 0
                              ? `${ordered} of ${goal} packets ordered${pct !== null ? ` · ${pct}%` : ''}`
                              : `${ordered} packets ordered · no target set`}
                          </span>
                          <span style={{ display: 'block', fontSize: 12, color: t.text3, marginTop: 2 }}>
                            {cancelled > 0
                              ? `${cancelled} cancelled, not counted`
                              : 'Cancelled orders are not counted'}
                            {existing?.setByName ? ` · set by ${existing.setByName}` : ''}
                            {existing?.updatedAt ? ' · edited' : ''}
                          </span>
                          {existing?.note && (
                            <span style={{ display: 'block', fontSize: 12, color: t.text2, marginTop: 4, lineHeight: 1.5 }}>
                              {existing.note}
                            </span>
                          )}
                        </span>

                        {/* One box per product, and the total underneath them
                            rather than in a box of its own. The total is the
                            sum: giving it an input as well would be two places
                            to set one thing, and whichever a manager edited
                            second would silently win. */}
                        <span style={{ flex: '1 1 260px', minWidth: 0 }}>
                          {products.length === 0 ? (
                            <Note tone="warn">
                              No products to set a target against. Add one in Products first.
                            </Note>
                          ) : (
                            <>
                              <div className="oc-wrap" style={{ gap: 10 }}>
                                {products.map(prod => {
                                  // Progress per product, where the target is
                                  // set. A manager setting four numbers wants
                                  // to know which of the four is behind.
                                  const did = packetsOrdered(
                                    allocations as any, r.uid, targetMonth, prod.id!)
                                  return (
                                  <span key={prod.id} style={{ flex: '1 1 110px', minWidth: 0 }}>
                                    <Field label={prod.name} hint={`${did} ordered`}>
                                      {/* Named per person and per product. Field
                                          renders its label as a div, so without
                                          this every box on the screen is an
                                          unnamed control called the same thing. */}
                                      <input type="number" inputMode="numeric" min={0}
                                        aria-label={`${prod.name} packets for ${r.name}`}
                                        value={boxes[prod.id!] ?? ''}
                                        onChange={e => setTargetDraft(prev => ({
                                          ...prev,
                                          [r.uid]: { ...(prev[r.uid] ?? {}), [prod.id!]: e.target.value },
                                        }))}
                                        placeholder="0" style={inputStyle(t)} />
                                    </Field>
                                  </span>
                                  )
                                })}
                              </div>
                              <div style={{ fontSize: 12, color: t.text3, marginTop: 6 }}>
                                {draftTotal(r.uid)} packets for the month, across{' '}
                                {products.length} product{products.length > 1 ? 's' : ''}
                              </div>
                            </>
                          )}
                        </span>

                        <GhostButton onClick={() => saveTarget(r)}
                          ariaLabel={`${existing ? 'Update' : 'Set'} target for ${r.name}`}
                          disabled={targetSaving === r.uid || !dirty}>
                          {targetSaving === r.uid ? 'Saving…' : existing ? 'Update' : 'Set'}
                        </GhostButton>
                      </div>

                      <input
                        aria-label={`Note for ${r.name}`}
                        value={targetNote[r.uid] ?? ''}
                        onChange={e => setTargetNote(prev => ({ ...prev, [r.uid]: e.target.value }))}
                        placeholder="Why, if it is not the usual — Onam push, covering a beat"
                        style={{ ...inputStyle(t), fontSize: 13 }} />

                      {/* ── The day-by-day breakdown ── */}
                      {(() => {
                        const open = daysOpenFor === r.uid
                        const all = allDayBoxes(r.uid)
                        const pid = shownProduct(r.uid)
                        const boxes = dayBoxes(r.uid, pid)
                        // Across every product, because the line beside the
                        // toggle is about the month and the month is every
                        // product. The grid below is one product at a time.
                        const setSum = Object.values(all).reduce((n, perDay) =>
                          n + Object.values(perDay).reduce((m, v) => m + (Number((v ?? '').trim()) || 0), 0), 0)
                        const filled = new Set(
                          Object.values(all).flatMap(perDay =>
                            Object.entries(perDay).filter(([, v]) => (v ?? '').trim() !== '')
                              .map(([d]) => d))).size
                        return (
                          <>
                            <div className="oc-wrap" style={{ alignItems: 'center', gap: 12 }}>
                              <button className="oc-action"
                                onClick={() => setDaysOpenFor(open ? null : r.uid)}
                                aria-label={`Day by day for ${r.name}`}
                                aria-expanded={open}
                                style={{ background: 'none', border: 'none', padding: 0,
                                         fontSize: 13, color: t.text2, cursor: 'pointer' }}>
                                {open ? 'Hide' : 'Day by day'}
                                {filled > 0 ? ` · ${filled} day${filled > 1 ? 's' : ''} set` : ''}
                              </button>
                              {filled > 0 && (
                                <span style={{ fontSize: 12, color: setSum === goal || goal === 0 ? t.text3 : t.warn }}>
                                  {setSum} across the days
                                  {goal > 0 && setSum !== goal
                                    ? ` · ${setSum > goal ? 'over' : 'under'} the month by ${Math.abs(setSum - goal)}`
                                    : ''}
                                </span>
                              )}
                            </div>

                            {open && (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                                <div className="oc-wrap" style={{ gap: 10 }}>
                                  <GhostButton onClick={() => divideEqually(r)}
                                    ariaLabel={`Divide equally for ${r.name}`}>
                                    Divide every product across {workableDays.length} days
                                  </GhostButton>
                                  <GhostButton
                                    onClick={() => setDayDraft(prev => ({ ...prev, [r.uid]: {} }))}
                                    ariaLabel={`Clear days for ${r.name}`}>
                                    Clear
                                  </GhostButton>
                                  <GhostButton onClick={() => saveDays(r)}
                                    ariaLabel={`Save days for ${r.name}`}
                                    disabled={targetSaving === r.uid}>
                                    {targetSaving === r.uid ? 'Saving…' : 'Save days'}
                                  </GhostButton>
                                </div>

                                {/* Which product's month is on screen.
                                    One grid at a time: four products over
                                    twenty-seven days is a hundred boxes, and a
                                    hundred boxes at once is a spreadsheet, and
                                    a worse one than a spreadsheet.
                                    Drawn from the products collection, so one
                                    added next month appears here on its own. */}
                                <div className="oc-scroll-x" style={{ display: 'flex', gap: 6 }}>
                                  {products.map(prod => {
                                    const mine = all[prod.id!] ?? {}
                                    const sum = Object.values(mine)
                                      .reduce((n, v) => n + (Number((v ?? '').trim()) || 0), 0)
                                    const on = pid === prod.id
                                    return (
                                      <button key={prod.id} className="oc-action"
                                        onClick={() => setDayProduct(prev => ({ ...prev, [r.uid]: prod.id! }))}
                                        aria-pressed={on}
                                        aria-label={`Days for ${prod.name}, ${r.name}`}
                                        style={{
                                          background: 'none',
                                          border: `0.5px solid ${on ? t.text2 : t.border}`,
                                          borderRadius: 99, padding: '6px 13px', fontSize: 12,
                                          color: on ? t.text : t.text3, cursor: 'pointer',
                                          whiteSpace: 'nowrap',
                                        }}>
                                        {prod.name}{sum > 0 ? ` · ${sum}` : ''}
                                      </button>
                                    )
                                  })}
                                </div>

                                {/* A box per workable day, for the product above.
                                    Sundays and holidays are absent rather than
                                    disabled — a greyed box still reads as something
                                    somebody forgot to fill in. */}
                                <div style={{
                                  display: 'grid',
                                  gridTemplateColumns: 'repeat(auto-fill, minmax(104px, 1fr))',
                                  gap: 8,
                                }}>
                                  {workableDays.map(date => {
                                    // What was ordered of this product that day,
                                    // so the comparison on screen is like for like.
                                    const done = packetsOrderedOn(allocations as any, r.uid, date, pid)
                                    const dayGoal = Number((boxes[date] ?? '').trim()) || 0
                                    return (
                                      <label key={date} style={{ display: 'block' }}>
                                        <span style={{ display: 'block', fontSize: 11, color: t.text3, marginBottom: 3 }}>
                                          {monthLabel(date)}
                                          {done > 0 ? ` · ${done}` : ''}
                                        </span>
                                        <input type="number" inputMode="numeric" min={0}
                                          aria-label={`Packets for ${r.name} on ${date}`}
                                          value={boxes[date] ?? ''}
                                          onChange={e => setDayDraft(prev => ({
                                            ...prev,
                                            [r.uid]: {
                                              ...(prev[r.uid] ?? {}),
                                              [pid]: { ...(prev[r.uid]?.[pid] ?? {}), [date]: e.target.value },
                                            },
                                          }))}
                                          placeholder="—"
                                          style={{
                                            ...inputStyle(t), fontSize: 13, padding: '7px 9px',
                                            // Met days are quietly marked, so a manager
                                            // scanning the month sees where it is going.
                                            borderColor: dayGoal > 0 && done >= dayGoal ? t.good : undefined,
                                          }} />
                                      </label>
                                    )
                                  })}
                                </div>
                              </div>
                            )}
                          </>
                        )
                      })()}
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
