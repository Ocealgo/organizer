import { useState, useEffect } from 'react'
import { collection, addDoc, onSnapshot, query, where, updateDoc, doc } from 'firebase/firestore'
import { db } from '../../firebase'
import {
  AppUser, DutySession, OutletVisit, Party, Product, GeoPoint,
  OutletType, OUTLET_TYPE_LABEL,
  VisitOutcomeCategory, VISIT_OUTCOME_LABEL, VISIT_OUTCOME_REASONS,
  NO_ORDER_CATEGORIES, MIN_REMARKS_LENGTH, validateVisitForPunchOut,
  CompetitorObservation, OutletStockLine,
} from '../../types'
import { useTheme } from '../../context/ThemeContext'
import CustomSelect from '../../components/CustomSelect'
import { PageHeader, Eyebrow, GhostButton, PrimaryButton, EmptyState, inputStyle } from '../../components/ui'
import { getFix, checkGeofence, distanceM, LocationError, DEFAULT_GEOFENCE_RADIUS_M } from '../../device/location'
import { localDateStr } from '../../utils/date'

interface Props {
  appUser: AppUser
  session: DutySession
  onBack: () => void
}

/** Which extra fields each channel makes mandatory (spec §3.2). */
function requiredFor(outletType: OutletType): string[] {
  switch (outletType) {
    case 'distributor': return ['creditLimitChecked']
    case 'pharmacy': return ['counterPresence']
    case 'cosmetics': return ['customerFeedback']
    case 'hospital': return ['contactPersonName']
    default: return []
  }
}

export default function OutletVisitScreen({ appUser, session, onBack }: Props) {
  const { t } = useTheme()

  const [parties, setParties] = useState<Party[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [visit, setVisit] = useState<OutletVisit | null>(null)
  const [loading, setLoading] = useState(true)

  // punch-in
  const [search, setSearch] = useState('')
  const [fix, setFix] = useState<GeoPoint | null>(null)
  const [fixError, setFixError] = useState<string | null>(null)
  const [locating, setLocating] = useState(false)
  const [pending, setPending] = useState<Party | null>(null)
  const [overrideReason, setOverrideReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // visit form
  const [stock, setStock] = useState<Record<string, string>>({})
  const [competitors, setCompetitors] = useState<CompetitorObservation[]>([])
  const [orderPlaced, setOrderPlaced] = useState(false)
  const [orderProductId, setOrderProductId] = useState('')
  const [orderQty, setOrderQty] = useState('')
  const [extra, setExtra] = useState<Record<string, any>>({})
  const [category, setCategory] = useState<VisitOutcomeCategory | ''>('')
  const [reason, setReason] = useState('')
  const [remarks, setRemarks] = useState('')

  useEffect(() => {
    const u1 = onSnapshot(collection(db, 'parties'), s =>
      setParties(s.docs.map(d => ({ id: d.id, ...d.data() } as Party))))
    const u2 = onSnapshot(collection(db, 'products'), s =>
      setProducts(s.docs.map(d => ({ id: d.id, ...d.data() } as Product)).filter(p => p.active)))
    return () => { u1(); u2() }
  }, [])

  // Resume an open visit if the app was closed mid-visit.
  useEffect(() => {
    if (!session.id) return
    const q = query(
      collection(db, 'outlet_visits'),
      where('sessionId', '==', session.id),
      where('status', '==', 'open'),
    )
    return onSnapshot(q, snap => {
      const d = snap.docs[0]
      setVisit(d ? ({ id: d.id, ...d.data() } as OutletVisit) : null)
      setLoading(false)
    }, err => { console.error('[OutletVisit] listener failed', err); setLoading(false) })
  }, [session.id])

  useEffect(() => { if (!visit) void locate() }, [visit])

  async function locate() {
    setLocating(true); setFixError(null)
    try { setFix(await getFix({ capturedBy: appUser.uid })) }
    catch (e) {
      setFix(null)
      setFixError(e instanceof LocationError ? e.message : 'Could not get your location.')
    } finally { setLocating(false) }
  }

  // ── punch in ──────────────────────────────────────────────────────────────
  async function punchIn(party: Party, override?: string) {
    if (!fix || !session.id) return
    setBusy(true); setError(null)
    try {
      const geo = checkGeofence(fix, party.coordinates ?? null)
      const payload: Omit<OutletVisit, 'id'> = {
        sessionId: session.id,
        uid: appUser.uid,
        name: appUser.name,
        date: localDateStr(),
        partyId: party.id!,
        partyName: party.name,
        outletType: party.outletType ?? 'general',
        punchInAt: Date.now(),
        punchInLocation: fix,
        ...(geo.distanceM !== null ? { distanceFromOutletM: geo.distanceM, withinGeofence: geo.within } : {}),
        ...(override ? { geoOverrideReason: override } : {}),
        stock: [],
        competitors: [],
        photos: [],
        orderPlaced: false,
        status: 'open',
        createdAt: Date.now(),
      }
      await addDoc(collection(db, 'outlet_visits'), payload)
      setPending(null); setOverrideReason('')
      // An outlet with no registered position gets one from the first visit.
      if (!party.coordinates) {
        await updateDoc(doc(db, 'parties', party.id!), { coordinates: fix })
      }
    } catch (e: any) {
      console.error('[OutletVisit] punch-in failed', e)
      setError(e?.message || 'Could not start the visit.')
    } finally { setBusy(false) }
  }

  // ── punch out ─────────────────────────────────────────────────────────────
  const draft: Partial<OutletVisit> = {
    remarksCategory: category || undefined,
    remarksReason: reason || undefined,
    remarksText: remarks,
  }
  const remarksProblem = validateVisitForPunchOut(draft)

  const missingCategoryField = visit
    ? requiredFor(visit.outletType).find(k =>
        extra[k] === undefined || extra[k] === '' || extra[k] === null)
    : undefined

  const FIELD_LABEL: Record<string, string> = {
    creditLimitChecked: 'Confirm you checked their credit limit',
    counterPresence: 'Record whether our wipes are on the counter',
    customerFeedback: 'Enter the customer feedback',
    contactPersonName: 'Enter the contact person',
  }

  const punchOutBlocker = missingCategoryField
    ? FIELD_LABEL[missingCategoryField]
    : remarksProblem

  async function punchOut() {
    if (!visit?.id || punchOutBlocker) return
    setBusy(true); setError(null)
    try {
      let outFix: GeoPoint | null = null
      try { outFix = await getFix({ capturedBy: appUser.uid }) } catch { /* not worth blocking on */ }

      const stockLines: OutletStockLine[] = Object.entries(stock)
        .filter(([, v]) => v !== '' && !isNaN(parseInt(v)))
        .map(([productId, v]) => ({
          productId,
          productName: products.find(p => p.id === productId)?.name ?? productId,
          qtyOnShelf: parseInt(v),
        }))

      // Book the order first — if this fails the visit stays open and retryable.
      let allocationId: string | undefined
      if (orderPlaced && orderProductId && parseInt(orderQty) > 0) {
        allocationId = await bookOrder(visit)
      }

      await updateDoc(doc(db, 'outlet_visits', visit.id), {
        stock: stockLines,
        competitors,
        orderPlaced,
        ...(allocationId ? { allocationId } : {}),
        ...extra,
        remarksCategory: category,
        ...(reason ? { remarksReason: reason } : {}),
        remarksText: remarks.trim(),
        punchOutAt: Date.now(),
        ...(outFix ? { punchOutLocation: outFix } : {}),
        durationMinutes: Math.max(1, Math.round((Date.now() - visit.punchInAt) / 60000)),
        status: 'closed',
      })
      resetForm()
    } catch (e: any) {
      console.error('[OutletVisit] punch-out failed', e)
      setError(e?.message || 'Could not close the visit.')
    } finally { setBusy(false) }
  }

  async function bookOrder(v: OutletVisit): Promise<string> {
    const party = parties.find(p => p.id === v.partyId)!
    const product = products.find(p => p.id === orderProductId)!
    const qty = parseInt(orderQty)
    const underDist = (party as any).underDistributorId as string | undefined
    const price = underDist ? 0 : product.defaultPricePerUnit
    const planned = localDateStr()
    const ref = await addDoc(collection(db, 'allocations_v2'), {
      fromType: underDist ? 'distributor' : 'company',
      fromId: underDist ?? 'company',
      fromName: underDist ? ((party as any).underDistributorName ?? '') : 'Ocealgo',
      partyId: party.id!, partyName: party.name, partyType: party.type,
      productId: product.id!, productName: product.name,
      packets: qty, cartons: Math.floor(qty / (product.unitsPerCarton || 1)),
      pricePerPacket: price, totalAmount: qty * price,
      paymentType: 'credit', plannedDate: planned,
      status: 'pending', notes: `Booked during outlet visit`,
      createdBy: appUser.uid, createdByName: appUser.name,
      createdAt: Date.now(), month: planned.slice(0, 7),
      lockedAtCreation: !underDist,
    })
    await updateDoc(doc(db, 'parties', party.id!), { status: 'active' })
    return ref.id
  }

  function resetForm() {
    setStock({}); setCompetitors([]); setOrderPlaced(false)
    setOrderProductId(''); setOrderQty(''); setExtra({})
    setCategory(''); setReason(''); setRemarks('')
  }

  // ─────────────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: t.bg }}>
        <PageHeader eyebrow="Visit" title="Outlets" onBack={onBack} />
        <div style={{ padding: '24px 20px', color: t.text3, fontSize: 14 }}>Loading…</div>
      </div>
    )
  }

  // ── PICK AN OUTLET ────────────────────────────────────────────────────────
  if (!visit) {
    const list = parties
      .filter(p => !search.trim() ||
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        (p.place ?? '').toLowerCase().includes(search.toLowerCase()))
      .map(p => ({
        party: p,
        d: fix && p.coordinates ? Math.round(distanceM(fix, p.coordinates)) : null,
      }))
      .sort((a, b) => (a.d ?? 1e9) - (b.d ?? 1e9))
      .slice(0, 40)

    return (
      <div style={{ minHeight: '100vh', background: t.bg, paddingBottom: 56 }}>
        <PageHeader eyebrow="Visit" title="Which outlet?" onBack={onBack}
          subtitle={locating ? 'Finding your location…'
            : fix ? `Sorted by distance from you, accurate to about ${Math.round(fix.accuracy)} m.`
            : fixError ?? undefined} />

        <div style={{ padding: '20px 20px 0' }}>
          {!fix && !locating && (
            <div style={{ marginBottom: 16 }}><GhostButton onClick={locate}>Try location again</GhostButton></div>
          )}
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or place" style={inputStyle(t)} />
        </div>

        {error && <div style={{ padding: '12px 20px 0', fontSize: 13, color: t.warn }}>{error}</div>}

        <div style={{ padding: '20px 20px 0' }}>
          {list.length === 0 ? (
            <EmptyState title="No outlets found" body="Try a different search, or add the outlet from your network first." />
          ) : (
            <div className="oc-list-flush" style={{ borderBottom: `0.5px solid ${t.border}` }}>
              {list.map(({ party, d }) => {
                const far = d !== null && d > DEFAULT_GEOFENCE_RADIUS_M
                return (
                  <button key={party.id} className="oc-row" onClick={() => setPending(party)}
                    style={{ display: 'flex', alignItems: 'baseline', gap: 16, width: '100%', textAlign: 'left',
                             background: 'none', border: 'none', borderTop: `0.5px solid ${t.border}`,
                             padding: '15px 10px', cursor: 'pointer' }}>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 15, fontWeight: 500, color: t.text }}>{party.name}</span>
                      <span style={{ display: 'block', fontSize: 13, color: t.text3, marginTop: 3 }}>
                        {OUTLET_TYPE_LABEL[party.outletType ?? 'general']}{party.place ? ` · ${party.place}` : ''}
                      </span>
                    </span>
                    <span style={{ fontSize: 13, color: far ? t.warn : t.text2, whiteSpace: 'nowrap' }}>
                      {d === null ? 'No location' : d < 1000 ? `${d} m` : `${(d / 1000).toFixed(1)} km`}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Geofence confirmation */}
        {pending && (() => {
          const geo = checkGeofence(fix!, pending.coordinates ?? null)
          const needsOverride = geo.distanceM !== null && !geo.within
          return (
            <div style={{ position: 'fixed', inset: 0, zIndex: 2000, display: 'flex', alignItems: 'flex-end' }}>
              <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)' }}
                onClick={() => { setPending(null); setOverrideReason('') }} />
              <div style={{ position: 'relative', zIndex: 1, width: '100%', background: t.bg2,
                            borderTop: `0.5px solid ${t.border}`, padding: '24px 20px 32px' }}>
                <div style={{ fontSize: 17, fontWeight: 500, color: t.text, marginBottom: 6 }}>{pending.name}</div>
                <div style={{ fontSize: 14, color: t.text3, lineHeight: 1.6, marginBottom: 18 }}>
                  {geo.distanceM === null
                    ? 'This outlet has no registered position yet. Punching in here will set it from where you are standing.'
                    : needsOverride
                      ? `You are about ${geo.distanceM} m away, outside the ${geo.radiusM} m limit. Say why before punching in.`
                      : `You are about ${geo.distanceM} m away. Inside the limit.`}
                </div>

                {needsOverride && (
                  <textarea value={overrideReason} onChange={e => setOverrideReason(e.target.value)}
                    rows={2} placeholder="Why are you punching in from here?"
                    style={{ ...inputStyle(t), resize: 'none', marginBottom: 16 }} />
                )}

                <div style={{ display: 'flex', gap: 10 }}>
                  <GhostButton onClick={() => { setPending(null); setOverrideReason('') }} style={{ flex: 1 }}>
                    Cancel
                  </GhostButton>
                  <PrimaryButton
                    onClick={() => punchIn(pending, needsOverride ? overrideReason.trim() : undefined)}
                    disabled={busy || (needsOverride && overrideReason.trim().length < 5)}
                    style={{ flex: 2 }}>
                    {busy ? 'Starting…' : 'Punch in'}
                  </PrimaryButton>
                </div>
              </div>
            </div>
          )
        })()}
      </div>
    )
  }

  // ── AN OPEN VISIT ─────────────────────────────────────────────────────────
  const reasons = category ? VISIT_OUTCOME_REASONS[category] : []
  const needsReason = category ? NO_ORDER_CATEGORIES.includes(category) : false

  return (
    <div style={{ minHeight: '100vh', background: t.bg, paddingBottom: 56 }}>
      <PageHeader
        eyebrow={OUTLET_TYPE_LABEL[visit.outletType]}
        title={visit.partyName}
        onBack={onBack}
        subtitle={`Punched in at ${new Date(visit.punchInAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}${
          visit.distanceFromOutletM !== undefined ? ` · ${visit.distanceFromOutletM} m away` : ''}${
          visit.geoOverrideReason ? ' · outside the limit' : ''}`}
      />

      <div style={{ padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: 28 }}>

        {/* Stock audit */}
        <div>
          <div style={{ marginBottom: 10 }}><Eyebrow>What is on their shelf</Eyebrow></div>
          {products.length === 0 ? (
            <div style={{ fontSize: 14, color: t.text3 }}>No products configured.</div>
          ) : (
            <div className="oc-list-flush" style={{ borderBottom: `0.5px solid ${t.border}` }}>
              {products.map(p => (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 14,
                                          borderTop: `0.5px solid ${t.border}`, padding: '12px 0' }}>
                  <span style={{ flex: 1, fontSize: 14, color: t.text }}>{p.name}</span>
                  <input type="number" inputMode="numeric"
                    value={stock[p.id!] ?? ''} onChange={e => setStock({ ...stock, [p.id!]: e.target.value })}
                    placeholder="0" style={{ ...inputStyle(t), width: 92, textAlign: 'right' }} />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Competitors */}
        <div>
          <div style={{ marginBottom: 10 }}><Eyebrow>Competitor brands seen</Eyebrow></div>
          {competitors.map((c, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <input value={c.brand} placeholder="Brand"
                onChange={e => setCompetitors(competitors.map((x, j) => j === i ? { ...x, brand: e.target.value } : x))}
                style={{ ...inputStyle(t), flex: 2 }} />
              <input type="number" inputMode="decimal" value={c.pricePerPack ?? ''} placeholder="₹/pack"
                onChange={e => setCompetitors(competitors.map((x, j) => j === i
                  ? { ...x, pricePerPack: e.target.value === '' ? undefined : parseFloat(e.target.value) } : x))}
                style={{ ...inputStyle(t), flex: 1 }} />
              <GhostButton onClick={() => setCompetitors(competitors.filter((_, j) => j !== i))}>Remove</GhostButton>
            </div>
          ))}
          <GhostButton onClick={() => setCompetitors([...competitors, { brand: '', present: true }])}>
            Add a competitor
          </GhostButton>
        </div>

        {/* Category-specific */}
        {requiredFor(visit.outletType).length > 0 && (
          <div>
            <div style={{ marginBottom: 10 }}><Eyebrow>Required for this channel</Eyebrow></div>
            {visit.outletType === 'distributor' && (
              <ToggleRow label="Credit limit checked" value={!!extra.creditLimitChecked}
                onChange={v => setExtra({ ...extra, creditLimitChecked: v })} />
            )}
            {visit.outletType === 'pharmacy' && (
              <ToggleRow label="Our wipes are on the counter" value={!!extra.counterPresence}
                onChange={v => setExtra({ ...extra, counterPresence: v })} />
            )}
            {visit.outletType === 'cosmetics' && (
              <textarea rows={2} value={extra.customerFeedback ?? ''} placeholder="What did the shop say?"
                onChange={e => setExtra({ ...extra, customerFeedback: e.target.value })}
                style={{ ...inputStyle(t), resize: 'none' }} />
            )}
            {visit.outletType === 'hospital' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <input value={extra.contactPersonName ?? ''} placeholder="Contact person"
                  onChange={e => setExtra({ ...extra, contactPersonName: e.target.value })} style={inputStyle(t)} />
                <input value={extra.sampleLogNote ?? ''} placeholder="Samples left (optional)"
                  onChange={e => setExtra({ ...extra, sampleLogNote: e.target.value })} style={inputStyle(t)} />
              </div>
            )}
          </div>
        )}

        {/* Order */}
        <div>
          <div style={{ marginBottom: 10 }}><Eyebrow>Did they order?</Eyebrow></div>
          <ToggleRow label="Book an order" value={orderPlaced} onChange={setOrderPlaced} />
          {orderPlaced && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
              <CustomSelect value={orderProductId} onChange={setOrderProductId} placeholder="Which product"
                options={products.map(p => ({ value: p.id!, label: p.name }))} />
              <input type="number" inputMode="numeric" value={orderQty} placeholder="Quantity"
                onChange={e => setOrderQty(e.target.value)} style={inputStyle(t)} />
            </div>
          )}
        </div>

        {/* Compulsory remarks */}
        <div>
          <div style={{ marginBottom: 10 }}><Eyebrow>Visit outcome — required</Eyebrow></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <CustomSelect
              value={category}
              onChange={v => { setCategory(v as VisitOutcomeCategory); setReason('') }}
              placeholder="Select the outcome"
              options={(Object.keys(VISIT_OUTCOME_LABEL) as VisitOutcomeCategory[])
                .map(k => ({ value: k, label: VISIT_OUTCOME_LABEL[k] }))}
            />
            {category && (
              <CustomSelect value={reason} onChange={setReason}
                placeholder={needsReason ? 'Select the reason — required' : 'Select the reason (optional)'}
                options={reasons.map(r => ({ value: r, label: r }))} />
            )}
            <textarea rows={3} value={remarks} onChange={e => setRemarks(e.target.value)}
              placeholder="What was said? At least 15 characters."
              style={{ ...inputStyle(t), resize: 'none', lineHeight: 1.6 }} />
            <div style={{ fontSize: 12, color: remarks.trim().length >= MIN_REMARKS_LENGTH ? t.text3 : t.warn }}>
              {remarks.trim().length} of {MIN_REMARKS_LENGTH} characters
            </div>
          </div>
        </div>

        {/* Punch out */}
        <div>
          <PrimaryButton onClick={punchOut} disabled={!!punchOutBlocker || busy} style={{ width: '100%' }}>
            {busy ? 'Closing…' : 'Punch out of this outlet'}
          </PrimaryButton>
          {punchOutBlocker && !busy && (
            <div style={{ fontSize: 13, color: t.warn, marginTop: 10, lineHeight: 1.6 }}>{punchOutBlocker}</div>
          )}
          {error && <div style={{ fontSize: 13, color: t.warn, marginTop: 10 }}>{error}</div>}
        </div>
      </div>
    </div>
  )
}

function ToggleRow({ label, value, onChange }: {
  label: string; value: boolean; onChange: (v: boolean) => void
}) {
  const { t } = useTheme()
  return (
    <button className="oc-row" onClick={() => onChange(!value)} aria-pressed={value}
      style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left',
               background: 'none', border: 'none', borderTop: `0.5px solid ${t.border}`,
               borderBottom: `0.5px solid ${t.border}`, padding: '13px 4px', cursor: 'pointer' }}>
      <span style={{ width: 30, height: 18, borderRadius: 99, flexShrink: 0, position: 'relative',
                     background: value ? t.text2 : 'transparent',
                     border: `0.5px solid ${value ? t.text2 : t.border2}` }}>
        <span style={{ position: 'absolute', top: 2, left: value ? 13 : 2, width: 12, height: 12,
                       borderRadius: '50%', background: value ? t.bg : t.text3 }} />
      </span>
      <span style={{ fontSize: 14, color: value ? t.text : t.text3 }}>{label}</span>
    </button>
  )
}
