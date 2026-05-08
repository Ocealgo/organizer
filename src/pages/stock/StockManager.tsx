import React, { useState, useEffect } from 'react'
import { collection, onSnapshot } from 'firebase/firestore'
import { db } from '../../firebase'
import { Party, Dispatch, MonthlyRequest, Product } from '../../types'
import DateInput from '../../components/DateInput'
import { useAuth } from '../../context/AuthContext'
import { useStockConfig, updateStockConfig, toDisplay, setProductStock } from '../../hooks/useFirebase'
import { localMonthStr } from '../../utils/date'

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
  const { config } = useStockConfig()
  const [parties, setParties] = useState<Party[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [dispatches, setDispatches] = useState<Dispatch[]>([])
  const [requests, setRequests] = useState<MonthlyRequest[]>([])
  const [tab, setTab] = useState<'overview' | 'history' | 'monthly'>('overview')
  const [selectedMonth, setSelectedMonth] = useState(localMonthStr())
  const [editCarton, setEditCarton] = useState(false)
  const [newCarton, setNewCarton] = useState('')
  const [editingProductActive, setEditingProductActive] = useState<string | null>(null)
  const [editingProductStock, setEditingProductStock] = useState<Record<string, string>>({})
  const [partyStatusFilter, setPartyStatusFilter] = useState<'all' | 'active' | 'prospect' | 'inactive'>('all')

  const isAdmin = appUser?.role === 'super_admin' || appUser?.role === 'admin'

  // Aggregate display values from per-product stock
  const hasProductStock = config.productStock && Object.keys(config.productStock).length > 0
  const displayTotal = hasProductStock ? Object.values(config.productStock!).reduce((s, p) => s + p.total, 0) : config.total
  const displayLocked = hasProductStock ? Object.values(config.productStock!).reduce((s, p) => s + p.locked, 0) : config.locked
  const displayAvailable = displayTotal - displayLocked
  const totalDispatched = dispatches.filter(d => !d.fromType || d.fromType === 'company').reduce((s, d) => s + (d.packets || 0), 0)

  useEffect(() => {
    const u1 = onSnapshot(collection(db, 'parties'), s => setParties(s.docs.map(d => ({ id: d.id, ...d.data() } as Party))))
    const u2 = onSnapshot(collection(db, 'dispatches'), s => setDispatches(s.docs.map(d => ({ id: d.id, ...d.data() } as Dispatch)).sort((a, b) => b.createdAt - a.createdAt)))
    const u3 = onSnapshot(collection(db, 'monthly_requests'), s => setRequests(s.docs.map(d => ({ id: d.id, ...d.data() } as MonthlyRequest))))
    const u4 = onSnapshot(collection(db, 'products'), s => setProducts(s.docs.map(d => ({ id: d.id, ...d.data() } as Product)).filter(p => p.active)))
    return () => { u1(); u2(); u3(); u4() }
  }, [])

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

  const filteredParties = partyStatusFilter === 'all'
    ? parties
    : parties.filter(p => (p as any).status === partyStatusFilter)

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
          {(['overview', 'history', 'monthly'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              style={{ flex: 1, background: tab === t ? 'rgba(255,255,255,0.2)' : 'transparent', color: tab === t ? '#fff' : 'rgba(255,255,255,0.5)', border: 'none', borderRadius: '10px 10px 0 0', padding: '9px 4px', fontSize: 10, fontWeight: 800, whiteSpace: 'nowrap' }}>
              {t === 'overview' ? '📊 Overview' : t === 'history' ? '📋 History' : '📅 Monthly'}
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
                <span style={{ fontSize: 13, color: '#16a34a', fontWeight: 800 }}>{(totalDispatched + displayTotal) > 0 ? Math.round((totalDispatched / (totalDispatched + displayTotal)) * 100) : 0}%</span>
              </div>
              <div style={{ background: 'rgba(255,255,255,0.06)', borderRadius: 99, height: 10, overflow: 'hidden' }}>
                <div style={{ height: '100%', background: 'linear-gradient(90deg,#16a34a,#22c55e)', width: `${(totalDispatched + displayTotal) > 0 ? (totalDispatched / (totalDispatched + displayTotal)) * 100 : 0}%`, borderRadius: 99, transition: 'width 0.5s' }} />
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
    </div>
  )
}
