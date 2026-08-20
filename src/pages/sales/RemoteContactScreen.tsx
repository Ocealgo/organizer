import { useState, useEffect } from 'react'
import { collection, addDoc, doc, updateDoc, query, where } from 'firebase/firestore'
import { onSnapshot } from '../../data/live'
import { db } from '../../firebase'
import {
  AppUser, DutySession, Party, Product, RemoteContact, UnifiedAllocation,
  OrderChannel, ORDER_CHANNEL_LABEL, PaymentType,
  VisitOutcomeCategory, VISIT_OUTCOME_LABEL, VISIT_OUTCOME_REASONS, NO_ORDER_CATEGORIES,
} from '../../types'
import { useTheme } from '../../context/ThemeContext'
import { useConfirm } from '../../hooks/useConfirm'
import CustomSelect from '../../components/CustomSelect'
import DateInput from '../../components/DateInput'
import { bookAllocation, cancelAllocation } from '../../data/bookAllocation'
import { supplierOptions, defaultSupplierId } from '../../data/supplierOptions'
import { PageHeader, Eyebrow, ChipGroup, GhostButton, PrimaryButton, EmptyState, inputStyle } from '../../components/ui'
import { localDateStr } from '../../utils/date'

interface Props {
  appUser: AppUser
  session: DutySession
  onBack: () => void
}

/** Every way of reaching a shop except going to it. */
const CHANNELS: Exclude<OrderChannel, 'field_visit'>[] = ['phone', 'whatsapp', 'email', 'office']

/**
 * Logging a shop you reached without going to it.
 *
 * This is not a visit and is deliberately not shaped like one. A visit is a
 * place you stood, evidenced by a position, a distance from the shop's pin and
 * a punch in and out. A contact is a conversation, evidenced by nothing at all
 * beyond the rep's own word — so it takes no location, has no duration, cannot
 * be geofenced, and is never counted as coverage anywhere.
 *
 * What it is for is the half of the work that used to vanish. "Called, they
 * will reorder after Onam" is real pipeline and there was nowhere to put it,
 * and an order taken over the phone was indistinguishable from one taken
 * standing in a doorway.
 *
 * The one piece of evidence it can carry is who was actually spoken to, which
 * is what settles an argument months later — somebody at the shop is named as
 * having said it.
 */
const CREDIT_DAYS = 30

/**
 * When payment falls due on a credit order.
 *
 * Not the same date as the delivery, which is what this was wrongly set to —
 * see the note where it is used. Thirty days from the planned dispatch, which
 * is the default the Allocations screen has always used.
 */
function creditDueFrom(plannedDate: string): string {
  const d = new Date(plannedDate + 'T00:00:00')
  d.setDate(d.getDate() + CREDIT_DAYS)
  return localDateStr(d)
}

export default function RemoteContactScreen({ appUser, session, onBack }: Props) {
  const { t } = useTheme()
  const { modal: confirmModal, showConfirm } = useConfirm()

  const [parties, setParties] = useState<Party[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [today, setToday] = useState<RemoteContact[]>([])
  const [allocations, setAllocations] = useState<UnifiedAllocation[]>([])

  const [search, setSearch] = useState('')
  const [party, setParty] = useState<Party | null>(null)

  const [channel, setChannel] = useState<Exclude<OrderChannel, 'field_visit'>>('phone')
  const [contactPerson, setContactPerson] = useState('')
  const [category, setCategory] = useState<VisitOutcomeCategory | ''>('')
  const [reason, setReason] = useState('')
  const [remarks, setRemarks] = useState('')

  // The order, if one came of it. Same questions the shop floor asks.
  const [orderOpen, setOrderOpen] = useState(false)
  const [orderProductId, setOrderProductId] = useState('')
  const [orderQty, setOrderQty] = useState('')
  const [orderUnit, setOrderUnit] = useState<'packets' | 'cartons'>('packets')
  const [orderSourceId, setOrderSourceId] = useState('')
  const [orderPrice, setOrderPrice] = useState('')
  const [orderPayment, setOrderPayment] = useState<PaymentType>('credit')
  const [orderDate, setOrderDate] = useState(localDateStr())
  const [placedIds, setPlacedIds] = useState<string[]>([])

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const u1 = onSnapshot(collection(db, 'parties'), s =>
      setParties(s.docs.map(d => ({ id: d.id, ...d.data() } as Party))))
    const u2 = onSnapshot(collection(db, 'products'), s =>
      setProducts(s.docs.map(d => ({ id: d.id, ...d.data() } as Product)).filter(p => p.active)))
    return () => { u1(); u2() }
  }, [])

  // Everything logged against this day, so a rep can see their own round.
  useEffect(() => {
    if (!session.id) return
    const q = query(
      collection(db, 'remote_contacts'),
      where('uid', '==', appUser.uid),
      where('sessionId', '==', session.id),
    )
    return onSnapshot(q, snap =>
      setToday(snap.docs.map(d => ({ id: d.id, ...d.data() } as RemoteContact))
        .sort((a, b) => b.at - a.at)))
  }, [session.id, appUser.uid])

  useEffect(() => {
    if (!party?.id) { setAllocations([]); return }
    const q = query(collection(db, 'allocations_v2'), where('partyId', '==', party.id))
    return onSnapshot(q, snap =>
      setAllocations(snap.docs.map(d => ({ id: d.id, ...d.data() } as UnifiedAllocation))))
  }, [party?.id])

  const supplyChoices = supplierOptions(parties, party, allocations)
  const orderSource = orderSourceId
    ? parties.find(p => p.id === orderSourceId) ?? null
    : null
  const orderProduct = products.find(p => p.id === orderProductId) ?? null

  const rawQty = parseInt(orderQty)
  const orderPackets = !isNaN(rawQty) && orderProduct
    ? (orderUnit === 'cartons' ? rawQty * (orderProduct.unitsPerCarton || 1) : rawQty)
    : NaN

  const placed = allocations
    .filter(a => placedIds.includes(a.id!) && a.status !== 'cancelled')
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))

  const reasons = category ? VISIT_OUTCOME_REASONS[category] : []
  const needsReason = category ? NO_ORDER_CATEGORIES.includes(category) : false

  const blocker = !party ? 'Pick the shop you spoke to.'
    : !category ? 'Say what came of the conversation.'
    : needsReason && !reason ? 'Pick the reason there was no order.'
    : null

  async function placeOrder() {
    if (!party || !orderProduct || isNaN(orderPackets) || orderPackets <= 0) return
    setBusy(true); setError(null)
    try {
      const id = await bookAllocation({
        party, product: orderProduct, packets: orderPackets,
        supplier: orderSource,
        pricePerPacket: parseFloat(orderPrice) || orderProduct.defaultPricePerUnit,
        paymentType: orderPayment,
        plannedDate: orderDate,
        // Payment falls due thirty days after dispatch, not on the day the
        // order is raised. This was `orderDate` — the planned delivery — so
        // every credit order booked in the field was due the moment it
        // existed and read as overdue before anything had even shipped.
        creditDueDate: creditDueFrom(orderDate),
        notes: `Taken ${ORDER_CHANNEL_LABEL[channel].toLowerCase()}`,
        by: appUser,
        packetsPerCarton: orderProduct.unitsPerCarton || 1,
        channel,
      })
      setPlacedIds(ids => [...ids, id])
      setOrderProductId(''); setOrderQty(''); setOrderPrice('')
    } catch (e: any) {
      console.error('[RemoteContact] could not place the order', e)
      setError(e?.message || 'Could not place the order.')
    } finally { setBusy(false) }
  }

  async function removeOrder(a: UnifiedAllocation) {
    setBusy(true); setError(null)
    try {
      await cancelAllocation({
        id: a.id!, productId: a.productId, packets: a.packets,
        fromType: a.fromType, lockedAtCreation: a.lockedAtCreation,
      })
      setPlacedIds(ids => ids.filter(x => x !== a.id))
    } catch (e: any) {
      console.error('[RemoteContact] could not remove the order', e)
      setError(e?.message || 'Could not remove the order.')
    } finally { setBusy(false) }
  }

  /**
   * Written once, then left alone. A conversation is not amended afterwards —
   * a second conversation is a second record, which is also what the rules say.
   */
  async function save() {
    if (!party || blocker || !session.id) return
    setBusy(true); setError(null)
    try {
      const payload: Omit<RemoteContact, 'id'> = {
        uid: appUser.uid,
        name: appUser.name,
        role: appUser.role,
        sessionId: session.id,
        date: localDateStr(),
        partyId: party.id!,
        partyName: party.name,
        channel,
        ...(contactPerson.trim() ? { contactPerson: contactPerson.trim() } : {}),
        outcomeCategory: category as VisitOutcomeCategory,
        ...(reason ? { outcomeReason: reason } : {}),
        ...(remarks.trim() ? { remarks: remarks.trim() } : {}),
        ...(placedIds.length ? { allocationIds: placedIds } : {}),
        at: Date.now(),
        createdAt: Date.now(),
      }
      const ref = await addDoc(collection(db, 'remote_contacts'), payload)

      // Point the orders back at the conversation that produced them.
      for (const id of placedIds) {
        await updateDoc(doc(db, 'allocations_v2', id), { remoteContactId: ref.id })
      }
      resetForm()
    } catch (e: any) {
      console.error('[RemoteContact] could not save', e)
      setError(e?.message || 'Could not save this contact.')
    } finally { setBusy(false) }
  }

  function resetForm() {
    setParty(null); setSearch('')
    setChannel('phone'); setContactPerson('')
    setCategory(''); setReason(''); setRemarks('')
    setOrderOpen(false); setOrderProductId(''); setOrderQty('')
    setOrderUnit('packets'); setOrderSourceId(''); setOrderPrice('')
    setOrderPayment('credit'); setOrderDate(localDateStr()); setPlacedIds([])
  }

  // ── pick a shop ───────────────────────────────────────────────────────────
  if (!party) {
    const list = parties
      .filter(p => !search.trim() ||
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        (p.place ?? '').toLowerCase().includes(search.toLowerCase()))
      .slice(0, 40)

    return (
      <div style={{ minHeight: '100vh', background: t.bg, paddingBottom: 56 }}>
        <PageHeader eyebrow="Contact" title="Who did you speak to?" onBack={onBack}
          subtitle="A call or a message, logged against your day. It is not a visit and is never counted as one." />

        <div style={{ padding: '20px 20px 0' }}>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or place" style={inputStyle(t)} />
        </div>

        <div style={{ padding: '20px 20px 0' }}>
          {list.length === 0 ? (
            <EmptyState title="No outlets found"
              body="Nothing matches that. Change the search, or add the shop from Network first." />
          ) : (
            <div className="oc-list-flush" style={{ borderBottom: `0.5px solid ${t.border}` }}>
              {list.map(p => (
                <button key={p.id} className="oc-row" onClick={() => setParty(p)}
                  style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none',
                           border: 'none', borderTop: `0.5px solid ${t.border}`,
                           padding: '15px 10px', cursor: 'pointer' }}>
                  <span style={{ display: 'block', fontSize: 15, fontWeight: 500, color: t.text }}>{p.name}</span>
                  <span style={{ display: 'block', fontSize: 13, color: t.text3, marginTop: 3 }}>
                    {p.type === 'distributor' ? 'Distributor' : 'Retailer'}{p.place ? ` · ${p.place}` : ''}
                    {p.phone ? ` · ${p.phone}` : ''}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {today.length > 0 && (
          <div style={{ padding: '28px 20px 0' }}>
            <div style={{ marginBottom: 10 }}><Eyebrow>Logged today ({today.length})</Eyebrow></div>
            <div style={{ borderBottom: `0.5px solid ${t.border}` }}>
              {today.map(c => (
                <div key={c.id} style={{ borderTop: `0.5px solid ${t.border}`, padding: '12px 0' }}>
                  <div style={{ fontSize: 14, color: t.text }}>{c.partyName}</div>
                  <div style={{ fontSize: 12, color: t.text3, marginTop: 3, lineHeight: 1.5 }}>
                    {ORDER_CHANNEL_LABEL[c.channel]}
                    {c.contactPerson ? ` · ${c.contactPerson}` : ''}
                    {' · '}{VISIT_OUTCOME_LABEL[c.outcomeCategory]}
                    {c.allocationIds?.length
                      ? ` · ${c.allocationIds.length} ${c.allocationIds.length === 1 ? 'order' : 'orders'}`
                      : ''}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  // ── log the conversation ──────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: t.bg, paddingBottom: 56 }}>
      <PageHeader eyebrow="Contact" title={party.name} onBack={() => resetForm()}
        subtitle={party.phone ? `${party.place ?? ''}${party.place ? ' · ' : ''}${party.phone}` : party.place} />

      <div style={{ padding: '24px 20px', display: 'flex', flexDirection: 'column',
                    gap: 26, maxWidth: 620 }}>

        <div>
          <div style={{ marginBottom: 10 }}><Eyebrow>How you reached them</Eyebrow></div>
          <ChipGroup value={channel} onChange={setChannel}
            options={CHANNELS.map(c => ({ id: c, label: ORDER_CHANNEL_LABEL[c] }))} />
        </div>

        <div>
          <div style={{ marginBottom: 10 }}><Eyebrow>Who you spoke to</Eyebrow></div>
          <input value={contactPerson} onChange={e => setContactPerson(e.target.value)}
            placeholder="Their name at the shop (optional)" style={inputStyle(t)} />
          <div style={{ fontSize: 12, color: t.text3, marginTop: 8, lineHeight: 1.6 }}>
            A call leaves no trace the way a visit does. A name is the one thing that
            settles it later if anybody asks who placed the order.
          </div>
        </div>

        {/* Orders, on the same terms the shop floor gets */}
        <div>
          <div style={{ marginBottom: 10 }}><Eyebrow>Did they order?</Eyebrow></div>
          {placed.length > 0 && (
            <div style={{ marginBottom: 14, borderBottom: `0.5px solid ${t.border}` }}>
              {placed.map(a => (
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
                  <button className="oc-action" onClick={() => removeOrder(a)} disabled={busy}
                    style={{ background: 'none', border: 'none', padding: 0, fontSize: 13,
                             color: t.text2, cursor: 'pointer', flexShrink: 0 }}>
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}

          <GhostButton onClick={() => {
            setOrderOpen(!orderOpen)
            if (!orderOpen && !orderSourceId) setOrderSourceId(defaultSupplierId(party, allocations))
          }}>
            {orderOpen ? 'Not this time' : placed.length ? 'Add another order' : 'They placed an order'}
          </GhostButton>

          {orderOpen && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
              <CustomSelect value={orderSourceId} onChange={setOrderSourceId} placeholder="Supplied by"
                options={supplyChoices} />
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
              {!orderSource && (
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
                  <DateInput type="date" value={orderDate} onChange={setOrderDate} min={localDateStr()} />
                </>
              )}
              <PrimaryButton onClick={placeOrder}
                disabled={!orderProduct || isNaN(orderPackets) || orderPackets <= 0 || busy}
                style={{ width: '100%' }}>
                {busy ? 'Placing…' : 'Place this order'}
              </PrimaryButton>
            </div>
          )}
        </div>

        {/* Outcome — the same vocabulary a visit uses */}
        <div>
          <div style={{ marginBottom: 10 }}><Eyebrow>What came of it</Eyebrow></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <CustomSelect value={category}
              onChange={v => { setCategory(v as VisitOutcomeCategory); setReason('') }}
              placeholder="Select the outcome — required"
              options={(Object.keys(VISIT_OUTCOME_LABEL) as VisitOutcomeCategory[])
                .map(k => ({ value: k, label: VISIT_OUTCOME_LABEL[k] }))} />
            {category && (
              <CustomSelect value={reason} onChange={setReason}
                placeholder={needsReason ? 'Select the reason — required' : 'Select the reason (optional)'}
                options={reasons.map(r => ({ value: r, label: r }))} />
            )}
            <textarea rows={3} value={remarks} onChange={e => setRemarks(e.target.value)}
              placeholder="Anything worth remembering? (optional)"
              style={{ ...inputStyle(t), resize: 'none', lineHeight: 1.6 }} />
          </div>
        </div>

        <div>
          <PrimaryButton onClick={async () => {
            if (placed.length === 0) {
              const ok = await showConfirm(
                'Log this with no order?',
                'That is worth recording — a call that went nowhere today is still a call somebody made. It will not count as a visit.',
                'Log it',
              )
              if (!ok) return
            }
            await save()
          }} disabled={!!blocker || busy} style={{ width: '100%' }}>
            {busy ? 'Saving…' : 'Log this contact'}
          </PrimaryButton>
          {blocker && !busy && (
            <div style={{ fontSize: 13, color: t.warn, marginTop: 10, lineHeight: 1.6 }}>{blocker}</div>
          )}
          {error && <div style={{ fontSize: 13, color: t.warn, marginTop: 10 }}>{error}</div>}
        </div>
      </div>
      {confirmModal}
    </div>
  )
}
