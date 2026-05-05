import React, { useState, useEffect } from 'react'
import { collection, addDoc, onSnapshot, updateDoc, doc, getDoc } from 'firebase/firestore'
import { db } from '../../firebase'
import { UnifiedAllocation, Party, PaymentType, AllocationStatus } from '../../types'
import { useAuth } from '../../context/AuthContext'
import { useStockConfig, updateStockConfig, toDisplay } from '../../hooks/useFirebase'
import CustomSelect from '../../components/CustomSelect'
import DateInput from '../../components/DateInput'

interface Props { onBack: () => void; parties: Party[]; isAdmin?: boolean }

const STATUS_STYLE: Record<AllocationStatus, { color: string; bg: string; emoji: string; label: string }> = {
  pending:  { color: '#d97706', bg: 'rgba(217,119,6,0.12)',   emoji: '🟡', label: 'Pending' },
  sent:     { color: '#0891b2', bg: 'rgba(8,145,178,0.12)',   emoji: '🔵', label: 'Sent' },
  paid:     { color: '#16a34a', bg: 'rgba(22,163,74,0.12)',   emoji: '✅', label: 'Paid' },
  overdue:  { color: '#dc2626', bg: 'rgba(220,38,38,0.12)',   emoji: '🔴', label: 'Overdue' },
}

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

function inputStyle(hasError?: boolean): React.CSSProperties {
  return {
    width: '100%', background: 'rgba(255,255,255,0.06)',
    border: `1.5px solid ${hasError ? '#dc2626' : 'rgba(255,255,255,0.1)'}`,
    borderRadius: 12, padding: '13px 16px', fontSize: 16,
    color: '#fff', outline: 'none', boxSizing: 'border-box',
  }
}

export default function AllocationManager({ onBack, parties, isAdmin }: Props) {
  const { appUser } = useAuth()
  const { config } = useStockConfig()
  const [allocations, setAllocations] = useState<UnifiedAllocation[]>([])
  const [stockMovements, setStockMovements] = useState<any[]>([])
  const [tab, setTab] = useState<'list' | 'add' | 'network'>('list')
  const [saving, setSaving] = useState(false)
  const [acting, setActing] = useState<string | null>(null)
  const [defaultPrice, setDefaultPriceState] = useState(0)
  const [unit, setUnit] = useState<'packets' | 'cartons'>('packets')
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Filters
  const [filterStatus, setFilterStatus] = useState<'all' | AllocationStatus>('all')
  const [filterPayment, setFilterPayment] = useState<'all' | PaymentType>('all')
  const [filterParty, setFilterParty] = useState<string>('all')

  const [form, setForm] = useState({
    partyId: '', packets: '', pricePerPacket: '',
    paymentType: 'cash' as PaymentType,
    plannedDate: new Date(Date.now() + 86400000).toISOString().split('T')[0], // tomorrow
    notes: '',
  })

  const today = new Date().toISOString().split('T')[0]
  const available = config.total - config.locked

  useEffect(() => {
    return onSnapshot(collection(db, 'allocations_v2'), snap => {
      const raw = snap.docs.map(d => ({ id: d.id, ...d.data() } as UnifiedAllocation))
      // Compute overdue status client-side
      const now = today
      const processed = raw.map(a => ({
        ...a,
        status: a.status === 'pending' && a.plannedDate < now ? 'overdue' : a.status,
      } as UnifiedAllocation))
      setAllocations(processed.sort((a, b) => a.plannedDate.localeCompare(b.plannedDate)))
    })
  }, [today])

  useEffect(() => {
    return onSnapshot(collection(db, 'stock_movements'), snap => {
      setStockMovements(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a: any, b: any) => b.createdAt - a.createdAt))
    })
  }, [])

  // Load default price
  useEffect(() => {
    getDoc(doc(db, 'config', 'stock')).then(snap => {
      if (snap.exists()) setDefaultPriceState(snap.data().defaultPricePerPacket || 0)
    })
  }, [])

  // When party selected — auto-fill price from party or default
  useEffect(() => {
    if (!form.partyId) return
    const party = parties.find(p => p.id === form.partyId)
    const price = party?.pricePerPacket || defaultPrice
    if (price) setForm(f => ({ ...f, pricePerPacket: String(price) }))
  }, [form.partyId, parties, defaultPrice])

  const toPackets = (qty: string) => {
    const n = parseInt(qty) || 0
    return unit === 'cartons' ? n * config.packetsPerCarton : n
  }

  const validate = () => {
    const e: Record<string, string> = {}
    if (!form.partyId) e.partyId = 'Select a distributor or retailer'
    if (!form.packets || parseInt(form.packets) <= 0) e.packets = 'Enter quantity'
    if (!form.pricePerPacket || parseFloat(form.pricePerPacket) <= 0) e.pricePerPacket = 'Enter price per packet'
    if (!form.plannedDate) e.plannedDate = 'Select planned send date'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const handleCreate = async () => {
    if (!validate()) return
    setSaving(true)
    try {
      const packets = toPackets(form.packets)
      const cartons = unit === 'cartons' ? parseInt(form.packets) : Math.floor(packets / config.packetsPerCarton)
      const party = parties.find(p => p.id === form.partyId)!
      const price = parseFloat(form.pricePerPacket)
      await addDoc(collection(db, 'allocations_v2'), {
        partyId: form.partyId,
        partyName: party.name,
        partyType: party.type,
        packets, cartons,
        pricePerPacket: price,
        totalAmount: packets * price,
        paymentType: form.paymentType,
        plannedDate: form.plannedDate,
        status: 'pending' as AllocationStatus,
        notes: form.notes,
        createdBy: appUser!.uid,
        createdByName: appUser!.name,
        createdAt: Date.now(),
        month: form.plannedDate.slice(0, 7),
      })
      setForm({ partyId: '', packets: '', pricePerPacket: String(defaultPrice || ''), paymentType: 'cash', plannedDate: new Date(Date.now() + 86400000).toISOString().split('T')[0], notes: '' })
      setErrors({})
      setTab('list')
    } finally { setSaving(false) }
  }

  // Admin dispatches — deducts stock
  const handleDispatch = async (a: UnifiedAllocation) => {
    if (!isAdmin) return
    if (a.packets > available) { alert(`Only ${toDisplay(available, config.packetsPerCarton)} available!`); return }
    if (!confirm(`Dispatch ${toDisplay(a.packets, config.packetsPerCarton)} to ${a.partyName}?`)) return
    setActing(a.id!)
    try {
      await updateDoc(doc(db, 'allocations_v2', a.id!), {
        status: 'sent' as AllocationStatus,
        sentAt: Date.now(),
        sentBy: appUser!.uid,
        sentByName: appUser!.name,
      })
      await updateStockConfig({ locked: config.locked + a.packets })
      // Auto log to stock history
      await addDoc(collection(db, 'dispatches'), {
        partyId: a.partyId, partyName: a.partyName, partyType: a.partyType,
        packets: a.packets, cartons: a.cartons,
        pricePerPacket: a.pricePerPacket, totalAmount: a.totalAmount,
        paymentType: a.paymentType, notes: a.notes || '',
        month: a.month, allocationId: a.id,
        dispatchedBy: appUser!.uid, dispatchedByName: appUser!.name,
        dispatchedAt: Date.now(),
        date: today, createdAt: Date.now(),
      })
      // Credit entry if needed
      if (a.paymentType === 'credit') {
        await addDoc(collection(db, 'credits'), {
          partyId: a.partyId, partyName: a.partyName, partyType: a.partyType,
          deliveryId: a.id, packets: a.packets, amount: a.totalAmount,
          status: 'outstanding', createdAt: Date.now(),
        })
      }
    } finally { setActing(null) }
  }

  // Admin marks credit paid
  const handleMarkPaid = async (a: UnifiedAllocation) => {
    if (!isAdmin) return
    if (!confirm(`Mark ₹${a.totalAmount.toLocaleString()} as paid for ${a.partyName}?`)) return
    setActing(a.id!)
    try {
      await updateDoc(doc(db, 'allocations_v2', a.id!), { status: 'paid' as AllocationStatus, paidAt: Date.now() })
      // Update stock — remove locked (now actually dispatched)
      await updateStockConfig({ total: config.total - a.packets, locked: Math.max(0, config.locked - a.packets) })
    } finally { setActing(null) }
  }

  // Filter allocations
  const filtered = allocations.filter(a => {
    if (filterStatus !== 'all' && a.status !== filterStatus) return false
    if (filterPayment !== 'all' && a.paymentType !== filterPayment) return false
    if (filterParty !== 'all' && a.partyId !== filterParty) return false
    return true
  })

  // Summary counts
  const counts = {
    all: allocations.length,
    pending: allocations.filter(a => a.status === 'pending').length,
    overdue: allocations.filter(a => a.status === 'overdue').length,
    sent: allocations.filter(a => a.status === 'sent').length,
    paid: allocations.filter(a => a.status === 'paid').length,
  }
  const totalCredit = allocations.filter(a => a.status === 'sent' && a.paymentType === 'credit').reduce((s, a) => s + a.totalAmount, 0)

  const partyOptions = parties
    .filter(p => !(p.type === 'retailer' && (p as any).underDistributorId))
    .map(p => ({
      value: p.id!, label: `${p.type === 'distributor' ? '🚚' : '🏪'} ${p.name}`,
      sub: `${p.category} • ${p.place || p.address}`,
      group: p.type === 'distributor' ? 'Distributors' : 'Independent Retailers',
    }))

  const blockedRetailersCount = parties.filter(p => p.type === 'retailer' && (p as any).underDistributorId).length

  const selectedParty = parties.find(p => p.id === form.partyId)

  return (
    <div style={{ minHeight: '100vh', background: '#0d1117', paddingBottom: 40 }}>
      {/* Header */}
      <div style={{ background: 'linear-gradient(135deg,#1a5c42,#16a34a)', padding: '20px 20px 0' }}>
        <button onClick={onBack} style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: '#bbf7d0', padding: '6px 14px', borderRadius: 20, fontSize: 12, marginBottom: 14 }}>← Back</button>
        <div style={{ color: '#bbf7d0', fontSize: 11, letterSpacing: 3, textTransform: 'uppercase', marginBottom: 2 }}>Allocations 📦</div>
        <div style={{ fontSize: 20, fontWeight: 900, marginBottom: 12 }}>Stock Allocations</div>

        {/* Summary pills */}
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', marginBottom: 14, paddingBottom: 2 }}>
          {counts.overdue > 0 && (
            <div style={{ background: 'rgba(220,38,38,0.25)', borderRadius: 20, padding: '5px 12px', fontSize: 11, fontWeight: 800, color: '#fca5a5', whiteSpace: 'nowrap' }}>🔴 {counts.overdue} Overdue</div>
          )}
          <div style={{ background: 'rgba(217,119,6,0.2)', borderRadius: 20, padding: '5px 12px', fontSize: 11, fontWeight: 700, color: '#fde68a', whiteSpace: 'nowrap' }}>🟡 {counts.pending} Pending</div>
          <div style={{ background: 'rgba(8,145,178,0.2)', borderRadius: 20, padding: '5px 12px', fontSize: 11, fontWeight: 700, color: '#bae6fd', whiteSpace: 'nowrap' }}>🔵 {counts.sent} Sent</div>
          <div style={{ background: 'rgba(22,163,74,0.2)', borderRadius: 20, padding: '5px 12px', fontSize: 11, fontWeight: 700, color: '#86efac', whiteSpace: 'nowrap' }}>✅ {counts.paid} Paid</div>
          {totalCredit > 0 && <div style={{ background: 'rgba(124,58,237,0.2)', borderRadius: 20, padding: '5px 12px', fontSize: 11, fontWeight: 700, color: '#ddd6fe', whiteSpace: 'nowrap' }}>💜 ₹{totalCredit.toLocaleString()} credit due</div>}
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          {([
            { id: 'list',    label: '📋 List' },
            { id: 'add',     label: '➕ New' },
            { id: 'network', label: '🌐 Network' },
          ] as const).map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{ background: tab === t.id ? 'rgba(255,255,255,0.2)' : 'transparent', color: tab === t.id ? '#fff' : 'rgba(255,255,255,0.5)', border: 'none', borderRadius: '12px 12px 0 0', padding: '9px 18px', fontSize: 12, fontWeight: 700 }}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: '14px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>

        {/* ── LIST TAB ──────────────────────────────────────────────────── */}
        {tab === 'list' && (
          <>
            {/* Filters */}
            <div style={{ background: '#161b22', borderRadius: 14, padding: 14, border: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {/* Status filter */}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {(['all', 'overdue', 'pending', 'sent', 'paid'] as const).map(s => (
                  <button key={s} onClick={() => setFilterStatus(s)}
                    style={{ background: filterStatus === s ? (s === 'all' ? '#1a5c42' : STATUS_STYLE[s as AllocationStatus]?.bg || '#1a5c42') : 'rgba(255,255,255,0.04)', color: filterStatus === s ? (s === 'all' ? '#6ee7b7' : STATUS_STYLE[s as AllocationStatus]?.color || '#6ee7b7') : '#64748b', border: `1px solid ${filterStatus === s ? (s === 'all' ? '#16a34a' : STATUS_STYLE[s as AllocationStatus]?.color || '#16a34a') : 'rgba(255,255,255,0.06)'}`, borderRadius: 20, padding: '5px 12px', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap', textTransform: 'capitalize' }}>
                    {s === 'all' ? `All (${counts.all})` : `${STATUS_STYLE[s]?.emoji} ${s}`}
                  </button>
                ))}
              </div>

              {/* Payment filter */}
              <div style={{ display: 'flex', gap: 6 }}>
                {(['all', 'cash', 'credit'] as const).map(p => (
                  <button key={p} onClick={() => setFilterPayment(p)}
                    style={{ background: filterPayment === p ? 'rgba(124,58,237,0.15)' : 'rgba(255,255,255,0.04)', color: filterPayment === p ? '#a78bfa' : '#64748b', border: `1px solid ${filterPayment === p ? '#7c3aed' : 'rgba(255,255,255,0.06)'}`, borderRadius: 20, padding: '5px 12px', fontSize: 11, fontWeight: 700 }}>
                    {p === 'all' ? 'All payments' : p === 'cash' ? '💵 Cash' : '📋 Credit'}
                  </button>
                ))}
              </div>

              {/* Party filter */}
              <CustomSelect
                value={filterParty}
                onChange={setFilterParty}
                placeholder="All parties"
                options={[{ value: 'all', label: 'All parties' }, ...partyOptions]} />
            </div>

            {/* Results count */}
            <div style={{ fontSize: 12, color: '#64748b' }}>{filtered.length} allocation{filtered.length !== 1 ? 's' : ''}</div>

            {/* Cards */}
            {filtered.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 40, color: '#475569' }}>
                <div style={{ fontSize: 36, marginBottom: 10 }}>📦</div>
                <div style={{ fontWeight: 700 }}>No allocations found</div>
                <div style={{ fontSize: 13, marginTop: 6 }}>Tap "New Allocation" to create one</div>
              </div>
            ) : filtered.map(a => {
              const ss = STATUS_STYLE[a.status]
              const isOverdue = a.status === 'overdue'
              const isSentCredit = a.status === 'sent' && a.paymentType === 'credit'
              const daysUntil = Math.ceil((new Date(a.plannedDate).getTime() - Date.now()) / 86400000)

              return (
                <div key={a.id} style={{ background: '#161b22', borderRadius: 16, padding: 16, border: `1.5px solid ${isOverdue ? '#dc262644' : ss.color + '33'}` }}>
                  {/* Top row */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 12 }}>
                    <div style={{ fontSize: 20, flexShrink: 0 }}>{a.partyType === 'distributor' ? '🚚' : '🏪'}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 800, fontSize: 15 }}>{a.partyName}</div>
                      <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>by {a.createdByName}</div>
                    </div>
                    <span style={{ background: ss.bg, color: ss.color, fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 99, whiteSpace: 'nowrap' }}>
                      {ss.emoji} {ss.label}
                    </span>
                  </div>

                  {/* Details */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 10 }}>
                    <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 10, padding: '8px', textAlign: 'center' }}>
                      <div style={{ fontSize: 13, fontWeight: 800, color: '#e2e8f0' }}>{toDisplay(a.packets, config.packetsPerCarton)}</div>
                      <div style={{ fontSize: 9, color: '#64748b', marginTop: 2 }}>quantity</div>
                    </div>
                    <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 10, padding: '8px', textAlign: 'center' }}>
                      <div style={{ fontSize: 13, fontWeight: 800, color: '#16a34a' }}>₹{a.totalAmount.toLocaleString()}</div>
                      <div style={{ fontSize: 9, color: '#64748b', marginTop: 2 }}>{a.paymentType === 'cash' ? '💵 cash' : '📋 credit'}</div>
                    </div>
                    <div style={{ background: isOverdue ? 'rgba(220,38,38,0.1)' : 'rgba(255,255,255,0.04)', borderRadius: 10, padding: '8px', textAlign: 'center', border: isOverdue ? '1px solid rgba(220,38,38,0.2)' : 'none' }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: isOverdue ? '#dc2626' : a.status === 'pending' ? '#d97706' : '#64748b' }}>
                        {a.status === 'pending' || a.status === 'overdue'
                          ? isOverdue ? 'Overdue!' : daysUntil === 0 ? 'Today' : daysUntil === 1 ? 'Tomorrow' : `${daysUntil}d`
                          : a.sentAt ? new Date(a.sentAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—'}
                      </div>
                      <div style={{ fontSize: 9, color: '#64748b', marginTop: 2 }}>
                        {a.status === 'pending' || a.status === 'overdue' ? `planned ${a.plannedDate}` : 'sent'}
                      </div>
                    </div>
                  </div>

                  {a.notes && <div style={{ fontSize: 11, color: '#475569', marginBottom: 10 }}>📝 {a.notes}</div>}

                  {/* Action buttons — admin only */}
                  {isAdmin && (
                    <div style={{ display: 'flex', gap: 8 }}>
                      {(a.status === 'pending' || a.status === 'overdue') && (
                        <button onClick={() => handleDispatch(a)} disabled={acting === a.id}
                          style={{ flex: 1, background: 'linear-gradient(135deg,#1a5c42,#16a34a)', color: '#fff', border: 'none', borderRadius: 10, padding: '10px', fontSize: 12, fontWeight: 800, opacity: acting === a.id ? 0.5 : 1 }}>
                          {acting === a.id ? 'Processing...' : '📦 Dispatch Now'}
                        </button>
                      )}
                      {isSentCredit && (
                        <button onClick={() => handleMarkPaid(a)} disabled={acting === a.id}
                          style={{ flex: 1, background: 'rgba(22,163,74,0.15)', color: '#16a34a', border: '1.5px solid rgba(22,163,74,0.3)', borderRadius: 10, padding: '10px', fontSize: 12, fontWeight: 800, opacity: acting === a.id ? 0.5 : 1 }}>
                          {acting === a.id ? '...' : '✅ Mark Paid'}
                        </button>
                      )}
                      {a.status === 'sent' && a.paymentType === 'cash' && (
                        <div style={{ flex: 1, background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.15)', borderRadius: 10, padding: '10px', fontSize: 12, color: '#16a34a', textAlign: 'center', fontWeight: 700 }}>
                          ✅ Cash received
                        </div>
                      )}
                      {a.status === 'paid' && (
                        <div style={{ flex: 1, background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.15)', borderRadius: 10, padding: '10px', fontSize: 12, color: '#16a34a', textAlign: 'center', fontWeight: 700 }}>
                          ✅ Fully paid {a.paidAt ? new Date(a.paidAt).toLocaleDateString('en-IN') : ''}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Sales view — read only actions */}
                  {!isAdmin && (a.status === 'pending' || a.status === 'overdue') && (
                    <div style={{ background: 'rgba(217,119,6,0.08)', border: '1px solid rgba(217,119,6,0.15)', borderRadius: 10, padding: '8px 12px', fontSize: 11, color: '#d97706' }}>
                      ⏳ Waiting for admin to dispatch
                    </div>
                  )}
                </div>
              )
            })}
          </>
        )}

        {/* ── ADD TAB ────────────────────────────────────────────────────── */}
        {tab === 'add' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.12)', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: '#6ee7b7' }}>
              💡 Create a plan to send stock. Admin will dispatch it on or before the planned date.
            </div>
            {blockedRetailersCount > 0 && (
              <div style={{ background: 'rgba(217,119,6,0.08)', border: '1px solid rgba(217,119,6,0.2)', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: '#d97706' }}>
                ⚠️ {blockedRetailersCount} retailer{blockedRetailersCount > 1 ? 's' : ''} under distributors are hidden — allocate via their parent distributor.
              </div>
            )}

            <Field label="Distributor / Retailer" error={errors.partyId}>
              <CustomSelect value={form.partyId} onChange={v => setForm({ ...form, partyId: v })}
                placeholder="Select..." options={partyOptions} error={!!errors.partyId} />
            </Field>

            {selectedParty && (
              <div style={{ background: 'rgba(8,145,178,0.08)', border: '1px solid rgba(8,145,178,0.15)', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: '#7dd3fc' }}>
                📍 {selectedParty.address} • 📞 {selectedParty.phone}
              </div>
            )}

            {/* Quantity */}
            <Field label="Quantity" error={errors.packets}>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                {(['packets', 'cartons'] as const).map(u => (
                  <button key={u} onClick={() => setUnit(u)}
                    style={{ flex: 1, background: unit === u ? 'rgba(22,163,74,0.15)' : 'rgba(255,255,255,0.04)', color: unit === u ? '#16a34a' : '#64748b', border: `1.5px solid ${unit === u ? '#16a34a' : 'rgba(255,255,255,0.06)'}`, borderRadius: 10, padding: '9px', fontSize: 12, fontWeight: 700 }}>
                    {u === 'packets' ? '📦 Packets' : `📫 Cartons (1=${config.packetsPerCarton})`}
                  </button>
                ))}
              </div>
              <input type="number" value={form.packets} onChange={e => setForm({ ...form, packets: e.target.value })}
                placeholder={unit === 'cartons' ? 'No. of cartons' : 'No. of packets'}
                style={inputStyle(!!errors.packets)} />
              {form.packets && parseInt(form.packets) > 0 && (
                <div style={{ marginTop: 6, fontSize: 12, color: '#6ee7b7', fontWeight: 600 }}>
                  = {toDisplay(toPackets(form.packets), config.packetsPerCarton)}
                  {form.pricePerPacket && ` • ₹${(toPackets(form.packets) * parseFloat(form.pricePerPacket)).toLocaleString()}`}
                </div>
              )}
            </Field>

            <Field label="Selling Price Per Single Packet (₹)" hint="Price charged per single packet — auto-filled from party or default price" error={errors.pricePerPacket}>
              <input type="number" value={form.pricePerPacket} onChange={e => setForm({ ...form, pricePerPacket: e.target.value })}
                placeholder={defaultPrice ? `Default: ₹${defaultPrice}` : 'e.g. 45'}
                style={inputStyle(!!errors.pricePerPacket)} />
            </Field>

            <Field label="Payment Type">
              <div style={{ display: 'flex', gap: 8 }}>
                {([['cash', '💵 Cash'], ['credit', '📋 Credit']] as [PaymentType, string][]).map(([val, label]) => (
                  <button key={val} onClick={() => setForm({ ...form, paymentType: val })}
                    style={{ flex: 1, background: form.paymentType === val ? (val === 'cash' ? 'rgba(22,163,74,0.15)' : 'rgba(217,119,6,0.15)') : 'rgba(255,255,255,0.04)', color: form.paymentType === val ? (val === 'cash' ? '#16a34a' : '#d97706') : '#64748b', border: `1.5px solid ${form.paymentType === val ? (val === 'cash' ? '#16a34a' : '#d97706') : 'rgba(255,255,255,0.06)'}`, borderRadius: 12, padding: '12px', fontSize: 14, fontWeight: 800 }}>
                    {label}
                  </button>
                ))}
              </div>
            </Field>

            <Field label="Planned Send Date" hint="The date you plan to physically send this stock" error={errors.plannedDate}>
              <DateInput type="date" value={form.plannedDate} onChange={v => setForm({ ...form, plannedDate: v })} />
            </Field>

            <Field label="Notes (optional)">
              <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
                placeholder="Any notes about this allocation..."
                rows={2}
                style={{ width: '100%', background: 'rgba(255,255,255,0.06)', border: '1.5px solid rgba(255,255,255,0.1)', borderRadius: 12, padding: '13px 16px', fontSize: 16, color: '#fff', outline: 'none', resize: 'none', boxSizing: 'border-box' }} />
            </Field>

            <button onClick={handleCreate} disabled={saving}
              style={{ background: saving ? '#475569' : 'linear-gradient(135deg,#1a5c42,#16a34a)', color: '#fff', border: 'none', borderRadius: 14, padding: 16, fontSize: 15, fontWeight: 800 }}>
              {saving ? 'Creating...' : 'Create Allocation 📦'}
            </button>
          </div>
        )}

        {/* ── NETWORK TAB ──────────────────────────────────────────────── */}
        {tab === 'network' && (() => {
          const distributors = parties.filter(p => p.type === 'distributor')
          const independents = parties.filter(p => p.type === 'retailer' && !(p as any).underDistributorId)

          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ fontSize: 11, color: '#64748b' }}>
                {distributors.length} distributor{distributors.length !== 1 ? 's' : ''} •{' '}
                {parties.filter(p => p.type === 'retailer').length} retailer{parties.filter(p => p.type === 'retailer').length !== 1 ? 's' : ''} total
              </div>

              {distributors.length === 0 && (
                <div style={{ textAlign: 'center', padding: 32, color: '#475569' }}>
                  <div style={{ fontSize: 32, marginBottom: 10 }}>🚚</div>
                  <div style={{ fontWeight: 700 }}>No distributors yet</div>
                </div>
              )}

              {distributors.map(dist => {
                const distAllocs = allocations.filter(a => a.partyId === dist.id)
                const sentPackets = distAllocs.filter(a => a.status === 'sent' || a.status === 'paid').reduce((s, a) => s + a.packets, 0)
                const pendingPackets = distAllocs.filter(a => a.status === 'pending' || a.status === 'overdue').reduce((s, a) => s + a.packets, 0)
                const creditDue = distAllocs.filter(a => a.status === 'sent' && a.paymentType === 'credit').reduce((s, a) => s + a.totalAmount, 0)
                const subRetailers = parties.filter(p => p.type === 'retailer' && (p as any).underDistributorId === dist.id)

                return (
                  <div key={dist.id} style={{ background: '#161b22', borderRadius: 16, border: '1.5px solid rgba(8,145,178,0.2)', overflow: 'hidden' }}>
                    {/* Distributor header */}
                    <div style={{ background: 'rgba(8,145,178,0.08)', padding: '14px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                        <span style={{ fontSize: 24 }}>🚚</span>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 800, fontSize: 15 }}>{dist.name}</div>
                          <div style={{ fontSize: 11, color: '#64748b', marginTop: 1 }}>{dist.place || dist.address} • 📞 {dist.phone}</div>
                        </div>
                        <span style={{ fontSize: 11, color: (dist as any).status === 'active' ? '#16a34a' : '#d97706', background: (dist as any).status === 'active' ? 'rgba(22,163,74,0.1)' : 'rgba(217,119,6,0.1)', padding: '3px 9px', borderRadius: 99, fontWeight: 700 }}>
                          {(dist as any).status === 'active' ? '🟢 Active' : '🟡 Prospect'}
                        </span>
                      </div>
                      {/* Allocation stats */}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginTop: 10 }}>
                        {[
                          { label: 'Sent', val: toDisplay(sentPackets, config.packetsPerCarton), color: '#0891b2' },
                          { label: 'Pending', val: toDisplay(pendingPackets, config.packetsPerCarton), color: '#d97706' },
                          { label: 'Credit Due', val: creditDue > 0 ? `₹${(creditDue / 1000).toFixed(0)}k` : '—', color: '#7c3aed' },
                        ].map(s => (
                          <div key={s.label} style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 8, padding: '7px', textAlign: 'center' }}>
                            <div style={{ fontSize: 12, fontWeight: 900, color: s.color }}>{s.val}</div>
                            <div style={{ fontSize: 9, color: '#64748b', marginTop: 1 }}>{s.label}</div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Retailers under this distributor */}
                    <div style={{ padding: '10px 16px 14px' }}>
                      <div style={{ fontSize: 10, color: '#64748b', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>
                        Retailers ({subRetailers.length})
                      </div>
                      {subRetailers.length === 0 ? (
                        <div style={{ fontSize: 12, color: '#334155', fontStyle: 'italic' }}>No retailers linked yet</div>
                      ) : subRetailers.map((r, i) => {
                        const rMovements = stockMovements.filter((m: any) => m.fromId === dist.id && m.toPartyId === r.id)
                        const rTotalPackets = rMovements.reduce((s: number, m: any) => s + (m.packets || 0), 0)
                        const rCreditDue = rMovements.filter((m: any) => m.paymentType === 'credit').reduce((s: number, m: any) => s + (m.totalAmount || 0), 0)
                        return (
                        <div key={r.id} style={{ paddingTop: i > 0 ? 10 : 0, marginTop: i > 0 ? 10 : 0, borderTop: i > 0 ? '1px solid rgba(255,255,255,0.04)' : 'none' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span style={{ fontSize: 16 }}>🏪</span>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: 13, fontWeight: 700 }}>{r.name}</div>
                              <div style={{ fontSize: 11, color: '#64748b' }}>{r.place || r.address}</div>
                            </div>
                            <div style={{ textAlign: 'right' }}>
                              <div style={{ fontSize: 10, color: (r as any).status === 'active' ? '#16a34a' : '#d97706', fontWeight: 700 }}>
                                {(r as any).status === 'active' ? '🟢' : '🟡'}
                              </div>
                              {rTotalPackets > 0 && <div style={{ fontSize: 10, color: '#0891b2', marginTop: 1 }}>{rTotalPackets} pkts sent</div>}
                              {rCreditDue > 0 && <div style={{ fontSize: 10, color: '#7c3aed' }}>₹{rCreditDue.toLocaleString()} due</div>}
                            </div>
                          </div>
                          {/* Recent distribution logs */}
                          {rMovements.slice(0, 3).map((m: any) => (
                            <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', background: 'rgba(255,255,255,0.03)', borderRadius: 6, padding: '5px 8px', marginTop: 5, fontSize: 11 }}>
                              <span style={{ color: '#64748b' }}>{m.date} — {m.packets} pkts</span>
                              <span style={{ color: m.paymentType === 'cash' ? '#16a34a' : '#d97706', fontWeight: 700 }}>
                                {m.paymentType === 'cash' ? '💵' : '📋'} ₹{(m.totalAmount || 0).toLocaleString()}
                              </span>
                            </div>
                          ))}
                        </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}

              {/* Independent retailers */}
              {independents.length > 0 && (
                <div style={{ background: '#161b22', borderRadius: 16, border: '1.5px solid rgba(22,163,74,0.15)', overflow: 'hidden' }}>
                  <div style={{ background: 'rgba(22,163,74,0.06)', padding: '12px 16px', fontSize: 12, color: '#6ee7b7', fontWeight: 700 }}>
                    🏪 Independent Retailers ({independents.length})
                  </div>
                  <div style={{ padding: '10px 16px 14px', display: 'flex', flexDirection: 'column', gap: 0 }}>
                    {independents.map((r, i) => {
                      const rAllocs = allocations.filter(a => a.partyId === r.id)
                      const rCredit = rAllocs.filter(a => a.status === 'sent' && a.paymentType === 'credit').reduce((s, a) => s + a.totalAmount, 0)
                      return (
                        <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: i > 0 ? 10 : 0, marginTop: i > 0 ? 10 : 0, borderTop: i > 0 ? '1px solid rgba(255,255,255,0.04)' : 'none' }}>
                          <span style={{ fontSize: 16 }}>🏪</span>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 13, fontWeight: 700 }}>{r.name}</div>
                            <div style={{ fontSize: 11, color: '#64748b' }}>{r.place || r.address}</div>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: 10, color: (r as any).status === 'active' ? '#16a34a' : '#d97706', fontWeight: 700 }}>
                              {(r as any).status === 'active' ? '🟢 Active' : '🟡 Prospect'}
                            </div>
                            {rCredit > 0 && <div style={{ fontSize: 10, color: '#7c3aed', marginTop: 1 }}>₹{rCredit.toLocaleString()} due</div>}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )
        })()}
      </div>
    </div>
  )
}
