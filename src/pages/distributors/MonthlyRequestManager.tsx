import React, { useState, useEffect } from 'react'
import { collection, addDoc, onSnapshot, doc, updateDoc } from 'firebase/firestore'
import { db } from '../../firebase'
import { Party, MonthlyRequest, RequestStatus } from '../../types'
import DateInput from '../../components/DateInput'
import { useAuth } from '../../context/AuthContext'
import { useStockConfig, toDisplay } from '../../hooks/useFirebase'
import CustomSelect from '../../components/CustomSelect'
import { localMonthStr } from '../../utils/date'

interface Props { onBack: () => void; parties: Party[] }

function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: '#888', marginBottom: 6, letterSpacing: 1, textTransform: 'uppercase' }}>{label}</div>
      {hint && <div style={{ fontSize: 11, color: '#a0a0a0', marginBottom: 6 }}>{hint}</div>}
      {children}
      {error && <div style={{ fontSize: 11, color: '#ef4444', marginTop: 4 }}>{error}</div>}
    </div>
  )
}

const STATUS_STYLE: Record<RequestStatus, { color: string; bg: string; label: string }> = {
  pending:   { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)',  label: 'Pending' },
  partial:   { color: '#fff',    bg: 'rgba(255,255,255,0.08)', label: 'Partial' },
  fulfilled: { color: '#22c55e', bg: 'rgba(34,197,94,0.12)',   label: 'Fulfilled' },
}

export default function MonthlyRequestManager({ onBack, parties }: Props) {
  const { appUser } = useAuth()
  const { config } = useStockConfig()
  const [requests, setRequests] = useState<MonthlyRequest[]>([])
  const [tab, setTab] = useState<'list' | 'add'>('list')
  const [selectedMonth, setSelectedMonth] = useState(localMonthStr())
  const [unit, setUnit] = useState<'packets' | 'cartons'>('packets')
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ partyId: '', quantity: '', notes: '' })
  const [errors, setErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'monthly_requests'), snap => {
      setRequests(snap.docs.map(d => ({ id: d.id, ...d.data() } as MonthlyRequest)).sort((a, b) => b.createdAt - a.createdAt))
    })
    return unsub
  }, [])

  const toPackets = (qty: string) => {
    const n = parseInt(qty) || 0
    return unit === 'cartons' ? n * config.packetsPerCarton : n
  }

  const filtered = requests.filter(r => r.month === selectedMonth)

  const partyOptions = parties.map(p => ({
    value: p.id!, label: p.name,
    sub: `${p.category} • ${p.place || p.address}`,
    group: p.type === 'distributor' ? 'Distributors' : 'Retailers',
  }))

  const validate = () => {
    const e: Record<string, string> = {}
    if (!form.partyId) e.partyId = 'Select a distributor or retailer'
    if (!form.quantity || parseInt(form.quantity) <= 0) e.quantity = 'Enter quantity'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const handleAdd = async () => {
    if (!validate()) return
    const party = parties.find(p => p.id === form.partyId)!
    const packets = toPackets(form.quantity)
    // Check if request already exists for this party+month
    const existing = requests.find(r => r.partyId === form.partyId && r.month === selectedMonth)
    setSaving(true)
    try {
      if (existing) {
        await updateDoc(doc(db, 'monthly_requests', existing.id!), {
          requestedPackets: packets,
          notes: form.notes,
          updatedAt: Date.now(),
          requestedBy: appUser!.uid,
          requestedByName: appUser!.name,
        })
      } else {
        await addDoc(collection(db, 'monthly_requests'), {
          partyId: form.partyId,
          partyName: party.name,
          partyType: party.type,
          month: selectedMonth,
          requestedPackets: packets,
          fulfilledPackets: 0,
          status: 'pending' as RequestStatus,
          notes: form.notes,
          requestedBy: appUser!.uid,
          requestedByName: appUser!.name,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        })
      }
      setForm({ partyId: '', quantity: '', notes: '' })
      setErrors({})
      setTab('list')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0d1117', paddingBottom: 40 }}>
      <div style={{ background: '#000000', padding: '24px 20px 16px' }}>
        <button onClick={onBack} style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: 'rgba(255,255,255,0.7)', padding: '6px 14px', borderRadius: 20, fontSize: 12, marginBottom: 16 }}>← Back</button>
        <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11, letterSpacing: 3, textTransform: 'uppercase', marginBottom: 4 }}>Monthly Planning</div>
        <div style={{ fontSize: 22, fontWeight: 900, color: '#fff', marginBottom: 16 }}>Stock Requests</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {(['list', 'add'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              style={{ background: tab === t ? 'rgba(255,255,255,0.2)' : 'transparent', color: tab === t ? '#fff' : 'rgba(255,255,255,0.5)', border: 'none', borderRadius: 20, padding: '7px 18px', fontSize: 12, fontWeight: 700 }}>
              {t === 'list' ? 'View Requests' : 'Add / Update Request'}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: '16px 14px' }}>
        {tab === 'list' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6, letterSpacing: 1, textTransform: 'uppercase' }}>Month</div>
              <DateInput type="month" value={selectedMonth} onChange={v => setSelectedMonth(v)} />
            </div>

            {filtered.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 40, color: '#475569' }}>
                <div style={{ fontWeight: 700 }}>No requests for {selectedMonth}</div>
                <div style={{ fontSize: 13, marginTop: 6 }}>Tap "Add Request" to add stock needs for this month</div>
              </div>
            ) : filtered.map(r => {
              const ss = STATUS_STYLE[r.status]
              const pct = r.requestedPackets > 0 ? Math.round((r.fulfilledPackets / r.requestedPackets) * 100) : 0
              return (
                <div key={r.id} style={{ background: '#161b22', borderRadius: 14, padding: 16, border: `1px solid ${r.status === 'pending' ? 'rgba(217,119,6,0.2)' : r.status === 'fulfilled' ? 'rgba(22,163,74,0.2)' : 'rgba(8,145,178,0.2)'}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 800, fontSize: 15 }}>{r.partyName}</div>
                      <div style={{ fontSize: 11, color: '#64748b' }}>Added by {r.requestedByName}</div>
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 99, background: ss.bg, color: ss.color }}>
                      {ss.label}
                    </span>
                  </div>

                  {/* Progress bar */}
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 12 }}>
                      <span style={{ color: '#64748b' }}>Requested: <b style={{ color: '#fff' }}>{toDisplay(r.requestedPackets, config.packetsPerCarton)}</b></span>
                      <span style={{ color: '#16a34a', fontWeight: 700 }}>{pct}% fulfilled</span>
                    </div>
                    <div style={{ background: 'rgba(255,255,255,0.06)', borderRadius: 99, height: 8, overflow: 'hidden' }}>
                      <div style={{ width: `${Math.min(100, pct)}%`, height: '100%', background: r.status === 'fulfilled' ? '#22c55e' : '#fff', borderRadius: 99, transition: 'width 0.5s' }} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 11, color: '#64748b' }}>
                      <span>Fulfilled: {toDisplay(r.fulfilledPackets, config.packetsPerCarton)}</span>
                      <span>Remaining: {toDisplay(Math.max(0, r.requestedPackets - r.fulfilledPackets), config.packetsPerCarton)}</span>
                    </div>
                  </div>

                  {r.notes && <div style={{ fontSize: 12, color: '#475569' }}>{r.notes}</div>}
                </div>
              )
            })}
          </div>
        )}

        {tab === 'add' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: '#a0a0a0' }}>
              If a request already exists for this party & month, it will be updated
            </div>

            <div>
              <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6, letterSpacing: 1, textTransform: 'uppercase' }}>Month</div>
              <DateInput type="month" value={selectedMonth} onChange={v => setSelectedMonth(v)} />
            </div>

            <Field label="Distributor / Retailer" error={errors.partyId}>
              <CustomSelect value={form.partyId} onChange={v => setForm({ ...form, partyId: v })}
                placeholder="Select distributor or retailer..." options={partyOptions} error={!!errors.partyId} />
            </Field>

            <Field label="Quantity Needed" error={errors.quantity}>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                {(['packets', 'cartons'] as const).map(u => (
                  <button key={u} onClick={() => setUnit(u)}
                    style={{ flex: 1, background: unit === u ? '#fff' : 'rgba(255,255,255,0.04)', color: unit === u ? '#000' : '#64748b', border: `1.5px solid ${unit === u ? '#fff' : 'rgba(255,255,255,0.06)'}`, borderRadius: 10, padding: '9px', fontSize: 12, fontWeight: 700 }}>
                    {u === 'packets' ? 'Packets' : `Cartons (1=${config.packetsPerCarton})`}
                  </button>
                ))}
              </div>
              <input type="number" value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })}
                placeholder={unit === 'cartons' ? 'No. of cartons' : 'No. of packets'}
                style={{ width: '100%', background: 'rgba(255,255,255,0.06)', border: `1.5px solid ${errors.quantity ? '#dc2626' : 'rgba(255,255,255,0.1)'}`, borderRadius: 12, padding: '13px 16px', fontSize: 18, fontWeight: 800, color: '#fff', outline: 'none', boxSizing: 'border-box' }} />
              {form.quantity && parseInt(form.quantity) > 0 && (
                <div style={{ marginTop: 6, fontSize: 13, color: '#22c55e', fontWeight: 700 }}>= {toDisplay(toPackets(form.quantity), config.packetsPerCarton)}</div>
              )}
            </Field>

            <Field label="Notes (optional)">
              <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
                placeholder="Any notes about this request..." rows={2}
                style={{ width: '100%', background: 'rgba(255,255,255,0.06)', border: '1.5px solid rgba(255,255,255,0.1)', borderRadius: 12, padding: '13px 16px', fontSize: 14, color: '#fff', outline: 'none', resize: 'none', boxSizing: 'border-box' }} />
            </Field>

            <button onClick={handleAdd} disabled={saving}
              style={{ background: saving ? '#475569' : '#fff', color: saving ? '#aaa' : '#000', border: 'none', borderRadius: 14, padding: 16, fontSize: 15, fontWeight: 800 }}>
              {saving ? 'Saving...' : 'Submit Request'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
