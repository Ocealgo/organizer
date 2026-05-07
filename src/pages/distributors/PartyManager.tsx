import React, { useState, useEffect } from 'react'
import { collection, addDoc, onSnapshot, deleteDoc, doc, updateDoc, deleteField } from 'firebase/firestore'
import { db } from '../../firebase'
import { Party, PartyType, PartyCategory, Dispatch, UnifiedAllocation, Product } from '../../types'
import { useAuth } from '../../context/AuthContext'
import { useStockConfig, toDisplay } from '../../hooks/useFirebase'
import CustomSelect from '../../components/CustomSelect'
import AllocationManager from './AllocationManager'
import CSVImporter from './CSVImporter'
import { useConfirm } from '../../hooks/useConfirm'

interface Props { onBack: () => void }

const CATEGORIES: PartyCategory[] = ['FMCG', 'Pharma', 'General Store', 'Supermarket', 'Online', 'Other']

function validatePhone(p: string) { return /^[6-9]\d{9}$/.test(p.trim()) }

// ── Outside component to prevent focus loss ───────────────────────────────────
function Field({ label, hint, error, children }: {
  label: string; hint?: string; error?: string; children: React.ReactNode
}) {
  return (
    <div>
      <div style={{ fontSize: 11, color: '#888', marginBottom: 6, letterSpacing: 1, textTransform: 'uppercase' }}>{label}</div>
      {hint && <div style={{ fontSize: 11, color: '#a0a0a0', marginBottom: 6 }}>{hint}</div>}
      {children}
      {error && <div style={{ fontSize: 11, color: '#ef4444', marginTop: 4 }}>{error}</div>}
    </div>
  )
}

function inputStyle(hasError?: boolean): React.CSSProperties {
  return {
    width: '100%', background: 'rgba(128,128,128,0.08)',
    border: `1.5px solid ${hasError ? '#ef4444' : 'rgba(128,128,128,0.2)'}`,
    borderRadius: 12, padding: '13px 16px', fontSize: 16, color: 'inherit',
    outline: 'none', boxSizing: 'border-box',
  }
}

const emptyForm = {
  name: '', type: 'distributor' as PartyType, category: 'FMCG' as PartyCategory,
  phone: '', address: '', place: '', quantity: '',
  lowStockThreshold: '', underDistributorId: '',
}

export default function PartyManager({ onBack }: Props) {
  const { appUser } = useAuth()
  const { config } = useStockConfig()
  const { modal, showDanger } = useConfirm()
  const [parties, setParties] = useState<Party[]>([])
  const [allocations, setAllocations] = useState<UnifiedAllocation[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [tab, setTab] = useState<'list' | 'add' | 'allocations' | 'import'>('list')
  const [dispatches, setDispatches] = useState<Dispatch[]>([])
  const [expandedDispatch, setExpandedDispatch] = useState<string | null>(null)
  const [typeFilter, setTypeFilter] = useState<'all' | 'distributor' | 'retailer'>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'prospect' | 'inactive'>('all')
  const [categoryFilter, setCategoryFilter] = useState<'all' | PartyCategory>('all')
  const [distributorFilter, setDistributorFilter] = useState<'all' | 'independent' | string>('all')
  const [placeSearch, setPlaceSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [unit, setUnit] = useState<'packets' | 'cartons'>('packets')
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [focusParent, setFocusParent] = useState(false)

  const isAdmin = appUser?.role === 'super_admin' || appUser?.role === 'admin'
  const distributors = parties.filter(p => p.type === 'distributor')

  useEffect(() => {
    const u1 = onSnapshot(collection(db, 'parties'), snap => {
      setParties(snap.docs.map(d => ({ id: d.id, ...d.data() } as Party)))
    })
    const u2 = onSnapshot(collection(db, 'dispatches'), snap => {
      setDispatches(snap.docs.map(d => ({ id: d.id, ...d.data() } as Dispatch)).sort((a, b) => b.createdAt - a.createdAt))
    })
    const u3 = onSnapshot(collection(db, 'allocations_v2'), snap => {
      setAllocations(snap.docs.map(d => ({ id: d.id, ...d.data() } as UnifiedAllocation)))
    })
    const u4 = onSnapshot(collection(db, 'products'), snap => {
      setProducts(snap.docs.map(d => ({ id: d.id, ...d.data() } as Product)))
    })
    return () => { u1(); u2(); u3(); u4() }
  }, [])

  const filtered = parties.filter(p => {
    if (typeFilter !== 'all' && p.type !== typeFilter) return false
    if (statusFilter !== 'all' && (p as any).status !== statusFilter) return false
    if (categoryFilter !== 'all' && p.category !== categoryFilter) return false
    if (p.type === 'retailer' && distributorFilter !== 'all') {
      if (distributorFilter === 'independent' && (p as any).underDistributorId) return false
      if (distributorFilter !== 'independent' && (p as any).underDistributorId !== distributorFilter) return false
    }
    if (placeSearch.trim()) {
      const s = placeSearch.toLowerCase()
      if (
        !p.name.toLowerCase().includes(s) &&
        !(p.address || '').toLowerCase().includes(s) &&
        !(p.place || '').toLowerCase().includes(s)
      ) return false
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
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const startEdit = (p: Party) => {
    const packets = p.packetsAllocated || 0
    setForm({
      name: p.name, type: p.type, category: p.category || 'FMCG',
      phone: p.phone, address: p.address, place: p.place || '',
      quantity: String(packets),
      lowStockThreshold: String(p.lowStockThreshold || 0),
      underDistributorId: p.underDistributorId || '',
    })
    setUnit('packets')
    setEditingId(p.id!)
    setFocusParent(false)
    setTab('add')
  }

  const startChangeParent = (p: Party) => {
    startEdit(p)
    setFocusParent(true)
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
        packetsAllocated: packets, cartonsAllocated: cartons,
        lowStockThreshold: parseInt(form.lowStockThreshold) || 0,
      }
      if (form.type === 'retailer') {
        if (form.underDistributorId) {
          data.underDistributorId = form.underDistributorId
          data.underDistributorName = underDist?.name || ''
        } else if (editingId) {
          // deleteField() only valid in updateDoc, not addDoc
          data.underDistributorId = deleteField()
          data.underDistributorName = deleteField()
        }
      }

      if (editingId) {
        await updateDoc(doc(db, 'parties', editingId), data)
        setEditingId(null)
      } else {
        data.addedBy = appUser!.uid
        data.addedByName = appUser!.name
        data.createdAt = Date.now()
        data.status = 'prospect'
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
      setFocusParent(false)
      setTab('list')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!await showDanger('Delete Entry?', 'This cannot be undone.')) return
    setDeleting(id)
    await deleteDoc(doc(db, 'parties', id))
    setDeleting(null)
  }

  if (tab === 'import') return <CSVImporter onBack={() => setTab('list')} onDone={() => setTab('list')} />
  if (tab === 'allocations') return <AllocationManager onBack={() => setTab('list')} parties={parties} isAdmin={isAdmin} />


  const distributorOptions = distributors.map(d => ({ value: d.id!, label: d.name }))

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg, #0a0a0a)', paddingBottom: 40 }}>
      {/* Header */}
      <div style={{ background: '#000000', padding: '24px 20px 16px' }}>
        <button onClick={onBack} style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: 'rgba(255,255,255,0.7)', padding: '6px 14px', borderRadius: 20, fontSize: 12, marginBottom: 16 }}>← Back</button>
        <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11, letterSpacing: 3, textTransform: 'uppercase', marginBottom: 4 }}>Network</div>
        <div style={{ fontSize: 22, fontWeight: 900, marginBottom: 2, color: '#fff' }}>Distributors & Retailers</div>
        <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 13, marginBottom: 16 }}>
          {distributors.length} distributors • {parties.filter(p => p.type === 'retailer').length} retailers
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {([
            { id: 'list', label: 'View All' },
            { id: 'add', label: editingId ? 'Editing' : 'Add New' },
            { id: 'import', label: 'Import CSV' },
            { id: 'allocations', label: 'Allocations' },
          ] as const).map(t => (
            <button key={t.id} onClick={() => { setTab(t.id); if (t.id !== 'add') { setEditingId(null); setForm(emptyForm) } }}
              style={{ background: tab === t.id ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.07)', color: tab === t.id ? '#fff' : 'rgba(255,255,255,0.5)', border: 'none', borderRadius: 20, padding: '7px 14px', fontSize: 11, fontWeight: 700 }}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: '16px 14px' }}>

        {/* LIST */}
        {tab === 'list' && (
          <>
            <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 14, padding: 14, marginBottom: 14, border: '1px solid rgba(255,255,255,0.08)', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <input value={placeSearch} onChange={e => setPlaceSearch(e.target.value)}
                placeholder="Search by name, place, area..."
                style={{ width: '100%', background: 'rgba(128,128,128,0.1)', border: '1px solid rgba(128,128,128,0.2)', borderRadius: 10, padding: '11px 14px', fontSize: 15, color: 'inherit', outline: 'none', boxSizing: 'border-box' }} />

              {/* Type filter */}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {(['all', 'distributor', 'retailer'] as const).map(f => (
                  <button key={f} onClick={() => { setTypeFilter(f); if (f === 'distributor') setDistributorFilter('all') }}
                    style={{ background: typeFilter === f ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.04)', color: typeFilter === f ? '#fff' : '#888', border: `1px solid ${typeFilter === f ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.08)'}`, borderRadius: 20, padding: '5px 14px', fontSize: 12, fontWeight: 700 }}>
                    {f === 'all' ? 'All' : f === 'distributor' ? 'Dist.' : 'Retailer'}
                  </button>
                ))}
              </div>

              {/* Status filter */}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {([
                  ['all',      'All'],
                  ['active',   'Active'],
                  ['prospect', 'Prospect'],
                  ['inactive', 'Inactive'],
                ] as [string, string][]).map(([val, label]) => (
                  <button key={val} onClick={() => setStatusFilter(val as any)}
                    style={{ background: statusFilter === val ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.04)', color: statusFilter === val ? '#fff' : '#888', border: `1px solid ${statusFilter === val ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.08)'}`, borderRadius: 20, padding: '5px 14px', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>
                    {label}
                  </button>
                ))}
              </div>

              {/* Distributor sub-filter — shown when retailers are visible */}
              {typeFilter !== 'distributor' && distributors.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, color: '#888', marginBottom: 6, letterSpacing: 1, textTransform: 'uppercase' }}>Under Distributor</div>
                  <CustomSelect
                    value={distributorFilter}
                    onChange={setDistributorFilter}
                    placeholder="All retailers"
                    options={[
                      { value: 'all', label: 'All retailers' },
                      { value: 'independent', label: 'Independent retailers' },
                      ...distributors.map(d => ({ value: d.id!, label: d.name, sub: d.place || d.address })),
                    ]}
                  />
                </div>
              )}

              {/* Category filter */}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {(['all', ...CATEGORIES] as ('all' | PartyCategory)[]).map(c => (
                  <button key={c} onClick={() => setCategoryFilter(c)}
                    style={{ background: categoryFilter === c ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.04)', color: categoryFilter === c ? '#fff' : '#888', border: `1px solid ${categoryFilter === c ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.08)'}`, borderRadius: 20, padding: '5px 12px', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>
                    {c}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ fontSize: 12, color: '#888', marginBottom: 10 }}>Showing {filtered.length} of {parties.length} entries</div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {filtered.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 40, color: '#555' }}>
                  <div style={{ fontWeight: 700 }}>No entries found</div>
                  <div style={{ fontSize: 13, marginTop: 6 }}>Try different filters or add a new entry</div>
                </div>
              ) : filtered.map(p => (
                <div key={p.id} style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 14, padding: 16, border: '1px solid rgba(255,255,255,0.08)' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                    <div style={{ width: 42, height: 42, background: p.type === 'distributor' ? 'rgba(99,102,241,0.15)' : 'rgba(34,197,94,0.12)', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, color: p.type === 'distributor' ? '#818cf8' : '#22c55e', flexShrink: 0 }}>
                      {p.type === 'distributor' ? 'D' : 'R'}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3, flexWrap: 'wrap' }}>
                        <div style={{ fontWeight: 800, fontSize: 15 }}>{p.name}</div>
                        <span style={{ fontSize: 10, background: 'rgba(128,128,128,0.15)', color: '#a0a0a0', padding: '2px 8px', borderRadius: 99 }}>{p.category}</span>
                      </div>
                      <div style={{ fontSize: 12, color: '#888' }}>{p.phone}</div>
                      <div style={{ fontSize: 12, color: '#888' }}>{p.address}</div>
                      {p.place && <div style={{ fontSize: 11, color: '#666' }}>{p.place}</div>}
                      {p.underDistributorName && <div style={{ fontSize: 11, color: '#a0a0a0', marginTop: 2 }}>Under: {p.underDistributorName}</div>}
                      {p.type === 'retailer' && (
                        <button onClick={() => startChangeParent(p)}
                          style={{ background: 'rgba(128,128,128,0.1)', border: '1px solid rgba(128,128,128,0.2)', color: '#a0a0a0', borderRadius: 8, padding: '4px 10px', fontSize: 10, marginTop: 6, cursor: 'pointer' }}>
                          Change Parent
                        </button>
                      )}
                      {(() => {
                        const pAllocs = allocations.filter(a => a.partyId === p.id && a.status !== 'cancelled')
                        const allocatedPkts = pAllocs.reduce((s, a) => s + a.packets, 0)
                        const stockEntries = Object.entries(p.stock || {}).filter(([, qty]) => (qty as number) > 0)
                        return (
                          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                            <span style={{ fontSize: 11, background: 'rgba(128,128,128,0.12)', color: '#a0a0a0', padding: '3px 10px', borderRadius: 99, fontWeight: 700, alignSelf: 'flex-start' }}>
                              {toDisplay(allocatedPkts, config.packetsPerCarton)} allocated
                            </span>
                            {stockEntries.length > 0 && (
                              <div style={{ background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.15)', borderRadius: 8, padding: '6px 10px', display: 'flex', flexDirection: 'column', gap: 3 }}>
                                <div style={{ fontSize: 9, color: '#22c55e', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 2 }}>In Stock</div>
                                {stockEntries.map(([pid, qty]) => {
                                  const prod = products.find(pr => pr.id === pid)
                                  return (
                                    <div key={pid} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                                      <span style={{ color: '#888' }}>{prod?.name || pid}</span>
                                      <span style={{ fontWeight: 700, color: '#22c55e' }}>{toDisplay(qty as number, config.packetsPerCarton)}</span>
                                    </div>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        )
                      })()}
                      <div style={{ fontSize: 10, color: '#555', marginTop: 4 }}>Added by {p.addedByName}</div>

                      {/* Dispatch log toggle */}
                      <button onClick={e => { e.stopPropagation(); setExpandedDispatch(expandedDispatch === p.id ? null : p.id!) }}
                        style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '5px 10px', fontSize: 11, color: '#888', marginTop: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                        {expandedDispatch === p.id ? '▲' : '▼'} Last dispatches
                      </button>

                      {expandedDispatch === p.id && (() => {
                        const pd = dispatches.filter(d => d.partyId === p.id).slice(0, 3)
                        return pd.length === 0 ? (
                          <div style={{ fontSize: 11, color: '#555', marginTop: 8, padding: '8px 10px', background: 'rgba(255,255,255,0.03)', borderRadius: 8 }}>No dispatches yet</div>
                        ) : (
                          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {pd.map(d => (
                              <div key={d.id} style={{ fontSize: 11, background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '8px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div>
                                  <div style={{ fontWeight: 600 }}>{toDisplay(d.packets, config.packetsPerCarton)}</div>
                                  <div style={{ color: '#555', fontSize: 10 }}>{new Date(d.dispatchedAt || d.createdAt).toLocaleDateString('en-IN')}</div>
                                </div>
                                <span style={{ fontSize: 10, color: d.paymentType === 'cash' ? '#22c55e' : '#f59e0b', background: d.paymentType === 'cash' ? 'rgba(34,197,94,0.1)' : 'rgba(245,158,11,0.1)', padding: '2px 8px', borderRadius: 99 }}>
                                  {d.paymentType === 'cash' ? 'Cash' : 'Credit'}
                                </span>
                              </div>
                            ))}
                          </div>
                        )
                      })()}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <button onClick={() => startEdit(p)}
                        style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', color: '#fff', borderRadius: 10, padding: '7px 12px', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
                        Edit
                      </button>
                      {isAdmin && (
                        <button onClick={() => handleDelete(p.id!)} disabled={deleting === p.id}
                          style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#ef4444', borderRadius: 10, padding: '7px 12px', fontSize: 11, fontWeight: 700, opacity: deleting === p.id ? 0.5 : 1, flexShrink: 0 }}>
                          Del
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
              <div style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.13)', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: '#a0a0a0' }}>
                Editing existing entry — changes will be saved
              </div>
            )}

            {/* Type */}
            {!editingId && (
              <div>
                <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8, letterSpacing: 1, textTransform: 'uppercase' }}>Type</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {(['distributor', 'retailer'] as PartyType[]).map(t => (
                    <button key={t} onClick={() => setForm({ ...form, type: t })}
                      style={{ flex: 1, background: form.type === t ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.04)', color: form.type === t ? '#fff' : '#888', border: `1.5px solid ${form.type === t ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.08)'}`, borderRadius: 12, padding: '12px', fontSize: 13, fontWeight: 800 }}>
                      {t === 'distributor' ? 'Distributor' : 'Retailer'}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Status legend — new parties always start as Prospect */}
            {!editingId && (
              <div style={{ background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 12, padding: '12px 14px' }}>
                <div style={{ fontSize: 11, color: '#f59e0b', fontWeight: 700, marginBottom: 8, letterSpacing: 1, textTransform: 'uppercase' }}>
                  Starting as Prospect
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {[
                    { color: '#f59e0b', label: 'Prospect', desc: 'New contact, not yet buying from us' },
                    { color: '#22c55e', label: 'Active', desc: 'Currently placing orders' },
                    { color: '#ef4444', label: 'Inactive', desc: 'Was active, no longer buying' },
                  ].map(s => (
                    <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: s.color, display: 'inline-block', flexShrink: 0 }} />
                      <span style={{ fontSize: 12, fontWeight: 700, minWidth: 60 }}>{s.label}</span>
                      <span style={{ fontSize: 11, color: '#888' }}>— {s.desc}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Category */}
            <div>
              <div style={{ fontSize: 11, color: '#888', marginBottom: 8, letterSpacing: 1, textTransform: 'uppercase' }}>Category</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {CATEGORIES.map(c => (
                  <button key={c} onClick={() => setForm({ ...form, category: c })}
                    style={{ background: form.category === c ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.04)', color: form.category === c ? '#fff' : '#888', border: `1px solid ${form.category === c ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.08)'}`, borderRadius: 20, padding: '6px 14px', fontSize: 12, fontWeight: 700 }}>
                    {c}
                  </button>
                ))}
              </div>
            </div>

            {/* Under distributor */}
            {form.type === 'retailer' && distributors.length > 0 && (
              <div style={{
                background: focusParent ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.02)',
                border: `1.5px solid ${focusParent ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.08)'}`,
                borderRadius: 12, padding: 14,
              }}>
                {focusParent && (
                  <div style={{ fontSize: 10, color: '#a0a0a0', marginBottom: 8, fontWeight: 700, letterSpacing: 1 }}>
                    CHANGE PARENT DISTRIBUTOR
                  </div>
                )}
                <div style={{ fontSize: 11, color: '#888', marginBottom: 8, letterSpacing: 1, textTransform: 'uppercase' }}>
                  Parent Distributor (optional)
                </div>
                <div style={{ fontSize: 11, color: '#475569', marginBottom: 10 }}>
                  Link this retailer to a distributor to enable distribution tracking. Unlinked = independent retailer.
                </div>
                <CustomSelect
                  value={form.underDistributorId}
                  onChange={v => { setForm({ ...form, underDistributorId: v }); setFocusParent(false) }}
                  placeholder="Independent retailer"
                  options={[{ value: '', label: 'Independent retailer' }, ...distributorOptions]}
                />
              </div>
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

            {/* Quantity — hidden for retailers under a distributor (stock managed by distributor) */}
            {!(form.type === 'retailer' && form.underDistributorId) && (
              <Field label="Quantity to Allocate" error={errors.quantity}>
                <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                  {(['packets', 'cartons'] as const).map(u => (
                    <button key={u} onClick={() => setUnit(u)}
                      style={{ flex: 1, background: unit === u ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.04)', color: unit === u ? '#fff' : '#888', border: `1.5px solid ${unit === u ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.08)'}`, borderRadius: 10, padding: '9px', fontSize: 12, fontWeight: 700 }}>
                      {u === 'packets' ? 'Packets' : `Cartons (1=${config.packetsPerCarton} pkts)`}
                    </button>
                  ))}
                </div>
                <input type="number" value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })}
                  placeholder={unit === 'cartons' ? 'No. of cartons' : 'No. of packets'}
                  style={inputStyle(!!errors.quantity)} />
                {form.quantity && parseInt(form.quantity) > 0 && (
                  <div style={{ marginTop: 8, fontSize: 13, color: '#22c55e', fontWeight: 700 }}>
                    = {toDisplay(toPackets(form.quantity), config.packetsPerCarton)}
                  </div>
                )}
              </Field>
            )}

            {isAdmin && !(form.type === 'retailer' && form.underDistributorId) && (
              <Field label="Low Stock Alert Threshold (packets)" hint="Admin alerted when remaining falls below this">
                <input type="number" value={form.lowStockThreshold} onChange={e => setForm({ ...form, lowStockThreshold: e.target.value })}
                  placeholder="e.g. 50" style={inputStyle()} />
              </Field>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => { setTab('list'); setEditingId(null); setForm(emptyForm); setErrors({}); setFocusParent(false) }}
                style={{ flex: 1, background: 'rgba(255,255,255,0.06)', color: '#888', border: 'none', borderRadius: 14, padding: 14, fontSize: 14, fontWeight: 700 }}>
                Cancel
              </button>
              <button onClick={handleSave} disabled={saving}
                style={{ flex: 2, background: saving ? 'rgba(255,255,255,0.1)' : '#ffffff', color: saving ? '#888' : '#000000', border: 'none', borderRadius: 14, padding: 14, fontSize: 15, fontWeight: 800 }}>
                {saving ? 'Saving...' : editingId ? 'Save Changes' : `Add ${form.type === 'distributor' ? 'Distributor' : 'Retailer'}`}
              </button>
            </div>
          </div>
        )}
      </div>
      {modal}
    </div>
  )
}
