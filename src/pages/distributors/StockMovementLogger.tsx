import React, { useState, useEffect } from 'react'
import { collection, addDoc, onSnapshot } from 'firebase/firestore'
import { db } from '../../firebase'
import { Party, StockMovement, PaymentType } from '../../types'
import DateInput from '../../components/DateInput'
import { useAuth } from '../../context/AuthContext'
import { useStockConfig, toDisplay } from '../../hooks/useFirebase'
import CustomSelect from '../../components/CustomSelect'
import { localDateStr, localMonthStr } from '../../utils/date'

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

const US_OPTION = { value: 'us', label: 'Us (Ocealgo)', sub: 'Direct from our stock', group: 'Direct' }

export default function StockMovementLogger({ onBack, parties }: Props) {
  const { appUser } = useAuth()
  const { config } = useStockConfig()
  const [movements, setMovements] = useState<StockMovement[]>([])
  const [tab, setTab] = useState<'log' | 'history'>('log')
  const [saving, setSaving] = useState(false)
  const [unit, setUnit] = useState<'packets' | 'cartons'>('packets')
  const [selectedMonth, setSelectedMonth] = useState(localMonthStr())
  const [form, setForm] = useState({ fromId: '', toPartyId: '', quantity: '', pricePerPacket: '', paymentType: 'cash' as PaymentType, notes: '' })
  const [errors, setErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'stock_movements'), snap => {
      setMovements(snap.docs.map(d => ({ id: d.id, ...d.data() } as StockMovement)).sort((a, b) => b.createdAt - a.createdAt))
    })
    return unsub
  }, [])

  const toPackets = (qty: string) => {
    const n = parseInt(qty) || 0
    return unit === 'cartons' ? n * config.packetsPerCarton : n
  }

  // FROM options: Us + all distributors
  const fromOptions = [
    US_OPTION,
    ...parties.filter(p => p.type === 'distributor').map(p => ({
      value: p.id!, label: p.name, sub: `${p.category} • ${p.place || p.address}`, group: 'Distributors'
    }))
  ]

  // TO options: all parties
  const toOptions = parties.map(p => ({
    value: p.id!, label: p.name,
    sub: `${p.category} • ${p.place || p.address}`,
    group: p.type === 'distributor' ? 'Distributors' : 'Retailers',
  }))

  const validate = () => {
    const e: Record<string, string> = {}
    if (!form.fromId) e.fromId = 'Select who is passing stock'
    if (!form.toPartyId) e.toPartyId = 'Select who is receiving stock'
    if (form.fromId !== 'us' && form.fromId === form.toPartyId) e.toPartyId = 'Cannot pass to same party'
    if (!form.quantity || parseInt(form.quantity) <= 0) e.quantity = 'Enter quantity'
    if (!form.pricePerPacket || parseFloat(form.pricePerPacket) <= 0) e.pricePerPacket = 'Enter price per packet'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const handleLog = async () => {
    if (!validate()) return
    setSaving(true)
    try {
      const packets = toPackets(form.quantity)
      const cartons = unit === 'cartons' ? parseInt(form.quantity) : Math.floor(packets / config.packetsPerCarton)
      const pricePerPacket = parseFloat(form.pricePerPacket)
      const fromParty = form.fromId === 'us' ? null : parties.find(p => p.id === form.fromId)
      const toParty = parties.find(p => p.id === form.toPartyId)!
      await addDoc(collection(db, 'stock_movements'), {
        fromId: form.fromId,
        fromName: form.fromId === 'us' ? 'Ocealgo (Us)' : fromParty?.name || '',
        toPartyId: form.toPartyId,
        toPartyName: toParty.name,
        packets, cartons,
        pricePerPacket,
        totalAmount: packets * pricePerPacket,
        paymentType: form.paymentType,
        notes: form.notes,
        month: selectedMonth,
        loggedBy: appUser!.uid,
        loggedByName: appUser!.name,
        date: localDateStr(),
        createdAt: Date.now(),
      })
      setForm({ fromId: '', toPartyId: '', quantity: '', pricePerPacket: '', paymentType: 'cash', notes: '' })
      setErrors({})
      setTab('history')
    } finally {
      setSaving(false)
    }
  }

  const filteredMovements = movements.filter(m => m.month === selectedMonth)

  return (
    <div style={{ minHeight: '100vh', background: '#0d1117', paddingBottom: 40 }}>
      <div style={{ background: '#000000', padding: '24px 20px 16px' }}>
        <button onClick={onBack} style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: 'rgba(255,255,255,0.7)', padding: '6px 14px', borderRadius: 20, fontSize: 12, marginBottom: 16 }}>← Back</button>
        <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11, letterSpacing: 3, textTransform: 'uppercase', marginBottom: 4 }}>Stock Movement</div>
        <div style={{ fontSize: 22, fontWeight: 900, color: '#fff', marginBottom: 16 }}>Log Stock Movement</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {(['log', 'history'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              style={{ background: tab === t ? 'rgba(255,255,255,0.2)' : 'transparent', color: tab === t ? '#fff' : 'rgba(255,255,255,0.5)', border: 'none', borderRadius: 20, padding: '7px 18px', fontSize: 12, fontWeight: 700 }}>
              {t === 'log' ? 'Log Movement' : 'History'}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: '16px 14px' }}>
        {tab === 'log' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            <Field label="From" error={errors.fromId}>
              <CustomSelect value={form.fromId} onChange={v => setForm({ ...form, fromId: v })}
                placeholder="Who is passing stock?" options={fromOptions} error={!!errors.fromId} />
            </Field>

            <Field label="To" error={errors.toPartyId}>
              <CustomSelect value={form.toPartyId} onChange={v => setForm({ ...form, toPartyId: v })}
                placeholder="Who is receiving?" options={toOptions} error={!!errors.toPartyId} />
            </Field>

            <Field label="Quantity" error={errors.quantity}>
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

            <Field label="Selling Price Per Single Packet to Receiver (₹)" hint="Price the receiver pays per single packet" error={errors.pricePerPacket}>
              <input type="number" value={form.pricePerPacket} onChange={e => setForm({ ...form, pricePerPacket: e.target.value })}
                placeholder="e.g. 52"
                style={{ width: '100%', background: 'rgba(255,255,255,0.06)', border: `1.5px solid ${errors.pricePerPacket ? '#dc2626' : 'rgba(255,255,255,0.1)'}`, borderRadius: 12, padding: '13px 16px', fontSize: 14, color: '#fff', outline: 'none', boxSizing: 'border-box' }} />
              {form.quantity && form.pricePerPacket && (
                <div style={{ marginTop: 6, fontSize: 13, color: '#16a34a', fontWeight: 700 }}>Total: ₹{(toPackets(form.quantity) * parseFloat(form.pricePerPacket)).toLocaleString()}</div>
              )}
            </Field>

            <Field label="Payment Type">
              <div style={{ display: 'flex', gap: 8 }}>
                {([['cash', 'Cash'], ['credit', 'Credit']] as [PaymentType, string][]).map(([val, label]) => (
                  <button key={val} onClick={() => setForm({ ...form, paymentType: val })}
                    style={{ flex: 1, background: form.paymentType === val ? (val === 'cash' ? 'rgba(34,197,94,0.12)' : 'rgba(245,158,11,0.12)') : 'rgba(255,255,255,0.04)', color: form.paymentType === val ? (val === 'cash' ? '#22c55e' : '#f59e0b') : '#64748b', border: `1.5px solid ${form.paymentType === val ? (val === 'cash' ? '#22c55e' : '#f59e0b') : 'rgba(255,255,255,0.06)'}`, borderRadius: 12, padding: '12px', fontSize: 14, fontWeight: 800 }}>
                    {label}
                  </button>
                ))}
              </div>
            </Field>

            <Field label="Notes (optional)">
              <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
                placeholder="Any notes..." rows={2}
                style={{ width: '100%', background: 'rgba(255,255,255,0.06)', border: '1.5px solid rgba(255,255,255,0.1)', borderRadius: 12, padding: '13px 16px', fontSize: 14, color: '#fff', outline: 'none', resize: 'none', boxSizing: 'border-box' }} />
            </Field>

            <button onClick={handleLog} disabled={saving}
              style={{ background: saving ? '#475569' : '#fff', color: saving ? '#aaa' : '#000', border: 'none', borderRadius: 14, padding: 16, fontSize: 15, fontWeight: 800 }}>
              {saving ? 'Saving...' : 'Log Movement'}
            </button>
          </div>
        )}

        {tab === 'history' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6, letterSpacing: 1, textTransform: 'uppercase' }}>Month</div>
              <DateInput type="month" value={selectedMonth} onChange={v => setSelectedMonth(v)} />
            </div>
            {filteredMovements.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 40, color: '#475569' }}>
                <div style={{ fontWeight: 700 }}>No movements for this month</div>
              </div>
            ) : filteredMovements.map(m => (
              <div key={m.id} style={{ background: '#161b22', borderRadius: 14, padding: 16, border: '1px solid rgba(255,255,255,0.05)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>{m.fromId === 'us' ? 'Ocealgo' : m.fromName}</div>
                  <div style={{ color: '#64748b', fontSize: 16 }}>→</div>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>{m.toPartyName}</div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11, background: 'rgba(255,255,255,0.06)', color: '#94a3b8', padding: '3px 10px', borderRadius: 99 }}>{toDisplay(m.packets, config.packetsPerCarton)}</span>
                  <span style={{ fontSize: 11, background: 'rgba(34,197,94,0.08)', color: '#22c55e', padding: '3px 10px', borderRadius: 99 }}>₹{m.totalAmount.toLocaleString()}</span>
                  <span style={{ fontSize: 11, background: m.paymentType === 'cash' ? 'rgba(34,197,94,0.08)' : 'rgba(245,158,11,0.1)', color: m.paymentType === 'cash' ? '#22c55e' : '#f59e0b', padding: '3px 10px', borderRadius: 99 }}>
                    {m.paymentType === 'cash' ? 'Cash' : 'Credit'}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: '#475569', marginTop: 8 }}>{m.date} • by {m.loggedByName}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
