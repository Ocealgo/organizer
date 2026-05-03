import React, { useState, useEffect } from 'react'
import { collection, addDoc, onSnapshot, updateDoc, doc, query, where } from 'firebase/firestore'
import { db } from '../../firebase'
import { Party, Product, VisitEntry, VisitOutcome, NOT_INTERESTED_REASONS, NotInterestedReason, DailyVisitLog } from '../../types'
import { useAuth } from '../../context/AuthContext'
import { useTheme } from '../../context/ThemeContext'
import { useStockConfig, toDisplay } from '../../hooks/useFirebase'
import CustomSelect from '../../components/CustomSelect'

interface Props { onBack: () => void }

const todayStr = () => new Date().toISOString().split('T')[0]

type Step = 'home' | 'selectShop' | 'addNewShop' | 'markOutcome' | 'summary'

export default function VisitLogger({ onBack }: Props) {
  const { appUser } = useAuth()
  const { t, theme } = useTheme()
  const { config } = useStockConfig()

  const [parties, setParties] = useState<Party[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [todayLog, setTodayLog] = useState<DailyVisitLog | null>(null)
  const [step, setStep] = useState<Step>('home')
  const [saving, setSaving] = useState(false)

  // Current visit being logged
  const [selectedParty, setSelectedParty] = useState<Party | null>(null)
  const [outcome, setOutcome] = useState<VisitOutcome | null>(null)
  const [notInterestedReason, setNotInterestedReason] = useState<NotInterestedReason | ''>('')
  const [otherReason, setOtherReason] = useState('')
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [allocQty, setAllocQty] = useState('')
  const [allocPrice, setAllocPrice] = useState('')
  const [allocPayment, setAllocPayment] = useState<'cash' | 'credit'>('cash')
  const [allocDate, setAllocDate] = useState(new Date(Date.now() + 86400000).toISOString().split('T')[0])
  const [endNote, setEndNote] = useState('')

  // New shop form
  const [newShop, setNewShop] = useState({ name: '', phone: '', address: '', place: '', type: 'retailer' as 'distributor' | 'retailer' })

  useEffect(() => {
    const u1 = onSnapshot(collection(db, 'parties'), snap =>
      setParties(snap.docs.map(d => ({ id: d.id, ...d.data() } as Party))))
    const u2 = onSnapshot(collection(db, 'products'), snap =>
      setProducts(snap.docs.map(d => ({ id: d.id, ...d.data() } as Product)).filter(p => p.active)))
    return () => { u1(); u2() }
  }, [])

  // Load today's log if exists
  useEffect(() => {
    if (!appUser) return
    const q = query(collection(db, 'visit_logs'),
      where('salesPersonId', '==', appUser.uid),
      where('date', '==', todayStr()))
    return onSnapshot(q, snap => {
      if (!snap.empty) {
        setTodayLog({ id: snap.docs[0].id, ...snap.docs[0].data() } as DailyVisitLog)
        setEndNote(snap.docs[0].data().endOfDayNote || '')
      } else {
        setTodayLog(null)
      }
    })
  }, [appUser])

  const visits: VisitEntry[] = todayLog?.visits || []

  const resetVisitState = () => {
    setSelectedParty(null); setOutcome(null)
    setNotInterestedReason(''); setOtherReason('')
    setSelectedProduct(null); setAllocQty(''); setAllocPrice('')
    setAllocPayment('cash')
    setAllocDate(new Date(Date.now() + 86400000).toISOString().split('T')[0])
  }

  // Auto-fill price when product selected
  useEffect(() => {
    if (selectedProduct) setAllocPrice(String(selectedProduct.defaultPricePerUnit))
  }, [selectedProduct])

  const handleAddVisit = async () => {
    if (!selectedParty || !outcome) return
    setSaving(true)
    try {
      const entry: VisitEntry = {
        partyId: selectedParty.id!,
        partyName: selectedParty.name,
        isNew: false,
        outcome,
        ...(outcome === 'not_interested' && { notInterestedReason: notInterestedReason as NotInterestedReason, otherReason: notInterestedReason === 'Other' ? otherReason : undefined }),
      }

      // If interested — create allocation
      if (outcome === 'interested' && selectedProduct && allocQty) {
        const units = parseInt(allocQty)
        const cartons = Math.floor(units / selectedProduct.unitsPerCarton)
        const price = parseFloat(allocPrice) || selectedProduct.defaultPricePerUnit
        const ref = await addDoc(collection(db, 'allocations_v2'), {
          partyId: selectedParty.id!, partyName: selectedParty.name, partyType: selectedParty.type,
          productId: selectedProduct.id!, productName: selectedProduct.name,
          packets: units, cartons, pricePerPacket: price, totalAmount: units * price,
          paymentType: allocPayment, plannedDate: allocDate,
          status: 'pending', notes: '',
          createdBy: appUser!.uid, createdByName: appUser!.name,
          createdAt: Date.now(), month: allocDate.slice(0, 7),
        })
        entry.productId = selectedProduct.id!
        entry.productName = selectedProduct.name
        entry.allocationId = ref.id
        // Mark party as active
        await updateDoc(doc(db, 'parties', selectedParty.id!), { status: 'active' })
      }

      // Update party status to prospect if not already active
      const currentStatus = (selectedParty as any).status
      if (!currentStatus || currentStatus === 'prospect') {
        if (outcome === 'not_interested') {
          await updateDoc(doc(db, 'parties', selectedParty.id!), { status: 'prospect', lastVisited: todayStr(), lastVisitedBy: appUser!.name, notInterestedReason: notInterestedReason })
        }
      }

      // Save to today's log
      const newVisits = [...visits, entry]
      const interested = newVisits.filter(v => v.outcome === 'interested').length
      const notInterested = newVisits.filter(v => v.outcome === 'not_interested').length

      if (todayLog?.id) {
        await updateDoc(doc(db, 'visit_logs', todayLog.id), {
          visits: newVisits,
          totalVisited: newVisits.length,
          totalInterested: interested,
          totalNotInterested: notInterested,
          updatedAt: Date.now(),
        })
      } else {
        await addDoc(collection(db, 'visit_logs'), {
          salesPersonId: appUser!.uid, salesPersonName: appUser!.name,
          date: todayStr(), visits: newVisits,
          endOfDayNote: '', totalVisited: newVisits.length,
          totalInterested: interested, totalNotInterested: notInterested,
          createdAt: Date.now(), updatedAt: Date.now(),
        })
      }

      resetVisitState()
      setStep('home')
    } finally { setSaving(false) }
  }

  const handleAddNewShop = async () => {
    if (!newShop.name.trim()) return
    setSaving(true)
    try {
      const ref = await addDoc(collection(db, 'parties'), {
        name: newShop.name.trim(), type: newShop.type,
        phone: newShop.phone, address: newShop.address, place: newShop.place,
        category: 'General Store', pricePerPacket: 0, packetsAllocated: 0,
        cartonsAllocated: 0, lowStockThreshold: 0, status: 'prospect',
        addedBy: appUser!.uid, addedByName: appUser!.name, createdAt: Date.now(),
      })
      const newParty: Party = { id: ref.id, name: newShop.name.trim(), type: newShop.type, category: 'General Store', phone: newShop.phone, address: newShop.address, place: newShop.place, pricePerPacket: 0, packetsAllocated: 0, cartonsAllocated: 0, lowStockThreshold: 0, addedBy: appUser!.uid, addedByName: appUser!.name, createdAt: Date.now() }
      setSelectedParty(newParty)
      setNewShop({ name: '', phone: '', address: '', place: '', type: 'retailer' })
      setStep('markOutcome')
    } finally { setSaving(false) }
  }

  const saveEndNote = async () => {
    if (!todayLog?.id) return
    await updateDoc(doc(db, 'visit_logs', todayLog.id), { endOfDayNote: endNote })
  }

  const s = { fontSize: 15, color: t.text, background: t.bg3, border: `1.5px solid ${t.border2}`, borderRadius: 12, padding: '13px 16px', width: '100%', outline: 'none', boxSizing: 'border-box' as const }

  const partyOptions = parties.map(p => ({
    value: p.id!, label: `${p.type === 'distributor' ? '🚚' : '🏪'} ${p.name}`,
    sub: `${(p as any).status === 'active' ? '🟢 Active' : '🟡 Prospect'} • ${p.place || p.address || ''}`,
    group: p.type === 'distributor' ? 'Distributors' : 'Retailers',
  }))

  // ── HOME ──────────────────────────────────────────────────────────────────
  if (step === 'home') return (
    <div style={{ minHeight: '100vh', background: t.bg, paddingBottom: 40 }}>
      <div style={{ background: 'linear-gradient(135deg,#0d3d2e,#1a5c42)', padding: '20px 20px 20px' }}>
        <button onClick={onBack} style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: '#6ee7b7', padding: '6px 14px', borderRadius: 20, fontSize: 13, marginBottom: 14 }}>← Back</button>
        <div style={{ color: '#6ee7b7', fontSize: 11, letterSpacing: 3, textTransform: 'uppercase', marginBottom: 4 }}>Today's Visits</div>
        <div style={{ fontSize: 22, fontWeight: 900, color: '#fff', marginBottom: 4 }}>{todayStr()}</div>

        {/* Stats */}
        <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
          {[
            { label: 'Visited', val: visits.length, color: '#fff' },
            { label: 'Interested', val: visits.filter(v => v.outcome === 'interested').length, color: '#86efac' },
            { label: 'Not Interested', val: visits.filter(v => v.outcome === 'not_interested').length, color: '#fca5a5' },
          ].map(s => (
            <div key={s.label} style={{ flex: 1, background: 'rgba(0,0,0,0.2)', borderRadius: 12, padding: '12px 8px', textAlign: 'center' }}>
              <div style={{ fontSize: 24, fontWeight: 900, color: s.color }}>{s.val}</div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.6)', marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ padding: '16px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* Add visit button */}
        <button onClick={() => setStep('selectShop')}
          style={{ background: 'linear-gradient(135deg,#0d3d2e,#1a5c42)', color: '#fff', border: 'none', borderRadius: 16, padding: '18px 20px', display: 'flex', alignItems: 'center', gap: 14, boxShadow: '0 8px 24px rgba(13,61,46,0.3)' }}>
          <span style={{ fontSize: 28 }}>🏪</span>
          <div style={{ textAlign: 'left' }}>
            <div style={{ fontWeight: 800, fontSize: 16 }}>Log a Visit</div>
            <div style={{ fontSize: 13, color: '#a7f3d0', marginTop: 2 }}>Select shop or add new</div>
          </div>
          <span style={{ marginLeft: 'auto', fontSize: 22 }}>›</span>
        </button>

        {/* Today's visits list */}
        {visits.length > 0 && (
          <>
            <div style={{ fontSize: 13, color: t.text2, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginTop: 4 }}>Today's Visits</div>
            {visits.map((v, i) => (
              <div key={i} style={{ background: t.card, borderRadius: 14, padding: '14px 16px', border: `1px solid ${v.outcome === 'interested' ? 'rgba(22,163,74,0.25)' : 'rgba(220,38,38,0.15)'}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 20 }}>{v.outcome === 'interested' ? '✅' : '❌'}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 15, color: t.text }}>{v.partyName}</div>
                    {v.outcome === 'interested' && v.productName && (
                      <div style={{ fontSize: 12, color: '#16a34a', marginTop: 2 }}>📦 {v.productName} • allocation created</div>
                    )}
                    {v.outcome === 'not_interested' && (
                      <div style={{ fontSize: 12, color: '#dc2626', marginTop: 2 }}>{v.notInterestedReason}{v.otherReason ? `: ${v.otherReason}` : ''}</div>
                    )}
                  </div>
                </div>
              </div>
            ))}

            {/* End of day note */}
            <div style={{ background: t.card, borderRadius: 14, padding: 16, border: `1px solid ${t.border}` }}>
              <div style={{ fontSize: 13, color: t.text2, fontWeight: 700, marginBottom: 8 }}>📝 End of Day Note</div>
              <textarea value={endNote} onChange={e => setEndNote(e.target.value)}
                onBlur={saveEndNote}
                placeholder="Anything to note for today? (optional)"
                rows={2}
                style={{ width: '100%', background: t.bg3, border: `1px solid ${t.border}`, borderRadius: 10, padding: '10px 12px', fontSize: 14, color: t.text, outline: 'none', resize: 'none', boxSizing: 'border-box' }} />
            </div>
          </>
        )}
      </div>
    </div>
  )

  // ── SELECT SHOP ───────────────────────────────────────────────────────────
  if (step === 'selectShop') return (
    <div style={{ minHeight: '100vh', background: t.bg, paddingBottom: 40 }}>
      <div style={{ background: 'linear-gradient(135deg,#0d3d2e,#1a5c42)', padding: '20px 20px 20px' }}>
        <button onClick={() => setStep('home')} style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: '#6ee7b7', padding: '6px 14px', borderRadius: 20, fontSize: 13, marginBottom: 14 }}>← Back</button>
        <div style={{ fontSize: 20, fontWeight: 900, color: '#fff' }}>Select Shop</div>
        <div style={{ fontSize: 13, color: '#a7f3d0', marginTop: 4 }}>Choose from existing or add new</div>
      </div>
      <div style={{ padding: '16px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <CustomSelect value={selectedParty?.id || ''}
          onChange={v => {
            const p = parties.find(p => p.id === v)
            if (p) { setSelectedParty(p); setStep('markOutcome') }
          }}
          placeholder="Search shops..."
          options={partyOptions} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1, height: 1, background: t.border }} />
          <span style={{ fontSize: 12, color: t.text3 }}>or</span>
          <div style={{ flex: 1, height: 1, background: t.border }} />
        </div>

        <button onClick={() => setStep('addNewShop')}
          style={{ background: t.card, border: `1.5px dashed ${t.border2}`, color: t.text, borderRadius: 14, padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 12, fontSize: 15 }}>
          <span style={{ fontSize: 24 }}>🆕</span>
          <div>
            <div style={{ fontWeight: 700 }}>Add New Shop</div>
            <div style={{ fontSize: 13, color: t.text2, marginTop: 2 }}>Distributor or retailer not in the list</div>
          </div>
        </button>
      </div>
    </div>
  )

  // ── ADD NEW SHOP ──────────────────────────────────────────────────────────
  if (step === 'addNewShop') return (
    <div style={{ minHeight: '100vh', background: t.bg, paddingBottom: 40 }}>
      <div style={{ background: 'linear-gradient(135deg,#0d3d2e,#1a5c42)', padding: '20px 20px 20px' }}>
        <button onClick={() => setStep('selectShop')} style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: '#6ee7b7', padding: '6px 14px', borderRadius: 20, fontSize: 13, marginBottom: 14 }}>← Back</button>
        <div style={{ fontSize: 20, fontWeight: 900, color: '#fff' }}>Add New Shop</div>
      </div>
      <div style={{ padding: '16px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Type */}
        <div style={{ display: 'flex', gap: 8 }}>
          {(['distributor', 'retailer'] as const).map(tp => (
            <button key={tp} onClick={() => setNewShop({ ...newShop, type: tp })}
              style={{ flex: 1, background: newShop.type === tp ? 'rgba(8,145,178,0.15)' : t.bg3, color: newShop.type === tp ? '#0891b2' : t.text2, border: `1.5px solid ${newShop.type === tp ? '#0891b2' : t.border2}`, borderRadius: 12, padding: '12px', fontSize: 14, fontWeight: 800 }}>
              {tp === 'distributor' ? '🚚 Distributor' : '🏪 Retailer'}
            </button>
          ))}
        </div>
        {[
          { label: 'Shop Name *', key: 'name', placeholder: 'e.g. Rajan Medical Store', type: 'text' },
          { label: 'Phone Number', key: 'phone', placeholder: '10-digit number', type: 'tel' },
          { label: 'Address', key: 'address', placeholder: 'Full address', type: 'text' },
          { label: 'Area / Place', key: 'place', placeholder: 'e.g. Koramangala', type: 'text' },
        ].map(f => (
          <div key={f.key}>
            <div style={{ fontSize: 12, color: t.text2, marginBottom: 6, letterSpacing: 1, textTransform: 'uppercase' }}>{f.label}</div>
            <input type={f.type} value={(newShop as any)[f.key]}
              onChange={e => setNewShop({ ...newShop, [f.key]: e.target.value })}
              placeholder={f.placeholder} style={s} />
          </div>
        ))}
        <button onClick={handleAddNewShop} disabled={saving || !newShop.name.trim()}
          style={{ background: saving ? '#475569' : 'linear-gradient(135deg,#0d3d2e,#1a5c42)', color: '#fff', border: 'none', borderRadius: 14, padding: 16, fontSize: 15, fontWeight: 800, opacity: !newShop.name.trim() ? 0.5 : 1 }}>
          {saving ? 'Saving...' : 'Add & Mark Outcome →'}
        </button>
      </div>
    </div>
  )

  // ── MARK OUTCOME ──────────────────────────────────────────────────────────
  if (step === 'markOutcome' && selectedParty) return (
    <div style={{ minHeight: '100vh', background: t.bg, paddingBottom: 40 }}>
      <div style={{ background: 'linear-gradient(135deg,#0d3d2e,#1a5c42)', padding: '20px 20px 20px' }}>
        <button onClick={() => { setStep('selectShop'); resetVisitState() }} style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: '#6ee7b7', padding: '6px 14px', borderRadius: 20, fontSize: 13, marginBottom: 14 }}>← Back</button>
        <div style={{ fontSize: 14, color: '#a7f3d0' }}>Visit outcome for</div>
        <div style={{ fontSize: 22, fontWeight: 900, color: '#fff' }}>{selectedParty.name}</div>
        <div style={{ fontSize: 13, color: '#a7f3d0', marginTop: 2 }}>{selectedParty.type === 'distributor' ? '🚚 Distributor' : '🏪 Retailer'} • {selectedParty.place || selectedParty.address}</div>
      </div>

      <div style={{ padding: '16px 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Outcome selection */}
        <div>
          <div style={{ fontSize: 13, color: t.text2, fontWeight: 700, marginBottom: 10, letterSpacing: 1, textTransform: 'uppercase' }}>Are they interested?</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <button onClick={() => setOutcome('interested')}
              style={{ background: outcome === 'interested' ? 'rgba(22,163,74,0.15)' : t.card, border: `2px solid ${outcome === 'interested' ? '#16a34a' : t.border}`, borderRadius: 14, padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 14, textAlign: 'left' }}>
              <span style={{ fontSize: 28 }}>✅</span>
              <div>
                <div style={{ fontWeight: 800, fontSize: 16, color: outcome === 'interested' ? '#16a34a' : t.text }}>Yes, Interested!</div>
                <div style={{ fontSize: 13, color: t.text2, marginTop: 2 }}>Will take our product — create allocation</div>
              </div>
            </button>
            <button onClick={() => setOutcome('not_interested')}
              style={{ background: outcome === 'not_interested' ? 'rgba(220,38,38,0.1)' : t.card, border: `2px solid ${outcome === 'not_interested' ? '#dc2626' : t.border}`, borderRadius: 14, padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 14, textAlign: 'left' }}>
              <span style={{ fontSize: 28 }}>❌</span>
              <div>
                <div style={{ fontWeight: 800, fontSize: 16, color: outcome === 'not_interested' ? '#dc2626' : t.text }}>Not Interested</div>
                <div style={{ fontSize: 13, color: t.text2, marginTop: 2 }}>Select reason below</div>
              </div>
            </button>
            <button onClick={() => setOutcome('follow_up')}
              style={{ background: outcome === 'follow_up' ? 'rgba(217,119,6,0.1)' : t.card, border: `2px solid ${outcome === 'follow_up' ? '#d97706' : t.border}`, borderRadius: 14, padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 14, textAlign: 'left' }}>
              <span style={{ fontSize: 28 }}>🔄</span>
              <div>
                <div style={{ fontWeight: 800, fontSize: 16, color: outcome === 'follow_up' ? '#d97706' : t.text }}>Follow Up Later</div>
                <div style={{ fontSize: 13, color: t.text2, marginTop: 2 }}>Interested but needs more time</div>
              </div>
            </button>
          </div>
        </div>

        {/* Not interested reasons */}
        {outcome === 'not_interested' && (
          <div>
            <div style={{ fontSize: 13, color: t.text2, fontWeight: 700, marginBottom: 10, letterSpacing: 1, textTransform: 'uppercase' }}>Why not interested?</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {NOT_INTERESTED_REASONS.map(r => (
                <button key={r} onClick={() => setNotInterestedReason(r)}
                  style={{ background: notInterestedReason === r ? 'rgba(220,38,38,0.12)' : t.bg3, color: notInterestedReason === r ? '#dc2626' : t.text2, border: `1.5px solid ${notInterestedReason === r ? '#dc2626' : t.border}`, borderRadius: 10, padding: '12px 14px', fontSize: 14, fontWeight: notInterestedReason === r ? 700 : 500, textAlign: 'left' }}>
                  {notInterestedReason === r ? '● ' : '○ '}{r}
                </button>
              ))}
            </div>
            {notInterestedReason === 'Other' && (
              <textarea value={otherReason} onChange={e => setOtherReason(e.target.value)}
                placeholder="Please specify..."
                rows={2}
                style={{ width: '100%', background: t.bg3, border: `1.5px solid ${t.border2}`, borderRadius: 10, padding: '10px 12px', fontSize: 14, color: t.text, outline: 'none', resize: 'none', boxSizing: 'border-box', marginTop: 8 }} />
            )}
          </div>
        )}

        {/* Interested — product + allocation */}
        {outcome === 'interested' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <div style={{ fontSize: 13, color: t.text2, fontWeight: 700, marginBottom: 10, letterSpacing: 1, textTransform: 'uppercase' }}>Which Product?</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {products.map(p => (
                  <button key={p.id} onClick={() => setSelectedProduct(p)}
                    style={{ background: selectedProduct?.id === p.id ? 'rgba(22,163,74,0.12)' : t.bg3, border: `1.5px solid ${selectedProduct?.id === p.id ? '#16a34a' : t.border}`, borderRadius: 12, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left' }}>
                    <span style={{ fontSize: 22 }}>📦</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: 15, color: selectedProduct?.id === p.id ? '#16a34a' : t.text }}>{p.name}</div>
                      <div style={{ fontSize: 12, color: t.text2, marginTop: 2 }}>Default: ₹{p.defaultPricePerUnit}/{p.unitLabel}</div>
                    </div>
                    {selectedProduct?.id === p.id && <span style={{ color: '#16a34a', fontSize: 18 }}>✓</span>}
                  </button>
                ))}
              </div>
            </div>

            {selectedProduct && (
              <>
                <div>
                  <div style={{ fontSize: 12, color: t.text2, marginBottom: 6, letterSpacing: 1, textTransform: 'uppercase' }}>Quantity ({selectedProduct.unitLabel})</div>
                  <input type="number" value={allocQty} onChange={e => setAllocQty(e.target.value)}
                    placeholder={`No. of ${selectedProduct.unitLabel}`} style={s} />
                  {allocQty && <div style={{ fontSize: 12, color: '#6ee7b7', marginTop: 5, fontWeight: 600 }}>
                    = {Math.floor(parseInt(allocQty) / selectedProduct.unitsPerCarton)} cartons ({allocQty} {selectedProduct.unitLabel})
                    {allocPrice && ` • ₹${(parseInt(allocQty) * parseFloat(allocPrice)).toLocaleString()}`}
                  </div>}
                </div>
                <div>
                  <div style={{ fontSize: 12, color: t.text2, marginBottom: 6, letterSpacing: 1, textTransform: 'uppercase' }}>Price per {selectedProduct.unitLabel} (₹)</div>
                  <input type="number" value={allocPrice} onChange={e => setAllocPrice(e.target.value)}
                    placeholder={`Default: ₹${selectedProduct.defaultPricePerUnit}`} style={s} />
                </div>
                <div>
                  <div style={{ fontSize: 12, color: t.text2, marginBottom: 6, letterSpacing: 1, textTransform: 'uppercase' }}>Payment Type</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {([['cash', '💵 Cash'], ['credit', '📋 Credit']] as const).map(([val, label]) => (
                      <button key={val} onClick={() => setAllocPayment(val)}
                        style={{ flex: 1, background: allocPayment === val ? (val === 'cash' ? 'rgba(22,163,74,0.15)' : 'rgba(217,119,6,0.15)') : t.bg3, color: allocPayment === val ? (val === 'cash' ? '#16a34a' : '#d97706') : t.text2, border: `1.5px solid ${allocPayment === val ? (val === 'cash' ? '#16a34a' : '#d97706') : t.border}`, borderRadius: 12, padding: '12px', fontSize: 14, fontWeight: 800 }}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 12, color: t.text2, marginBottom: 6, letterSpacing: 1, textTransform: 'uppercase' }}>Planned Send Date</div>
                  <input type="date" value={allocDate} onChange={e => setAllocDate(e.target.value)} style={s} />
                </div>
              </>
            )}
          </div>
        )}

        {/* Submit */}
        {outcome && (
          <button onClick={handleAddVisit} disabled={saving ||
            (outcome === 'not_interested' && !notInterestedReason) ||
            (outcome === 'interested' && (!selectedProduct || !allocQty))}
            style={{ background: saving ? '#475569' : 'linear-gradient(135deg,#0d3d2e,#1a5c42)', color: '#fff', border: 'none', borderRadius: 14, padding: 18, fontSize: 16, fontWeight: 800, marginTop: 4, opacity: (!outcome || (outcome === 'not_interested' && !notInterestedReason) || (outcome === 'interested' && (!selectedProduct || !allocQty))) ? 0.5 : 1 }}>
            {saving ? 'Saving...' : 'Save Visit ✅'}
          </button>
        )}
      </div>
    </div>
  )

  return null
}
