import React, { useState, useEffect } from 'react'
import { collection, addDoc, onSnapshot, deleteDoc, doc, updateDoc } from 'firebase/firestore'
import { db } from '../../firebase'
import { Party, PartyType, PartyCategory, Dispatch } from '../../types'
import { useAuth } from '../../context/AuthContext'
import { useStockConfig, toDisplay } from '../../hooks/useFirebase'
import CustomSelect from '../../components/CustomSelect'
import StockMovementLogger from './StockMovementLogger'
import MonthlyRequestManager from './MonthlyRequestManager'
import AllocationManager from './AllocationManager'

interface Props { onBack: () => void }

const CATEGORIES: PartyCategory[] = ['FMCG', 'Pharma', 'General Store', 'Supermarket', 'Online', 'Other']

function validatePhone(p: string) { return /^[6-9]\d{9}$/.test(p.trim()) }

// ── Outside component to prevent focus loss ───────────────────────────────────
function Field({ label, hint, error, children }: {
  label: string; hint?: string; error?: string; children: React.ReactNode
}) {
  return (
    <div>
      <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6, letterSpacing: 1, textTransform: 'uppercase' }}>{label}</div>
      {hint && <div style={{ fontSize: 11, color: '#6ee7b7', marginBottom: 6 }}>💡 {hint}</div>}
      {children}
      {error && <div style={{ fontSize: 11, color: '#dc2626', marginTop: 4 }}>⚠️ {error}</div>}
    </div>
  )
}

function inputStyle(hasError?: boolean): React.CSSProperties {
  return {
    width: '100%', background: 'rgba(255,255,255,0.06)',
    border: `1.5px solid ${hasError ? '#dc2626' : 'rgba(255,255,255,0.1)'}`,
    borderRadius: 12, padding: '13px 16px', fontSize: 14, color: '#fff',
    outline: 'none', boxSizing: 'border-box',
  }
}

const emptyForm = {
  name: '', type: 'distributor' as PartyType, category: 'FMCG' as PartyCategory,
  phone: '', address: '', place: '', pricePerPacket: '', quantity: '',
  lowStockThreshold: '', underDistributorId: '',
}

export default function PartyManager({ onBack }: Props) {
  const { appUser } = useAuth()
  const { config } = useStockConfig()
  const [parties, setParties] = useState<Party[]>([])
  const [tab, setTab] = useState<'list' | 'add' | 'movement' | 'requests' | 'allocations'>('list')
  const [dispatches, setDispatches] = useState<Dispatch[]>([])
  const [expandedDispatch, setExpandedDispatch] = useState<string | null>(null)
  const [typeFilter, setTypeFilter] = useState<'all' | 'distributor' | 'retailer'>('all')
  const [categoryFilter, setCategoryFilter] = useState<'all' | PartyCategory>('all')
  const [placeSearch, setPlaceSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [unit, setUnit] = useState<'packets' | 'cartons'>('packets')
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState<string | null>(null)

  const isAdmin = appUser?.role === 'super_admin' || appUser?.role === 'admin'
  const distributors = parties.filter(p => p.type === 'distributor')

  useEffect(() => {
    const u1 = onSnapshot(collection(db, 'parties'), snap => {
      setParties(snap.docs.map(d => ({ id: d.id, ...d.data() } as Party)))
    })
    const u2 = onSnapshot(collection(db, 'dispatches'), snap => {
      setDispatches(snap.docs.map(d => ({ id: d.id, ...d.data() } as Dispatch)).sort((a, b) => b.createdAt - a.createdAt))
    })
    return () => { u1(); u2() }
  }, [])

  // Safe filter — handle missing place field
  const filtered = parties.filter(p => {
    if (typeFilter !== 'all' && p.type !== typeFilter) return false
    if (categoryFilter !== 'all' && p.category !== categoryFilter) return false
    if (placeSearch.trim()) {
      const search = placeSearch.toLowerCase()
      const addr = (p.address || '').toLowerCase()
      const place = (p.place || '').toLowerCase()
      if (!addr.includes(search) && !place.includes(search)) return false
    }
    return true
  })

  const toPackets = (qty: string) => {
    const n = parseInt(qty) || 0
    return unit === 'cartons' ? n * config.packetsPerCarton : n
  }

  const validate = () => {
    const e: Record<string, string> = {}
    if (!form.name.trim()) e.name = 'Name is required'
    if (!validatePhone(form.phone)) e.phone = 'Enter valid 10-digit Indian mobile number'
    if (!form.address.trim()) e.address = 'Address is required'
    if (!form.place.trim()) e.place = 'Place / area is required'
    if (!form.pricePerPacket || parseFloat(form.pricePerPacket) <= 0) e.pricePerPacket = 'Enter a valid price'
    if (!form.quantity || parseInt(form.quantity) <= 0) e.quantity = 'Enter quantity'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const startEdit = (p: Party) => {
    const packets = p.packetsAllocated || 0
    setForm({
      name: p.name, type: p.type, category: p.category || 'FMCG',
      phone: p.phone, address: p.address, place: p.place || '',
      pricePerPacket: String(p.pricePerPacket),
      quantity: String(packets),
      lowStockThreshold: String(p.lowStockThreshold || 0),
      underDistributorId: p.underDistributorId || '',
    })
    setUnit('packets')
    setEditingId(p.id!)
    setTab('add')
  }

  const handleSave = async () => {
    if (!validate()) return
    setSaving(true)
    try {
      const packets = toPackets(form.quantity)
      const cartons = unit === 'cartons' ? parseInt(form.quantity) : Math.floor(packets / config.packetsPerCarton)
      const underDist = distributors.find(d => d.id === form.underDistributorId)
      const data: any = {
        name: form.name.trim(), type: form.type, category: form.category,
        phone: form.phone.trim(), address: form.address.trim(), place: form.place.trim(),
        pricePerPacket: parseFloat(form.pricePerPacket),
        packetsAllocated: packets, cartonsAllocated: cartons,
        lowStockThreshold: parseInt(form.lowStockThreshold) || 0,
      }
      if (form.type === 'retailer' && form.underDistributorId) {
        data.underDistributorId = form.underDistributorId
        data.underDistributorName = underDist?.name || ''
      }

      if (editingId) {
        await updateDoc(doc(db, 'parties', editingId), data)
        setEditingId(null)
      } else {
        data.addedBy = appUser!.uid
        data.addedByName = appUser!.name
        data.createdAt = Date.now()
        await addDoc(collection(db, 'parties'), data)
        if (appUser?.role === 'offline_sales' || appUser?.role === 'online_sales') {
          await addDoc(collection(db, 'alerts'), {
            type: 'new_party',
            message: `${appUser.name} added ${form.type}: ${form.name.trim()} — needs ${toDisplay(packets, config.packetsPerCarton)}`,
            relatedId: form.name, read: false, createdAt: Date.now(),
          })
        }
      }
      setForm(emptyForm)
      setErrors({})
      setTab('list')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this entry?')) return
    setDeleting(id)
    await deleteDoc(doc(db, 'parties', id))
    setDeleting(null)
  }

  if (tab === 'movement') return <StockMovementLogger onBack={() => setTab('list')} parties={parties} />
  if (tab === 'allocations') return <AllocationManager onBack={() => setTab('list')} parties={parties} />
  if (tab === 'requests') return <MonthlyRequestManager onBack={() => setTab('list')} parties={parties} />

  const distributorOptions = distributors.map(d => ({ value: d.id!, label: `🚚 ${d.name}` }))

  return (
    <div style={{ minHeight: '100vh', background: '#0d1117', paddingBottom: 40 }}>
      {/* Header */}
      <div style={{ background: 'linear-gradient(135deg,#0891b2,#0e7490)', padding: '24px 20px 16px' }}>
        <button onClick={onBack} style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: '#bae6fd', padding: '6px 14px', borderRadius: 20, fontSize: 12, marginBottom: 16 }}>← Back</button>
        <div style={{ color: '#bae6fd', fontSize: 11, letterSpacing: 3, textTransform: 'uppercase', marginBottom: 4 }}>Network 🤝</div>
        <div style={{ fontSize: 22, fontWeight: 900, marginBottom: 2 }}>Distributors & Retailers</div>
        <div style={{ color: '#e0f2fe', fontSize: 13, marginBottom: 16 }}>
          {distributors.length} distributors • {parties.filter(p => p.type === 'retailer').length} retailers
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {([
            { id: 'list', label: '📋 View All' },
            { id: 'add', label: editingId ? '✏️ Editing' : '➕ Add New' },
            { id: 'allocations', label: '📋 Allocations' },
            { id: 'requests', label: '📅 Monthly Requests' },
            { id: 'movement', label: '📦 Log Movement' },
          ] as const).map(t => (
            <button key={t.id} onClick={() => { setTab(t.id); if (t.id !== 'add') { setEditingId(null); setForm(emptyForm) } }}
              style={{ background: tab === t.id ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.08)', color: tab === t.id ? '#fff' : 'rgba(255,255,255,0.6)', border: 'none', borderRadius: 20, padding: '7px 14px', fontSize: 11, fontWeight: 700 }}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: '16px 14px' }}>

        {/* LIST */}
        {tab === 'list' && (
          <>
            <div style={{ background: '#161b22', borderRadius: 14, padding: 14, marginBottom: 14, border: '1px solid rgba(255,255,255,0.06)' }}>
              <input value={placeSearch} onChange={e => setPlaceSearch(e.target.value)}
                placeholder="🔍 Search by place / area..."
                style={{ width: '100%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: '#fff', outline: 'none', boxSizing: 'border-box', marginBottom: 10 }} />
              <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
                {(['all', 'distributor', 'retailer'] as const).map(f => (
                  <button key={f} onClick={() => setTypeFilter(f)}
                    style={{ background: typeFilter === f ? '#0891b2' : 'rgba(255,255,255,0.04)', color: typeFilter === f ? '#fff' : '#64748b', border: `1px solid ${typeFilter === f ? '#0891b2' : 'rgba(255,255,255,0.06)'}`, borderRadius: 20, padding: '5px 12px', fontSize: 11, fontWeight: 700 }}>
                    {f === 'all' ? 'All' : f === 'distributor' ? '🚚 Dist' : '🏪 Retailer'}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {(['all', ...CATEGORIES] as ('all' | PartyCategory)[]).map(c => (
                  <button key={c} onClick={() => setCategoryFilter(c)}
                    style={{ background: categoryFilter === c ? '#7c3aed' : 'rgba(255,255,255,0.04)', color: categoryFilter === c ? '#fff' : '#64748b', border: `1px solid ${categoryFilter === c ? '#7c3aed' : 'rgba(255,255,255,0.06)'}`, borderRadius: 20, padding: '5px 12px', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>
                    {c}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 10 }}>Showing {filtered.length} of {parties.length} entries</div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {filtered.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 40, color: '#475569' }}>
                  <div style={{ fontSize: 36, marginBottom: 12 }}>🤝</div>
                  <div style={{ fontWeight: 700 }}>No entries found</div>
                  <div style={{ fontSize: 13, marginTop: 6 }}>Try different filters or add a new entry</div>
                </div>
              ) : filtered.map(p => (
                <div key={p.id} style={{ background: '#161b22', borderRadius: 14, padding: 16, border: '1px solid rgba(255,255,255,0.06)' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                    <div style={{ width: 42, height: 42, background: p.type === 'distributor' ? 'rgba(8,145,178,0.2)' : 'rgba(22,163,74,0.2)', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>
                      {p.type === 'distributor' ? '🚚' : '🏪'}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3, flexWrap: 'wrap' }}>
                        <div style={{ fontWeight: 800, fontSize: 15 }}>{p.name}</div>
                        <span style={{ fontSize: 10, background: 'rgba(124,58,237,0.15)', color: '#a78bfa', padding: '2px 8px', borderRadius: 99 }}>{p.category}</span>
                      </div>
                      <div style={{ fontSize: 12, color: '#64748b' }}>📞 {p.phone}</div>
                      <div style={{ fontSize: 12, color: '#64748b' }}>📍 {p.address}</div>
                      {p.place && <div style={{ fontSize: 11, color: '#475569' }}>🏘️ {p.place}</div>}
                      {p.underDistributorName && <div style={{ fontSize: 11, color: '#0891b2', marginTop: 2 }}>Under: {p.underDistributorName}</div>}
                      <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                        {isAdmin && <span style={{ fontSize: 11, background: 'rgba(22,163,74,0.15)', color: '#16a34a', padding: '3px 10px', borderRadius: 99, fontWeight: 700 }}>₹{p.pricePerPacket}/pkt</span>}
                        <span style={{ fontSize: 11, background: 'rgba(8,145,178,0.15)', color: '#0891b2', padding: '3px 10px', borderRadius: 99, fontWeight: 700 }}>
                          📦 {toDisplay(p.packetsAllocated || 0, config.packetsPerCarton)} allocated
                        </span>
                      </div>
                      <div style={{ fontSize: 10, color: '#475569', marginTop: 4 }}>Added by {p.addedByName}</div>

                      {/* Dispatch log toggle */}
                      <button onClick={e => { e.stopPropagation(); setExpandedDispatch(expandedDispatch === p.id ? null : p.id!) }}
                        style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '5px 10px', fontSize: 11, color: '#64748b', marginTop: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                        {expandedDispatch === p.id ? '▲' : '▼'} Last dispatches
                      </button>

                      {expandedDispatch === p.id && (() => {
                        const pd = dispatches.filter(d => d.partyId === p.id).slice(0, 3)
                        return pd.length === 0 ? (
                          <div style={{ fontSize: 11, color: '#475569', marginTop: 8, padding: '8px 10px', background: 'rgba(255,255,255,0.03)', borderRadius: 8 }}>No dispatches yet</div>
                        ) : (
                          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {pd.map(d => (
                              <div key={d.id} style={{ fontSize: 11, background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '8px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div>
                                  <div style={{ color: '#e2e8f0', fontWeight: 600 }}>{toDisplay(d.packets, config.packetsPerCarton)}</div>
                                  <div style={{ color: '#475569', fontSize: 10 }}>{new Date(d.dispatchedAt || d.createdAt).toLocaleDateString('en-IN')}</div>
                                </div>
                                <span style={{ fontSize: 10, color: d.paymentType === 'cash' ? '#16a34a' : '#d97706', background: d.paymentType === 'cash' ? 'rgba(22,163,74,0.1)' : 'rgba(217,119,6,0.1)', padding: '2px 8px', borderRadius: 99 }}>
                                  {d.paymentType === 'cash' ? '💵 Cash' : '📋 Credit'}
                                </span>
                              </div>
                            ))}
                          </div>
                        )
                      })()}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <button onClick={() => startEdit(p)}
                        style={{ background: 'rgba(8,145,178,0.1)', border: '1px solid rgba(8,145,178,0.2)', color: '#0891b2', borderRadius: 10, padding: '7px 10px', fontSize: 13, flexShrink: 0 }}>
                        ✏️
                      </button>
                      {isAdmin && (
                        <button onClick={() => handleDelete(p.id!)} disabled={deleting === p.id}
                          style={{ background: 'rgba(220,38,38,0.1)', border: '1px solid rgba(220,38,38,0.2)', color: '#dc2626', borderRadius: 10, padding: '7px 10px', fontSize: 13, opacity: deleting === p.id ? 0.5 : 1, flexShrink: 0 }}>
                          🗑️
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ADD / EDIT */}
        {tab === 'add' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {editingId && (
              <div style={{ background: 'rgba(8,145,178,0.1)', border: '1px solid rgba(8,145,178,0.2)', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: '#0891b2' }}>
                ✏️ Editing existing entry — changes will be saved
              </div>
            )}

            {/* Type */}
            {!editingId && (
              <div>
                <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8, letterSpacing: 1, textTransform: 'uppercase' }}>Type</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {(['distributor', 'retailer'] as PartyType[]).map(t => (
                    <button key={t} onClick={() => setForm({ ...form, type: t })}
                      style={{ flex: 1, background: form.type === t ? 'rgba(8,145,178,0.15)' : 'rgba(255,255,255,0.04)', color: form.type === t ? '#0891b2' : '#64748b', border: `1.5px solid ${form.type === t ? '#0891b2' : 'rgba(255,255,255,0.06)'}`, borderRadius: 12, padding: '12px', fontSize: 13, fontWeight: 800 }}>
                      {t === 'distributor' ? '🚚 Distributor' : '🏪 Retailer'}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Category */}
            <div>
              <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8, letterSpacing: 1, textTransform: 'uppercase' }}>Category</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {CATEGORIES.map(c => (
                  <button key={c} onClick={() => setForm({ ...form, category: c })}
                    style={{ background: form.category === c ? 'rgba(124,58,237,0.2)' : 'rgba(255,255,255,0.04)', color: form.category === c ? '#a78bfa' : '#64748b', border: `1px solid ${form.category === c ? '#7c3aed' : 'rgba(255,255,255,0.06)'}`, borderRadius: 20, padding: '6px 14px', fontSize: 12, fontWeight: 700 }}>
                    {c}
                  </button>
                ))}
              </div>
            </div>

            {/* Under distributor */}
            {form.type === 'retailer' && distributors.length > 0 && (
              <Field label="Under Distributor (optional)">
                <CustomSelect
                  value={form.underDistributorId}
                  onChange={v => setForm({ ...form, underDistributorId: v })}
                  placeholder="Independent retailer"
                  options={[{ value: '', label: 'Independent retailer' }, ...distributorOptions]}
                />
              </Field>
            )}

            <Field label="Full Name" error={errors.name}>
              <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Rajan Enterprises" style={inputStyle(!!errors.name)} />
            </Field>

            <Field label="Phone Number" error={errors.phone}>
              <input type="tel" value={form.phone}
                onChange={e => setForm({ ...form, phone: e.target.value.replace(/\D/g, '').slice(0, 10) })}
                placeholder="10-digit mobile number" style={inputStyle(!!errors.phone)} />
            </Field>

            <Field label="Full Address" error={errors.address}>
              <input type="text" value={form.address} onChange={e => setForm({ ...form, address: e.target.value })}
                placeholder="e.g. 12/A, MG Road, Koramangala" style={inputStyle(!!errors.address)} />
            </Field>

            <Field label="Place / Area (for filtering)" error={errors.place}>
              <input type="text" value={form.place} onChange={e => setForm({ ...form, place: e.target.value })}
                placeholder="e.g. Koramangala" style={inputStyle(!!errors.place)} />
            </Field>

            <Field
              label="Selling Price Per Single Packet (₹)"
              hint="Price you charge them per single packet — not your cost price"
              error={errors.pricePerPacket}>
              <input type="number" value={form.pricePerPacket} onChange={e => setForm({ ...form, pricePerPacket: e.target.value })}
                placeholder="e.g. 45" style={inputStyle(!!errors.pricePerPacket)} />
            </Field>

            {/* Quantity */}
            <Field label="Quantity to Allocate" error={errors.quantity}>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                {(['packets', 'cartons'] as const).map(u => (
                  <button key={u} onClick={() => setUnit(u)}
                    style={{ flex: 1, background: unit === u ? 'rgba(22,163,74,0.15)' : 'rgba(255,255,255,0.04)', color: unit === u ? '#16a34a' : '#64748b', border: `1.5px solid ${unit === u ? '#16a34a' : 'rgba(255,255,255,0.06)'}`, borderRadius: 10, padding: '9px', fontSize: 12, fontWeight: 700 }}>
                    {u === 'packets' ? '📦 Packets' : `📫 Cartons (1=${config.packetsPerCarton} pkts)`}
                  </button>
                ))}
              </div>
              <input type="number" value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })}
                placeholder={unit === 'cartons' ? 'No. of cartons' : 'No. of packets'}
                style={inputStyle(!!errors.quantity)} />
              {form.quantity && parseInt(form.quantity) > 0 && (
                <div style={{ marginTop: 8, fontSize: 13, color: '#6ee7b7', fontWeight: 700 }}>
                  = {toDisplay(toPackets(form.quantity), config.packetsPerCarton)}
                  {form.pricePerPacket && ` • ₹${(toPackets(form.quantity) * parseFloat(form.pricePerPacket)).toLocaleString()}`}
                </div>
              )}
            </Field>

            {isAdmin && (
              <Field label="Low Stock Alert Threshold (packets)" hint="Admin alerted when remaining falls below this">
                <input type="number" value={form.lowStockThreshold} onChange={e => setForm({ ...form, lowStockThreshold: e.target.value })}
                  placeholder="e.g. 50" style={inputStyle()} />
              </Field>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => { setTab('list'); setEditingId(null); setForm(emptyForm); setErrors({}) }}
                style={{ flex: 1, background: 'rgba(255,255,255,0.06)', color: '#64748b', border: 'none', borderRadius: 14, padding: 14, fontSize: 14, fontWeight: 700 }}>
                Cancel
              </button>
              <button onClick={handleSave} disabled={saving}
                style={{ flex: 2, background: saving ? '#475569' : 'linear-gradient(135deg,#0891b2,#0e7490)', color: '#fff', border: 'none', borderRadius: 14, padding: 14, fontSize: 15, fontWeight: 800 }}>
                {saving ? 'Saving...' : editingId ? 'Save Changes ✅' : `Add ${form.type === 'distributor' ? 'Distributor 🚚' : 'Retailer 🏪'}`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
