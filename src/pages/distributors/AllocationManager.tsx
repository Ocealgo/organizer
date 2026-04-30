import React, { useState, useEffect } from 'react'
import { collection, addDoc, onSnapshot, query, where } from 'firebase/firestore'
import { db } from '../../firebase'
import { Party, Allocation } from '../../types'
import { useAuth } from '../../context/AuthContext'
import { useStockConfig, toDisplay } from '../../hooks/useFirebase'
import CustomSelect from '../../components/CustomSelect'

interface Props { onBack: () => void; parties: Party[] }

function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6, letterSpacing: 1, textTransform: 'uppercase' }}>{label}</div>
      {hint && <div style={{ fontSize: 11, color: '#6ee7b7', marginBottom: 6 }}>💡 {hint}</div>}
      {children}
      {error && <div style={{ fontSize: 11, color: '#dc2626', marginTop: 4 }}>⚠️ {error}</div>}
    </div>
  )
}

export default function AllocationManager({ onBack, parties }: Props) {
  const { appUser } = useAuth()
  const { config } = useStockConfig()
  const [allocations, setAllocations] = useState<Allocation[]>([])
  const [tab, setTab] = useState<'list' | 'add'>('list')
  const [saving, setSaving] = useState(false)
  const [unit, setUnit] = useState<'packets' | 'cartons'>('packets')
  const [filterParty, setFilterParty] = useState('')
  const [form, setForm] = useState({
    partyId: '', month: new Date().toISOString().slice(0, 7),
    quantity: '', pricePerPacket: '', notes: '',
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [stockWarning, setStockWarning] = useState('')

  useEffect(() => {
    return onSnapshot(collection(db, 'allocations'), snap => {
      setAllocations(snap.docs.map(d => ({ id: d.id, ...d.data() } as Allocation)).sort((a, b) => b.createdAt - a.createdAt))
    })
  }, [])

  const toPackets = (qty: string) => {
    const n = parseInt(qty) || 0
    return unit === 'cartons' ? n * config.packetsPerCarton : n
  }

  const partyOptions = parties.map(p => ({
    value: p.id!, label: `${p.type === 'distributor' ? '🚚' : '🏪'} ${p.name}`,
    sub: `${p.category} • ${p.place || p.address}`,
    group: p.type === 'distributor' ? 'Distributors' : 'Retailers',
  }))

  const validate = () => {
    const e: Record<string, string> = {}
    if (!form.partyId) e.partyId = 'Select a distributor or retailer'
    if (!form.quantity || parseInt(form.quantity) <= 0) e.quantity = 'Enter quantity'
    if (!form.pricePerPacket || parseFloat(form.pricePerPacket) <= 0) e.pricePerPacket = 'Enter selling price per packet'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const handleAdd = async () => {
    if (!validate()) return
    const packets = toPackets(form.quantity)
    const cartons = unit === 'cartons' ? parseInt(form.quantity) : Math.floor(packets / config.packetsPerCarton)
    const party = parties.find(p => p.id === form.partyId)!

    // Stock check
    const available = config.total - config.locked
    if (packets > available) {
      setStockWarning(`⚠️ Total available stock (${toDisplay(available, config.packetsPerCarton)}) is less than this allocation (${toDisplay(packets, config.packetsPerCarton)}). Allocation saved — admin should restock.`)
      // Create alert
      await addDoc(collection(db, 'alerts'), {
        type: 'low_stock',
        message: `⚠️ Insufficient stock for ${party.name} allocation (${toDisplay(packets, config.packetsPerCarton)} needed, only ${toDisplay(available, config.packetsPerCarton)} available)`,
        relatedId: form.partyId, read: false, createdAt: Date.now(),
      })
    } else {
      setStockWarning('')
    }

    setSaving(true)
    try {
      await addDoc(collection(db, 'allocations'), {
        partyId: form.partyId,
        partyName: party.name,
        partyType: party.type,
        packets, cartons,
        pricePerPacket: parseFloat(form.pricePerPacket),
        month: form.month,
        notes: form.notes,
        status: 'active',
        createdBy: appUser!.uid,
        createdByName: appUser!.name,
        createdAt: Date.now(),
      })
      setForm({ partyId: '', month: new Date().toISOString().slice(0, 7), quantity: '', pricePerPacket: '', notes: '' })
      setErrors({})
      setTab('list')
    } finally {
      setSaving(false)
    }
  }

  const filtered = filterParty
    ? allocations.filter(a => a.partyId === filterParty)
    : allocations

  const filterOptions = [
    { value: '', label: 'All Parties' },
    ...parties.map(p => ({ value: p.id!, label: `${p.type === 'distributor' ? '🚚' : '🏪'} ${p.name}` }))
  ]

  return (
    <div style={{ minHeight: '100vh', background: '#0d1117', paddingBottom: 40 }}>
      <div style={{ background: 'linear-gradient(135deg,#7c3aed,#6d28d9)', padding: '24px 20px 16px' }}>
        <button onClick={onBack} style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: '#ddd6fe', padding: '6px 14px', borderRadius: 20, fontSize: 12, marginBottom: 16 }}>← Back</button>
        <div style={{ color: '#ddd6fe', fontSize: 11, letterSpacing: 3, textTransform: 'uppercase', marginBottom: 4 }}>Allocations 📋</div>
        <div style={{ fontSize: 22, fontWeight: 900, marginBottom: 16 }}>Stock Allocations</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {(['list', 'add'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              style={{ background: tab === t ? 'rgba(255,255,255,0.2)' : 'transparent', color: tab === t ? '#fff' : 'rgba(255,255,255,0.5)', border: 'none', borderRadius: 20, padding: '7px 18px', fontSize: 12, fontWeight: 700 }}>
              {t === 'list' ? '📋 View All' : '➕ New Allocation'}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: '16px 14px' }}>
        {tab === 'list' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Field label="Filter by Party">
              <CustomSelect value={filterParty} onChange={setFilterParty}
                placeholder="All Parties" options={filterOptions} />
            </Field>

            {filtered.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 40, color: '#475569' }}>
                <div style={{ fontSize: 36, marginBottom: 12 }}>📋</div>
                <div style={{ fontWeight: 700 }}>No allocations yet</div>
                <div style={{ fontSize: 13, marginTop: 6 }}>Tap "New Allocation" to create one</div>
              </div>
            ) : filtered.map(a => (
              <div key={a.id} style={{ background: '#161b22', borderRadius: 14, padding: 16, border: '1px solid rgba(124,58,237,0.2)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <div style={{ fontSize: 22 }}>{a.partyType === 'distributor' ? '🚚' : '🏪'}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 800, fontSize: 14 }}>{a.partyName}</div>
                    <div style={{ fontSize: 11, color: '#64748b' }}>
                      {a.month} • by {a.createdByName} • {new Date(a.createdAt).toLocaleDateString('en-IN')}
                    </div>
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 99, background: a.status === 'active' ? 'rgba(22,163,74,0.15)' : 'rgba(100,116,139,0.15)', color: a.status === 'active' ? '#16a34a' : '#64748b' }}>
                    {a.status === 'active' ? '✅ Active' : '🔒 Completed'}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11, background: 'rgba(124,58,237,0.15)', color: '#a78bfa', padding: '4px 12px', borderRadius: 99, fontWeight: 700 }}>
                    📦 {toDisplay(a.packets, config.packetsPerCarton)}
                  </span>
                  <span style={{ fontSize: 11, background: 'rgba(22,163,74,0.15)', color: '#16a34a', padding: '4px 12px', borderRadius: 99, fontWeight: 700 }}>
                    ₹{a.pricePerPacket}/pkt
                  </span>
                  <span style={{ fontSize: 11, background: 'rgba(8,145,178,0.15)', color: '#0891b2', padding: '4px 12px', borderRadius: 99, fontWeight: 700 }}>
                    Total ₹{(a.packets * a.pricePerPacket).toLocaleString()}
                  </span>
                </div>
                {a.notes && <div style={{ fontSize: 11, color: '#475569', marginTop: 8 }}>📝 {a.notes}</div>}
              </div>
            ))}
          </div>
        )}

        {tab === 'add' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.2)', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: '#a78bfa' }}>
              💡 Each allocation is independent — creating a new one won't overwrite existing ones
            </div>

            {stockWarning && (
              <div style={{ background: 'rgba(220,38,38,0.1)', border: '1px solid rgba(220,38,38,0.3)', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: '#fca5a5' }}>
                {stockWarning}
              </div>
            )}

            <Field label="Distributor / Retailer" error={errors.partyId}>
              <CustomSelect value={form.partyId} onChange={v => {
                const party = parties.find(p => p.id === v)
                setForm({ ...form, partyId: v, pricePerPacket: party ? String(party.pricePerPacket) : '' })
              }}
                placeholder="Select..." options={partyOptions} error={!!errors.partyId} />
            </Field>

            <div>
              <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6, letterSpacing: 1, textTransform: 'uppercase' }}>Month</div>
              <input type="month" value={form.month} onChange={e => setForm({ ...form, month: e.target.value })}
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '10px 14px', fontSize: 14, color: '#fff', outline: 'none', width: '100%', boxSizing: 'border-box' }} />
            </div>

            <Field label="Quantity" error={errors.quantity}>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                {(['packets', 'cartons'] as const).map(u => (
                  <button key={u} onClick={() => setUnit(u)}
                    style={{ flex: 1, background: unit === u ? 'rgba(124,58,237,0.15)' : 'rgba(255,255,255,0.04)', color: unit === u ? '#a78bfa' : '#64748b', border: `1.5px solid ${unit === u ? '#7c3aed' : 'rgba(255,255,255,0.06)'}`, borderRadius: 10, padding: '9px', fontSize: 12, fontWeight: 700 }}>
                    {u === 'packets' ? '📦 Packets' : `📫 Cartons (1=${config.packetsPerCarton})`}
                  </button>
                ))}
              </div>
              <input type="number" value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })}
                placeholder={unit === 'cartons' ? 'No. of cartons' : 'No. of packets'}
                style={{ width: '100%', background: 'rgba(255,255,255,0.06)', border: `1.5px solid ${errors.quantity ? '#dc2626' : 'rgba(255,255,255,0.1)'}`, borderRadius: 12, padding: '13px 16px', fontSize: 18, fontWeight: 800, color: '#fff', outline: 'none', boxSizing: 'border-box' }} />
              {form.quantity && parseInt(form.quantity) > 0 && (
                <div style={{ marginTop: 6, fontSize: 13, color: '#a78bfa', fontWeight: 700 }}>= {toDisplay(toPackets(form.quantity), config.packetsPerCarton)}</div>
              )}
            </Field>

            <Field label="Selling Price Per Single Packet (₹)" hint="Price you charge them per single packet" error={errors.pricePerPacket}>
              <input type="number" value={form.pricePerPacket} onChange={e => setForm({ ...form, pricePerPacket: e.target.value })}
                placeholder="e.g. 45"
                style={{ width: '100%', background: 'rgba(255,255,255,0.06)', border: `1.5px solid ${errors.pricePerPacket ? '#dc2626' : 'rgba(255,255,255,0.1)'}`, borderRadius: 12, padding: '13px 16px', fontSize: 14, color: '#fff', outline: 'none', boxSizing: 'border-box' }} />
              {form.quantity && form.pricePerPacket && (
                <div style={{ marginTop: 6, fontSize: 13, color: '#16a34a', fontWeight: 700 }}>
                  Total value: ₹{(toPackets(form.quantity) * parseFloat(form.pricePerPacket)).toLocaleString()}
                </div>
              )}
            </Field>

            <Field label="Notes (optional)">
              <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
                placeholder="e.g. Next batch for June..." rows={2}
                style={{ width: '100%', background: 'rgba(255,255,255,0.06)', border: '1.5px solid rgba(255,255,255,0.1)', borderRadius: 12, padding: '13px 16px', fontSize: 14, color: '#fff', outline: 'none', resize: 'none', boxSizing: 'border-box' }} />
            </Field>

            <button onClick={handleAdd} disabled={saving}
              style={{ background: saving ? '#475569' : 'linear-gradient(135deg,#7c3aed,#6d28d9)', color: '#fff', border: 'none', borderRadius: 14, padding: 16, fontSize: 15, fontWeight: 800 }}>
              {saving ? 'Saving...' : 'Create Allocation 📋'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
