import { useState, useEffect, useMemo } from 'react'
import { collection, query, where } from 'firebase/firestore'
import { onSnapshot } from '../../data/live'
import { db } from '../../firebase'
import { OutletVisit, Party, UnifiedAllocation } from '../../types'
import { useTheme } from '../../context/ThemeContext'
import {
  findOpportunities, groupByKind, OpportunityKind,
  OPPORTUNITY_LABEL, OPPORTUNITY_BLURB,
} from '../../data/opportunities'
import { PageHeader, Eyebrow, EmptyState, Note } from '../../components/ui'
import { localDateStr } from '../../utils/date'

interface Props {
  onBack: () => void
  /**
   * Whose work to read. A rep sees the shops they have been to; a manager sees
   * the whole network, including the shops nobody has been to at all.
   */
  uid?: string
  /** Offered to a rep so a list can become a visit without leaving the app. */
  onVisit?: () => void
}

/** Half a year back. Long enough to see a rhythm, short enough to stream. */
const WINDOW_DAYS = 180

const ORDER: OpportunityKind[] =
  ['lapsed', 'zero_shelf', 'competitor', 'never_ordered', 'uncovered']

/**
 * The shops worth going back to.
 *
 * Nothing here is newly collected. Shelf counts and competitor sightings have
 * been typed into every visit since the outlet screen was written and were read
 * back in exactly one place — a line inside an expanded visit that nobody was
 * going to page through. Order history was only ever read per shop, never as
 * "who has stopped buying".
 *
 * A manager gets the whole network and can see the shops nobody has been to. A
 * rep gets the shops they cover, so the list is theirs to work rather than a
 * league table of somebody else's territory.
 */
export default function OpportunitiesScreen({ onBack, uid, onVisit }: Props) {
  const { t } = useTheme()

  const [parties, setParties] = useState<Party[]>([])
  const [visits, setVisits] = useState<OutletVisit[]>([])
  const [allocations, setAllocations] = useState<UnifiedAllocation[]>([])
  const [loading, setLoading] = useState(true)
  const [readError, setReadError] = useState<string | null>(null)
  const [open, setOpen] = useState<OpportunityKind>('lapsed')

  const since = useMemo(() => {
    const d = new Date(); d.setDate(d.getDate() - WINDOW_DAYS)
    return localDateStr(d)
  }, [])

  useEffect(() => {
    const u1 = onSnapshot(collection(db, 'parties'), snap =>
      setParties(snap.docs.map(d => ({ id: d.id, ...d.data() } as Party))))

    const u2 = onSnapshot(
      query(collection(db, 'outlet_visits'), where('date', '>=', since)),
      snap => { setVisits(snap.docs.map(d => ({ id: d.id, ...d.data() } as OutletVisit))); setLoading(false) },
      err => {
        console.error('[Opportunities] visits listener failed', err)
        setReadError(err?.code === 'permission-denied'
          ? 'Firestore turned down the read. The deployed rules may be older than this build.'
          : 'Could not load the shop history.')
        setLoading(false)
      },
    )

    const u3 = onSnapshot(
      query(collection(db, 'allocations_v2'),
        where('createdAt', '>=', new Date(since + 'T00:00:00').getTime())),
      snap => setAllocations(snap.docs.map(d => ({ id: d.id, ...d.data() } as UnifiedAllocation))),
      err => console.error('[Opportunities] allocations listener failed', err),
    )

    return () => { u1(); u2(); u3() }
  }, [since])

  const grouped = useMemo(
    () => groupByKind(findOpportunities({ parties, visits, allocations, uid })),
    [parties, visits, allocations, uid])

  const total = ORDER.reduce((n, k) => n + grouped[k].length, 0)

  return (
    <div style={{ minHeight: '100vh', background: t.bg, paddingBottom: 56 }}>
      <PageHeader
        eyebrow={uid ? 'Yours' : 'Reports'}
        title="Worth going back to"
        onBack={onBack}
        subtitle={uid
          ? 'Shops you cover that are asking for another visit, worked out from what you have already recorded.'
          : 'Where the network is leaking, from shelf counts, competitor sightings and order history.'}
      />

      <div style={{ padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: 24 }}>
        {readError && <Note tone="warn">{readError}</Note>}

        {/* One row of filters above the list */}
        <div className="oc-scroll-x" style={{ display: 'flex', gap: 6 }}>
          {ORDER.map(k => {
            const n = grouped[k].length
            const on = open === k
            return (
              <button key={k} className="oc-action" onClick={() => setOpen(k)}
                style={{
                  background: 'none',
                  border: `0.5px solid ${on ? t.text2 : t.border}`,
                  borderRadius: 99, padding: '6px 13px', fontSize: 12,
                  color: on ? t.text : t.text3, cursor: 'pointer', whiteSpace: 'nowrap',
                }}>
                {OPPORTUNITY_LABEL[k]}{n > 0 ? ` · ${n}` : ''}
              </button>
            )
          })}
        </div>

        <div>
          <div style={{ marginBottom: 6 }}><Eyebrow>{OPPORTUNITY_LABEL[open]}</Eyebrow></div>
          <div style={{ fontSize: 13, color: t.text3, lineHeight: 1.6, marginBottom: 14 }}>
            {OPPORTUNITY_BLURB[open]}
          </div>

          {loading ? (
            <div style={{ fontSize: 13, color: t.text3 }}>Reading the last six months…</div>
          ) : grouped[open].length === 0 ? (
            <EmptyState
              title={total === 0 ? 'Nothing to chase' : 'None on this list'}
              body={total === 0
                ? 'No shop in the network is lapsed, empty, or uncovered. That is either very good news or nobody is counting shelves.'
                : 'Nothing matches this one. Try another list above.'}
            />
          ) : (
            <div style={{ borderBottom: `0.5px solid ${t.border}` }}>
              {grouped[open].slice(0, 60).map(o => (
                <div key={`${o.kind}-${o.party.id}`}
                  style={{ borderTop: `0.5px solid ${t.border}`, padding: '13px 0' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 500, color: t.text }}>
                      {o.party.name}
                    </span>
                    {o.party.coordinates && (
                      <a href={`https://www.google.com/maps?q=${o.party.coordinates.lat},${o.party.coordinates.lng}`}
                        target="_blank" rel="noopener noreferrer"
                        style={{ fontSize: 12, color: t.accent, textDecoration: 'underline',
                                 textUnderlineOffset: 3, flexShrink: 0 }}>
                        map
                      </a>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: t.text3, marginTop: 3 }}>
                    {o.party.type === 'distributor' ? 'Distributor' : 'Retailer'}
                    {o.party.place ? ` · ${o.party.place}` : ''}
                    {o.party.phone ? ` · ${o.party.phone}` : ''}
                  </div>
                  <div style={{ fontSize: 13, color: t.text2, marginTop: 4, lineHeight: 1.5 }}>
                    {o.why}
                  </div>
                </div>
              ))}
              {grouped[open].length > 60 && (
                <div style={{ fontSize: 12, color: t.text3, padding: '12px 0' }}>
                  Showing the 60 most neglected of {grouped[open].length}.
                </div>
              )}
            </div>
          )}
        </div>

        {onVisit && grouped[open].length > 0 && (
          <div style={{ fontSize: 13, color: t.text3, lineHeight: 1.6 }}>
            Punch in from Log a visit when you get there — these are shops, not tasks, and
            nothing here is ticked off by reading it.
          </div>
        )}

        <div style={{ fontSize: 12, color: t.text3, lineHeight: 1.6, maxWidth: 560 }}>
          Worked out from the last {WINDOW_DAYS} days. A shelf reads as empty only where
          somebody actually counted it — a visit that recorded no count is not the same as
          a count of none, and treating it as one would fill this list with shops nobody
          has looked at.
        </div>
      </div>
    </div>
  )
}
