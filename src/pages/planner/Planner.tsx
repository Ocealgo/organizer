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
  PageHeader, Eyebrow, EmptyState, Note, Field,
  GhostButton, PrimaryButton, inputStyle,
} from '../../components/ui'
import { localDateStr, isSunday } from '../../utils/date'

interface Props { onBack: () => void }

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
const monthLabel = (d: string) =>
  new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })

/**
 * The week's work, per person.
 *
 * Laid out a rep at a time rather than as a spreadsheet grid. A manager plans
 * one person's week in one go — that is the actual Monday-morning motion — and
 * a seven-by-six table of dropdowns is unreadable on the phone most of them
 * carry.
 *
 * A plan is advisory. It says what a day was meant to cover; where the rep
 * actually went is the visits, and the two are compared afterwards. Nothing
 * here stops a rep working a shop that is not on the list, and it should not:
 * an unplanned call is usually prospecting, which is the most valuable thing
 * they do.
 */
export default function Planner({ onBack }: Props) {
  const { t } = useTheme()
  const { appUser } = useAuth()
  const { modal, showConfirm } = useConfirm()

  const [weekStart, setWeekStart] = useState(mondayOf(localDateStr()))
  const [reps, setReps] = useState<AppUser[]>([])
  const [routes, setRoutes] = useState<SalesRoute[]>([])
  const [plans, setPlans] = useState<WorkPlan[]>([])
  const [holidays, setHolidays] = useState<Holiday[]>([])
  const [leaves, setLeaves] = useState<LeaveRecord[]>([])
  const [readError, setReadError] = useState<string | null>(null)

  // Assign panel
  const [assigning, setAssigning] = useState<string | null>(null)   // uid
  const [routeId, setRouteId] = useState('')
  const [days, setDays] = useState<Set<string>>(new Set())
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [blocked, setBlocked] = useState<string | null>(null)

  /** Monday to Saturday. Sunday is a day off and cannot be worked, so it is not offered. */
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
  const holidayOn = (date: string) => holidays.find(h => h.date === date)
  const leaveOn = (uid: string, date: string) =>
    leaves.find(l => l.uid === uid && l.date === date && l.status === 'active')

  /** Why this day cannot be worked at all — nothing to do with who is on it. */
  const dayOff = (date: string) => {
    if (isSunday(date)) return 'Sunday'
    const h = holidayOn(date)
    return h ? h.name : null
  }

  const openAssign = (uid: string) => {
    setAssigning(uid); setRouteId(''); setNote(''); setBlocked(null)
    // Days that are workable and not already planned — the usual intent is to
    // fill the gaps rather than overwrite what is already there.
    setDays(new Set(week.filter(d => !dayOff(d) && !planFor(uid, d))))
  }

  const toggleDay = (d: string) =>
    setDays(prev => { const n = new Set(prev); n.has(d) ? n.delete(d) : n.add(d); return n })

  const assign = async () => {
    const rep = reps.find(r => r.uid === assigning)
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
      setAssigning(null)
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

  const routeOptions = routes.map(r => ({
    value: r.id!,
    label: r.name,
    sub: `${routePlaces(r).join(', ')} · ${(r.outletIds || []).length} shops`,
  }))

  const shiftWeek = (n: number) => setWeekStart(addDays(weekStart, n * 7))
  const thisWeek = mondayOf(localDateStr())

  return (
    <div style={{ minHeight: 'var(--oc-screen)', background: t.bg, paddingBottom: 56 }}>
      {modal}
      <PageHeader
        eyebrow="Planner"
        title="The week"
        subtitle="Give each rep their beats. Advisory — it never stops them working elsewhere."
        onBack={onBack}
      />

      <div style={{ padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 760 }}>
        {/* Week nav */}
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

        {readError && <Note tone="warn">{readError}</Note>}

        {routes.length === 0 ? (
          <EmptyState
            title="No beats to assign yet"
            body="Build a beat first — it is the areas a rep works and the shops in them. Beats live on the dashboard."
          />
        ) : reps.length === 0 ? (
          <EmptyState title="No sales reps yet" body="Approve a sales officer and they will appear here." />
        ) : reps.map(rep => {
          const planned = week.filter(d => planFor(rep.uid, d)).length
          const workable = week.filter(d => !dayOff(d)).length
          return (
            <div key={rep.uid}>
              <div style={{
                display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
                gap: 16, marginBottom: 10,
              }}>
                <Eyebrow>{rep.name}</Eyebrow>
                <span style={{ fontSize: 12, color: planned === 0 ? t.warn : t.text3 }}>
                  {planned} of {workable} days planned
                </span>
              </div>

              <div style={{ borderBottom: `0.5px solid ${t.border}` }}>
                {week.map(date => {
                  const off = dayOff(date)
                  const plan = planFor(rep.uid, date)
                  const leave = leaveOn(rep.uid, date)
                  return (
                    <div key={date} style={{
                      display: 'flex', alignItems: 'baseline', gap: 14,
                      borderTop: `0.5px solid ${t.border}`, padding: '12px 0',
                      opacity: off ? 0.55 : 1,
                    }}>
                      <span style={{ fontSize: 13, color: t.text3, width: 74, flexShrink: 0 }}>
                        {dayLabel(date)}
                      </span>
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
                              <span style={{ display: 'block', fontSize: 12, color: t.text3, marginTop: 2 }}>
                                {plan.note}
                              </span>
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
                })}
              </div>

              {assigning === rep.uid ? (
                <div style={{
                  marginTop: 14, background: t.tint, borderRadius: 6, padding: 16,
                  display: 'flex', flexDirection: 'column', gap: 16,
                }}>
                  <Field label="Beat">
                    <CustomSelect
                      value={routeId}
                      onChange={setRouteId}
                      options={routeOptions}
                      placeholder="Choose a beat"
                    />
                  </Field>

                  <Field label={`Days · ${days.size} chosen`}
                    hint="Days off are not offered. Assigning a day that already has a beat replaces it.">
                    <div className="oc-wrap" style={{ gap: 8 }}>
                      {week.map(date => {
                        const off = dayOff(date)
                        const on = days.has(date)
                        const taken = planFor(rep.uid, date)
                        return (
                          <button key={date} className="oc-action"
                            onClick={() => !off && toggleDay(date)}
                            disabled={!!off}
                            aria-pressed={on}
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
                    <GhostButton onClick={() => setAssigning(null)}>Cancel</GhostButton>
                  </div>
                </div>
              ) : (
                <div style={{ marginTop: 12 }}>
                  <GhostButton onClick={() => openAssign(rep.uid)}>
                    Assign a beat to {rep.name.split(' ')[0]}
                  </GhostButton>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
