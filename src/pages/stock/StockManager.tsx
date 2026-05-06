import React, { useState, useEffect } from 'react'
import { collection, addDoc, onSnapshot, doc, updateDoc, query, where } from 'firebase/firestore'
import { db } from '../../firebase'
import { Party, Dispatch, MonthlyRequest, PaymentType, Product } from '../../types'
import DateInput from '../../components/DateInput'
import { useAuth } from '../../context/AuthContext'
import { useStockConfig, updateStockConfig, toDisplay, setProductStock } from '../../hooks/useFirebase'
import CustomSelect from '../../components/CustomSelect'
import { useConfirm } from '../../hooks/useConfirm'

interface Props { onBack: () => void }


// ── Default Price Editor (defined outside to prevent re-mount) ────────────────
function DefaultPriceEditor() {
  const [editing, setEditing] = React.useState(false)
  const [val, setVal] = React.useState('')
  const [current, setCurrent] = React.useState(0)
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    import('firebase/firestore').then(({ getDoc, doc }) => {
      getDoc(doc(db, 'config', 'stock')).then(snap => {
        if (snap.exists()) setCurrent(snap.data().defaultPricePerPacket || 0)
      })
    })
  }, [])

  const handleSave = async () => {
    const price = parseFloat(val)
    if (isNaN(price) || price <= 0) return
    setSaving(true)
    try {
      const { getDoc, setDoc, doc } = await import('firebase/firestore')
      const snap = await getDoc(doc(db, 'config', 'stock'))
      const existing = snap.exists() ? snap.data() : {}
      await setDoc(doc(db, 'config', 'stock'), { ...existing, defaultPricePerPacket: price, updatedAt: Date.now() })
      setCurrent(price)
      setEditing(false)
      setVal('')
    } finally { setSaving(false) }
  }

  return editing ? (
    <div style={{ display: 'flex', gap: 8 }}>
      <input type="number" value={val} onChange={e => setVal(e.target.value)}
        placeholder="Price per packet"
        style={{ flex: 1, background: 'rgba(255,255,255,0.06)', border: '1.5px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '10px 14px', fontSize: 14, color: '#fff', outline: 'none' }} />
      <button onClick={handleSave} disabled={saving}
        style={{ background: '#16a34a', border: 'none', color: '#fff', borderRadius: 10, padding: '0 16px', fontWeight: 800, fontSize: 13 }}>
        {saving ? '...' : 'Save'}
      </button>
      <button onClick={() => setEditing(false)}
        style={{ background: 'rgba(255,255,255,0.06)', border: 'none', color: '#64748b', borderRadius: 10, padding: '0 14px', fontSize: 13 }}>Cancel</button>
    </div>
  ) : (
    <button onClick={() => { setEditing(true); setVal(String(current || '')) }}
      style={{ background: 'rgba(22,163,74,0.1)', border: '1px solid rgba(22,163,74,0.2)', color: '#16a34a', borderRadius: 10, padding: '10px 16px', fontSize: 13, fontWeight: 700, width: '100%' }}>
      💰 Default: {current > 0 ? `₹${current}/packet` : 'Not set'} — tap to edit
    </button>
  )
}

export default function StockManager({ onBack }: Props) {
  const { appUser } = useAuth()
  const { modal, showAlert } = useConfirm()
  const { config } = useStockConfig()
  const [parties, setParties] = useState<Party[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [dispatches, setDispatches] = useState<Dispatch[]>([])
  const [requests, setRequests] = useState<MonthlyRequest[]>([])
  const [tab, setTab] = useState<'overview' | 'dispatch' | 'history' | 'monthly'>('overview')
  const [unit, setUnit] = useState<'packets' | 'cartons'>('packets')
  const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7))
  const [saving, setSaving] = useState(false)
  const [editCarton, setEditCarton] = useState(false)
  const [newCarton, setNewCarton] = useState('')
  const [editingProductActive, setEditingProductActive] = useState<string | null>(null)
  const [editingProductStock, setEditingProductStock] = useState<Record<string, string>>({})
  const [form, setForm] = useState({ partyId: '', quantity: '', paymentType: 'cash' as PaymentType, notes: '' })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [partyStatusFilter, setPartyStatusFilter] = useState<'all' | 'active' | 'prospect' | 'inactive'>('all')

  const isAdmin = appUser?.role === 'super_admin' || appUser?.role === 'admin'
  const available = config.total - config.locked

  // Aggregate display values from per-product stock
  const hasProductStock = config.productStock && Object.keys(config.productStock).length > 0
  const displayTotal = hasProductStock ? Object.values(config.productStock!).reduce((s, p) => s + p.total, 0) : config.total
  const displayLocked = hasProductStock ? Object.values(config.productStock!).reduce((s, p) => s + p.locked, 0) : config.locked
  const displayAvailable = displayTotal - displayLocked

  useEffect(() => {
    const u1 = onSnapshot(collection(db, 'parties'), s => setParties(s.docs.map(d => ({ id: d.id, ...d.data() } as Party))))
    const u2 = onSnapshot(collection(db, 'dispatches'), s => setDispatches(s.docs.map(d => ({ id: d.id, ...d.data() } as Dispatch)).sort((a, b) => b.createdAt - a.createdAt)))
    const u3 = onSnapshot(collection(db, 'monthly_requests'), s => setRequests(s.docs.map(d => ({ id: d.id, ...d.data() } as MonthlyRequest))))
    const u4 = onSnapshot(collection(db, 'products'), s => setProducts(s.docs.map(d => ({ id: d.id, ...d.data() } as Product)).filter(p => p.active)))
    return () => { u1(); u2(); u3(); u4() }
  }, [])

  const toPackets = (qty: string) => {
    const n = parseInt(qty) || 0
    return unit === 'cartons' ? n * config.packetsPerCarton : n
  }

  const handleSaveProductStock = async (productId: string) => {
    const val = parseInt(editingProductStock[productId] || '')
    if (isNaN(val) || val < 0) return
    await setProductStock(productId, val)
    setEditingProductActive(null)
  }

  const updateCarton = async () => {
    const val = parseInt(newCarton)
    if (isNaN(val) || val < 1) return
    await updateStockConfig({ packetsPerCarton: val })
    setEditCarton(false); setNewCarton('')
  }

  const validate = () => {
    const e: Record<string, string> = {}
    if (!form.partyId) e.partyId = 'Select a distributor or retailer'
    if (!form.quantity || parseInt(form.quantity) <= 0) e.quantity = 'Enter quantity'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const handleDispatch = async () => {
    if (!validate()) return
    const packets = toPackets(form.quantity)
    const cartons = unit === 'cartons' ? parseInt(form.quantity) : Math.floor(packets / config.packetsPerCarton)
    if (packets > available) { await showAlert('Insufficient Stock', `Only ${toDisplay(available, config.packetsPerCarton)} available.`); return }
    const party = parties.find(p => p.id === form.partyId)!
    setSaving(true)
    try {
      const now = Date.now()
      const dispatchData: any = {
        partyId: form.partyId, partyName: party.name, partyType: party.type,
        packets, cartons, pricePerPacket: party.pricePerPacket,
        totalAmount: packets * party.pricePerPacket,
        paymentType: form.paymentType, notes: form.notes,
        month: selectedMonth,
        dispatchedBy: appUser!.uid, dispatchedByName: appUser!.name,
        dispatchedAt: now, date: new Date().toISOString().split('T')[0],
        createdAt: now,
      }

      // Link to monthly request if exists
      const linkedReq = requests.find(r => r.partyId === form.partyId && r.month === selectedMonth)
      if (linkedReq) {
        dispatchData.requestId = linkedReq.id
        const newFulfilled = linkedReq.fulfilledPackets + packets
        const newStatus = newFulfilled >= linkedReq.requestedPackets ? 'fulfilled' : 'partial'
        await updateDoc(doc(db, 'monthly_requests', linkedReq.id!), {
          fulfilledPackets: newFulfilled, status: newStatus, updatedAt: now,
        })
      }

      await addDoc(collection(db, 'dispatches'), dispatchData)
      await updateStockConfig({ locked: config.locked + packets })

      if (form.paymentType === 'credit') {
        await addDoc(collection(db, 'credits'), {
          partyId: form.partyId, partyName: party.name, partyType: party.type,
          deliveryId: 'dispatch', packets, amount: packets * party.pricePerPacket,
          status: 'outstanding', createdAt: now,
        })
      }

      // Low stock alert + auto-reminder
      const remaining = available - packets
      if (party.lowStockThreshold && remaining <= party.lowStockThreshold) {
        await addDoc(collection(db, 'alerts'), {
          type: 'low_stock',
          message: `⚠️ ${party.name} low — only ${toDisplay(remaining, config.packetsPerCarton)} remaining`,
          relatedId: form.partyId, read: false, createdAt: now,
        })
        // Auto-create workspace reminder
        await addDoc(collection(db, 'reminders'), {
          title: `⚠️ Restock: ${party.name} — only ${toDisplay(remaining, config.packetsPerCarton)} remaining`,
          date: new Date().toISOString().split('T')[0],
          category: 'Operations',
          type: 'low_stock',
          linkedId: form.partyId,
          linkedType: 'party',
          createdBy: appUser!.uid,
          createdByName: appUser!.name,
          done: false,
          createdAt: now,
        })
      }

      // Dispatched alert for sales
      await addDoc(collection(db, 'alerts'), {
        type: 'stock_dispatched',
        message: `✅ ${toDisplay(packets, config.packetsPerCarton)} dispatched to ${party.name} on ${new Date().toLocaleString('en-IN')}`,
        relatedId: form.partyId, read: false, createdAt: now,
      })

      setForm({ partyId: '', quantity: '', paymentType: 'cash', notes: '' })
      setErrors({})
      setTab('history')
    } finally {
      setSaving(false)
    }
  }

  const confirmDelivery = async (d: Dispatch) => {
    await updateStockConfig({ total: config.total - d.packets, locked: Math.max(0, config.locked - d.packets) })
    await updateDoc(doc(db, 'dispatches', d.id!), { confirmed: true })
  }

  const filteredParties = partyStatusFilter === 'all'
    ? parties
    : parties.filter(p => (p as any).status === partyStatusFilter)

  const partyOptions = filteredParties.map(p => ({
    value: p.id!, label: `${p.type === 'distributor' ? '🚚' : '🏪'} ${p.name}`,
    sub: `₹${p.pricePerPacket}/pkt · ${p.place || p.address}`,
    group: p.type === 'distributor' ? 'Distributors' : 'Retailers',
  }))

  const monthlyDispatches = dispatches.filter(d => d.month === selectedMonth)
  const monthlyTotal = monthlyDispatches.reduce((s, d) => s + d.packets, 0)
  const monthlyRevenue = monthlyDispatches.reduce((s, d) => s + d.totalAmount, 0)

  return (
    <div style={{ minHeight: '100vh', background: '#0d1117', paddingBottom: 40 }}>
      <div style={{ background: 'linear-gradient(135deg,#1a5c42,#16a34a)', padding: '24px 20px 0' }}>
        <button onClick={onBack} style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: '#bbf7d0', padding: '6px 14px', borderRadius: 20, fontSize: 12, marginBottom: 16 }}>← Back</button>
        <div style={{ color: '#bbf7d0', fontSize: 11, letterSpacing: 3, textTransform: 'uppercase', marginBottom: 4 }}>Inventory 📦</div>
        <div style={{ fontSize: 22, fontWeight: 900, marginBottom: 16 }}>Stock Management</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {[
            { label: 'Total', val: toDisplay(displayTotal, config.packetsPerCarton), color: '#fff' },
            { label: 'Locked', val: toDisplay(displayLocked, config.packetsPerCarton), color: '#fde68a' },
            { label: 'Available', val: toDisplay(displayAvailable, config.packetsPerCarton), color: '#86efac' },
          ].map(s => (
            <div key={s.label} style={{ flex: 1, background: 'rgba(0,0,0,0.2)', borderRadius: 12, padding: '10px 6px', textAlign: 'center' }}>
              <div style={{ fontSize: 12, fontWeight: 900, color: s.color, lineHeight: 1.3 }}>{s.val}</div>
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.5)', marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 4, overflowX: 'auto' }}>
          {(['overview', 'dispatch', 'history', 'monthly'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              style={{ flex: 1, background: tab === t ? 'rgba(255,255,255,0.2)' : 'transparent', color: tab === t ? '#fff' : 'rgba(255,255,255,0.5)', border: 'none', borderRadius: '10px 10px 0 0', padding: '9px 4px', fontSize: 10, fontWeight: 800, whiteSpace: 'nowrap' }}>
              {t === 'overview' ? '📊 Overview' : t === 'dispatch' ? '📦 Dispatch' : t === 'history' ? '📋 History' : '📅 Monthly'}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: '16px 14px' }}>

        {/* OVERVIEW */}
        {tab === 'overview' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {isAdmin && (
              <>
                <div style={{ background: '#161b22', borderRadius: 14, padding: 16, border: '1px solid rgba(255,255,255,0.06)' }}>
                  <div style={{ fontSize: 12, color: '#64748b', marginBottom: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>⚙️ Carton Setting</div>
                  {editCarton ? (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input type="number" value={newCarton} onChange={e => setNewCarton(e.target.value)} placeholder="Packets per carton"
                        style={{ flex: 1, background: 'rgba(255,255,255,0.06)', border: '1.5px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '11px 14px', fontSize: 14, color: '#fff', outline: 'none' }} />
                      <button onClick={updateCarton} style={{ background: '#16a34a', border: 'none', color: '#fff', borderRadius: 10, padding: '0 16px', fontWeight: 800, fontSize: 13 }}>Save</button>
                      <button onClick={() => setEditCarton(false)} style={{ background: 'rgba(255,255,255,0.06)', border: 'none', color: '#64748b', borderRadius: 10, padding: '0 14px', fontSize: 13 }}>Cancel</button>
                    </div>
                  ) : (
                    <button onClick={() => setEditCarton(true)}
                      style={{ background: 'rgba(22,163,74,0.1)', border: '1px solid rgba(22,163,74,0.2)', color: '#16a34a', borderRadius: 10, padding: '10px 16px', fontSize: 13, fontWeight: 700, width: '100%' }}>
                      📫 1 Carton = {config.packetsPerCarton} packets — tap to edit
                    </button>
                  )}
                </div>
                <div style={{ background: '#161b22', borderRadius: 14, padding: 16, border: '1px solid rgba(255,255,255,0.06)' }}>
                  <div style={{ fontSize: 12, color: '#64748b', marginBottom: 12, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>📦 Stock Per Product</div>
                  {products.length === 0 ? (
                    <div style={{ fontSize: 12, color: '#64748b', textAlign: 'center', padding: '12px 0' }}>No active products. Add products in Products section first.</div>
                  ) : products.map((p, idx) => {
                    const pStk = config.productStock?.[p.id!]
                    const pTotal = pStk?.total ?? 0
                    const pLocked = pStk?.locked ?? 0
                    const pAvail = pTotal - pLocked
                    const isEditing = editingProductActive === p.id
                    return (
                      <div key={p.id} style={{ marginBottom: idx < products.length - 1 ? 14 : 0, paddingBottom: idx < products.length - 1 ? 14 : 0, borderBottom: idx < products.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none' }}>
                        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, color: '#e2e8f0' }}>{p.name}</div>
                        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                          {[
                            { label: 'Total', val: toDisplay(pTotal, config.packetsPerCarton), color: '#fff' },
                            { label: 'Locked', val: toDisplay(pLocked, config.packetsPerCarton), color: '#fde68a' },
                            { label: 'Available', val: toDisplay(pAvail, config.packetsPerCarton), color: pAvail > 0 ? '#86efac' : '#f87171' },
                          ].map(s => (
                            <div key={s.label} style={{ flex: 1, background: 'rgba(0,0,0,0.25)', borderRadius: 8, padding: '7px 4px', textAlign: 'center' }}>
                              <div style={{ fontSize: 11, fontWeight: 900, color: s.color, lineHeight: 1.3 }}>{s.val}</div>
                              <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>{s.label}</div>
                            </div>
                          ))}
                        </div>
                        {isEditing ? (
                          <div style={{ display: 'flex', gap: 8 }}>
                            <input type="number" value={editingProductStock[p.id!] ?? ''}
                              onChange={e => setEditingProductStock(prev => ({ ...prev, [p.id!]: e.target.value }))}
                              placeholder="Total packets in stock"
                              style={{ flex: 1, background: 'rgba(255,255,255,0.06)', border: '1.5px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '10px 14px', fontSize: 14, color: '#fff', outline: 'none' }} />
                            <button onClick={() => handleSaveProductStock(p.id!)}
                              style={{ background: '#16a34a', border: 'none', color: '#fff', borderRadius: 10, padding: '0 14px', fontWeight: 800, fontSize: 12 }}>Save</button>
                            <button onClick={() => setEditingProductActive(null)}
                              style={{ background: 'rgba(255,255,255,0.06)', border: 'none', color: '#64748b', borderRadius: 10, padding: '0 12px', fontSize: 13 }}>✕</button>
                          </div>
                        ) : (
                          <button onClick={() => { setEditingProductActive(p.id!); setEditingProductStock(prev => ({ ...prev, [p.id!]: String(pTotal) })) }}
                            style={{ background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.15)', color: '#16a34a', borderRadius: 10, padding: '8px 14px', fontSize: 12, fontWeight: 700, width: '100%' }}>
                            ✏️ Set Total Stock
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              </>
            )}
            <div style={{ background: '#161b22', borderRadius: 14, padding: 16, border: '1px solid rgba(255,255,255,0.06)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                <span style={{ fontSize: 13, fontWeight: 700 }}>Stock Utilisation</span>
                <span style={{ fontSize: 13, color: '#16a34a', fontWeight: 800 }}>{displayTotal > 0 ? Math.round(((displayTotal - displayAvailable) / displayTotal) * 100) : 0}%</span>
              </div>
              <div style={{ background: 'rgba(255,255,255,0.06)', borderRadius: 99, height: 10, overflow: 'hidden' }}>
                <div style={{ height: '100%', background: 'linear-gradient(90deg,#16a34a,#22c55e)', width: `${displayTotal > 0 ? ((displayTotal - displayAvailable) / displayTotal) * 100 : 0}%`, borderRadius: 99, transition: 'width 0.5s' }} />
              </div>
            </div>
            <div style={{ fontSize: 12, color: '#64748b', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>Recent Dispatches</div>
            {dispatches.slice(0, 5).map(d => (
              <div key={d.id} style={{ background: '#161b22', borderRadius: 12, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10, border: '1px solid rgba(255,255,255,0.05)' }}>
                <div style={{ fontSize: 18 }}>{d.partyType === 'distributor' ? '🚚' : '🏪'}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{d.partyName}</div>
                  <div style={{ fontSize: 11, color: '#64748b' }}>{toDisplay(d.packets, config.packetsPerCarton)} • {new Date(d.dispatchedAt).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}</div>
                </div>
                <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 99, background: d.paymentType === 'cash' ? 'rgba(22,163,74,0.15)' : 'rgba(217,119,6,0.15)', color: d.paymentType === 'cash' ? '#16a34a' : '#d97706' }}>
                  {d.paymentType === 'cash' ? '💵' : '📋'}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* DISPATCH */}
        {tab === 'dispatch' && isAdmin && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ background: 'rgba(22,163,74,0.1)', border: '1px solid rgba(22,163,74,0.2)', borderRadius: 12, padding: '12px 14px', fontSize: 13, color: '#86efac' }}>
              📦 Available: <strong>{toDisplay(available, config.packetsPerCarton)}</strong>
            </div>

            <div>
              <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6, letterSpacing: 1, textTransform: 'uppercase' }}>Month</div>
              <DateInput type="month" value={selectedMonth} onChange={v => setSelectedMonth(v)} />
            </div>

            <div>
              <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8, letterSpacing: 1, textTransform: 'uppercase' }}>Dispatch To</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                {([
                  { val: 'all',      label: 'All' },
                  { val: 'active',   label: '🟢 Active' },
                  { val: 'prospect', label: '🟡 Prospect' },
                  { val: 'inactive', label: '⛔ Inactive' },
                ] as const).map(s => (
                  <button key={s.val} onClick={() => setPartyStatusFilter(s.val)}
                    style={{ background: partyStatusFilter === s.val ? (s.val === 'active' ? 'rgba(22,163,74,0.15)' : s.val === 'prospect' ? 'rgba(217,119,6,0.15)' : s.val === 'inactive' ? 'rgba(220,38,38,0.12)' : 'rgba(22,163,74,0.15)') : 'rgba(255,255,255,0.04)', color: partyStatusFilter === s.val ? (s.val === 'active' ? '#16a34a' : s.val === 'prospect' ? '#d97706' : s.val === 'inactive' ? '#dc2626' : '#16a34a') : '#64748b', border: `1px solid ${partyStatusFilter === s.val ? (s.val === 'active' ? '#16a34a' : s.val === 'prospect' ? '#d97706' : s.val === 'inactive' ? '#dc2626' : '#16a34a') : 'rgba(255,255,255,0.06)'}`, borderRadius: 20, padding: '5px 12px', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>
                    {s.label}
                  </button>
                ))}
              </div>
              {errors.partyId && <div style={{ fontSize: 11, color: '#dc2626', marginBottom: 6 }}>⚠️ {errors.partyId}</div>}
              <CustomSelect value={form.partyId} onChange={v => setForm({ ...form, partyId: v })}
                placeholder="Select distributor or retailer..." options={partyOptions} error={!!errors.partyId} />
            </div>

            {form.partyId && (() => {
              const req = requests.find(r => r.partyId === form.partyId && r.month === selectedMonth)
              if (!req) return null
              return (
                <div style={{ background: 'rgba(8,145,178,0.1)', border: '1px solid rgba(8,145,178,0.2)', borderRadius: 12, padding: '12px 14px' }}>
                  <div style={{ fontSize: 12, color: '#0891b2', fontWeight: 700, marginBottom: 4 }}>📅 Monthly Request Linked</div>
                  <div style={{ fontSize: 12, color: '#7dd3fc' }}>
                    Requested: {toDisplay(req.requestedPackets, config.packetsPerCarton)} •
                    Fulfilled: {toDisplay(req.fulfilledPackets, config.packetsPerCarton)} •
                    Remaining: {toDisplay(Math.max(0, req.requestedPackets - req.fulfilledPackets), config.packetsPerCarton)}
                  </div>
                </div>
              )
            })()}

            <div>
              <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6, letterSpacing: 1, textTransform: 'uppercase' }}>Quantity</div>
              {errors.quantity && <div style={{ fontSize: 11, color: '#dc2626', marginBottom: 6 }}>⚠️ {errors.quantity}</div>}
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                {(['packets', 'cartons'] as const).map(u => (
                  <button key={u} onClick={() => setUnit(u)}
                    style={{ flex: 1, background: unit === u ? 'rgba(22,163,74,0.15)' : 'rgba(255,255,255,0.04)', color: unit === u ? '#16a34a' : '#64748b', border: `1.5px solid ${unit === u ? '#16a34a' : 'rgba(255,255,255,0.06)'}`, borderRadius: 10, padding: '9px', fontSize: 12, fontWeight: 700 }}>
                    {u === 'packets' ? '📦 Packets' : `📫 Cartons (1=${config.packetsPerCarton})`}
                  </button>
                ))}
              </div>
              <input type="number" value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })}
                placeholder={unit === 'cartons' ? 'No. of cartons' : 'No. of packets'}
                style={{ width: '100%', background: 'rgba(255,255,255,0.06)', border: `1.5px solid ${errors.quantity ? '#dc2626' : 'rgba(255,255,255,0.1)'}`, borderRadius: 12, padding: '13px 16px', fontSize: 22, fontWeight: 800, color: '#fff', outline: 'none', boxSizing: 'border-box' }} />
              {form.quantity && parseInt(form.quantity) > 0 && (() => {
                const p = parties.find(pp => pp.id === form.partyId)
                return <div style={{ marginTop: 8, fontSize: 13, color: '#6ee7b7', fontWeight: 700 }}>
                  = {toDisplay(toPackets(form.quantity), config.packetsPerCarton)}
                  {p && ` • ₹${(toPackets(form.quantity) * p.pricePerPacket).toLocaleString()}`}
                </div>
              })()}
            </div>

            <div>
              <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8, letterSpacing: 1, textTransform: 'uppercase' }}>Payment Type</div>
              <div style={{ display: 'flex', gap: 8 }}>
                {([['cash', '💵 Cash'], ['credit', '📋 Credit']] as [PaymentType, string][]).map(([val, label]) => (
                  <button key={val} onClick={() => setForm({ ...form, paymentType: val })}
                    style={{ flex: 1, background: form.paymentType === val ? (val === 'cash' ? 'rgba(22,163,74,0.15)' : 'rgba(217,119,6,0.15)') : 'rgba(255,255,255,0.04)', color: form.paymentType === val ? (val === 'cash' ? '#16a34a' : '#d97706') : '#64748b', border: `1.5px solid ${form.paymentType === val ? (val === 'cash' ? '#16a34a' : '#d97706') : 'rgba(255,255,255,0.06)'}`, borderRadius: 12, padding: '12px', fontSize: 14, fontWeight: 800 }}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8, letterSpacing: 1, textTransform: 'uppercase' }}>Notes</div>
              <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
                placeholder="Any notes..." rows={2}
                style={{ width: '100%', background: 'rgba(255,255,255,0.06)', border: '1.5px solid rgba(255,255,255,0.1)', borderRadius: 12, padding: '13px 16px', fontSize: 14, color: '#fff', outline: 'none', resize: 'none', boxSizing: 'border-box' }} />
            </div>

            <button onClick={handleDispatch} disabled={saving}
              style={{ background: saving ? '#475569' : 'linear-gradient(135deg,#1a5c42,#16a34a)', color: '#fff', border: 'none', borderRadius: 14, padding: 16, fontSize: 15, fontWeight: 800 }}>
              {saving ? 'Processing...' : 'Dispatch Stock 📦'}
            </button>
          </div>
        )}

        {/* HISTORY */}
        {tab === 'history' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6, letterSpacing: 1, textTransform: 'uppercase' }}>Filter by Month</div>
              <DateInput type="month" value={selectedMonth} onChange={v => setSelectedMonth(v)} />
            </div>
            {dispatches.filter(d => d.month === selectedMonth).length === 0 ? (
              <div style={{ textAlign: 'center', padding: 40, color: '#475569' }}>
                <div style={{ fontSize: 36, marginBottom: 12 }}>📋</div>
                <div style={{ fontWeight: 700 }}>No dispatches this month</div>
              </div>
            ) : dispatches.filter(d => d.month === selectedMonth).map(d => (
              <div key={d.id} style={{ background: '#161b22', borderRadius: 14, padding: 16, border: '1px solid rgba(255,255,255,0.05)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <div style={{ fontSize: 22 }}>{d.partyType === 'distributor' ? '🚚' : '🏪'}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 800, fontSize: 14 }}>{d.partyName}</div>
                    <div style={{ fontSize: 11, color: '#6ee7b7', fontWeight: 600 }}>
                      🕐 {new Date(d.dispatchedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                    </div>
                    <div style={{ fontSize: 11, color: '#64748b' }}>by {d.dispatchedByName}</div>
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '4px 10px', borderRadius: 99, background: d.paymentType === 'cash' ? 'rgba(22,163,74,0.15)' : 'rgba(217,119,6,0.15)', color: d.paymentType === 'cash' ? '#16a34a' : '#d97706' }}>
                    {d.paymentType === 'cash' ? '💵 Cash' : '📋 Credit'}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <div style={{ flex: 1, background: 'rgba(255,255,255,0.04)', borderRadius: 10, padding: '8px', textAlign: 'center' }}>
                    <div style={{ fontWeight: 800, fontSize: 13 }}>{toDisplay(d.packets, config.packetsPerCarton)}</div>
                    <div style={{ fontSize: 9, color: '#64748b' }}>dispatched</div>
                  </div>
                  <div style={{ flex: 1, background: 'rgba(22,163,74,0.1)', borderRadius: 10, padding: '8px', textAlign: 'center' }}>
                    <div style={{ fontWeight: 800, fontSize: 13, color: '#16a34a' }}>₹{d.totalAmount.toLocaleString()}</div>
                    <div style={{ fontSize: 9, color: '#64748b' }}>value</div>
                  </div>
                </div>
                {d.notes && <div style={{ fontSize: 11, color: '#475569', marginTop: 8 }}>📝 {d.notes}</div>}
              </div>
            ))}
          </div>
        )}

        {/* MONTHLY SUMMARY */}
        {tab === 'monthly' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6, letterSpacing: 1, textTransform: 'uppercase' }}>Month</div>
              <DateInput type="month" value={selectedMonth} onChange={v => setSelectedMonth(v)} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div style={{ background: '#161b22', borderRadius: 14, padding: 14, border: '1px solid rgba(22,163,74,0.2)' }}>
                <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>DISPATCHED</div>
                <div style={{ fontSize: 18, fontWeight: 900, color: '#16a34a' }}>{toDisplay(monthlyTotal, config.packetsPerCarton)}</div>
              </div>
              <div style={{ background: '#161b22', borderRadius: 14, padding: 14, border: '1px solid rgba(8,145,178,0.2)' }}>
                <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>REVENUE</div>
                <div style={{ fontSize: 18, fontWeight: 900, color: '#0891b2' }}>₹{monthlyRevenue.toLocaleString()}</div>
              </div>
            </div>

            {/* Per party breakdown */}
            <div style={{ fontSize: 12, color: '#64748b', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 }}>Per Distributor / Retailer</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
              {([
                { val: 'all', label: 'All' },
                { val: 'active', label: '🟢 Active' },
                { val: 'prospect', label: '🟡 Prospect' },
                { val: 'inactive', label: '⛔ Inactive' },
              ] as const).map(s => (
                <button key={s.val} onClick={() => setPartyStatusFilter(s.val)}
                  style={{ background: partyStatusFilter === s.val ? (s.val === 'active' ? 'rgba(22,163,74,0.15)' : s.val === 'prospect' ? 'rgba(217,119,6,0.15)' : s.val === 'inactive' ? 'rgba(220,38,38,0.12)' : 'rgba(22,163,74,0.15)') : 'rgba(255,255,255,0.04)', color: partyStatusFilter === s.val ? (s.val === 'active' ? '#16a34a' : s.val === 'prospect' ? '#d97706' : s.val === 'inactive' ? '#dc2626' : '#16a34a') : '#64748b', border: `1px solid ${partyStatusFilter === s.val ? (s.val === 'active' ? '#16a34a' : s.val === 'prospect' ? '#d97706' : s.val === 'inactive' ? '#dc2626' : '#16a34a') : 'rgba(255,255,255,0.06)'}`, borderRadius: 20, padding: '5px 12px', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>
                  {s.label}
                </button>
              ))}
            </div>
            {filteredParties.map(party => {
              const pd = monthlyDispatches.filter(d => d.partyId === party.id)
              const req = requests.find(r => r.partyId === party.id && r.month === selectedMonth)
              if (pd.length === 0 && !req) return null
              const totalDispatched = pd.reduce((s, d) => s + d.packets, 0)
              return (
                <div key={party.id} style={{ background: '#161b22', borderRadius: 14, padding: 16, border: '1px solid rgba(255,255,255,0.06)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                    <span style={{ fontSize: 18 }}>{party.type === 'distributor' ? '🚚' : '🏪'}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 800, fontSize: 14 }}>{party.name}</div>
                      <div style={{ fontSize: 11, color: '#64748b' }}>{party.category} • {party.place || party.address}</div>
                    </div>
                    {req && (
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 99, background: req.status === 'fulfilled' ? 'rgba(22,163,74,0.15)' : req.status === 'partial' ? 'rgba(8,145,178,0.15)' : 'rgba(217,119,6,0.15)', color: req.status === 'fulfilled' ? '#16a34a' : req.status === 'partial' ? '#0891b2' : '#d97706' }}>
                        {req.status === 'fulfilled' ? '✅ Fulfilled' : req.status === 'partial' ? '🔄 Partial' : '⏳ Pending'}
                      </span>
                    )}
                  </div>

                  {req && (
                    <div style={{ marginBottom: 10 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 11, color: '#64748b' }}>
                        <span>Requested: {toDisplay(req.requestedPackets, config.packetsPerCarton)}</span>
                        <span>Dispatched: {toDisplay(totalDispatched, config.packetsPerCarton)}</span>
                      </div>
                      <div style={{ background: 'rgba(255,255,255,0.06)', borderRadius: 99, height: 6, overflow: 'hidden' }}>
                        <div style={{ width: `${Math.min(100, req.requestedPackets > 0 ? (totalDispatched / req.requestedPackets) * 100 : 0)}%`, height: '100%', background: req.status === 'fulfilled' ? '#16a34a' : 'linear-gradient(90deg,#0891b2,#6ee7b7)', borderRadius: 99 }} />
                      </div>
                    </div>
                  )}

                  {/* Dispatch log */}
                  {pd.map(d => (
                    <div key={d.id} style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 10, padding: '8px 12px', marginBottom: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontSize: 12, color: '#e2e8f0', fontWeight: 600 }}>{toDisplay(d.packets, config.packetsPerCarton)}</div>
                        <div style={{ fontSize: 10, color: '#6ee7b7' }}>🕐 {new Date(d.dispatchedAt).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 12, color: '#16a34a', fontWeight: 700 }}>₹{d.totalAmount.toLocaleString()}</div>
                        <div style={{ fontSize: 10, color: d.paymentType === 'cash' ? '#16a34a' : '#d97706' }}>{d.paymentType === 'cash' ? '💵 Cash' : '📋 Credit'}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        )}
      </div>
      {modal}
    </div>
  )
}
