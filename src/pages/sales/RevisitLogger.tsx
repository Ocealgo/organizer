import React, { useState, useEffect } from 'react'
import { collection, addDoc, onSnapshot, updateDoc, doc, query, where, increment } from 'firebase/firestore'
import { db } from '../../firebase'
import { Party, Product, RevisitAction, StockUpdateAction, NewOrderAction, PaymentCollectionAction, StockMovement } from '../../types'
import { useAuth } from '../../context/AuthContext'
import { useTheme } from '../../context/ThemeContext'

interface Props { party: Party; onBack: () => void; onDone: () => void }

type ActionKey = 'stock_update' | 'new_order' | 'payment_collection' | 'relationship_visit' | 'no_longer_active' | 'distribute_to_retailers'

const today2 = () => new Date(Date.now() + 2 * 86400000).toISOString().split('T')[0]

const BASE_ACTIONS: { key: ActionKey; emoji: string; label: string; sub: string }[] = [
  { key: 'stock_update',        emoji: '📊', label: 'Stock Update',        sub: 'Log current stock level — enter qty sold' },
  { key: 'new_order',           emoji: '📦', label: 'New Order',           sub: 'They want more stock — create allocation' },
  { key: 'payment_collection',  emoji: '💰', label: 'Payment Collected',   sub: 'Collected cash against outstanding credit' },
  { key: 'relationship_visit',  emoji: '🤝', label: 'Relationship Visit',  sub: 'Just visited, no specific action' },
  { key: 'no_longer_active',    emoji: '❌', label: 'No Longer Active',    sub: 'Stopped selling / changed supplier' },
]

export default function RevisitLogger({ party, onBack, onDone }: Props) {
  const { appUser } = useAuth()
  const { t } = useTheme()
  const [products, setProducts] = useState<Product[]>([])
  const [selectedActions, setSelectedActions] = useState<Set<ActionKey>>(new Set())
  const [saving, setSaving] = useState(false)

  // Stock update state
  const [stockProductId, setStockProductId] = useState('')
  const [soldQtyInput, setSoldQtyInput] = useState('')

  // New order state
  const [orderProduct, setOrderProduct] = useState<Product | null>(null)
  const [orderQty, setOrderQty] = useState('')
  const [orderPrice, setOrderPrice] = useState('')
  const [orderPayment, setOrderPayment] = useState<'cash' | 'credit'>('cash')
  const [orderDate, setOrderDate] = useState(today2())

  // Payment state
  const [paymentAmount, setPaymentAmount] = useState('')
  const [paymentNote, setPaymentNote] = useState('')

  // Relationship visit / no longer active
  const [visitNote, setVisitNote] = useState('')
  const [inactiveReason, setInactiveReason] = useState('')

  const [allocations, setAllocations] = useState<any[]>([])
  const [subRetailers, setSubRetailers] = useState<Party[]>([])
  const [distributions, setDistributions] = useState<Record<string, { qty: string; pricePerUnit: string; payment: 'cash' | 'credit' }>>({})

  const partyLabel = party.type === 'distributor' ? '🚚 Distributor' : '🏪 Retailer'
  const isUnderDistributor = party.type === 'retailer' && !!(party as any).underDistributorId

  const actionOptions = [
    ...BASE_ACTIONS.filter(a => !(isUnderDistributor && a.key === 'payment_collection')),
    ...(party.type === 'distributor'
      ? [{ key: 'distribute_to_retailers' as ActionKey, emoji: '📋', label: 'Distribute to Retailers', sub: 'Log stock pushed out to your retailer network' }]
      : []),
  ]

  useEffect(() => {
    return onSnapshot(collection(db, 'products'), snap =>
      setProducts(snap.docs.map(d => ({ id: d.id, ...d.data() } as Product)).filter(p => p.active)))
  }, [])

  useEffect(() => {
    const q = query(collection(db, 'allocations_v2'), where('partyId', '==', party.id!))
    return onSnapshot(q, snap => setAllocations(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
  }, [party.id])

  useEffect(() => {
    if (party.type !== 'distributor') return
    const q = query(collection(db, 'parties'), where('underDistributorId', '==', party.id!))
    return onSnapshot(q, snap => setSubRetailers(snap.docs.map(d => ({ id: d.id, ...d.data() } as Party))))
  }, [party.id, party.type])

  const outstandingAllocs = allocations.filter(a => a.paymentType === 'credit' && (a.status === 'sent' || a.status === 'overdue'))
  const outstandingAmount = outstandingAllocs.reduce((s: number, a: any) => s + (a.totalAmount || 0), 0)

  useEffect(() => {
    if (orderProduct) setOrderPrice(String(orderProduct.defaultPricePerUnit))
  }, [orderProduct])

  const toggleAction = (key: ActionKey) => {
    setSelectedActions(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  // Stock update computed values
  const stockOpening = stockProductId ? ((party.stock?.[stockProductId]) || 0) : 0
  const stockSold = parseInt(soldQtyInput) || 0
  const stockBalance = Math.max(0, stockOpening - stockSold)

  // ── Save ─────────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (selectedActions.size === 0) return
    setSaving(true)
    try {
      const actions: RevisitAction[] = []

      if (selectedActions.has('stock_update') && stockProductId && stockSold > 0) {
        actions.push({
          type: 'stock_update',
          openingQty: stockOpening,
          purchasedQty: 0,
          soldQty: stockSold,
          balanceQty: stockBalance,
          balanceValue: 0,
          aiRead: false,
        } as StockUpdateAction)
        await updateDoc(doc(db, 'parties', party.id!), {
          [`stock.${stockProductId}`]: increment(-stockSold),
        })
      }

      if (selectedActions.has('new_order') && orderProduct && orderQty) {
        const qty = parseInt(orderQty)
        const todayDate = new Date().toISOString().split('T')[0]
        let allocRef: any
        if (isUnderDistributor) {
          allocRef = await addDoc(collection(db, 'allocations_v2'), {
            fromType: 'distributor',
            fromId: (party as any).underDistributorId,
            fromName: (party as any).underDistributorName || '',
            partyId: party.id!, partyName: party.name, partyType: party.type,
            productId: orderProduct.id!, productName: orderProduct.name,
            packets: qty, cartons: Math.floor(qty / orderProduct.unitsPerCarton),
            pricePerPacket: 0, totalAmount: 0,
            paymentType: 'cash', plannedDate: todayDate,
            status: 'pending', notes: '',
            createdBy: appUser!.uid, createdByName: appUser!.name,
            createdAt: Date.now(), month: todayDate.slice(0, 7),
            lockedAtCreation: false,
          })
        } else {
          const price = parseFloat(orderPrice) || orderProduct.defaultPricePerUnit
          allocRef = await addDoc(collection(db, 'allocations_v2'), {
            fromType: 'company', fromId: 'company', fromName: 'Ocealgo',
            partyId: party.id!, partyName: party.name, partyType: party.type,
            productId: orderProduct.id!, productName: orderProduct.name,
            packets: qty, cartons: Math.floor(qty / orderProduct.unitsPerCarton),
            pricePerPacket: price, totalAmount: qty * price,
            paymentType: orderPayment, plannedDate: orderDate,
            status: 'pending', notes: '',
            createdBy: appUser!.uid, createdByName: appUser!.name,
            createdAt: Date.now(), month: orderDate.slice(0, 7),
            lockedAtCreation: true,
          })
        }
        await updateDoc(doc(db, 'parties', party.id!), { status: 'active' })
        actions.push({
          type: 'new_order',
          productId: orderProduct.id!, productName: orderProduct.name,
          quantity: qty, pricePerUnit: 0, totalAmount: 0,
          paymentType: 'cash', plannedDate: todayDate,
          allocationId: allocRef.id,
        } as NewOrderAction)
      }

      if (selectedActions.has('payment_collection') && paymentAmount) {
        actions.push({
          type: 'payment_collection',
          amount: parseFloat(paymentAmount),
          notes: paymentNote,
          status: 'pending_approval',
        } as PaymentCollectionAction)
        await addDoc(collection(db, 'alerts'), {
          type: 'payment_collected',
          message: `💰 ${appUser!.name} collected ₹${parseFloat(paymentAmount).toLocaleString()} from ${party.name} — pending approval`,
          relatedId: party.id!, read: false, createdAt: Date.now(),
        })
      }

      if (selectedActions.has('relationship_visit')) {
        actions.push({ type: 'relationship_visit', notes: visitNote })
      }

      if (selectedActions.has('no_longer_active')) {
        actions.push({ type: 'no_longer_active', reason: inactiveReason })
        await updateDoc(doc(db, 'parties', party.id!), { status: 'prospect', inactiveReason })
      }

      if (selectedActions.has('distribute_to_retailers')) {
        const todayDate = new Date().toISOString().split('T')[0]
        for (const [retailerId, data] of Object.entries(distributions)) {
          const qty = parseInt(data.qty) || 0
          if (qty <= 0) continue
          const retailer = subRetailers.find(r => r.id === retailerId)
          if (!retailer) continue
          const price = parseFloat(data.pricePerUnit) || 0
          const mov: Omit<StockMovement, 'id'> = {
            fromId: party.id!, fromName: party.name,
            toPartyId: retailerId, toPartyName: retailer.name,
            packets: qty, cartons: 0,
            pricePerPacket: price, totalAmount: qty * price,
            paymentType: data.payment, notes: '',
            month: todayDate.slice(0, 7),
            loggedBy: appUser!.uid, loggedByName: appUser!.name,
            date: todayDate, createdAt: Date.now(),
          }
          await addDoc(collection(db, 'stock_movements'), mov)
        }
      }

      await addDoc(collection(db, 'revisit_logs'), {
        partyId: party.id!, partyName: party.name, partyType: party.type,
        salesPersonId: appUser!.uid, salesPersonName: appUser!.name,
        date: new Date().toISOString().split('T')[0],
        actions, notes: visitNote, createdAt: Date.now(),
      })

      onDone()
    } finally { setSaving(false) }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', background: t.bg3, border: `1.5px solid ${t.border2}`,
    borderRadius: 12, padding: '13px 16px', fontSize: 16,
    color: t.text, outline: 'none', boxSizing: 'border-box',
  }

  const hasAnyDistribution = Object.values(distributions).some(d => (parseInt(d.qty) || 0) > 0)
  const canSave = selectedActions.size > 0 &&
    (!selectedActions.has('stock_update') || (!!stockProductId && stockSold > 0)) &&
    (!selectedActions.has('new_order') || (!!orderProduct && !!orderQty)) &&
    (!selectedActions.has('payment_collection') || !!paymentAmount) &&
    (!selectedActions.has('distribute_to_retailers') || hasAnyDistribution)

  return (
    <div style={{ minHeight: '100vh', background: t.bg, paddingBottom: 40 }}>
      {/* Header */}
      <div style={{ background: 'linear-gradient(135deg,#0d3d2e,#1a5c42)', padding: '20px 20px 20px' }}>
        <button onClick={onBack} style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: '#6ee7b7', padding: '6px 14px', borderRadius: 20, fontSize: 13, marginBottom: 14 }}>← Back</button>
        <div style={{ fontSize: 13, color: '#a7f3d0' }}>{partyLabel}</div>
        <div style={{ fontSize: 22, fontWeight: 900, color: '#fff' }}>{party.name}</div>
        <div style={{ fontSize: 13, color: '#a7f3d0', marginTop: 3 }}>
          {party.place || party.address} •
          <span style={{ color: (party as any).status === 'active' ? '#86efac' : '#fde68a', marginLeft: 6 }}>
            {(party as any).status === 'active' ? '🟢 Active' : '🟡 Prospect'}
          </span>
        </div>
        {outstandingAmount > 0 && (
          <div style={{ background: 'rgba(220,38,38,0.2)', border: '1px solid rgba(220,38,38,0.35)', borderRadius: 12, padding: '10px 14px', marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 10, color: '#fca5a5', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700 }}>Outstanding Credit</div>
              <div style={{ fontSize: 22, fontWeight: 900, color: '#f87171', lineHeight: 1.2 }}>₹{outstandingAmount.toLocaleString()}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 11, color: '#fca5a5' }}>{outstandingAllocs.length} unpaid dispatch{outstandingAllocs.length > 1 ? 'es' : ''}</div>
              <div style={{ fontSize: 10, color: 'rgba(252,165,165,0.7)', marginTop: 2 }}>Collect before new order</div>
            </div>
          </div>
        )}
      </div>

      <div style={{ padding: '16px 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ fontSize: 14, color: t.text2, fontWeight: 700 }}>What happened during this visit? <span style={{ color: t.text3, fontWeight: 400 }}>(select all that apply)</span></div>

        {actionOptions.map(opt => {
          const active = selectedActions.has(opt.key)
          return (
            <div key={opt.key}>
              <button onClick={() => toggleAction(opt.key)}
                style={{ width: '100%', background: active ? 'rgba(22,163,74,0.1)' : t.card, border: `2px solid ${active ? '#16a34a' : t.border}`, borderRadius: 14, padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 14, textAlign: 'left', cursor: 'pointer' }}>
                <span style={{ fontSize: 26 }}>{opt.emoji}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 16, color: active ? '#16a34a' : t.text }}>{opt.label}</div>
                  <div style={{ fontSize: 13, color: t.text2, marginTop: 2 }}>{opt.sub}</div>
                </div>
                <div style={{ width: 22, height: 22, borderRadius: '50%', border: `2px solid ${active ? '#16a34a' : t.border2}`, background: active ? '#16a34a' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  {active && <span style={{ color: '#fff', fontSize: 13, fontWeight: 900 }}>✓</span>}
                </div>
              </button>

              {active && (
                <div style={{ background: t.card, borderRadius: '0 0 14px 14px', padding: '16px', border: `2px solid #16a34a`, borderTop: 'none', marginTop: -2, display: 'flex', flexDirection: 'column', gap: 12 }}>

                  {/* STOCK UPDATE */}
                  {opt.key === 'stock_update' && (
                    <>
                      <div style={{ fontSize: 11, color: t.text3, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 2 }}>Product</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {products.map(p => (
                          <button key={p.id} onClick={() => setStockProductId(p.id!)}
                            style={{ background: stockProductId === p.id ? 'rgba(22,163,74,0.12)' : t.bg3, border: `1.5px solid ${stockProductId === p.id ? '#16a34a' : t.border}`, borderRadius: 10, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left' }}>
                            <span style={{ fontSize: 18 }}>📦</span>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontWeight: 700, fontSize: 14, color: stockProductId === p.id ? '#16a34a' : t.text }}>{p.name}</div>
                              <div style={{ fontSize: 11, color: t.text3 }}>
                                Current stock: {(party.stock?.[p.id!]) ?? 0} {p.unitLabel}
                              </div>
                            </div>
                            {stockProductId === p.id && <span style={{ color: '#16a34a' }}>✓</span>}
                          </button>
                        ))}
                      </div>
                      {stockProductId && (
                        <>
                          <div style={{ background: 'rgba(8,145,178,0.08)', borderRadius: 10, padding: '10px 12px', fontSize: 12, color: '#0891b2' }}>
                            💡 Enter qty sold — balance calculates automatically
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                            <div>
                              <div style={{ fontSize: 10, color: t.text3, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>Opening Qty</div>
                              <div style={{ ...inputStyle, fontSize: 16, fontWeight: 900, color: '#94a3b8', display: 'flex', alignItems: 'center' }}>
                                {stockOpening}
                              </div>
                            </div>
                            <div>
                              <div style={{ fontSize: 10, color: t.text3, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>Qty Sold</div>
                              <input type="number" value={soldQtyInput} onChange={e => setSoldQtyInput(e.target.value)}
                                placeholder="0" style={{ ...inputStyle, fontSize: 16, fontWeight: 700 }} />
                            </div>
                          </div>
                          <div>
                            <div style={{ fontSize: 10, color: '#6ee7b7', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>Balance Qty</div>
                            <div style={{ ...inputStyle, fontSize: 18, fontWeight: 900, color: stockBalance > 0 ? '#6ee7b7' : '#f87171', background: 'rgba(22,163,74,0.08)', display: 'flex', alignItems: 'center' }}>
                              {stockBalance}
                            </div>
                          </div>
                        </>
                      )}
                    </>
                  )}

                  {/* NEW ORDER */}
                  {opt.key === 'new_order' && (
                    <>
                      {isUnderDistributor && (
                        <div style={{ background: 'rgba(8,145,178,0.08)', border: '1px solid rgba(8,145,178,0.2)', borderRadius: 10, padding: '10px 12px', fontSize: 12, color: '#0891b2' }}>
                          🚚 Stock via <strong>{(party as any).underDistributorName}</strong> — allocation will be created under that distributor
                        </div>
                      )}
                      <div style={{ fontSize: 12, color: t.text3, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>Product</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {products.map(p => (
                          <button key={p.id} onClick={() => setOrderProduct(p)}
                            style={{ background: orderProduct?.id === p.id ? 'rgba(22,163,74,0.12)' : t.bg3, border: `1.5px solid ${orderProduct?.id === p.id ? '#16a34a' : t.border}`, borderRadius: 10, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left' }}>
                            <span style={{ fontSize: 20 }}>📦</span>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontWeight: 700, fontSize: 14, color: orderProduct?.id === p.id ? '#16a34a' : t.text }}>{p.name}</div>
                              <div style={{ fontSize: 12, color: t.text2 }}>₹{p.defaultPricePerUnit}/{p.unitLabel}</div>
                            </div>
                            {orderProduct?.id === p.id && <span style={{ color: '#16a34a' }}>✓</span>}
                          </button>
                        ))}
                      </div>
                      {orderProduct && (
                        <>
                          <div>
                            <div style={{ fontSize: 12, color: t.text3, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>Quantity ({orderProduct.unitLabel})</div>
                            <input type="number" value={orderQty} onChange={e => setOrderQty(e.target.value)}
                              placeholder={`No. of ${orderProduct.unitLabel}`} style={inputStyle} />
                          </div>
                          {isUnderDistributor && orderQty && parseInt(orderQty) > 0 && (
                            <>
                              <div style={{ background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.2)', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: '#6ee7b7', fontWeight: 600 }}>
                                📦 {parseInt(orderQty)} {orderProduct.unitLabel} of {orderProduct.name} → {(party as any).underDistributorName}
                              </div>
                              <button onClick={handleSave} disabled={saving}
                                style={{ background: saving ? '#475569' : 'linear-gradient(135deg,#0d3d2e,#1a5c42)', color: '#fff', border: 'none', borderRadius: 12, padding: '14px', fontSize: 15, fontWeight: 800 }}>
                                {saving ? 'Placing...' : '📦 Place Order'}
                              </button>
                            </>
                          )}
                          {!isUnderDistributor && (
                            <>
                              <div>
                                <div style={{ fontSize: 12, color: t.text3, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>Price per {orderProduct.unitLabel} (₹)</div>
                                <input type="number" value={orderPrice} onChange={e => setOrderPrice(e.target.value)}
                                  placeholder={`₹${orderProduct.defaultPricePerUnit}`} style={inputStyle} />
                                {orderQty && orderPrice && (
                                  <div style={{ fontSize: 13, color: '#6ee7b7', marginTop: 5, fontWeight: 600 }}>
                                    Total: ₹{(parseInt(orderQty) * parseFloat(orderPrice)).toLocaleString()}
                                  </div>
                                )}
                              </div>
                              <div style={{ display: 'flex', gap: 8 }}>
                                {([['cash', '💵 Cash'], ['credit', '📋 Credit']] as const).map(([val, label]) => (
                                  <button key={val} onClick={() => setOrderPayment(val)}
                                    style={{ flex: 1, background: orderPayment === val ? (val === 'cash' ? 'rgba(22,163,74,0.15)' : 'rgba(217,119,6,0.15)') : t.bg3, color: orderPayment === val ? (val === 'cash' ? '#16a34a' : '#d97706') : t.text2, border: `1.5px solid ${orderPayment === val ? (val === 'cash' ? '#16a34a' : '#d97706') : t.border}`, borderRadius: 10, padding: '10px', fontSize: 13, fontWeight: 800 }}>
                                    {label}
                                  </button>
                                ))}
                              </div>
                              <div>
                                <div style={{ fontSize: 12, color: t.text3, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>Planned Delivery Date</div>
                                <input type="date" value={orderDate} onChange={e => setOrderDate(e.target.value)} style={inputStyle} />
                              </div>
                            </>
                          )}
                        </>
                      )}
                    </>
                  )}

                  {/* DISTRIBUTE TO RETAILERS */}
                  {opt.key === 'distribute_to_retailers' && (
                    <>
                      {subRetailers.length === 0 ? (
                        <div style={{ fontSize: 13, color: t.text3, textAlign: 'center', padding: 12 }}>
                          No retailers linked under this distributor yet.
                        </div>
                      ) : subRetailers.map(r => {
                        const dist = distributions[r.id!] || { qty: '', pricePerUnit: '', payment: 'cash' as const }
                        const setDist = (key: string, val: string) =>
                          setDistributions(prev => ({ ...prev, [r.id!]: { ...dist, [key]: val } }))
                        const total = (parseInt(dist.qty) || 0) * (parseFloat(dist.pricePerUnit) || 0)
                        return (
                          <div key={r.id} style={{ background: t.bg3, borderRadius: 12, padding: 14, border: `1.5px solid ${dist.qty ? '#16a34a33' : t.border}` }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                              <span style={{ fontSize: 16 }}>🏪</span>
                              <div>
                                <div style={{ fontWeight: 700, fontSize: 14, color: t.text }}>{r.name}</div>
                                <div style={{ fontSize: 11, color: t.text3 }}>{r.place || r.address}</div>
                              </div>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                              <div>
                                <div style={{ fontSize: 10, color: t.text3, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>Qty (packets)</div>
                                <input type="number" value={dist.qty} onChange={e => setDist('qty', e.target.value)}
                                  placeholder="0" style={{ ...inputStyle, fontSize: 15, fontWeight: 700 }} />
                              </div>
                              <div>
                                <div style={{ fontSize: 10, color: t.text3, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>Price/packet (₹)</div>
                                <input type="number" value={dist.pricePerUnit} onChange={e => setDist('pricePerUnit', e.target.value)}
                                  placeholder="0" style={{ ...inputStyle, fontSize: 15, fontWeight: 700 }} />
                              </div>
                            </div>
                            {total > 0 && (
                              <div style={{ fontSize: 13, color: '#6ee7b7', fontWeight: 600, marginBottom: 8 }}>
                                Total: ₹{total.toLocaleString()}
                              </div>
                            )}
                            <div style={{ display: 'flex', gap: 6 }}>
                              {(['cash', 'credit'] as const).map(p => (
                                <button key={p} onClick={() => setDist('payment', p)}
                                  style={{ flex: 1, background: dist.payment === p ? (p === 'cash' ? 'rgba(22,163,74,0.15)' : 'rgba(217,119,6,0.15)') : t.bg3, color: dist.payment === p ? (p === 'cash' ? '#16a34a' : '#d97706') : t.text2, border: `1.5px solid ${dist.payment === p ? (p === 'cash' ? '#16a34a' : '#d97706') : t.border}`, borderRadius: 8, padding: '8px', fontSize: 12, fontWeight: 700 }}>
                                  {p === 'cash' ? '💵 Cash' : '📋 Credit'}
                                </button>
                              ))}
                            </div>
                          </div>
                        )
                      })}
                    </>
                  )}

                  {/* PAYMENT COLLECTION */}
                  {opt.key === 'payment_collection' && (
                    <>
                      <div style={{ background: 'rgba(217,119,6,0.1)', border: '1px solid rgba(217,119,6,0.2)', borderRadius: 10, padding: '10px 12px', fontSize: 12, color: '#d97706' }}>
                        ⏳ Payment logged as pending — admin needs to approve
                      </div>
                      <div>
                        <div style={{ fontSize: 12, color: t.text3, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>Amount Collected (₹)</div>
                        <input type="number" value={paymentAmount} onChange={e => setPaymentAmount(e.target.value)}
                          placeholder="e.g. 4500" style={{ ...inputStyle, fontSize: 22, fontWeight: 900 }} />
                      </div>
                      <div>
                        <div style={{ fontSize: 12, color: t.text3, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>Notes</div>
                        <textarea value={paymentNote} onChange={e => setPaymentNote(e.target.value)}
                          placeholder="Any notes about this payment..." rows={2}
                          style={{ ...inputStyle, resize: 'none' }} />
                      </div>
                    </>
                  )}

                  {/* RELATIONSHIP VISIT */}
                  {opt.key === 'relationship_visit' && (
                    <div>
                      <div style={{ fontSize: 12, color: t.text3, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>Notes (optional)</div>
                      <textarea value={visitNote} onChange={e => setVisitNote(e.target.value)}
                        placeholder="What was discussed? Any feedback?" rows={3}
                        style={{ ...inputStyle, resize: 'none' }} />
                    </div>
                  )}

                  {/* NO LONGER ACTIVE */}
                  {opt.key === 'no_longer_active' && (
                    <div>
                      <div style={{ fontSize: 12, color: t.text3, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>Reason</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {['Stopped selling our product', 'Changed supplier', 'Closed down', 'Low sales / not profitable', 'Other'].map(r => (
                          <button key={r} onClick={() => setInactiveReason(r)}
                            style={{ background: inactiveReason === r ? 'rgba(220,38,38,0.12)' : t.bg3, color: inactiveReason === r ? '#dc2626' : t.text2, border: `1.5px solid ${inactiveReason === r ? '#dc2626' : t.border}`, borderRadius: 10, padding: '11px 14px', fontSize: 14, textAlign: 'left', fontWeight: inactiveReason === r ? 700 : 400 }}>
                            {inactiveReason === r ? '● ' : '○ '}{r}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}

        <button onClick={handleSave} disabled={saving || !canSave}
          style={{ background: saving ? '#475569' : canSave ? 'linear-gradient(135deg,#0d3d2e,#1a5c42)' : '#334155', color: '#fff', border: 'none', borderRadius: 14, padding: 18, fontSize: 16, fontWeight: 800, opacity: !canSave ? 0.5 : 1, marginTop: 8 }}>
          {saving ? 'Saving...' : 'Save Visit Log ✅'}
        </button>
      </div>
    </div>
  )
}
