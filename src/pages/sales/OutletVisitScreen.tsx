import { useState, useEffect } from 'react'
import { collection, addDoc, query, where, updateDoc, doc } from 'firebase/firestore'
import { onSnapshot } from '../../data/live'
import { db } from '../../firebase'
import {
  AppUser, DutySession, OutletVisit, Party, Product, GeoPoint, LocationIssue, PaymentType,
  OutletType, OUTLET_TYPE_LABEL,
  VisitOutcomeCategory, VISIT_OUTCOME_LABEL, VISIT_OUTCOME_REASONS,
  NO_ORDER_CATEGORIES, SUGGESTED_REMARKS_LENGTH, validateVisitForPunchOut,
  CompetitorObservation, OutletStockLine,
} from '../../types'
import { useTheme } from '../../context/ThemeContext'
import CustomSelect from '../../components/CustomSelect'
import DateInput from '../../components/DateInput'
import QuickAddParty from '../../components/QuickAddParty'
import { PageHeader, Eyebrow, ChipGroup, GhostButton, PrimaryButton, EmptyState, inputStyle } from '../../components/ui'
import { getFixOrReason, checkGeofence, distanceM, DEFAULT_GEOFENCE_RADIUS_M } from '../../device/location'
import { setPartyPin, accurateEnoughForPin } from '../../data/partyPin'
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
  const [fixIssue, setFixIssue] = useState<LocationIssue | null>(null)
  const [fixError, setFixError] = useState<string | null>(null)
  const [locating, setLocating] = useState(false)
  const [pending, setPending] = useState<Party | null>(null)
  // A shop that is not on the list yet is added from here rather than sending
  // the rep back out to Network mid-round.
  const [adding, setAdding] = useState(false)
  const [overrideReason, setOverrideReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // visit form
  const [stock, setStock] = useState<Record<string, string>>({})
  const [competitors, setCompetitors] = useState<CompetitorObservation[]>([])
  const [orderPlaced, setOrderPlaced] = useState(false)
  const [orderProductId, setOrderProductId] = useState('')
  const [orderQty, setOrderQty] = useState('')
  /**
   * Who is supplying this order — '' meaning Ocealgo itself.
   *
   * It used to be worked out silently from the retailer's linked distributor
   * and never shown, so a shop with no distributor on file booked against the
   * company whether or not that was true, a shop served by a second
   * distributor booked against the wrong one, and the rep standing in the
   * shop had no way to say otherwise. It defaults to the link, because that is
   * usually right, and it is a question rather than an assumption.
   */
  const [orderSourceId, setOrderSourceId] = useState('')
  const [orderUnit, setOrderUnit] = useState<'packets' | 'cartons'>('packets')
  const [orderPrice, setOrderPrice] = useState('')
  const [orderPayment, setOrderPayment] = useState<PaymentType>('credit')
  const [orderDate, setOrderDate] = useState(localDateStr())
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
    // uid is not redundant with sessionId. The read rule is written as
    // `resource.data.uid == request.auth.uid`, and Firestore secures a list by
    // the shape of the query, not per document — so without this filter the
    // whole listener is denied and the officer punches in to a screen that
    // silently drops them back on the outlet picker.
    const q = query(
      collection(db, 'outlet_visits'),
      where('uid', '==', appUser.uid),
      where('sessionId', '==', session.id),
      where('status', '==', 'open'),
    )
    return onSnapshot(q, snap => {
      const d = snap.docs[0]
      setVisit(d ? ({ id: d.id, ...d.data() } as OutletVisit) : null)
      setLoading(false)
    }, err => { console.error('[OutletVisit] listener failed', err); setLoading(false) })
  }, [session.id, appUser.uid])

  useEffect(() => { if (!visit) void locate() }, [visit])

  async function locate() {
    setLocating(true); setFixError(null)
    const { fix: f, issue } = await getFixOrReason({ capturedBy: appUser.uid })
    setFix(f)
    setFixIssue(issue)
    // Denial is the one the officer can do something about, so it is the one
    // that gets told apart from "the sky is not co-operating".
    if (!f) setFixError(issue === 'denied'
      ? 'Location is switched off for Ocealgo. Visits will be recorded without one, and will say so. Turn it on in your phone’s Settings → Apps → Ocealgo → Permissions → Location.'
      : issue === 'timeout'
        ? 'No location came back in time — visits will be recorded without one.'
        : issue === 'inaccurate'
          ? 'The position was too vague to keep — visits will be recorded without one.'
          : 'No location available — visits will be recorded without one.')
    setLocating(false)
  }

  // ── punch in ──────────────────────────────────────────────────────────────
  // Location is recorded when we have it. It never stops a visit going ahead.
  async function punchIn(party: Party) {
    if (!session.id) return
    setBusy(true); setError(null)
    try {
      const geo = fix ? checkGeofence(fix, party.coordinates ?? null) : null
      const payload: Omit<OutletVisit, 'id'> = {
        sessionId: session.id,
        uid: appUser.uid,
        name: appUser.name,
        // Who was standing there, recorded at the time rather than looked up
        // later. Managers cover outlets too, and a report that counts visits
        // has to be able to separate territory coverage from supervision
        // without joining back to a users collection it may not read.
        role: appUser.role,
        date: localDateStr(),
        partyId: party.id!,
        partyName: party.name,
        outletType: party.outletType ?? 'general',
        punchInAt: Date.now(),
        ...(fix ? { punchInLocation: fix } : fixIssue ? { punchInLocationIssue: fixIssue } : {}),
        ...(geo && geo.distanceM !== null
          ? { distanceFromOutletM: geo.distanceM, withinGeofence: geo.within }
          : {}),
        stock: [],
        competitors: [],
        photos: [],
        orderPlaced: false,
        status: 'open',
        createdAt: Date.now(),
      }
      await addDoc(collection(db, 'outlet_visits'), payload)
      setPending(null)
      // An outlet with no registered position gets one from the first visit —
      // but only from a fix sharp enough to define one. A vague fix is still
      // kept against the visit, where "somewhere in this circle" is useful;
      // what it must not become is the point every later visit at this shop is
      // measured against for the rest of the shop's life.
      if (fix && !party.coordinates && accurateEnoughForPin(fix)) {
        await setPartyPin(party, fix, 'first_visit', appUser)
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

  // ── the order, if there is one ────────────────────────────────────────────
  const visitedParty = visit ? parties.find(p => p.id === visit.partyId) ?? null : null
  /** Everyone who could supply this shop — never the shop itself. */
  const suppliers = parties.filter(p => p.type === 'distributor' && p.id !== visit?.partyId)
  const orderSource = orderSourceId ? suppliers.find(p => p.id === orderSourceId) ?? null : null
  const orderProduct = products.find(p => p.id === orderProductId) ?? null

  const rawQty = parseInt(orderQty)
  const orderPackets = !isNaN(rawQty) && orderProduct
    ? (orderUnit === 'cartons' ? rawQty * (orderProduct.unitsPerCarton || 1) : rawQty)
    : NaN

  /**
   * An order half filled in must not be silently dropped on punch-out.
   *
   * The switch used to be the only thing consulted — the write was guarded on
   * `orderPlaced && orderProductId && qty > 0`, so a rep who flipped it on and
   * then missed the quantity punched out with `orderPlaced: true` recorded
   * against the visit and no order booked anywhere. It now blocks the
   * punch-out and says which part is missing.
   */
  const orderProblem = !orderPlaced ? null
    : !orderProductId ? 'Choose which product they ordered.'
    : isNaN(orderPackets) || orderPackets <= 0 ? 'Enter how much they ordered.'
    : null

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

  const punchOutBlocker = orderProblem
    ?? (missingCategoryField ? FIELD_LABEL[missingCategoryField] : remarksProblem)

  async function punchOut() {
    if (!visit?.id || punchOutBlocker) return
    setBusy(true); setError(null)
    try {
      const { fix: outFix, issue: outIssue } = await getFixOrReason({ capturedBy: appUser.uid })

      const stockLines: OutletStockLine[] = Object.entries(stock)
        .filter(([, v]) => v !== '' && !isNaN(parseInt(v)))
        .map(([productId, v]) => ({
          productId,
          productName: products.find(p => p.id === productId)?.name ?? productId,
          qtyOnShelf: parseInt(v),
        }))

      // Book the order first — if this fails the visit stays open and retryable.
      let allocationId: string | undefined
      if (orderPlaced) {
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
        ...(outFix ? { punchOutLocation: outFix } : outIssue ? { punchOutLocationIssue: outIssue } : {}),
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
    const qty = orderPackets
    const source = orderSource

    /**
     * Stock moving from a distributor to their own retailer is not the
     * company's sale, so the company does not price it, does not put it on
     * anybody's credit and does not schedule it — the same shape the revisit
     * order flow has always written. Ocealgo's own supply is priced, dated and
     * booked to cash or credit, and locks company stock at creation.
     */
    const planned = source ? localDateStr() : orderDate
    const price = source ? 0 : (parseFloat(orderPrice) || product.defaultPricePerUnit)

    const ref = await addDoc(collection(db, 'allocations_v2'), {
      fromType: source ? 'distributor' : 'company',
      fromId: source?.id ?? 'company',
      fromName: source?.name ?? 'Ocealgo',
      partyId: party.id!, partyName: party.name, partyType: party.type,
      productId: product.id!, productName: product.name,
      packets: qty, cartons: Math.floor(qty / (product.unitsPerCarton || 1)),
      pricePerPacket: price, totalAmount: qty * price,
      paymentType: source ? 'cash' : orderPayment,
      plannedDate: planned,
      status: 'pending', notes: 'Booked during outlet visit',
      createdBy: appUser.uid, createdByName: appUser.name,
      createdAt: Date.now(), month: planned.slice(0, 7),
      lockedAtCreation: !source,
    })
    await updateDoc(doc(db, 'parties', party.id!), { status: 'active' })
    return ref.id
  }

  function resetForm() {
    setStock({}); setCompetitors([]); setOrderPlaced(false)
    setOrderProductId(''); setOrderQty(''); setExtra({})
    setOrderSourceId(''); setOrderUnit('packets'); setOrderPrice('')
    setOrderPayment('credit'); setOrderDate(localDateStr())
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

  // ── ADD AN OUTLET ─────────────────────────────────────────────────────────
  if (!visit && adding) {
    return (
      <div style={{ minHeight: '100vh', background: t.bg, paddingBottom: 56 }}>
        <PageHeader eyebrow="Visit" title="Add an outlet" onBack={() => setAdding(false)}
          subtitle="A new distributor or retailer, ready to visit straight away." />
        <div style={{ padding: '24px 20px' }}>
          <QuickAddParty
            parties={parties}
            coordinates={fix}
            onCancel={() => setAdding(false)}
            onCreated={party => { setAdding(false); setSearch(''); setPending(party) }}
          />
        </div>
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
          right={<GhostButton onClick={() => setAdding(true)}>Add an outlet</GhostButton>}
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
            <EmptyState
              title="No outlets found"
              body={search.trim()
                ? `Nothing matches “${search.trim()}”. Change the search, or add this shop as a new distributor or retailer.`
                : 'Your network is empty. Add the first distributor or retailer to start visiting.'}
              actionLabel="Add an outlet"
              onAction={() => setAdding(true)}
            />
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

          {list.length > 0 && (
            <div style={{ marginTop: 18, display: 'flex', alignItems: 'baseline',
                          flexWrap: 'wrap', gap: 12 }}>
              <span style={{ fontSize: 13, fontWeight: 400, color: t.text3 }}>
                Standing in a shop that is not on this list?
              </span>
              <GhostButton onClick={() => setAdding(true)}>Add an outlet</GhostButton>
            </div>
          )}
        </div>

        {/* Confirmation — states the distance for the record, blocks nothing */}
        {pending && (() => {
          const geo = fix ? checkGeofence(fix, pending.coordinates ?? null) : null
          const note = !fix
            ? 'No location right now, so this visit will be recorded without one.'
            : geo!.distanceM === null
              ? accurateEnoughForPin(fix)
                ? 'This outlet has no position on file yet. Punching in will set it from where you are standing.'
                : `This outlet has no position on file yet, and your location is only accurate to about ${Math.round(fix.accuracy)} m — too vague to register the shop by. The visit is recorded either way.`
              : `You are about ${geo!.distanceM} m from where this outlet is registered.`
          return (
            <div style={{ position: 'fixed', inset: 0, zIndex: 2000, display: 'flex',
                          alignItems: 'flex-end', justifyContent: 'center' }}>
              <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)' }}
                onClick={() => setPending(null)} />
              {/* A sheet on a phone, a centred panel above the fold on a desktop. */}
              <div style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: 520,
                            background: t.bg2, border: `0.5px solid ${t.border}`,
                            borderRadius: '10px 10px 0 0',
                            padding: '24px 20px calc(32px + env(safe-area-inset-bottom, 0px))' }}>
                <div style={{ fontSize: 17, fontWeight: 500, color: t.text, marginBottom: 6 }}>{pending.name}</div>
                <div style={{ fontSize: 14, color: t.text3, lineHeight: 1.6, marginBottom: 18 }}>{note}</div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <GhostButton onClick={() => setPending(null)} style={{ flex: 1 }}>Cancel</GhostButton>
                  <PrimaryButton onClick={() => punchIn(pending)} disabled={busy} style={{ flex: 2 }}>
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
          visit.distanceFromOutletM !== undefined ? ` · ${visit.distanceFromOutletM} m away` : ''}`}
      />

      {/* A single-column form. Capped so it stays a readable column on a
          desktop rather than a row of 1000px-wide inputs. */}
      <div style={{ padding: '24px 20px', display: 'flex', flexDirection: 'column',
                    gap: 28, maxWidth: 620 }}>

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
            <div key={i} className="oc-wrap" style={{ gap: 8, marginBottom: 8, alignItems: 'center' }}>
              <input value={c.brand} placeholder="Brand"
                onChange={e => setCompetitors(competitors.map((x, j) => j === i ? { ...x, brand: e.target.value } : x))}
                style={{ ...inputStyle(t), flex: '2 1 140px', width: 'auto' }} />
              <input type="number" inputMode="decimal" value={c.pricePerPack ?? ''} placeholder="₹/pack"
                onChange={e => setCompetitors(competitors.map((x, j) => j === i
                  ? { ...x, pricePerPack: e.target.value === '' ? undefined : parseFloat(e.target.value) } : x))}
                style={{ ...inputStyle(t), flex: '1 1 90px', width: 'auto' }} />
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
          <ToggleRow label="Book an order" value={orderPlaced} onChange={on => {
            setOrderPlaced(on)
            // Start on the shop's own distributor when it has one. Usually
            // right, always visible, and always changeable.
            if (on && !orderSourceId) setOrderSourceId(visitedParty?.underDistributorId ?? '')
          }} />
          {orderPlaced && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>

              {/* Who is supplying it. The question that was never asked. */}
              <CustomSelect value={orderSourceId} onChange={setOrderSourceId}
                placeholder="Supplied by"
                options={[
                  { value: '', label: 'Ocealgo — direct from the company' },
                  ...suppliers.map(d => ({
                    value: d.id!,
                    label: d.id === visitedParty?.underDistributorId
                      ? `${d.name} — their distributor`
                      : d.name,
                  })),
                ]} />

              <CustomSelect value={orderProductId} onChange={setOrderProductId} placeholder="Which product"
                options={products.map(p => ({ value: p.id!, label: p.name }))} />

              <div className="oc-wrap" style={{ gap: 10 }}>
                <input type="number" inputMode="numeric" value={orderQty} placeholder="Quantity"
                  onChange={e => setOrderQty(e.target.value)}
                  style={{ ...inputStyle(t), flex: '1 1 120px', width: 'auto' }} />
                <ChipGroup value={orderUnit} onChange={setOrderUnit}
                  options={[
                    { id: 'packets' as const, label: orderProduct?.unitLabel ?? 'Packets' },
                    { id: 'cartons' as const, label: 'Cartons' },
                  ]} />
              </div>
              {orderUnit === 'cartons' && orderProduct && !isNaN(orderPackets) && (
                <div style={{ fontSize: 12, color: t.text3 }}>
                  That is {orderPackets} {orderProduct.unitLabel}.
                </div>
              )}

              {/* Price, payment and date are the company's terms. A movement
                  from a distributor to their own retailer is not the company's
                  sale, so none of the three is asked — the same shape the
                  revisit order flow has always written. */}
              {orderSource ? (
                <div style={{ fontSize: 12, color: t.text3, lineHeight: 1.6 }}>
                  {orderSource.name} supplies this one, so Ocealgo does not price it or
                  put it on anyone’s credit. It is raised against them to fulfil.
                </div>
              ) : (
                <>
                  <input type="number" inputMode="decimal" value={orderPrice}
                    onChange={e => setOrderPrice(e.target.value)}
                    placeholder={orderProduct
                      ? `Price per ${orderProduct.unitLabel.replace(/s$/, '')} — ₹${orderProduct.defaultPricePerUnit} if left blank`
                      : 'Price per unit'}
                    style={inputStyle(t)} />
                  <ChipGroup value={orderPayment} onChange={setOrderPayment}
                    options={[
                      { id: 'cash' as const, label: 'Cash' },
                      { id: 'credit' as const, label: 'Credit' },
                    ]} />
                  <DateInput type="date" value={orderDate} onChange={setOrderDate}
                    min={localDateStr()} />
                  {orderProduct && !isNaN(orderPackets) && orderPackets > 0 && (
                    <div style={{ fontSize: 12, color: t.text3 }}>
                      {orderPackets} × ₹{parseFloat(orderPrice) || orderProduct.defaultPricePerUnit}
                      {' = ₹'}
                      {(orderPackets * (parseFloat(orderPrice) || orderProduct.defaultPricePerUnit)).toLocaleString('en-IN')}
                      {' on '}{orderPayment}.
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* The outcome, and anything worth adding to it */}
        <div>
          <div style={{ marginBottom: 10 }}><Eyebrow>Visit outcome</Eyebrow></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <CustomSelect
              value={category}
              onChange={v => { setCategory(v as VisitOutcomeCategory); setReason('') }}
              placeholder="Select the outcome — required"
              options={(Object.keys(VISIT_OUTCOME_LABEL) as VisitOutcomeCategory[])
                .map(k => ({ value: k, label: VISIT_OUTCOME_LABEL[k] }))}
            />
            {category && (
              <CustomSelect value={reason} onChange={setReason}
                placeholder={needsReason ? 'Select the reason — required' : 'Select the reason (optional)'}
                options={reasons.map(r => ({ value: r, label: r }))} />
            )}
            {/* Asked for, never demanded. The prompt says what makes a remark
                worth writing rather than counting characters at somebody who
                has twenty more shops to get round today. */}
            <textarea rows={3} value={remarks} onChange={e => setRemarks(e.target.value)}
              placeholder="Anything worth remembering about this visit? (optional)"
              style={{ ...inputStyle(t), resize: 'none', lineHeight: 1.6 }} />
            {remarks.trim().length > 0 && remarks.trim().length < SUGGESTED_REMARKS_LENGTH && (
              <div style={{ fontSize: 12, color: t.text3 }}>
                A few more words will make more sense to whoever reads this later.
              </div>
            )}
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
