import { useState, useEffect, useMemo } from 'react'
import { collection, query, where, writeBatch, doc, deleteDoc } from 'firebase/firestore'
import { onSnapshot } from '../../data/live'
import { db } from '../../firebase'
import {
  AppUser, SalesRoute, WorkPlan, Holiday, LeaveRecord,
  workPlanId, routePlaces,
} from '../../types'
import { useAuth } from '../../context/AuthContext'
import { useTheme } from '../../context/ThemeContext'
import { useConfirm } from '../../hooks/useConfirm'
import CustomSelect from '../../components/CustomSelect'
import {
  PageHeader, TabBar, Eyebrow, EmptyState, Note, Field,
  GhostButton, PrimaryButton, inputStyle,
} from '../../components/ui'
import { localDateStr, isSunday } from '../../utils/date'

interface Props { onBack: () => void }

type Tab = 'assign' | 'assigned'

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
    return () => { u1(); u2(); u3() }
  }, [])

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
          <button className="oc-action" onClick={() => clearDay(plan)}
            style={{ background: 'none', border: 'none', fontSize: 13, color: t.text3, cursor: 'pointer' }}>
            Clear
          </button>
        )}
      </div>
    )
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
        ]}
      />

      <div style={{ padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 760 }}>
        {weekNav}
        {readError && <Note tone="warn">{readError}</Note>}

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
                            </span>
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
      </div>
    </div>
  )
}
