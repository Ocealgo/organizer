import { useState, useEffect, useMemo } from 'react'
import { collection, addDoc, updateDoc, doc, deleteDoc } from 'firebase/firestore'
import { onSnapshot } from '../../data/live'
import { db } from '../../firebase'
import { Party, SalesRoute, routePlaces } from '../../types'
import { useAuth } from '../../context/AuthContext'
import { useTheme } from '../../context/ThemeContext'
import { useConfirm } from '../../hooks/useConfirm'
import CustomSelect from '../../components/CustomSelect'
import {
  PageHeader, Section, EmptyState, Field, Note, ChipGroup,
  GhostButton, PrimaryButton, inputStyle,
} from '../../components/ui'

interface Props { onBack: () => void }

type TypeFilter = 'all' | 'retailer' | 'distributor'

/**
 * Beats — the areas a rep works, and the shops in them.
 *
 * A beat is areas before it is a list. Ticking a place offers its shops and
 * the manager trims from there, which keeps the stored list explicit — nothing
 * shifts under them — while letting the screen notice that a shop turned up in
 * one of those areas later and offer it by name. A frozen list of ids assumes
 * the world is already in the database, and reps add shops all week.
 *
 * Nothing here binds anybody. A beat says what a day is meant to cover; where
 * the rep actually went is the visits, and the two are compared afterwards.
 */
export default function BeatManager({ onBack }: Props) {
  const { t } = useTheme()
  const { appUser } = useAuth()
  const { modal, showConfirm } = useConfirm()

  const [parties, setParties] = useState<Party[]>([])
  const [routes, setRoutes] = useState<SalesRoute[]>([])
  const [editing, setEditing] = useState<SalesRoute | 'new' | null>(null)
  const [name, setName] = useState('')
  const [places, setPlaces] = useState<Set<string>>(new Set())
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [search, setSearch] = useState('')
  const [targetVisits, setTargetVisits] = useState('')
  const [targetOrderValue, setTargetOrderValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [blocked, setBlocked] = useState<string | null>(null)

  useEffect(() => {
    const u1 = onSnapshot(collection(db, 'parties'), s =>
      setParties(s.docs.map(d => ({ id: d.id, ...d.data() } as Party))))
    const u2 = onSnapshot(collection(db, 'sales_routes'), s =>
      setRoutes(s.docs.map(d => ({ id: d.id, ...d.data() } as SalesRoute))))
    return () => { u1(); u2() }
  }, [])

  const norm = (s?: string) => (s || '').trim().toLowerCase()

  /** Every distinct place on a party record, with how many shops sit in it. */
  const allPlaces = useMemo(() => {
    const counts = new Map<string, number>()
    parties.forEach(p => {
      const k = (p.place || '').trim()
      if (k) counts.set(k, (counts.get(k) ?? 0) + 1)
    })
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [parties])

  const shopsIn = (place: string) => parties.filter(p => norm(p.place) === norm(place))

  /** Everything inside the chosen areas — the pool this beat draws from. */
  const inAreas = useMemo(() => {
    const keys = new Set([...places].map(norm))
    return parties
      .filter(p => keys.has(norm(p.place)))
      .sort((a, b) => (a.place || '').localeCompare(b.place || '') || a.name.localeCompare(b.name))
  }, [parties, places])

  /** What the list actually shows right now. Filters narrow the view, never the selection. */
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return inAreas.filter(p =>
      (typeFilter === 'all' || p.type === typeFilter)
      && (!q || p.name.toLowerCase().includes(q)))
  }, [inAreas, typeFilter, search])

  const openNew = () => {
    setEditing('new'); setName(''); setPlaces(new Set()); setPicked(new Set())
    setTypeFilter('all'); setSearch('')
    setTargetVisits(''); setTargetOrderValue(''); setBlocked(null)
  }

  const openEdit = (r: SalesRoute) => {
    setEditing(r); setName(r.name)
    setPlaces(new Set(routePlaces(r)))
    setPicked(new Set(r.outletIds || []))
    setTypeFilter('all'); setSearch('')
    setTargetVisits(r.defaultTargets?.visits?.toString() ?? '')
    setTargetOrderValue(r.defaultTargets?.orderValue?.toString() ?? '')
    setBlocked(null)
  }

  /**
   * Adding an area brings its shops in; removing one takes only its own back
   * out. A shop the manager unticked by hand stays unticked — toggling a
   * different area must not resurrect it.
   */
  const toggleArea = (place: string) => {
    const ids = shopsIn(place).map(p => p.id!)
    setPlaces(prev => {
      const next = new Set(prev)
      const removing = next.has(place)
      removing ? next.delete(place) : next.add(place)
      setPicked(cur => {
        const p = new Set(cur)
        ids.forEach(id => (removing ? p.delete(id) : p.add(id)))
        return p
      })
      return next
    })
  }

  const toggleShop = (id: string) =>
    setPicked(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  /** Applies to what is on screen, so a filter plus this is how you take a whole type out. */
  const setAllVisible = (on: boolean) =>
    setPicked(prev => {
      const n = new Set(prev)
      visible.forEach(p => (on ? n.add(p.id!) : n.delete(p.id!)))
      return n
    })

  const save = async () => {
    // Echoed at the button rather than thrown away. A save that quietly does
    // nothing is the most confusing thing a form can do.
    if (!name.trim()) { setBlocked('Give the beat a name.'); return }
    if (places.size === 0) { setBlocked('Pick at least one area.'); return }
    if (picked.size === 0) { setBlocked('A beat with no shops cannot be assigned.'); return }
    setBlocked(null); setSaving(true)
    try {
      const targets = {
        ...(targetVisits.trim() ? { visits: Number(targetVisits) } : {}),
        ...(targetOrderValue.trim() ? { orderValue: Number(targetOrderValue) } : {}),
      }
      const payload = {
        name: name.trim(),
        places: [...places],
        outletIds: [...picked],
        ...(Object.keys(targets).length ? { defaultTargets: targets } : {}),
        active: true,
      }
      if (editing === 'new') {
        await addDoc(collection(db, 'sales_routes'), {
          ...payload,
          assignedTo: [],
          createdBy: appUser!.uid,
          createdByName: appUser!.name,
          createdAt: Date.now(),
        })
      } else if (editing) {
        await updateDoc(doc(db, 'sales_routes', editing.id!), payload)
      }
      setEditing(null)
    } finally { setSaving(false) }
  }

  const remove = async (r: SalesRoute) => {
    const ok = await showConfirm(
      'Delete this beat?',
      `${r.name} goes. Days already assigned to it keep the name they were given, so ` +
      'nothing already planned is rewritten.',
      'Delete it',
    )
    if (!ok) return
    await deleteDoc(doc(db, 'sales_routes', r.id!))
  }

  // ── FORM ──────────────────────────────────────────────────────────────────
  if (editing) {
    const missing = inAreas.filter(p => !picked.has(p.id!))
    const shownPicked = visible.filter(p => picked.has(p.id!)).length

    return (
      <div style={{ minHeight: 'var(--oc-screen)', background: t.bg, paddingBottom: 56 }}>
        {modal}
        <PageHeader
          eyebrow="Planner"
          title={editing === 'new' ? 'New beat' : editing.name}
          subtitle="The areas it covers, and the shops in them."
          onBack={() => setEditing(null)}
        />
        <div style={{ padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 620 }}>
          <Field label="Name">
            <input value={name} onChange={e => setName(e.target.value)}
              placeholder="Kozhikode North" style={inputStyle(t)} />
          </Field>

          <Field
            label={`Areas · ${places.size} chosen`}
            hint="Pick as many as the beat covers. Ticking one brings its shops in; unticking it takes only its own back out."
          >
            {allPlaces.length === 0 ? (
              <Note>No shops have an area on file yet.</Note>
            ) : (
              <CustomSelect
                values={[...places]}
                onToggle={toggleArea}
                value=""
                onChange={() => {}}
                options={allPlaces.map(([place, count]) => ({
                  value: place,
                  label: place,
                  sub: `${count} shop${count === 1 ? '' : 's'}`,
                }))}
                placeholder="Choose areas"
              />
            )}
          </Field>

          {places.size > 0 && (
            <Section label={`Shops · ${picked.size} of ${inAreas.length} chosen`}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <ChipGroup
                  value={typeFilter}
                  onChange={setTypeFilter}
                  options={[
                    { id: 'all' as const, label: `All ${inAreas.length}` },
                    { id: 'retailer' as const, label: `Retailers ${inAreas.filter(p => p.type === 'retailer').length}` },
                    { id: 'distributor' as const, label: `Distributors ${inAreas.filter(p => p.type === 'distributor').length}` },
                  ]}
                />

                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search these shops by name"
                  style={inputStyle(t)}
                />

                {/* Fixed height: several areas together run to hundreds of shops,
                    and a list that long buries the save button off the bottom of
                    the page. */}
                <div style={{
                  maxHeight: 340, overflowY: 'auto',
                  border: `0.5px solid ${t.border}`, borderRadius: 6,
                }}>
                  {visible.length === 0 ? (
                    <div style={{ padding: '16px 13px', fontSize: 13, color: t.text3 }}>
                      Nothing matches that.
                    </div>
                  ) : visible.map((p, i) => {
                    const on = picked.has(p.id!)
                    return (
                      <button key={p.id} className="oc-row" onClick={() => toggleShop(p.id!)}
                        aria-pressed={on}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 12, width: '100%',
                          textAlign: 'left', background: 'none', border: 'none',
                          borderTop: i === 0 ? 'none' : `0.5px solid ${t.border}`,
                          padding: '11px 13px', cursor: 'pointer', minHeight: 44,
                        }}>
                        <span style={{
                          width: 18, height: 18, borderRadius: 4, flexShrink: 0,
                          border: `0.5px solid ${on ? t.text2 : t.border2}`,
                          background: on ? t.text2 : 'transparent',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 12, color: t.bg,
                        }}>{on ? '✓' : ''}</span>
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ display: 'block', fontSize: 14, color: t.text }}>{p.name}</span>
                          <span style={{ display: 'block', fontSize: 12, color: t.text3, marginTop: 2 }}>
                            {p.type === 'distributor' ? 'Distributor' : 'Retailer'}
                            {p.place ? ` · ${p.place}` : ''}
                          </span>
                        </span>
                      </button>
                    )
                  })}
                </div>

                {visible.length > 0 && (
                  <div className="oc-wrap" style={{ gap: 10, alignItems: 'baseline' }}>
                    <span style={{ fontSize: 12, color: t.text3 }}>
                      {shownPicked} of the {visible.length} shown
                    </span>
                    <button className="oc-action" onClick={() => setAllVisible(true)}
                      style={{ background: 'none', border: 'none', fontSize: 13, color: t.text2, cursor: 'pointer' }}>
                      Select shown
                    </button>
                    <button className="oc-action" onClick={() => setAllVisible(false)}
                      style={{ background: 'none', border: 'none', fontSize: 13, color: t.text2, cursor: 'pointer' }}>
                      Clear shown
                    </button>
                  </div>
                )}
              </div>
            </Section>
          )}

          <Section label="Targets for a day on this beat">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <Note>
                Both optional — leave them blank and days on this beat simply have nothing
                to hit. Whatever is set here is copied onto each day when the beat is
                assigned and left alone after that, so editing these changes what future
                days aim at, never what past days were measured against.
              </Note>
              <Field label="Shops visited"
                hint="Optional. All visits that day, not only the ones on this beat.">
                <input type="number" inputMode="numeric" value={targetVisits}
                  onChange={e => setTargetVisits(e.target.value)}
                  placeholder={String(picked.size || 12)} style={inputStyle(t)} />
              </Field>
              <Field label="Order value"
                hint="Optional. Rupees of orders raised — raised, not dispatched or paid.">
                <input type="number" inputMode="numeric" value={targetOrderValue}
                  onChange={e => setTargetOrderValue(e.target.value)}
                  placeholder="50000" style={inputStyle(t)} />
              </Field>
            </div>
          </Section>

          {blocked && <Note tone="warn">{blocked}</Note>}

          <div className="oc-wrap" style={{ gap: 10 }}>
            <PrimaryButton onClick={save} disabled={saving}>
              {saving ? 'Saving…' : editing === 'new' ? 'Create beat' : 'Save changes'}
            </PrimaryButton>
            <GhostButton onClick={() => setEditing(null)}>Cancel</GhostButton>
          </div>

          {editing !== 'new' && missing.length > 0 && (
            <Note>
              {missing.length} shop{missing.length > 1 ? 's' : ''} in these areas{' '}
              {missing.length > 1 ? 'are' : 'is'} not on the beat:{' '}
              {missing.slice(0, 8).map(p => p.name).join(', ')}
              {missing.length > 8 ? `, and ${missing.length - 8} more` : ''}. Tick above if they
              should be.
            </Note>
          )}
        </div>
      </div>
    )
  }

  // ── LIST ──────────────────────────────────────────────────────────────────
  const sorted = [...routes].sort((a, b) => a.name.localeCompare(b.name))
  return (
    <div style={{ minHeight: 'var(--oc-screen)', background: t.bg, paddingBottom: 56 }}>
      {modal}
      <PageHeader
        eyebrow="Planner"
        title="Beats"
        subtitle="The areas your team works, and the shops in each."
        onBack={onBack}
      />
      <div style={{ padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 720 }}>
        <div><GhostButton onClick={openNew}>New beat</GhostButton></div>

        {sorted.length === 0 ? (
          <EmptyState
            title="No beats yet"
            body="A beat is the areas a rep works and the shops in them. Build one, then assign it to a day."
          />
        ) : (
          <div style={{ borderBottom: `0.5px solid ${t.border}` }}>
            {sorted.map(r => (
              <div key={r.id} style={{
                display: 'flex', alignItems: 'baseline', gap: 16,
                borderTop: `0.5px solid ${t.border}`, padding: '14px 0',
              }}>
                <button className="oc-action" onClick={() => openEdit(r)}
                  style={{
                    flex: 1, minWidth: 0, textAlign: 'left', background: 'none',
                    border: 'none', padding: 0, cursor: 'pointer',
                  }}>
                  <span style={{ display: 'block', fontSize: 15, fontWeight: 500, color: t.text }}>
                    {r.name}
                  </span>
                  <span style={{ display: 'block', fontSize: 13, color: t.text3, marginTop: 3 }}>
                    {routePlaces(r).join(', ') || 'No area'} · {(r.outletIds || []).length} shops
                    {r.defaultTargets?.visits ? ` · target ${r.defaultTargets.visits} visits` : ''}
                  </span>
                </button>
                <button className="oc-action" onClick={() => remove(r)}
                  style={{
                    background: 'none', border: 'none', fontSize: 13,
                    color: t.text3, cursor: 'pointer',
                  }}>
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
