import { useState, useEffect } from 'react'
import { collection, addDoc, onSnapshot, doc, updateDoc } from 'firebase/firestore'
import { db } from '../../firebase'
import { Party, MonthlyRequest, RequestStatus } from '../../types'
import DateInput from '../../components/DateInput'
import { useAuth } from '../../context/AuthContext'
import { useTheme } from '../../context/ThemeContext'
import { useStockConfig, toDisplay } from '../../hooks/useFirebase'
import CustomSelect from '../../components/CustomSelect'
import { localMonthStr } from '../../utils/date'
import {
  PageHeader, TabBar, Section, EmptyState, Field, ChipGroup, Note,
  PrimaryButton, inputStyle,
} from '../../components/ui'

interface Props { onBack: () => void; parties: Party[] }

const STATUS_LABEL: Record<RequestStatus, string> = {
  pending: 'Pending', partial: 'Partly filled', fulfilled: 'Fulfilled',
}

export default function MonthlyRequestManager({ onBack, parties }: Props) {
  const { appUser } = useAuth()
  const { t } = useTheme()
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
    sub: `${p.category} · ${p.place || p.address}`,
    group: p.type === 'distributor' ? 'Distributors' : 'Retailers',
  }))

  const validate = () => {
    const e: Record<string, string> = {}
    if (!form.partyId) e.partyId = 'Pick a distributor or retailer.'
    if (!form.quantity || parseInt(form.quantity) <= 0) e.quantity = 'Enter a quantity above zero.'
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

  const monthLabel = new Date(selectedMonth + '-02').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })

  return (
    <div style={{ minHeight: '100vh', background: t.bg, paddingBottom: 40 }}>
      <PageHeader
        eyebrow="Monthly planning"
        title="Stock requests"
        subtitle="What each distributor and retailer expects to need this month."
        onBack={onBack}
        divider={false}
      />
      <TabBar
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'list', label: 'Requests' },
          { id: 'add', label: 'Add or update' },
        ]}
      />

      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 28 }}>
        <Section label="Month">
          <div style={{ maxWidth: 220 }}>
            <DateInput type="month" value={selectedMonth} onChange={v => setSelectedMonth(v)} />
          </div>
        </Section>

        {tab === 'list' && (
          filtered.length === 0 ? (
            <EmptyState
              title={`No requests for ${monthLabel}`}
              body="Add what each distributor and retailer expects to need, so dispatch can be planned against it."
              actionLabel="Add a request"
              onAction={() => setTab('add')}
            />
          ) : (
            <div style={{ borderBottom: `0.5px solid ${t.border}` }}>
              {filtered.map(r => {
                const pct = r.requestedPackets > 0 ? Math.round((r.fulfilledPackets / r.requestedPackets) * 100) : 0
                const remaining = Math.max(0, r.requestedPackets - r.fulfilledPackets)
                return (
                  <div key={r.id} style={{ borderTop: `0.5px solid ${t.border}`, padding: '16px 0' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 15, fontWeight: 500, color: t.text }}>{r.partyName}</div>
                        <div style={{ fontSize: 13, fontWeight: 400, color: t.text3, marginTop: 3 }}>
                          Asked for {toDisplay(r.requestedPackets, config.packetsPerCarton)} ·{' '}
                          {toDisplay(r.fulfilledPackets, config.packetsPerCarton)} sent
                          {remaining > 0 && ` · ${toDisplay(remaining, config.packetsPerCarton)} still to go`}
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 400, color: t.text3, marginTop: 3 }}>
                          Added by {r.requestedByName}
                        </div>
                        {r.notes && (
                          <div style={{ fontSize: 13, fontWeight: 400, color: t.text3, marginTop: 3 }}>{r.notes}</div>
                        )}
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 400,
                                      color: r.status === 'fulfilled' ? t.text2 : t.warn }}>
                          {STATUS_LABEL[r.status]}
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 400, color: t.text3, marginTop: 3 }}>{pct}%</div>
                      </div>
                    </div>
                    <div style={{ background: t.tint, borderRadius: 99, height: 3, overflow: 'hidden', marginTop: 12 }}>
                      <div style={{ height: '100%', background: t.text2, width: `${Math.min(100, pct)}%` }} />
                    </div>
                  </div>
                )
              })}
            </div>
          )
        )}

        {tab === 'add' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 460 }}>
            <Note>
              If a request already exists for this party in {monthLabel}, saving updates it rather than
              adding a second one.
            </Note>

            <Field label="Distributor or retailer" error={errors.partyId}>
              <CustomSelect value={form.partyId} onChange={v => setForm({ ...form, partyId: v })}
                placeholder="Pick who this is for" options={partyOptions} error={!!errors.partyId} />
            </Field>

            <Field label="Quantity needed" error={errors.quantity}>
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

            <Field label="Notes">
              <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
                placeholder="Anything worth recording about this request" rows={3}
                style={{ ...inputStyle(t), resize: 'vertical', lineHeight: 1.5 }} />
            </Field>

            <div style={{ marginTop: 4 }}>
              <PrimaryButton onClick={handleAdd} disabled={saving}>
                {saving ? 'Saving' : 'Save request'}
              </PrimaryButton>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
