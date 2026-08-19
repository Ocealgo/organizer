import { useState, useEffect } from 'react'
import { collection, addDoc, query, where, updateDoc, doc } from 'firebase/firestore'
import { onSnapshot } from '../../data/live'
import { db } from '../../firebase'
import {
  AppUser, DutySession, OutletVisit, Party, Product, GeoPoint, LocationIssue,
  PaymentType, PaymentMethod, UnifiedAllocation, PaymentTransaction,
  OutletType, OUTLET_TYPE_LABEL, OUTLET_STOCK_LABEL,
  VisitOutcomeCategory, VISIT_OUTCOME_LABEL, VISIT_OUTCOME_REASONS,
  NO_ORDER_CATEGORIES, SUGGESTED_REMARKS_LENGTH, validateVisitForPunchOut,
  CompetitorObservation, OutletStockLine,
} from '../../types'
import { useTheme } from '../../context/ThemeContext'
import { useConfirm } from '../../hooks/useConfirm'
import CustomSelect from '../../components/CustomSelect'
import DateInput from '../../components/DateInput'
import QuickAddParty from '../../components/QuickAddParty'
import { PageHeader, Eyebrow, ChipGroup, GhostButton, PrimaryButton, EmptyState, inputStyle } from '../../components/ui'
import { getFixOrReason, checkGeofence, distanceM, DEFAULT_GEOFENCE_RADIUS_M } from '../../device/location'
import { setPartyPin, accurateEnoughForPin } from '../../data/partyPin'
import { bookAllocation, cancelAllocation } from '../../data/bookAllocation'
import { localDateStr } from '../../utils/date'

interface Props {
  appUser: AppUser
  session: DutySession
  onBack: () => void
}

/**
 * Which extra fields each channel makes mandatory (spec §3.2).
 *
 * `distributor` used to demand a "Credit limit checked" tick. Nothing ever
 * read it — it recorded that somebody said they looked, never what they saw,
 * and it was standing in for a credit position the app could not show at the
 * time. The visit now shows the real figures, captures them onto the record,
 * and warns at the moment an order actually crosses the limit, so the tick has
 * nothing left to do except get flipped without being read.
 */
function requiredFor(outletType: OutletType): string[] {
  switch (outletType) {
    case 'pharmacy': return ['counterPresence']
    case 'cosmetics': return ['customerFeedback']
    case 'hospital': return ['contactPersonName']
    default: return []
  }
}

export default function OutletVisitScreen({ appUser, session, onBack }: Props) {
  const { t } = useTheme()
  const { modal: confirmModal, showConfirm } = useConfirm()

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
  const [orderOpen, setOrderOpen] = useState(false)
  const [placingOrder, setPlacingOrder] = useState(false)
  const [removingOrder, setRemovingOrder] = useState<string | null>(null)
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

  // money
  const [allocations, setAllocations] = useState<UnifiedAllocation[]>([])
  const [payments, setPayments] = useState<PaymentTransaction[]>([])
  const [collecting, setCollecting] = useState(false)
  const [collectingBusy, setCollectingBusy] = useState(false)
  const [payAmount, setPayAmount] = useState('')
  const [payMethod, setPayMethod] = useState<PaymentMethod>('cash')
  const [payNote, setPayNote] = useState('')

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

  // What this shop owes, so the rep knows before they ask for it.
  useEffect(() => {
    if (!visit?.partyId) return
    const q = query(collection(db, 'allocations_v2'), where('partyId', '==', visit.partyId))
    return onSnapshot(q, snap =>
      setAllocations(snap.docs.map(d => ({ id: d.id, ...d.data() } as UnifiedAllocation))))
  }, [visit?.partyId])

  // And what has already been taken off them — including by somebody else.
  useEffect(() => {
    if (!visit?.partyId) return
    const q = query(collection(db, 'payment_transactions'), where('partyId', '==', visit.partyId))
    return onSnapshot(q, snap =>
      setPayments(snap.docs.map(d => ({ id: d.id, ...d.data() } as PaymentTransaction))))
  }, [visit?.partyId])

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

  /** What has actually been booked here, live from the allocations listener. */
  const placedHere = allocations
    .filter(a => (visit?.allocationIds ?? []).includes(a.id!) && a.status !== 'cancelled')
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))

  /** Why the order form is not ready to be placed. Never blocks punch-out. */
  const orderProblem = !orderProductId && !orderQty ? null
    : !orderProductId ? 'Choose which product they ordered.'
    : isNaN(orderPackets) || orderPackets <= 0 ? 'Enter how much they ordered.'
    : null

  const orderTotal = orderProduct && !isNaN(orderPackets) && orderPackets > 0 && !orderSource
    ? orderPackets * (parseFloat(orderPrice) || orderProduct.defaultPricePerUnit)
    : 0

  // ── money ─────────────────────────────────────────────────────────────────
  /**
   * Who actually owes Ocealgo money.
   *
   * Distributors and retailers standing on their own. A retailer under a
   * distributor buys from that distributor and settles with them, so there is
   * nothing here for a rep to collect and asking would be wrong — the same
   * line PaymentTransaction draws in types.ts.
   */
  const isDirectCustomer = !!visitedParty &&
    (visitedParty.type === 'distributor' || !visitedParty.underDistributorId)

  /** Bills the company has sent, on credit, not yet settled. */
  const openBills = allocations
    .filter(a => a.paymentType === 'credit'
      && (a.status === 'sent' || a.status === 'overdue')
      && a.fromType !== 'distributor')
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))

  const outstanding = openBills.reduce(
    (sum, a) => sum + Math.max(0, (a.totalAmount || 0) - (a.paidAmount || 0)), 0)
  const overdueCount = openBills.filter(a => a.status === 'overdue').length
  const creditLimit = visitedParty?.creditLimit
  const headroom = creditLimit !== undefined ? creditLimit - outstanding : null

  /** What has been taken off this shop lately, newest first. */
  const recentPayments = payments
    .filter(p => p.status !== 'rejected')
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 5)

  /**
   * Would this order take them past what they are allowed to owe?
   *
   * Only Ocealgo's own credit counts. A cash order is settled on the spot, and
   * a distributor supplying their own retailer is not the company's exposure.
   */
  const wouldOwe = outstanding + orderTotal
  const overLimit = creditLimit !== undefined && !orderSource
    && orderPayment === 'credit' && orderTotal > 0 && wouldOwe > creditLimit

  const payValue = parseFloat(payAmount)
  const payProblem = !payAmount.trim() ? null
    : isNaN(payValue) || payValue <= 0 ? 'Enter how much you collected.'
    : null

  const PAY_METHOD_LABEL: Record<PaymentMethod, string> = {
    cash: 'Cash', upi: 'UPI', cheque: 'Cheque', bank_transfer: 'Bank transfer',
  }

  /**
   * Apply a collection the way the revisit flow already does — oldest bill
   * first, writing paidAmount straight onto the allocation.
   *
   * That is a rep writing to the financial ledger, which firestore.rules
   * permits under an explicitly temporary allowance (GAP 3) pending a Cloud
   * Function. Deliberately the same path rather than a second one: when that
   * function arrives there should be one place to move, not two.
   */
  async function recordPayment() {
    if (!visit || !visitedParty || payProblem || !payValue) return
    const party = visitedParty
    setCollectingBusy(true); setError(null)
    try {
    const amount = payValue
    const appliedTo: { allocId: string; amount: number }[] = []
    let left = amount
    for (const bill of openBills) {
      if (left <= 0) break
      const paid = bill.paidAmount || 0
      const owed = (bill.totalAmount || 0) - paid
      if (owed <= 0) continue
      const apply = Math.min(left, owed)
      await updateDoc(doc(db, 'allocations_v2', bill.id!), {
        paidAmount: paid + apply,
        ...(paid + apply >= (bill.totalAmount || 0) ? { status: 'paid', paidAt: Date.now() } : {}),
      })
      appliedTo.push({ allocId: bill.id!, amount: apply })
      left -= apply
    }

    const txn = await addDoc(collection(db, 'payment_transactions'), {
      partyId: party.id!, partyName: party.name, partyType: party.type,
      amount, paymentMethod: payMethod,
      collectionType: 'collected_by_salesperson',
      collectedBy: appUser.uid, collectedByName: appUser.name,
      notes: payNote.trim(),
      status: 'pending_approval',
      date: localDateStr(),
      createdAt: Date.now(),
      appliedTo,
    })

    await addDoc(collection(db, 'alerts'), {
      type: 'credit_settlement',
      message: `₹${amount.toLocaleString('en-IN')} collected from ${party.name} by ${appUser.name} during a visit`,
      relatedId: party.id!, toRole: 'admin_group',
      read: false, createdAt: Date.now(),
    })

      // On the visit the moment it is taken. A rep with the company's cash in
      // their pocket and a phone that dies before punch-out must still have
      // said so.
      await updateDoc(doc(db, 'outlet_visits', visit.id!), {
        paymentCollected: (visit.paymentCollected ?? 0) + amount,
        paymentMethod: payMethod,
        paymentTransactionId: txn.id,
      })
      setPayAmount(''); setPayNote(''); setCollecting(false)
    } catch (e: any) {
      console.error('[OutletVisit] could not record the payment', e)
      setError(e?.message || 'Could not record the payment.')
    } finally { setCollectingBusy(false) }
  }

  const missingCategoryField = visit
    ? requiredFor(visit.outletType).find(k =>
        extra[k] === undefined || extra[k] === '' || extra[k] === null)
    : undefined

  const FIELD_LABEL: Record<string, string> = {
    counterPresence: 'Record whether our wipes are on the counter',
    customerFeedback: 'Enter the customer feedback',
    contactPersonName: 'Enter the contact person',
  }

  // An order or a payment half-typed and never placed does not block leaving —
  // it was never written, so there is nothing to lose. Only the visit's own
  // required parts do.
  const punchOutBlocker = missingCategoryField
    ? FIELD_LABEL[missingCategoryField]
    : remarksProblem

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

      // Orders and payments are already written — each was its own deliberate
      // action, in front of the shopkeeper. Punch-out only closes the visit,
      // which is why retrying a failed one cannot double-book anything.
      await updateDoc(doc(db, 'outlet_visits', visit.id), {
        stock: stockLines,
        competitors,
        // The credit position as it stood, captured rather than attested. Only
        // for the people who can owe the company anything.
        ...(isDirectCustomer ? {
          creditOutstandingAtVisit: outstanding,
          ...(creditLimit !== undefined ? { creditLimitAtVisit: creditLimit } : {}),
        } : {}),
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

  /**
   * Place the order now, not at punch-out.
   *
   * A rep tells a shopkeeper "booked" while they are standing in front of
   * them; that should be true when they say it. Holding it in component state
   * until the visit closes also meant losing it to a dead battery — nothing
   * rehydrates this form when an interrupted visit is resumed — and meant a
   * punch-out that failed halfway booked the order a second time on the retry.
   */
  async function placeOrder() {
    if (!visit || !visitedParty || !orderProduct || orderProblem) return

    // Told before, not refused. The rep is standing in the shop and cannot
    // wait on the office to raise a number; refusing would cost the sale
    // without collecting a rupee of the debt. So it is a deliberate act.
    if (overLimit) {
      const ok = await showConfirm(
        'This goes past their credit limit',
        `${visitedParty.name} owes ₹${outstanding.toLocaleString('en-IN')} and this adds ₹${orderTotal.toLocaleString('en-IN')}, ` +
        `taking them to ₹${wouldOwe.toLocaleString('en-IN')} against a limit of ₹${creditLimit!.toLocaleString('en-IN')}.\n\n` +
        'You can book it. The admin team is told, and the order carries the fact.',
        'Book it anyway',
      )
      if (!ok) return
    }

    setPlacingOrder(true); setError(null)
    try {
      const id = await bookAllocation({
        party: visitedParty,
        product: orderProduct,
        packets: orderPackets,
        supplier: orderSource,
        pricePerPacket: parseFloat(orderPrice) || orderProduct.defaultPricePerUnit,
        paymentType: orderPayment,
        plannedDate: orderDate,
        creditDueDate: orderDate,
        notes: 'Booked during an outlet visit',
        by: appUser,
        packetsPerCarton: orderProduct.unitsPerCarton || 1,
        overCreditLimit: overLimit,
      })

      const ids = [...(visit.allocationIds ?? (visit.allocationId ? [visit.allocationId] : [])), id]
      await updateDoc(doc(db, 'outlet_visits', visit.id!), {
        orderPlaced: true,
        allocationIds: ids,
        // Kept in step for anything still reading the single field.
        allocationId: ids[0],
      })

      // Ready for the next one — a shop orders more than one thing.
      setOrderProductId(''); setOrderQty(''); setOrderPrice('')
    } catch (e: any) {
      console.error('[OutletVisit] could not place the order', e)
      setError(e?.message || 'Could not place the order.')
    } finally { setPlacingOrder(false) }
  }

  /** Remove one placed here, while it is still only pending. */
  async function removeOrder(a: UnifiedAllocation) {
    if (!visit) return
    setRemovingOrder(a.id!); setError(null)
    try {
      await cancelAllocation({
        id: a.id!, productId: a.productId, packets: a.packets,
        fromType: a.fromType, lockedAtCreation: a.lockedAtCreation,
      })
      const ids = (visit.allocationIds ?? []).filter(x => x !== a.id)
      await updateDoc(doc(db, 'outlet_visits', visit.id!), {
        allocationIds: ids,
        orderPlaced: ids.length > 0,
      })
    } catch (e: any) {
      console.error('[OutletVisit] could not remove the order', e)
      setError(e?.message || 'Could not remove the order.')
    } finally { setRemovingOrder(null) }
  }

  function resetForm() {
    setStock({}); setCompetitors([]); setOrderOpen(false)
    setOrderProductId(''); setOrderQty(''); setExtra({})
    setOrderSourceId(''); setOrderUnit('packets'); setOrderPrice('')
    setOrderPayment('credit'); setOrderDate(localDateStr())
    setCollecting(false); setPayAmount(''); setPayMethod('cash'); setPayNote('')
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
          <div style={{ marginBottom: 10 }}>
            <Eyebrow>{OUTLET_STOCK_LABEL[visit.outletType]}</Eyebrow>
          </div>
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

          {/* Booked, and it says so, because it is already true — each of
              these exists in allocations before the rep leaves the shop. */}
          {placedHere.length > 0 && (
            <div style={{ marginBottom: 14, borderBottom: `0.5px solid ${t.border}` }}>
              {placedHere.map(a => (
                <div key={a.id} style={{ display: 'flex', alignItems: 'baseline', gap: 12,
                                         borderTop: `0.5px solid ${t.border}`, padding: '11px 0' }}>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 14, color: t.text }}>
                    {a.packets} {a.productName}
                    <span style={{ display: 'block', fontSize: 12, color: t.text3, marginTop: 2 }}>
                      from {a.fromName}
                      {a.fromType === 'company'
                        ? ` · ₹${a.totalAmount.toLocaleString('en-IN')} on ${a.paymentType}`
                        : ' · they supply it'}
                    </span>
                  </span>
                  <button className="oc-action" onClick={() => removeOrder(a)}
                    disabled={removingOrder === a.id}
                    style={{ background: 'none', border: 'none', padding: 0, fontSize: 13,
                             color: t.text2, cursor: 'pointer', flexShrink: 0 }}>
                    {removingOrder === a.id ? 'Removing…' : 'Remove'}
                  </button>
                </div>
              ))}
            </div>
          )}

          <ToggleRow
            label={placedHere.length > 0 ? 'Book another order' : 'Book an order'}
            value={orderOpen}
            onChange={on => {
              setOrderOpen(on)
              // Start on the shop's own distributor when it has one. Usually
              // right, always visible, and always changeable.
              if (on && !orderSourceId) setOrderSourceId(visitedParty?.underDistributorId ?? '')
            }} />
          {orderOpen && (
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

              {overLimit && (
                <div style={{ fontSize: 12, color: t.warn, lineHeight: 1.6 }}>
                  This takes them to ₹{wouldOwe.toLocaleString('en-IN')} owed against a
                  ₹{creditLimit!.toLocaleString('en-IN')} limit. You can still book it — the
                  admin team is told, and the order carries the fact.
                </div>
              )}

              <div>
                <PrimaryButton onClick={placeOrder}
                  disabled={!orderProduct || !!orderProblem || isNaN(orderPackets) || orderPackets <= 0 || placingOrder}
                  style={{ width: '100%' }}>
                  {placingOrder ? 'Placing…' : 'Place this order'}
                </PrimaryButton>
                {orderProblem && !placingOrder && (
                  <div style={{ fontSize: 13, color: t.warn, marginTop: 8 }}>{orderProblem}</div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── Money ───────────────────────────────────────────────────────────
            Only for the people who actually owe Ocealgo: distributors, and
            retailers standing on their own. A retailer under a distributor
            buys from that distributor and settles with them, so there is
            nothing here for a rep to collect and asking would be wrong. */}
        {isDirectCustomer && (
          <div>
            <div style={{ marginBottom: 10 }}><Eyebrow>Money</Eyebrow></div>

            <div style={{ background: t.tint, borderRadius: 6, padding: '13px 15px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between',
                            alignItems: 'baseline', gap: 12 }}>
                <span style={{ fontSize: 13, color: t.text3 }}>Outstanding</span>
                <span style={{ fontSize: 15, fontWeight: 500,
                               color: overdueCount > 0 ? t.warn : t.text }}>
                  ₹{outstanding.toLocaleString('en-IN')}
                </span>
              </div>
              <div style={{ fontSize: 12, color: t.text3, marginTop: 4, lineHeight: 1.6 }}>
                {outstanding === 0
                  ? 'Nothing owed. Their bills are settled.'
                  : `Across ${openBills.length} ${openBills.length === 1 ? 'bill' : 'bills'}` +
                    (overdueCount > 0 ? ` · ${overdueCount} past the due date` : '')}
                {creditLimit !== undefined && headroom !== null && (
                  <div style={{ marginTop: 3, color: headroom < 0 ? t.warn : t.text3 }}>
                    {headroom < 0
                      ? `Over their ₹${creditLimit.toLocaleString('en-IN')} limit by ₹${Math.abs(headroom).toLocaleString('en-IN')}.`
                      : `₹${headroom.toLocaleString('en-IN')} left of a ₹${creditLimit.toLocaleString('en-IN')} limit.`}
                  </div>
                )}
              </div>
            </div>

            {/* What has already been taken off them, including by somebody
                else on another day — so nobody asks twice for the same money,
                and a rep can answer "I paid your colleague last week". */}
            {recentPayments.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 12, color: t.text3, marginBottom: 6 }}>Collected lately</div>
                <div style={{ borderBottom: `0.5px solid ${t.border}` }}>
                  {recentPayments.map(p => (
                    <div key={p.id} style={{ display: 'flex', alignItems: 'baseline', gap: 12,
                                             borderTop: `0.5px solid ${t.border}`, padding: '9px 0' }}>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: t.text }}>
                        ₹{p.amount.toLocaleString('en-IN')}
                        <span style={{ color: t.text3 }}>
                          {' · '}{PAY_METHOD_LABEL[p.paymentMethod]}
                          {p.id === visit.paymentTransactionId ? ' · taken on this visit' : ''}
                        </span>
                        <span style={{ display: 'block', fontSize: 12, color: t.text3, marginTop: 2 }}>
                          {p.collectedByName ?? 'Someone'} on{' '}
                          {new Date(p.createdAt).toLocaleDateString('en-IN',
                            { day: 'numeric', month: 'short' })}
                        </span>
                      </span>
                      <span style={{ fontSize: 12, whiteSpace: 'nowrap', flexShrink: 0,
                                     color: p.confirmedAt || p.status === 'approved' ? t.text3 : t.warn }}>
                        {p.confirmedAt || p.status === 'approved' ? 'Confirmed' : 'Not confirmed yet'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{ marginTop: 12 }}>
              <ToggleRow label="Collected a payment" value={collecting} onChange={setCollecting} />
            </div>

            {/* Taking money against no bill is a real thing — an advance, or
                cash for an order booked minutes ago that is not dispatched
                yet. Hiding the option would leave a rep holding the company's
                money with no way to declare it, which is the worse failure. */}
            {collecting && outstanding === 0 && (
              <div style={{ fontSize: 12, color: t.text3, marginTop: 10, lineHeight: 1.6 }}>
                Nothing is owed right now, so this is recorded as an advance. It is not
                applied to any bill — including an order booked here today, which is not
                dispatched yet — so somebody will settle it against one later.
              </div>
            )}

            {collecting && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
                <input type="number" inputMode="decimal" value={payAmount}
                  onChange={e => setPayAmount(e.target.value)}
                  placeholder="How much did you take?" style={inputStyle(t)} />
                <ChipGroup value={payMethod} onChange={setPayMethod}
                  options={[
                    { id: 'cash' as const, label: 'Cash' },
                    { id: 'upi' as const, label: 'UPI' },
                    { id: 'cheque' as const, label: 'Cheque' },
                    { id: 'bank_transfer' as const, label: 'Bank transfer' },
                  ]} />
                <input value={payNote} onChange={e => setPayNote(e.target.value)}
                  placeholder="Cheque number, reference, anything (optional)"
                  style={inputStyle(t)} />
                {payValue > 0 && (
                  <div style={{ fontSize: 12, color: payValue > outstanding ? t.warn : t.text3,
                                lineHeight: 1.6 }}>
                    {payValue > outstanding
                      ? `That is ₹${(payValue - outstanding).toLocaleString('en-IN')} more than they owe. The extra sits unapplied until there is a bill for it.`
                      : `Clears their oldest bills first, leaving ₹${(outstanding - payValue).toLocaleString('en-IN')} outstanding.`}
                    <div style={{ marginTop: 3 }}>
                      An admin confirms it reached the company. Until then it is your word for it.
                    </div>
                  </div>
                )}
                <PrimaryButton onClick={recordPayment}
                  disabled={!payValue || !!payProblem || collectingBusy}
                  style={{ width: '100%' }}>
                  {collectingBusy ? 'Recording…' : 'Record this payment'}
                </PrimaryButton>
                {payProblem && !collectingBusy && (
                  <div style={{ fontSize: 13, color: t.warn }}>{payProblem}</div>
                )}
              </div>
            )}
          </div>
        )}

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
      {confirmModal}
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
