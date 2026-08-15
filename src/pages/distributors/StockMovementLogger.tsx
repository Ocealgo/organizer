import { useState, useEffect } from 'react'
import { collection, addDoc } from 'firebase/firestore'
import { onSnapshot } from '../../data/live'
import { db } from '../../firebase'
import { Party, StockMovement, PaymentType } from '../../types'
import DateInput from '../../components/DateInput'
import { useAuth } from '../../context/AuthContext'
import { useTheme } from '../../context/ThemeContext'
import { useStockConfig, toDisplay } from '../../hooks/useFirebase'
import CustomSelect from '../../components/CustomSelect'
import { localDateStr, localMonthStr } from '../../utils/date'
import {
  PageHeader, TabBar, Section, EmptyState, Field, ChipGroup,
  PrimaryButton, inputStyle,
} from '../../components/ui'

interface Props { onBack: () => void; parties: Party[] }

const US_OPTION = { value: 'us', label: 'Ocealgo', sub: 'Direct from our own stock', group: 'Direct' }

export default function StockMovementLogger({ onBack, parties }: Props) {
  const { appUser } = useAuth()
  const { t } = useTheme()
  const { config } = useStockConfig()
  const [movements, setMovements] = useState<StockMovement[]>([])
  const [tab, setTab] = useState<'log' | 'history'>('log')
  const [saving, setSaving] = useState(false)
  const [unit, setUnit] = useState<'packets' | 'cartons'>('packets')
  const [selectedMonth, setSelectedMonth] = useState(localMonthStr())
  const [form, setForm] = useState({ fromId: '', toPartyId: '', quantity: '', pricePerPacket: '', paymentType: 'credit' as PaymentType, notes: '' })
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
      value: p.id!, label: p.name, sub: `${p.category} · ${p.place || p.address}`, group: 'Distributors'
    }))
  ]

  // TO options: all parties
  const toOptions = parties.map(p => ({
    value: p.id!, label: p.name,
    sub: `${p.category} · ${p.place || p.address}`,
    group: p.type === 'distributor' ? 'Distributors' : 'Retailers',
  }))

  const validate = () => {
    const e: Record<string, string> = {}
    if (!form.fromId) e.fromId = 'Pick who is passing the stock on.'
    if (!form.toPartyId) e.toPartyId = 'Pick who is receiving it.'
    if (form.fromId !== 'us' && form.fromId === form.toPartyId) e.toPartyId = 'Stock cannot move to the same party.'
    if (!form.quantity || parseInt(form.quantity) <= 0) e.quantity = 'Enter a quantity above zero.'
    if (!form.pricePerPacket || parseFloat(form.pricePerPacket) <= 0) e.pricePerPacket = 'Enter a price above zero.'
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
  const money = (n: number) => `₹${n.toLocaleString('en-IN')}`

  return (
    <div style={{ minHeight: '100vh', background: t.bg, paddingBottom: 40 }}>
      <PageHeader
        eyebrow="Stock movement"
        title="Log a movement"
        subtitle="Record stock passing from us or a distributor to someone else."
        onBack={onBack}
        divider={false}
      />
      <TabBar
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'log', label: 'Log' },
          { id: 'history', label: 'History' },
        ]}
      />

      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 28 }}>
        {tab === 'log' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 460 }}>
            <Field label="From" error={errors.fromId}>
              <CustomSelect value={form.fromId} onChange={v => setForm({ ...form, fromId: v })}
                placeholder="Who is passing the stock on" options={fromOptions} error={!!errors.fromId} />
            </Field>

            <Field label="To" error={errors.toPartyId}>
              <CustomSelect value={form.toPartyId} onChange={v => setForm({ ...form, toPartyId: v })}
                placeholder="Who is receiving it" options={toOptions} error={!!errors.toPartyId} />
            </Field>

            <Field label="Quantity" error={errors.quantity}>
              <div style={{ marginBottom: 10 }}>
                <ChipGroup
                  value={unit}
                  onChange={setUnit}
                  options={[
                    { id: 'packets' as const, label: 'Packets' },
                    { id: 'cartons' as const, label: `Cartons of ${config.packetsPerCarton}` },
                  ]}
                />
              </div>
              <input type="number" inputMode="numeric" value={form.quantity}
                onChange={e => setForm({ ...form, quantity: e.target.value })}
                placeholder={unit === 'cartons' ? 'Number of cartons' : 'Number of packets'}
                style={inputStyle(t)} />
              {form.quantity && parseInt(form.quantity) > 0 && (
                <div style={{ marginTop: 7, fontSize: 13, fontWeight: 400, color: t.text3 }}>
                  That is {toDisplay(toPackets(form.quantity), config.packetsPerCarton)}.
                </div>
              )}
            </Field>

            <Field label="Price per packet" hint="What the receiver pays for one packet."
              error={errors.pricePerPacket}>
              <input type="number" inputMode="decimal" value={form.pricePerPacket}
                onChange={e => setForm({ ...form, pricePerPacket: e.target.value })}
                placeholder="52" style={inputStyle(t)} />
              {form.quantity && form.pricePerPacket && (
                <div style={{ marginTop: 7, fontSize: 13, fontWeight: 400, color: t.text3 }}>
                  Comes to {money(toPackets(form.quantity) * parseFloat(form.pricePerPacket))}.
                </div>
              )}
            </Field>

            <Field label="Payment">
              <ChipGroup
                value={form.paymentType}
                onChange={v => setForm({ ...form, paymentType: v })}
                options={[
                  { id: 'cash' as PaymentType, label: 'Cash' },
                  { id: 'credit' as PaymentType, label: 'Credit' },
                ]}
              />
            </Field>

            <Field label="Notes">
              <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
                placeholder="Anything worth recording" rows={3}
                style={{ ...inputStyle(t), resize: 'vertical', lineHeight: 1.5 }} />
            </Field>

            <div style={{ marginTop: 4 }}>
              <PrimaryButton onClick={handleLog} disabled={saving}>
                {saving ? 'Saving' : 'Log this movement'}
              </PrimaryButton>
            </div>
          </div>
        )}

        {tab === 'history' && (
          <>
            <Section label="Month">
              <div style={{ maxWidth: 220 }}>
                <DateInput type="month" value={selectedMonth} onChange={v => setSelectedMonth(v)} />
              </div>
            </Section>

            {filteredMovements.length === 0 ? (
              <EmptyState title="No movements this month"
                body="Pick another month, or log a movement to start the record." />
            ) : (
              <div style={{ borderBottom: `0.5px solid ${t.border}` }}>
                {filteredMovements.map(m => (
                  <div key={m.id} style={{ borderTop: `0.5px solid ${t.border}`, padding: '16px 0' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 15, fontWeight: 500, color: t.text }}>
                          {m.fromId === 'us' ? 'Ocealgo' : m.fromName} to {m.toPartyName}
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 400, color: t.text3, marginTop: 3 }}>
                          {toDisplay(m.packets, config.packetsPerCarton)} · {m.date} · by {m.loggedByName}
                        </div>
                        {m.notes && (
                          <div style={{ fontSize: 13, fontWeight: 400, color: t.text3, marginTop: 3 }}>{m.notes}</div>
                        )}
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div style={{ fontSize: 15, fontWeight: 500, color: t.text }}>{money(m.totalAmount)}</div>
                        <div style={{ fontSize: 13, fontWeight: 400, marginTop: 3,
                                      color: m.paymentType === 'cash' ? t.text3 : t.warn }}>
                          {m.paymentType === 'cash' ? 'Cash' : 'Credit'}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
