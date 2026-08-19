import { useState, useEffect, useMemo, ReactNode } from 'react'
import { collection, query, where } from 'firebase/firestore'
import { onSnapshot } from '../../data/live'
import { db } from '../../firebase'
import {
  AppUser, DutySession, GeoPoint, LocationIssue, LOCATION_ISSUE_LABEL, OutletVisit,
  OUTLET_TYPE_LABEL, ODOMETER_STATUS_LABEL, VISIT_OUTCOME_LABEL,
} from '../../types'
import { useTheme } from '../../context/ThemeContext'
import CustomSelect from '../../components/CustomSelect'
import DateInput from '../../components/DateInput'
import { PageHeader, Eyebrow, StatGrid, StatCard, EmptyState } from '../../components/ui'
import { urlFor } from '../../device/photo'
import { localDateStr, localMonthStr } from '../../utils/date'

interface Props { onBack: () => void }

type RangeMode = 'day' | 'week' | 'month' | 'custom'

function mondayOf(d: string): string {
  const x = new Date(d + 'T00:00:00')
  x.setDate(x.getDate() - (x.getDay() === 0 ? 6 : x.getDay() - 1))
  return localDateStr(x)
}
function addDays(d: string, n: number): string {
  const x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() + n); return localDateStr(x)
}
function lastDayOfMonth(m: string): string {
  const [y, mo] = m.split('-').map(Number); return localDateStr(new Date(y, mo, 0))
}
const hhmm = (ts: number) =>
  new Date(ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })

/** A stored photo, resolved lazily. Opens full size in a new tab. */
function StoragePhoto({ path, label }: { path: string; label: string }) {
  const { t } = useTheme()
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    urlFor(path).then(u => { if (alive) setUrl(u) }).catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [path])

  if (failed) return <span style={{ fontSize: 12, color: t.text3 }}>{label} — unavailable</span>
  if (!url) return <span style={{ fontSize: 12, color: t.text3 }}>{label} — loading…</span>
  return (
    <a href={url} target="_blank" rel="noopener noreferrer"
      style={{ display: 'inline-block', textDecoration: 'none' }}>
      <img src={url} alt={label}
        style={{ width: 74, height: 74, objectFit: 'cover', borderRadius: 6, border: `0.5px solid ${t.border}`, display: 'block' }} />
      <span style={{ fontSize: 11, color: t.text3, display: 'block', marginTop: 4 }}>{label}</span>
    </a>
  )
}

export default function FieldReport({ onBack }: Props) {
  const { t } = useTheme()

  const [mode, setMode] = useState<RangeMode>('day')
  const [day, setDay] = useState(localDateStr())
  const [week, setWeek] = useState(mondayOf(localDateStr()))
  const [month, setMonth] = useState(localMonthStr())
  const [from, setFrom] = useState(addDays(localDateStr(), -7))
  const [to, setTo] = useState(localDateStr())
  const [who, setWho] = useState('all')
  const [open, setOpen] = useState<Set<string>>(new Set())

  const range = useMemo(() => {
    if (mode === 'day') return { from: day, to: day }
    if (mode === 'week') return { from: week, to: addDays(week, 6) }
    if (mode === 'month') return { from: `${month}-01`, to: lastDayOfMonth(month) }
    return { from, to }
  }, [mode, day, week, month, from, to])

  const [users, setUsers] = useState<AppUser[]>([])
  const [sessions, setSessions] = useState<DutySession[]>([])
  const [visits, setVisits] = useState<OutletVisit[]>([])
  const [loading, setLoading] = useState(true)
  const [readError, setReadError] = useState<string | null>(null)

  useEffect(() => {
    return onSnapshot(collection(db, 'users'), snap => {
      setUsers(snap.docs.map(d => ({ uid: d.id, ...d.data() } as AppUser))
        .filter(u => u.status === 'approved'))
    })
  }, [])

  useEffect(() => {
    setLoading(true); setReadError(null)
    const byDate = (col: string, set: (v: any[]) => void) =>
      onSnapshot(
        query(collection(db, col), where('date', '>=', range.from), where('date', '<=', range.to)),
        snap => { set(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setLoading(false) },
        err => {
          console.error(`[FieldReport] ${col} listener failed`, err)
          setReadError(err?.code === 'permission-denied'
            ? 'Firestore turned down the read. The deployed rules may be older than this build.'
            : 'Could not load field activity.')
          setLoading(false)
        },
      )
    const u1 = byDate('duty_sessions', v => setSessions(v as DutySession[]))
    const u2 = byDate('outlet_visits', v => setVisits(v as OutletVisit[]))
    return () => { u1(); u2() }
  }, [range.from, range.to])

  const shown = useMemo(() => {
    const s = sessions
      .filter(x => who === 'all' || x.uid === who)
      .sort((a, b) => b.date.localeCompare(a.date) || b.startAt - a.startAt)
    return s
  }, [sessions, who])

  const visitsFor = (sessionId?: string) =>
    visits.filter(v => v.sessionId === sessionId).sort((a, b) => a.punchInAt - b.punchInAt)

  // ── headline numbers ──────────────────────────────────────────────────────
  const totals = useMemo(() => {
    const relevant = shown
    const ids = new Set(relevant.map(s => s.id))
    const vs = visits.filter(v => ids.has(v.sessionId) && (who === 'all' || v.uid === who))
    const km = relevant.reduce((n, s) => n + (s.claimedDistanceKm ?? 0), 0)
    const stillOut = relevant.filter(s => s.status === 'active').length
    const noMeter = relevant.filter(s => (s.odometerStatus ?? 'recorded') !== 'recorded').length
    return { days: relevant.length, visits: vs.length, km, stillOut, noMeter }
  }, [shown, visits, who])

  const toggle = (id: string) =>
    setOpen(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  const chip = (active: boolean) => ({
    background: 'none',
    border: `0.5px solid ${active ? t.text2 : t.border}`,
    borderRadius: 99, padding: '6px 13px', fontSize: 12, fontWeight: 400 as const,
    color: active ? t.text : t.text3, cursor: 'pointer', whiteSpace: 'nowrap' as const,
  })

  return (
    <div style={{ minHeight: '100vh', background: t.bg, paddingBottom: 56 }}>
      <PageHeader
        eyebrow="Reports"
        title="Field activity"
        subtitle="Attendance, meter readings and every outlet visit with its remarks."
        onBack={onBack}
      />

      <div style={{ padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: 26 }}>

        {/* Range */}
        <div>
          <div style={{ marginBottom: 8 }}><Eyebrow>When</Eyebrow></div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
            {(['day', 'week', 'month', 'custom'] as RangeMode[]).map(m => (
              <button key={m} className="oc-action" onClick={() => setMode(m)} style={chip(mode === m)}>
                {m === 'day' ? 'Day' : m === 'week' ? 'Week' : m === 'month' ? 'Month' : 'Range'}
              </button>
            ))}
          </div>
          {mode === 'day' && <DateInput type="date" value={day} onChange={setDay} />}
          {mode === 'week' && <DateInput type="date" value={week} onChange={v => setWeek(mondayOf(v))} />}
          {mode === 'month' && <DateInput type="month" value={month} onChange={setMonth} />}
          {mode === 'custom' && (
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, color: t.text3, marginBottom: 5 }}>From</div>
                <DateInput type="date" value={from} onChange={setFrom} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, color: t.text3, marginBottom: 5 }}>To</div>
                <DateInput type="date" value={to} onChange={setTo} />
              </div>
            </div>
          )}
        </div>

        {/* Who */}
        <div>
          <div style={{ marginBottom: 8 }}><Eyebrow>Who</Eyebrow></div>
          <CustomSelect value={who} onChange={setWho} placeholder="Everyone"
            options={[{ value: 'all', label: 'Everyone' },
              ...users.map(u => ({ value: u.uid, label: u.name }))]} />
        </div>

        {readError && <div style={{ fontSize: 13, color: t.warn }}>{readError}</div>}

        {/* Totals */}
        <StatGrid>
          <StatCard value={totals.days} label="Days worked"
            context={totals.stillOut > 0 ? `${totals.stillOut} still out` : 'All punched out'} />
          <StatCard value={totals.visits} label="Outlet visits"
            context={totals.days > 0 ? `${(totals.visits / totals.days).toFixed(1)} per day` : undefined} />
          <StatCard value={`${totals.km} km`} label="Distance claimed"
            context={totals.noMeter > 0 ? `${totals.noMeter} days with no meter` : 'All from meter readings'} />
        </StatGrid>

        {/* Sessions */}
        {loading ? (
          <div style={{ fontSize: 14, color: t.text3 }}>Loading…</div>
        ) : shown.length === 0 ? (
          <EmptyState
            title="Nobody worked in this period"
            body="Once an officer punches in, their day appears here with their meter readings and every outlet they visited."
          />
        ) : (
          <div className="oc-list-flush" style={{ borderBottom: `0.5px solid ${t.border}` }}>
            {shown.map(s => {
              const vs = visitsFor(s.id)
              const isOpen = open.has(s.id!)
              const meterIssue = (s.odometerStatus ?? 'recorded') !== 'recorded'
              return (
                <div key={s.id} style={{ borderTop: `0.5px solid ${t.border}` }}>
                  <button className="oc-row" onClick={() => toggle(s.id!)} aria-expanded={isOpen}
                    style={{ width: '100%', display: 'flex', alignItems: 'baseline', gap: 16,
                             background: 'none', border: 'none', padding: '15px 10px',
                             textAlign: 'left', cursor: 'pointer' }}>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 15, fontWeight: 500, color: t.text }}>
                        {s.name}
                      </span>
                      <span style={{ display: 'block', fontSize: 13, color: t.text3, marginTop: 3 }}>
                        {s.date} · {hhmm(s.startAt)}
                        {s.autoClosed ? ' · never ended' : s.endAt ? `–${hhmm(s.endAt)}` : ' · still out'}
                        {' · '}{vs.length} {vs.length === 1 ? 'visit' : 'visits'}
                      </span>
                    </span>
                    <span style={{ fontSize: 14, whiteSpace: 'nowrap',
                                   color: s.status === 'active' || s.autoClosed || meterIssue ? t.warn : t.text2 }}>
                      {s.autoClosed ? 'Not ended'
                        : s.claimedDistanceKm !== undefined ? `${s.claimedDistanceKm} km`
                        : meterIssue ? 'No meter' : '—'}
                    </span>
                  </button>

                  {isOpen && (
                    <div style={{ padding: '0 10px 18px' }}>

                      {/* The day itself */}
                      <div style={{ marginBottom: 14 }}>
                        <div style={{ marginBottom: 8 }}><Eyebrow>The day</Eyebrow></div>
                        <Detail label="Punched in" value={hhmm(s.startAt)}
                          loc={s.startLocation} locIssue={s.startLocationIssue} locExpected />
                        <Detail label="Punched out"
                          value={s.autoClosed ? 'Never — closed automatically'
                            : s.endAt ? hhmm(s.endAt) : 'Still out'}
                          warn={s.autoClosed}
                          loc={s.autoClosed ? undefined : s.endLocation}
                          locIssue={s.autoClosed ? undefined : s.endLocationIssue}
                          locExpected={!s.autoClosed && !!s.endAt} />
                        {meterIssue ? (
                          <Detail label="Meter"
                            value={`${ODOMETER_STATUS_LABEL[s.odometerStatus!]}${s.odometerIssueNote ? ` — ${s.odometerIssueNote}` : ''}`} warn />
                        ) : (
                          <>
                            <Detail label="Opening" value={s.startOdometerKm !== undefined ? `${s.startOdometerKm} km` : '—'} />
                            <Detail label="Closing" value={s.endOdometerKm !== undefined ? `${s.endOdometerKm} km` : '—'} />
                          </>
                        )}
                        {s.endOdometerIssueNote && (
                          <Detail label="At close" value={s.endOdometerIssueNote} warn />
                        )}
                        {s.startBatteryPct !== undefined && (
                          <Detail label="Battery"
 value={`${s.startBatteryPct}%${s.endBatteryPct !== undefined ?` → ${s.endBatteryPct}%` :''}`} />
                        )}

                        {(s.startOdometerPhoto || s.endOdometerPhoto) && (
                          <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
                            {s.startOdometerPhoto && <StoragePhoto path={s.startOdometerPhoto} label="Opening" />}
                            {s.endOdometerPhoto && <StoragePhoto path={s.endOdometerPhoto} label="Closing" />}
                          </div>
                        )}
                      </div>

                      {/* Visits */}
                      <div style={{ marginBottom: 8 }}><Eyebrow>Outlets ({vs.length})</Eyebrow></div>
                      {vs.length === 0 ? (
                        <div style={{ fontSize: 13, color: t.text3 }}>No outlets visited on this day.</div>
                      ) : (
                        <div style={{ borderBottom: `0.5px solid ${t.border}` }}>
                          {vs.map(v => (
                            <div key={v.id} style={{ borderTop: `0.5px solid ${t.border}`, padding: '13px 0' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
                                <span style={{ fontSize: 14, fontWeight: 500, color: t.text }}>{v.partyName}</span>
                                <span style={{ fontSize: 12, whiteSpace: 'nowrap',
                                               color: v.status === 'abandoned' ? t.warn : t.text3 }}>
                                  {hhmm(v.punchInAt)}
                                  {v.status === 'abandoned' ? ' · never closed'
                                    : v.punchOutAt ? `–${hhmm(v.punchOutAt)}` : ' · open'}
                                  {v.durationMinutes ? ` · ${v.durationMinutes}m` : ''}
                                </span>
                              </div>
                              <div style={{ fontSize: 12, color: t.text3, marginTop: 3 }}>
                                {OUTLET_TYPE_LABEL[v.outletType]}
                                {v.distanceFromOutletM !== undefined && (
                                  // Coloured only when it is outside the geofence. The
                                  // number is on every line; the point of the colour is
                                  // that a manager scanning forty visits sees the one
                                  // logged from the next town without reading any of them.
                                  <span style={{ color: v.withinGeofence === false ? t.warn : undefined }}>
                                    {` · ${v.distanceFromOutletM} m from the shop`}
                                  </span>
                                )}
                                {v.orderPlaced && ' · order booked'}
                              </div>

                              {/* Where the officer actually stood, at each end of the
                                  visit. Both fixes have been recorded since the outlet
                                  screen was written; until now nothing displayed them,
                                  so the only thing anybody could see about a visit's
                                  position was how far it was from the shop — which says
                                  nothing about where they were instead. */}
                              <div style={{ fontSize: 12, color: t.text3, marginTop: 4 }}>
                                Where they stood:{' '}
                                {v.punchInLocation
                                  ? <MapLink loc={v.punchInLocation}>arriving</MapLink>
                                  : <>arriving <NoFix issue={v.punchInLocationIssue} /></>}
                                {' · '}
                                {v.punchOutLocation
                                  ? <MapLink loc={v.punchOutLocation}>leaving</MapLink>
                                  : v.status === 'abandoned'
                                    ? 'never left'
                                    : v.status === 'open'
                                      ? 'still inside'
                                      : <>leaving <NoFix issue={v.punchOutLocationIssue} /></>}
                              </div>

                              {v.remarksCategory && (
                                <div style={{ fontSize: 13, color: t.text2, marginTop: 6 }}>
                                  {VISIT_OUTCOME_LABEL[v.remarksCategory]}
                                  {v.remarksReason ? ` — ${v.remarksReason}` : ''}
                                </div>
                              )}
                              {v.remarksText && (
                                <div style={{ fontSize: 13, color: t.text, marginTop: 4, lineHeight: 1.6 }}>
                                  “{v.remarksText}”
                                </div>
                              )}
                              {v.competitors?.length > 0 && (
                                <div style={{ fontSize: 12, color: t.text3, marginTop: 5 }}>
                                  Competitors: {v.competitors.map(c =>
                                    `${c.brand}${c.pricePerPack ? ` ₹${c.pricePerPack}` : ''}`).join(', ')}
                                </div>
                              )}
                              {v.stock?.length > 0 && (
                                <div style={{ fontSize: 12, color: t.text3, marginTop: 3 }}>
                                  On shelf: {v.stock.map(l => `${l.productName} ${l.qtyOnShelf}`).join(', ')}
                                </div>
                              )}
                              {v.photos?.length > 0 && (
                                <div className="oc-wrap" style={{ gap: 10, marginTop: 10 }}>
                                  {v.photos.map((p, i) => <StoragePhoto key={i} path={p.path} label={p.kind} />)}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * A fix, as somewhere you can go and look.
 *
 * A latitude and a longitude on a screen tell a manager nothing. The whole
 * reason for recording where somebody was standing is being able to put it
 * against the street, so a fix is always a link out to a map and never a pair
 * of numbers. How good the fix was travels with it in the tooltip, because
 * "12 m" and "900 m" are very different claims about the same dot.
 */
function MapLink({ loc, children }: { loc: GeoPoint; children: ReactNode }) {
  const { t } = useTheme()
  return (
    <a href={`https://www.google.com/maps?q=${loc.lat},${loc.lng}`}
      target="_blank" rel="noopener noreferrer"
      title={typeof loc.accuracy === 'number'
        ? `Accurate to about ${Math.round(loc.accuracy)} m`
        : 'Accuracy not recorded'}
      style={{ color: t.accent, textDecoration: 'underline', textUnderlineOffset: 3 }}>
      {children}
    </a>
  )
}

/**
 * Why a fix is missing, when one is.
 *
 * `denied` is the only one of the four that is somebody's decision rather than
 * the world's, and the only one anybody can act on, so it is the only one that
 * gets the colour. The rest are stated and left alone — a rep who spent the
 * morning inside a concrete market has done nothing that needs answering for.
 */
function NoFix({ issue }: { issue?: LocationIssue }) {
  const { t } = useTheme()
  return (
    <span style={{ color: issue === 'denied' ? t.warn : t.text3 }}>
      {issue ? LOCATION_ISSUE_LABEL[issue] : 'no location'}
    </span>
  )
}

/**
 * `locExpected` says a fix should have been taken here, so its absence is
 * reported rather than left blank. A blank reads as "the screen does not show
 * this"; what a manager needs to know is "the device did not supply it, and
 * here is why" — which is a fact about the day, and sometimes about the person.
 */
function Detail({ label, value, loc, locIssue, locExpected, warn }: {
  label: string; value: string
  loc?: GeoPoint; locIssue?: LocationIssue; locExpected?: boolean; warn?: boolean
}) {
  const { t } = useTheme()
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '7px 0' }}>
      <span style={{ fontSize: 13, color: t.text3 }}>{label}</span>
      <span style={{ fontSize: 13, color: warn ? t.warn : t.text, textAlign: 'right' }}>
        {value}
        {loc ? (
          <span style={{ marginLeft: 8 }}><MapLink loc={loc}>map</MapLink></span>
        ) : locExpected || locIssue ? (
          <span style={{ marginLeft: 8 }}><NoFix issue={locIssue} /></span>
        ) : null}
      </span>
    </div>
  )
}
