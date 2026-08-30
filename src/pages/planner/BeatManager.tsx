import { useState, useEffect, useMemo } from 'react'
import { collection, addDoc, updateDoc, doc, deleteDoc } from 'firebase/firestore'
import { onSnapshot } from '../../data/live'
import { db } from '../../firebase'
import { Party, SalesRoute } from '../../types'
import { useAuth } from '../../context/AuthContext'
import { useTheme } from '../../context/ThemeContext'
import { useConfirm } from '../../hooks/useConfirm'
import CustomSelect from '../../components/CustomSelect'
import {
  PageHeader, Section, EmptyState, Field, Note,
  GhostButton, PrimaryButton, inputStyle,
} from '../../components/ui'

interface Props { onBack: () => void }

/**
 * Beats — a named area and the shops in it.
 *
 * A beat is an area before it is a list. Picking the place seeds the shops and
 * the manager trims from there: the stored list stays explicit, so nothing
 * shifts under them, but the screen can still notice when a shop turns up in
 * that area later and offer it. A frozen list of ids assumes the world is
 * already in the database, and reps add shops all week.
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
  const [place, setPlace] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
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

  /** Every distinct place on a party record — the areas a beat can cover. */
  const places = useMemo(() => {
    const set = new Set<string>()
    parties.forEach(p => { if (p.place?.trim()) set.add(p.place.trim()) })
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [parties])

  const inPlace = useMemo(
    () => parties.filter(p => (p.place || '').trim().toLowerCase() === place.trim().toLowerCase()),
    [parties, place],
  )

  const openNew = () => {
    setEditing('new'); setName(''); setPlace('')
    setPicked(new Set()); setTargetVisits(''); setTargetOrderValue('')
    setBlocked(null)
  }

  const openEdit = (r: SalesRoute) => {
    setEditing(r); setName(r.name); setPlace(r.place || '')
    setPicked(new Set(r.outletIds || []))
    setTargetVisits(r.defaultTargets?.visits?.toString() ?? '')
    setTargetOrderValue(r.defaultTargets?.orderValue?.toString() ?? '')
    setBlocked(null)
  }

  /** Choosing a place offers everything in it; the manager takes things out. */
  const choosePlace = (v: string) => {
    setPlace(v)
    setPicked(new Set(
      parties
        .filter(p => (p.place || '').trim().toLowerCase() === v.trim().toLowerCase())
        .map(p => p.id!),
    ))
  }

  const toggle = (id: string) =>
    setPicked(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  const save = async () => {
    // Echoed at the button rather than thrown away. A save that quietly does
    // nothing is the most confusing thing a form can do.
    if (!name.trim()) { setBlocked('Give the beat a name.'); return }
    if (!place.trim()) { setBlocked('Pick the area it covers.'); return }
    if (picked.size === 0) { setBlocked('A beat with no shops cannot be assigned.'); return }
    setBlocked(null); setSaving(true)
    try {
      const targets = {
        ...(targetVisits.trim() ? { visits: Number(targetVisits) } : {}),
        ...(targetOrderValue.trim() ? { orderValue: Number(targetOrderValue) } : {}),
      }
      const payload = {
        name: name.trim(),
        place: place.trim(),
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
    // Shops that turned up in this area after the beat was built.
    const missing = inPlace.filter(p => !picked.has(p.id!))
    return (
      <div style={{ minHeight: 'var(--oc-screen)', background: t.bg, paddingBottom: 56 }}>
        {modal}
        <PageHeader
          eyebrow="Planner"
          title={editing === 'new' ? 'New beat' : editing.name}
          subtitle="An area, and the shops in it."
          onBack={() => setEditing(null)}
        />
        <div style={{ padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 560 }}>
          <Field label="Name">
            <input value={name} onChange={e => setName(e.target.value)}
              placeholder="Kozhikode North" style={inputStyle(t)} />
          </Field>

          <Field label="Area" hint="Shops here are offered automatically. Take out anything that does not belong.">
            <CustomSelect
              value={place}
              onChange={choosePlace}
              options={places.map(p => ({
                value: p,
                label: p,
                sub: `${parties.filter(x => (x.place || '').trim() === p).length} shops`,
              }))}
              placeholder="Choose an area"
            />
          </Field>

          {place && (
            <Section label={`Shops · ${picked.size} of ${inPlace.length} in ${place}`}>
              {inPlace.length === 0 ? (
                <Note>No shops are registered in {place} yet.</Note>
              ) : (
                <div style={{ borderBottom: `0.5px solid ${t.border}` }}>
                  {inPlace.map(p => (
                    <button key={p.id} className="oc-row" onClick={() => toggle(p.id!)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 12, width: '100%',
                        textAlign: 'left', background: 'none', border: 'none',
                        borderTop: `0.5px solid ${t.border}`, padding: '13px 4px',
                        cursor: 'pointer', minHeight: 44,
                      }}>
                      <span style={{
                        width: 18, height: 18, borderRadius: 4, flexShrink: 0,
                        border: `0.5px solid ${picked.has(p.id!) ? t.text2 : t.border2}`,
                        background: picked.has(p.id!) ? t.text2 : 'transparent',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 12, color: t.bg,
                      }}>{picked.has(p.id!) ? '✓' : ''}</span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: 'block', fontSize: 14, color: t.text }}>{p.name}</span>
                        <span style={{ display: 'block', fontSize: 12, color: t.text3, marginTop: 2 }}>
                          {p.type === 'distributor' ? 'Distributor' : 'Retailer'}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </Section>
          )}

          <Section label="Targets for a day on this beat">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <Note>
                Copied onto each day when the beat is assigned, and left alone after that.
                Editing them later changes what future days aim at, never what past days
                were measured against.
              </Note>
              <Field label="Shops visited" hint="All visits that day, not only the ones on this beat.">
                <input type="number" inputMode="numeric" value={targetVisits}
                  onChange={e => setTargetVisits(e.target.value)}
                  placeholder={String(picked.size || 12)} style={inputStyle(t)} />
              </Field>
              <Field label="Order value" hint="Rupees of orders raised. Raised, not dispatched or paid.">
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
              {missing.length} shop{missing.length > 1 ? 's' : ''} in {place}{' '}
              {missing.length > 1 ? 'are' : 'is'} not on this beat:{' '}
              {missing.map(p => p.name).join(', ')}. Tick {missing.length > 1 ? 'them' : 'it'} above
              if {missing.length > 1 ? 'they' : 'it'} should be.
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
            body="A beat is an area and the shops in it. Build one, then assign it to a day."
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
                    {r.place} · {(r.outletIds || []).length} shops
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
