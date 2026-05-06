import React, { useState, useEffect } from 'react'
import { collection, addDoc, onSnapshot, updateDoc, doc, runTransaction, increment } from 'firebase/firestore'
import { db } from '../../firebase'
import { UnifiedAllocation, Party, PaymentType, AllocationStatus, Product, RetailerIndent, IndentStatus, StockConfig } from '../../types'
import { useAuth } from '../../context/AuthContext'
import { useTheme } from '../../context/ThemeContext'
import { useStockConfig, updateStockConfig, toDisplay } from '../../hooks/useFirebase'
import CustomSelect from '../../components/CustomSelect'
import DateInput from '../../components/DateInput'
import { useConfirm } from '../../hooks/useConfirm'

interface Props { onBack: () => void; parties: Party[]; isAdmin?: boolean }

const STATUS_STYLE: Record<AllocationStatus, { color: string; bg: string; emoji: string; label: string }> = {
  pending:   { color: '#d97706', bg: 'rgba(217,119,6,0.12)',   emoji: '🟡', label: 'Pending' },
  sent:      { color: '#0891b2', bg: 'rgba(8,145,178,0.12)',   emoji: '🔵', label: 'Sent' },
  paid:      { color: '#16a34a', bg: 'rgba(22,163,74,0.12)',   emoji: '✅', label: 'Paid' },
  overdue:   { color: '#dc2626', bg: 'rgba(220,38,38,0.12)',   emoji: '🔴', label: 'Overdue' },
  cancelled: { color: '#64748b', bg: 'rgba(100,116,139,0.12)', emoji: '🚫', label: 'Cancelled' },
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

function inputStyle(hasError?: boolean, dark = true): React.CSSProperties {
  return {
    width: '100%',
    background: dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
    border: `1.5px solid ${hasError ? '#dc2626' : dark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.12)'}`,
    borderRadius: 12, padding: '13px 16px', fontSize: 16,
    color: dark ? '#fff' : '#0f172a', outline: 'none', boxSizing: 'border-box',
  }
}

export default function AllocationManager({ onBack, parties, isAdmin }: Props) {
  const { appUser } = useAuth()
  const { t, theme } = useTheme()
  const isDark = theme === 'dark'
  const { config } = useStockConfig()
  const { modal, showConfirm, showDanger, showAlert } = useConfirm()
  const [allocations, setAllocations] = useState<UnifiedAllocation[]>([])
  const [stockMovements, setStockMovements] = useState<any[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [indents, setIndents] = useState<RetailerIndent[]>([])
  const [tab, setTab] = useState<'list' | 'add' | 'network'>('list')
  const [saving, setSaving] = useState(false)
  const [acting, setActing] = useState<string | null>(null)
  const [unit, setUnit] = useState<'packets' | 'cartons'>('packets')
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Allocation filters
  const [filterSource, setFilterSource] = useState<'all' | 'company' | 'distributor'>('all')
  const [filterStatus, setFilterStatus] = useState<'all' | AllocationStatus>('all')
  const [filterPayment, setFilterPayment] = useState<'all' | PaymentType>('all')
  const [filterParty, setFilterParty] = useState<string>('all')
  const [filterDistributor, setFilterDistributor] = useState<string>('all')
  // Network tab party status filter
  const [networkStatusFilter, setNetworkStatusFilter] = useState<'all' | 'active' | 'prospect' | 'inactive'>('all')
  const [historyPartyId, setHistoryPartyId] = useState<string | null>(null)

  // Indent send state
  const [indentSendQty, setIndentSendQty] = useState<Record<string, string>>({})
  const [indentErrors, setIndentErrors] = useState<Record<string, string>>({})
  const [sendingIndent, setSendingIndent] = useState<string | null>(null)

  const emptyForm = {
    fromType: 'company' as 'company' | 'distributor',
    fromId: '',   // distributorId when fromType='distributor'
    partyId: '', productId: '', packets: '', pricePerPacket: '',
    paymentType: 'cash' as PaymentType,
    plannedDate: new Date(Date.now() + 86400000).toISOString().split('T')[0],
    notes: '',
  }
  const [form, setForm] = useState(emptyForm)

  const today = new Date().toISOString().split('T')[0]
  const available = config.total - config.locked

  useEffect(() => {
    return onSnapshot(collection(db, 'allocations_v2'), snap => {
      const raw = snap.docs.map(d => ({ id: d.id, ...d.data() } as UnifiedAllocation))
      // Compute overdue status client-side
      const now = today
      const processed = raw.map(a => ({
        ...a,
        status: a.status === 'pending' && a.fromType !== 'distributor' && a.plannedDate && a.plannedDate < now ? 'overdue' : a.status,
      } as UnifiedAllocation))
      setAllocations(processed.sort((a, b) => a.plannedDate.localeCompare(b.plannedDate)))
    })
  }, [today])

  useEffect(() => {
    return onSnapshot(collection(db, 'stock_movements'), snap => {
      setStockMovements(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a: any, b: any) => b.createdAt - a.createdAt))
    })
  }, [])

  useEffect(() => {
    return onSnapshot(collection(db, 'products'), snap => {
      setProducts(snap.docs.map(d => ({ id: d.id, ...d.data() } as Product)).filter(p => p.active))
    })
  }, [])

  useEffect(() => {
    return onSnapshot(collection(db, 'retailer_indents'), snap => {
      setIndents(snap.docs.map(d => ({ id: d.id, ...d.data() } as RetailerIndent))
        .sort((a, b) => b.requestedAt - a.requestedAt))
    })
  }, [])


  const toPackets = (qty: string) => {
    const n = parseInt(qty) || 0
    return unit === 'cartons' ? n * config.packetsPerCarton : n
  }

  const validate = () => {
    const e: Record<string, string> = {}
    if (form.fromType === 'distributor' && !form.fromId) e.fromId = 'Select source distributor'
    if (!form.partyId) e.partyId = form.fromType === 'company' ? 'Select a distributor or retailer' : 'Select a retailer'
    if (!form.productId) e.productId = 'Select a product'
    if (!form.packets || parseInt(form.packets) <= 0) e.packets = 'Enter quantity'
    else {
      const pkt = toPackets(form.packets)
      if (form.fromType === 'company') {
        const pStk = config.productStock?.[form.productId]
        const prodAvail = pStk ? pStk.total - pStk.locked : 0
        if (pkt > prodAvail)
          e.packets = prodAvail <= 0
            ? 'No stock available for this product — update stock in Stock Management'
            : `Insufficient company stock — only ${toDisplay(prodAvail, config.packetsPerCarton)} available`
      } else {
        const dist = parties.find(p => p.id === form.fromId)
        const distStock = (dist?.stock?.[form.productId]) || 0
        if (pkt > distStock)
          e.packets = distStock <= 0
            ? `${dist?.name || 'Distributor'} has no stock for this product`
            : `Insufficient distributor stock — ${dist?.name || 'distributor'} only has ${toDisplay(distStock, config.packetsPerCarton)}`
      }
    }
    if (form.fromType === 'company') {
      if (!form.pricePerPacket || parseFloat(form.pricePerPacket) <= 0) e.pricePerPacket = 'Enter price per packet'
      if (!form.plannedDate) e.plannedDate = 'Select planned send date'
    }
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
      const product = products.find(p => p.id === form.productId)
      const isCompanyOrigin = form.fromType === 'company'
      const price = isCompanyOrigin ? parseFloat(form.pricePerPacket) : 0
      const plannedDate = isCompanyOrigin ? form.plannedDate : today
      const fromDist = !isCompanyOrigin ? parties.find(p => p.id === form.fromId) : null
      await addDoc(collection(db, 'allocations_v2'), {
        fromType: form.fromType,
        fromId: isCompanyOrigin ? 'company' : form.fromId,
        fromName: isCompanyOrigin ? 'Ocealgo' : (fromDist?.name || ''),
        partyId: form.partyId, partyName: party.name, partyType: party.type,
        productId: form.productId, productName: product?.name || '',
        packets, cartons, pricePerPacket: price, totalAmount: packets * price,
        paymentType: form.paymentType, plannedDate,
        status: 'pending' as AllocationStatus, notes: form.notes,
        createdBy: appUser!.uid, createdByName: appUser!.name,
        createdAt: Date.now(), month: plannedDate.slice(0, 7),
        lockedAtCreation: isCompanyOrigin,
      })
      await updateDoc(doc(db, 'parties', form.partyId), { status: 'active' })
      if (form.fromType === 'company') {
        await updateDoc(doc(db, 'config', 'stock'), {
          [`productStock.${form.productId}.locked`]: increment(packets),
          updatedAt: Date.now(),
        })
      }
      setForm(emptyForm)
      setErrors({})
      setTab('list')
    } finally { setSaving(false) }
  }

  const handleSendIndent = async (indent: RetailerIndent) => {
    const qty = parseInt(indentSendQty[indent.id!] ?? String(indent.requestedPackets))
    if (isNaN(qty) || qty <= 0) {
      setIndentErrors(prev => ({ ...prev, [indent.id!]: 'Enter a valid quantity' })); return
    }
    if (qty > indent.requestedPackets) {
      setIndentErrors(prev => ({ ...prev, [indent.id!]: `Cannot exceed ${indent.requestedPackets} pkts` })); return
    }
    const dist = parties.find(p => p.id === indent.distributorId)
    const distStock = dist?.stock?.[indent.productId] || 0
    if (distStock < qty) {
      setIndentErrors(prev => ({ ...prev, [indent.id!]: `Distributor only has ${distStock} packets (need ${qty})` })); return
    }
    setSendingIndent(indent.id!)
    setIndentErrors(prev => { const n = { ...prev }; delete n[indent.id!]; return n })
    try {
      await runTransaction(db, async (tx) => {
        const distRef = doc(db, 'parties', indent.distributorId)
        const distSnap = await tx.get(distRef)
        const currentStock = (distSnap.data()?.stock?.[indent.productId] as number) || 0
        if (currentStock < qty) throw new Error(`Distributor now only has ${currentStock} packets`)
        const retailerRef = doc(db, 'parties', indent.retailerId)
        const indentRef = doc(db, 'retailer_indents', indent.id!)
        tx.update(distRef, { [`stock.${indent.productId}`]: increment(-qty) })
        tx.update(retailerRef, { [`stock.${indent.productId}`]: increment(qty) })
        tx.update(indentRef, { fulfilledPackets: qty, status: 'fulfilled' as IndentStatus, fulfilledAt: Date.now() })
      })
      await addDoc(collection(db, 'stock_movements'), {
        fromId: indent.distributorId, fromName: indent.distributorName,
        toPartyId: indent.retailerId, toPartyName: indent.retailerName,
        packets: qty, cartons: 0, pricePerPacket: 0, totalAmount: 0,
        paymentType: 'cash', notes: 'Indent fulfilled',
        month: new Date().toISOString().slice(0, 7),
        loggedBy: appUser!.uid, loggedByName: appUser!.name,
        date: new Date().toISOString().split('T')[0], createdAt: Date.now(),
        productId: indent.productId, productName: indent.productName, indentId: indent.id,
      })
      setIndentSendQty(prev => { const n = { ...prev }; delete n[indent.id!]; return n })
    } catch (err: any) {
      setIndentErrors(prev => ({ ...prev, [indent.id!]: err.message || 'Send failed' }))
    } finally { setSendingIndent(null) }
  }

  const handleCancelIndent = async (indent: RetailerIndent) => {
    if (!await showDanger('Cancel Indent?', `Stock request from ${indent.retailerName} will be cancelled.`, 'Cancel Indent')) return
    setSendingIndent(indent.id!)
    try {
      await updateDoc(doc(db, 'retailer_indents', indent.id!), { status: 'cancelled' as IndentStatus })
    } finally { setSendingIndent(null) }
  }

  const handleCancelAllocation = async (a: UnifiedAllocation) => {
    const isCompany = a.fromType === 'company' || !(a as any).fromType
    const detail = isCompany
      ? `${toDisplay(a.packets, config.packetsPerCarton)} will be restored to available stock.`
      : `Allocation for ${a.partyName} will be removed.`
    if (!await showDanger(`Cancel Allocation?`, detail, 'Cancel Allocation')) return
    setActing(a.id!)
    try {
      await updateDoc(doc(db, 'allocations_v2', a.id!), { status: 'cancelled' as AllocationStatus })
      if (isCompany && a.lockedAtCreation) {
        if (a.productId) {
          await updateDoc(doc(db, 'config', 'stock'), {
            [`productStock.${a.productId}.locked`]: increment(-a.packets),
            updatedAt: Date.now(),
          })
        } else {
          await updateStockConfig({ locked: Math.max(0, config.locked - a.packets) })
        }
      }
    } finally { setActing(null) }
  }

  // Admin dispatches — moves stock via transaction
  const handleDispatch = async (a: UnifiedAllocation) => {
    if (!isAdmin) return
    const isCompany = a.fromType === 'company' || !(a as any).fromType

    // UX pre-check (non-atomic — transaction re-validates atomically)
    if (isCompany) {
      const pStk = a.productId ? config.productStock?.[a.productId] : null
      const prodAvail = pStk ? pStk.total - pStk.locked : available
      if (a.packets > prodAvail) { await showAlert('Insufficient Stock', `Only ${toDisplay(prodAvail, config.packetsPerCarton)} of ${a.productName || 'this product'} available.`); return }
    } else {
      const dist = parties.find(p => p.id === a.fromId)
      const distStock = (dist?.stock?.[a.productId]) || 0
      if (a.packets > distStock) { await showAlert('Insufficient Stock', `Distributor only has ${distStock} packets available.`); return }
    }

    if (!await showConfirm(a.fromType === 'distributor' ? 'Confirm Sent?' : 'Dispatch Stock?', `${toDisplay(a.packets, config.packetsPerCarton)} → ${a.partyName}`)) return
    setActing(a.id!)
    try {
      await runTransaction(db, async (tx) => {
        const allocRef = doc(db, 'allocations_v2', a.id!)
        const partyRef = doc(db, 'parties', a.partyId)

        if (isCompany) {
          const configRef = doc(db, 'config', 'stock')
          const configSnap = await tx.get(configRef)
          const cfg = configSnap.data() as StockConfig | undefined

          tx.update(allocRef, {
            status: 'sent' as AllocationStatus,
            sentAt: Date.now(), sentBy: appUser!.uid, sentByName: appUser!.name,
          })

          if (a.productId) {
            const pStk = cfg?.productStock?.[a.productId] ?? { total: 0, locked: 0 }
            tx.update(configRef, {
              [`productStock.${a.productId}.total`]: pStk.total - a.packets,
              [`productStock.${a.productId}.locked`]: Math.max(0, pStk.locked - (a.lockedAtCreation ? a.packets : 0)),
              updatedAt: Date.now(),
            })
          } else {
            // Legacy global-pool fallback for old allocations without productId
            const total = cfg?.total ?? 0
            const locked = cfg?.locked ?? 0
            tx.update(configRef, {
              total: total - a.packets,
              locked: Math.max(0, locked - (a.lockedAtCreation ? a.packets : 0)),
              updatedAt: Date.now(),
            })
          }
          tx.update(partyRef, { [`stock.${a.productId}`]: increment(a.packets) })
        } else {
          // Distributor → retailer
          const distRef = doc(db, 'parties', a.fromId)
          const distSnap = await tx.get(distRef)
          const distStock = (distSnap.data()?.stock?.[a.productId] as number) || 0
          if (distStock < a.packets) throw new Error(`Distributor only has ${distStock} packets available`)

          tx.update(allocRef, {
            status: 'sent' as AllocationStatus,
            sentAt: Date.now(), sentBy: appUser!.uid, sentByName: appUser!.name,
          })
          tx.update(distRef, { [`stock.${a.productId}`]: increment(-a.packets) })
          tx.update(partyRef, { [`stock.${a.productId}`]: increment(a.packets) })
        }
      })

      // Audit log (outside transaction — non-load-bearing)
      await addDoc(collection(db, 'dispatches'), {
        partyId: a.partyId, partyName: a.partyName, partyType: a.partyType,
        fromType: a.fromType || 'company', fromId: a.fromId || 'company', fromName: a.fromName || 'Ocealgo',
        packets: a.packets, cartons: a.cartons,
        pricePerPacket: a.pricePerPacket, totalAmount: a.totalAmount,
        paymentType: a.paymentType, notes: a.notes || '',
        month: a.month, allocationId: a.id,
        dispatchedBy: appUser!.uid, dispatchedByName: appUser!.name,
        dispatchedAt: Date.now(), date: today, createdAt: Date.now(),
      })
      if (a.paymentType === 'credit') {
        await addDoc(collection(db, 'credits'), {
          partyId: a.partyId, partyName: a.partyName, partyType: a.partyType,
          deliveryId: a.id, packets: a.packets, amount: a.totalAmount,
          status: 'outstanding', createdAt: Date.now(),
        })
      }
    } catch (err: any) {
      await showAlert('Dispatch Failed', err.message || 'Something went wrong. Please try again.')
    } finally { setActing(null) }
  }

  // Admin marks credit paid — stock already moved at dispatch, just flip status
  const handleMarkPaid = async (a: UnifiedAllocation) => {
    if (!isAdmin) return
    if (!await showConfirm('Mark as Paid?', `₹${a.totalAmount.toLocaleString()} from ${a.partyName}`)) return
    setActing(a.id!)
    try {
      await updateDoc(doc(db, 'allocations_v2', a.id!), { status: 'paid' as AllocationStatus, paidAt: Date.now() })
    } finally { setActing(null) }
  }

  // Filter allocations
  const filtered = allocations.filter(a => {
    if (filterSource === 'company' && a.fromType === 'distributor') return false
    if (filterSource === 'distributor' && a.fromType !== 'distributor') return false
    if (filterStatus !== 'all' && a.status !== filterStatus) return false
    if (filterPayment !== 'all' && a.paymentType !== filterPayment) return false
    if (filterParty !== 'all' && a.partyId !== filterParty) return false
    return true
  })

  // Filter indents (only active, by distributor)
  const filteredIndents = filterSource === 'company' ? [] : indents.filter(i => {
    if (i.status === 'fulfilled' || i.status === 'cancelled') return false
    if (filterDistributor !== 'all' && i.distributorId !== filterDistributor) return false
    return true
  })

  // Summary counts
  const counts = {
    all: allocations.length,
    pending: allocations.filter(a => a.status === 'pending').length,
    overdue: allocations.filter(a => a.status === 'overdue').length,
    sent: allocations.filter(a => a.status === 'sent').length,
    paid: allocations.filter(a => a.status === 'paid').length,
    cancelled: allocations.filter(a => a.status === 'cancelled').length,
  }
  const totalCredit = allocations.filter(a => a.status === 'sent' && a.paymentType === 'credit').reduce((s, a) => s + a.totalAmount, 0)

  // Party options for list-tab filter (all parties including retailers under distributors)
  const partyOptions = parties.map(p => ({
    value: p.id!, label: `${p.type === 'distributor' ? '🚚' : '🏪'} ${p.name}`,
    sub: `${p.category} • ${p.place || p.address}`,
    group: p.type === 'distributor' ? 'Distributors' : (p as any).underDistributorId ? 'Retailers (under Distributor)' : 'Independent Retailers',
  }))

  // Add-tab recipient options — depends on fromType
  const addTabPartyOptions = form.fromType === 'company'
    ? parties
        .filter(p => !(p.type === 'retailer' && (p as any).underDistributorId))
        .map(p => ({
          value: p.id!, label: `${p.type === 'distributor' ? '🚚' : '🏪'} ${p.name}`,
          sub: `${p.category} • ${p.place || p.address}`,
          group: p.type === 'distributor' ? 'Distributors' : 'Independent Retailers',
        }))
    : form.fromId
      ? parties
          .filter(p => p.type === 'retailer' && (p as any).underDistributorId === form.fromId)
          .map(p => ({ value: p.id!, label: `🏪 ${p.name}`, sub: `${p.category} • ${p.place || p.address}` }))
      : []

  const blockedRetailersCount = parties.filter(p => p.type === 'retailer' && (p as any).underDistributorId).length

  const selectedParty = parties.find(p => p.id === form.partyId)
  const selectedFromDist = form.fromType === 'distributor' ? parties.find(p => p.id === form.fromId) : null

  // History view
  if (historyPartyId) {
    const histParty = parties.find(p => p.id === historyPartyId)
    if (!histParty) { setHistoryPartyId(null); return null }
    const inboundAllocs = allocations.filter(a => a.partyId === historyPartyId)
    const outboundAllocs = allocations.filter(a => a.fromId === historyPartyId && a.fromType === 'distributor')
    const partyAllocs = [...inboundAllocs, ...outboundAllocs].sort((a, b) => b.createdAt - a.createdAt)
    const subRets = parties.filter(p => (p as any).underDistributorId === historyPartyId)
    const receivedPkts = inboundAllocs.filter(a => a.status === 'sent' || a.status === 'paid').reduce((s, a) => s + a.packets, 0)
    const sentOutPkts = outboundAllocs.filter(a => a.status === 'sent' || a.status === 'paid').reduce((s, a) => s + a.packets, 0)
    const outstanding = inboundAllocs.filter(a => a.status === 'sent' && a.paymentType === 'credit').reduce((s, a) => s + a.totalAmount, 0)

    return (
      <>
      <div style={{ minHeight: '100vh', background: t.bg, paddingBottom: 40 }}>
        <div style={{ background: 'linear-gradient(135deg,#1a5c42,#16a34a)', padding: '20px 20px 16px' }}>
          <button onClick={() => setHistoryPartyId(null)} style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: '#bbf7d0', padding: '6px 14px', borderRadius: 20, fontSize: 12, marginBottom: 14 }}>← Network</button>
          <div style={{ color: '#bbf7d0', fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 2 }}>
            {histParty.type === 'distributor' ? '🚚 Distributor' : '🏪 Retailer'} History
          </div>
          <div style={{ fontSize: 22, fontWeight: 900, color: '#fff', marginBottom: 2 }}>{histParty.name}</div>
          <div style={{ fontSize: 12, color: '#a7f3d0' }}>{histParty.place || histParty.address} · {histParty.phone}</div>
        </div>

        <div style={{ padding: '14px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            {(histParty.type === 'distributor' ? [
              { label: 'From Company', val: toDisplay(receivedPkts, config.packetsPerCarton), color: '#0891b2' },
              { label: 'To Retailers', val: sentOutPkts > 0 ? toDisplay(sentOutPkts, config.packetsPerCarton) : '—', color: '#16a34a' },
              { label: 'Outstanding', val: outstanding > 0 ? `₹${(outstanding / 1000).toFixed(0)}k` : '—', color: '#7c3aed' },
            ] : [
              { label: 'Received', val: toDisplay(receivedPkts, config.packetsPerCarton), color: '#0891b2' },
              { label: 'Sent Out', val: sentOutPkts > 0 ? toDisplay(sentOutPkts, config.packetsPerCarton) : '—', color: '#16a34a' },
              { label: 'Outstanding', val: outstanding > 0 ? `₹${(outstanding / 1000).toFixed(0)}k` : '—', color: '#7c3aed' },
            ]).map(s => (
              <div key={s.label} style={{ background: t.card, borderRadius: 12, padding: '12px 10px', textAlign: 'center', border: `1px solid ${t.border}` }}>
                <div style={{ fontSize: 16, fontWeight: 900, color: s.color }}>{s.val}</div>
                <div style={{ fontSize: 10, color: t.text3, marginTop: 2 }}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* Current Stock */}
          {histParty.type === 'distributor' && (() => {
            const stockEntries = Object.entries(histParty.stock || {}).filter(([, qty]) => qty > 0)
            const allEntries = products.length > 0
              ? products.map(p => ({ name: p.name, qty: histParty.stock?.[p.id!] ?? 0, id: p.id! }))
              : stockEntries.map(([id, qty]) => ({ name: id, qty, id }))
            const hasAny = allEntries.some(e => e.qty > 0)
            return (
              <div style={{ background: t.card, borderRadius: 14, padding: '14px 16px', border: `1.5px solid rgba(22,163,74,0.25)` }}>
                <div style={{ fontSize: 11, color: '#6ee7b7', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10 }}>📦 Current Stock</div>
                {!hasAny ? (
                  <div style={{ fontSize: 13, color: t.text3 }}>No stock recorded</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {allEntries.map(e => (
                      <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: 13, color: t.text2 }}>{e.name}</span>
                        <span style={{ fontSize: 14, fontWeight: 800, color: e.qty > 0 ? '#6ee7b7' : t.text3 }}>
                          {e.qty > 0 ? toDisplay(e.qty, config.packetsPerCarton) : '—'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })()}

          <div style={{ fontSize: 11, color: t.text3, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>
            Allocation History ({partyAllocs.length})
          </div>
          {partyAllocs.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 24, color: t.text3 }}>No allocations yet</div>
          ) : partyAllocs.map(a => {
            const ss = STATUS_STYLE[a.status] || STATUS_STYLE.pending
            const isOutbound = a.fromId === historyPartyId && a.fromType === 'distributor'
            return (
              <div key={a.id} style={{ background: t.card, borderRadius: 14, padding: '14px 16px', border: `1px solid ${ss.color}33` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14, color: t.text }}>{(a as any).productName || '—'}</div>
                    <div style={{ fontSize: 11, color: t.text3, marginTop: 2 }}>
                      {isOutbound ? `→ ${a.partyName}` : '← Ocealgo'} · {new Date(a.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                    </div>
                    <div style={{ fontSize: 11, color: t.text3 }}>by {a.createdByName}</div>
                  </div>
                  <span style={{ background: ss.bg, color: ss.color, fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 99, flexShrink: 0 }}>
                    {ss.emoji} {ss.label}
                  </span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: isOutbound ? '1fr' : '1fr 1fr', gap: 6 }}>
                  <div style={{ background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)', borderRadius: 8, padding: '8px', textAlign: 'center' }}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: t.text }}>{toDisplay(a.packets, config.packetsPerCarton)}</div>
                    <div style={{ fontSize: 9, color: t.text3 }}>quantity</div>
                  </div>
                  {!isOutbound && (
                    <div style={{ background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)', borderRadius: 8, padding: '8px', textAlign: 'center' }}>
                      <div style={{ fontSize: 13, fontWeight: 800, color: '#16a34a' }}>₹{a.totalAmount.toLocaleString()}</div>
                      <div style={{ fontSize: 9, color: t.text3 }}>{a.paymentType === 'cash' ? 'cash' : 'credit'}</div>
                    </div>
                  )}
                </div>
              </div>
            )
          })}

          {histParty.type === 'distributor' && (
            <>
              <div style={{ fontSize: 11, color: t.text3, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginTop: 4 }}>
                Retailers Under This Distributor ({subRets.length})
              </div>
              {subRets.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 16, color: t.text3, fontSize: 13 }}>No retailers linked</div>
              ) : subRets.map(r => {
                const rAllocs = outboundAllocs.filter(a => a.partyId === r.id)
                const rSentPkts = rAllocs.filter(a => a.status === 'sent' || a.status === 'paid').reduce((s, a) => s + a.packets, 0)
                const rPendingPkts = rAllocs.filter(a => a.status === 'pending').reduce((s, a) => s + a.packets, 0)
                const rStockEntries = Object.entries(r.stock || {})
                const rTotalStock = rStockEntries.reduce((s, [, qty]) => s + (qty as number), 0)
                return (
                  <div key={r.id} style={{ background: t.card, borderRadius: 14, padding: '14px 16px', border: `1px solid ${t.border}` }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                      <span style={{ fontSize: 18 }}>🏪</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 700, fontSize: 14, color: t.text }}>{r.name}</div>
                        <div style={{ fontSize: 11, color: t.text3 }}>{r.place || r.address}</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        {rSentPkts > 0 && <div style={{ fontSize: 13, fontWeight: 800, color: '#0891b2' }}>{toDisplay(rSentPkts, config.packetsPerCarton)}</div>}
                        {rSentPkts > 0 && <div style={{ fontSize: 9, color: t.text3 }}>total sent</div>}
                        {rPendingPkts > 0 && <div style={{ fontSize: 10, color: '#d97706', marginTop: 2 }}>{rPendingPkts} pkts pending</div>}
                        {rSentPkts === 0 && rPendingPkts === 0 && <div style={{ fontSize: 12, color: t.text3 }}>—</div>}
                      </div>
                    </div>
                    {/* Retailer current stock */}
                    {rTotalStock > 0 && (
                      <div style={{ background: isDark ? 'rgba(22,163,74,0.06)' : 'rgba(22,163,74,0.05)', border: '1px solid rgba(22,163,74,0.15)', borderRadius: 8, padding: '8px 10px', marginBottom: rAllocs.length > 0 ? 8 : 0 }}>
                        <div style={{ fontSize: 10, color: '#6ee7b7', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>In Stock</div>
                        {rStockEntries.filter(([, qty]) => (qty as number) > 0).map(([pid, qty]) => {
                          const prod = products.find(p => p.id === pid)
                          return (
                            <div key={pid} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                              <span style={{ color: t.text2 }}>{prod?.name || pid}</span>
                              <span style={{ fontWeight: 700, color: '#6ee7b7' }}>{toDisplay(qty as number, config.packetsPerCarton)}</span>
                            </div>
                          )
                        })}
                      </div>
                    )}
                    {rAllocs.slice(0, 3).map(a => (
                      <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', background: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)', borderRadius: 6, padding: '6px 10px', marginTop: 4, fontSize: 11 }}>
                        <span style={{ color: t.text3 }}>
                          {a.sentAt ? new Date(a.sentAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : a.plannedDate} · {a.packets} pkts{a.productName ? ` · ${a.productName}` : ''}
                        </span>
                        <span style={{ color: a.status === 'sent' || a.status === 'paid' ? '#16a34a' : '#d97706', fontWeight: 700 }}>
                          {a.status === 'sent' || a.status === 'paid' ? '✅' : '⏳'}
                        </span>
                      </div>
                    ))}
                  </div>
                )
              })}
            </>
          )}
        </div>
      </div>
      {modal}
      </>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: t.bg, paddingBottom: 40 }}>
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
            {/* Source filter */}
            <div style={{ display: 'flex', gap: 8 }}>
              {([
                { val: 'all',         label: '📋 All' },
                { val: 'company',     label: '🏭 From Company' },
                { val: 'distributor', label: '🚚 From Distributor' },
              ] as const).map(opt => (
                <button key={opt.val} onClick={() => setFilterSource(opt.val)}
                  style={{ flex: 1, background: filterSource === opt.val ? 'rgba(22,163,74,0.15)' : isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)', color: filterSource === opt.val ? '#16a34a' : '#64748b', border: `1.5px solid ${filterSource === opt.val ? '#16a34a' : isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)'}`, borderRadius: 12, padding: '10px 6px', fontSize: 12, fontWeight: 800 }}>
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Indent distributor filter */}
            {filterSource !== 'company' && (
              <div style={{ background: t.card, borderRadius: 14, padding: 14, border: `1px solid rgba(8,145,178,0.2)` }}>
                <div style={{ fontSize: 11, color: '#0891b2', marginBottom: 8, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>🚚 Filter by Distributor</div>
                <CustomSelect
                  value={filterDistributor}
                  onChange={setFilterDistributor}
                  placeholder="All distributors"
                  options={[
                    { value: 'all', label: '📋 All distributors' },
                    ...parties.filter(p => p.type === 'distributor').map(p => ({
                      value: p.id!, label: `🚚 ${p.name}`, sub: p.place || p.address,
                    })),
                  ]}
                />
              </div>
            )}

            {/* Allocation filters */}
            {filterSource !== 'distributor' && (
              <div style={{ background: t.card, borderRadius: 14, padding: 14, border: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {(['all', 'overdue', 'pending', 'sent', 'paid', 'cancelled'] as const).map(s => (
                    <button key={s} onClick={() => setFilterStatus(s)}
                      style={{ background: filterStatus === s ? (s === 'all' ? '#1a5c42' : STATUS_STYLE[s as AllocationStatus]?.bg || '#1a5c42') : 'rgba(255,255,255,0.04)', color: filterStatus === s ? (s === 'all' ? '#6ee7b7' : STATUS_STYLE[s as AllocationStatus]?.color || '#6ee7b7') : '#64748b', border: `1px solid ${filterStatus === s ? (s === 'all' ? '#16a34a' : STATUS_STYLE[s as AllocationStatus]?.color || '#16a34a') : 'rgba(255,255,255,0.06)'}`, borderRadius: 20, padding: '5px 12px', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap', textTransform: 'capitalize' }}>
                      {s === 'all' ? `All (${counts.all})` : `${STATUS_STYLE[s]?.emoji} ${s}`}
                    </button>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {(['all', 'cash', 'credit'] as const).map(p => (
                    <button key={p} onClick={() => setFilterPayment(p)}
                      style={{ background: filterPayment === p ? 'rgba(124,58,237,0.15)' : 'rgba(255,255,255,0.04)', color: filterPayment === p ? '#a78bfa' : '#64748b', border: `1px solid ${filterPayment === p ? '#7c3aed' : 'rgba(255,255,255,0.06)'}`, borderRadius: 20, padding: '5px 12px', fontSize: 11, fontWeight: 700 }}>
                      {p === 'all' ? 'All payments' : p === 'cash' ? '💵 Cash' : '📋 Credit'}
                    </button>
                  ))}
                </div>
                <CustomSelect value={filterParty} onChange={setFilterParty} placeholder="All parties"
                  options={[{ value: 'all', label: 'All parties' }, ...partyOptions]} />
              </div>
            )}

            {/* Results count */}
            <div style={{ fontSize: 12, color: '#64748b' }}>
              {`${filtered.length} allocation${filtered.length !== 1 ? 's' : ''}`}
              {filterSource !== 'company' && filteredIndents.length > 0 && ` · ${filteredIndents.length} indent${filteredIndents.length !== 1 ? 's' : ''} pending`}
            </div>

            {/* Allocation cards */}
            {filtered.length === 0 ? (
              filterSource !== 'distributor' && (
                <div style={{ textAlign: 'center', padding: 40, color: '#475569' }}>
                  <div style={{ fontSize: 36, marginBottom: 10 }}>📦</div>
                  <div style={{ fontWeight: 700 }}>No allocations found</div>
                  <div style={{ fontSize: 13, marginTop: 6 }}>Tap "New Allocation" to create one</div>
                </div>
              )
            ) : filtered.map(a => {
              const ss = STATUS_STYLE[a.status]
              const isOverdue = a.status === 'overdue'
              const isSentCredit = a.status === 'sent' && a.paymentType === 'credit'
              const daysUntil = Math.ceil((new Date(a.plannedDate).getTime() - Date.now()) / 86400000)
              return (
                <div key={a.id} style={{ background: t.card, borderRadius: 16, padding: 16, border: `1.5px solid ${isOverdue ? '#dc262644' : ss.color + '33'}` }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 12 }}>
                    <div style={{ fontSize: 20, flexShrink: 0 }}>{a.partyType === 'distributor' ? '🚚' : '🏪'}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 800, fontSize: 15 }}>{a.partyName}</div>
                      <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>
                        {a.fromType === 'distributor' ? `🚚 ${a.fromName}` : '🏭 Ocealgo'} → {a.partyName}
                      </div>
                      <div style={{ fontSize: 10, color: '#475569' }}>by {a.createdByName}</div>
                    </div>
                    <span style={{ background: ss.bg, color: ss.color, fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 99, whiteSpace: 'nowrap' }}>
                      {ss.emoji} {ss.label}
                    </span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: a.fromType === 'distributor' ? '1fr 1fr' : '1fr 1fr 1fr', gap: 8, marginBottom: 10 }}>
                    <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 10, padding: '8px', textAlign: 'center' }}>
                      <div style={{ fontSize: 13, fontWeight: 800, color: '#e2e8f0' }}>{toDisplay(a.packets, config.packetsPerCarton)}</div>
                      <div style={{ fontSize: 9, color: '#64748b', marginTop: 2 }}>quantity</div>
                    </div>
                    {a.fromType !== 'distributor' && (
                      <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 10, padding: '8px', textAlign: 'center' }}>
                        <div style={{ fontSize: 13, fontWeight: 800, color: '#16a34a' }}>₹{a.totalAmount.toLocaleString()}</div>
                        <div style={{ fontSize: 9, color: '#64748b', marginTop: 2 }}>{a.paymentType === 'cash' ? '💵 cash' : '📋 credit'}</div>
                      </div>
                    )}
                    <div style={{ background: isOverdue ? 'rgba(220,38,38,0.1)' : 'rgba(255,255,255,0.04)', borderRadius: 10, padding: '8px', textAlign: 'center', border: isOverdue ? '1px solid rgba(220,38,38,0.2)' : 'none' }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: isOverdue ? '#dc2626' : a.status === 'pending' ? '#d97706' : '#64748b' }}>
                        {a.status === 'pending' || a.status === 'overdue'
                          ? isOverdue ? 'Overdue!' : daysUntil === 0 ? 'Today' : daysUntil === 1 ? 'Tomorrow' : `${daysUntil}d`
                          : a.sentAt ? new Date(a.sentAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—'}
                      </div>
                      <div style={{ fontSize: 9, color: '#64748b', marginTop: 2 }}>
                        {a.status === 'pending' || a.status === 'overdue' ? (a.fromType === 'distributor' ? 'awaiting confirmation' : `planned ${a.plannedDate}`) : 'sent'}
                      </div>
                    </div>
                  </div>
                  {a.notes && <div style={{ fontSize: 11, color: '#475569', marginBottom: 10 }}>📝 {a.notes}</div>}
                  {isAdmin && (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {(a.status === 'pending' || a.status === 'overdue') && (
                        <>
                          <button onClick={() => handleDispatch(a)} disabled={acting === a.id}
                            style={{ flex: 1, background: a.fromType === 'distributor' ? 'linear-gradient(135deg,#0e4f7a,#0891b2)' : 'linear-gradient(135deg,#1a5c42,#16a34a)', color: '#fff', border: 'none', borderRadius: 10, padding: '10px', fontSize: 12, fontWeight: 800, opacity: acting === a.id ? 0.5 : 1 }}>
                            {acting === a.id ? 'Processing...' : a.fromType === 'distributor' ? '✅ Confirm Sent' : '📦 Dispatch Now'}
                          </button>
                          <button onClick={() => handleCancelAllocation(a)} disabled={acting === a.id}
                            style={{ background: 'rgba(220,38,38,0.1)', color: '#dc2626', border: '1px solid rgba(220,38,38,0.25)', borderRadius: 10, padding: '10px 14px', fontSize: 12, fontWeight: 700, opacity: acting === a.id ? 0.5 : 1 }}>
                            🚫 Cancel
                          </button>
                        </>
                      )}
                      {a.fromType !== 'distributor' && isSentCredit && (
                        <button onClick={() => handleMarkPaid(a)} disabled={acting === a.id}
                          style={{ flex: 1, background: 'rgba(22,163,74,0.15)', color: '#16a34a', border: '1.5px solid rgba(22,163,74,0.3)', borderRadius: 10, padding: '10px', fontSize: 12, fontWeight: 800, opacity: acting === a.id ? 0.5 : 1 }}>
                          {acting === a.id ? '...' : '✅ Mark Paid'}
                        </button>
                      )}
                      {a.fromType !== 'distributor' && a.status === 'sent' && a.paymentType === 'cash' && (
                        <div style={{ flex: 1, background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.15)', borderRadius: 10, padding: '10px', fontSize: 12, color: '#16a34a', textAlign: 'center', fontWeight: 700 }}>✅ Cash received</div>
                      )}
                      {a.fromType !== 'distributor' && a.status === 'paid' && (
                        <div style={{ flex: 1, background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.15)', borderRadius: 10, padding: '10px', fontSize: 12, color: '#16a34a', textAlign: 'center', fontWeight: 700 }}>
                          ✅ Fully paid {a.paidAt ? new Date(a.paidAt).toLocaleDateString('en-IN') : ''}
                        </div>
                      )}
                      {a.fromType === 'distributor' && a.status === 'sent' && (
                        <div style={{ flex: 1, background: 'rgba(8,145,178,0.08)', border: '1px solid rgba(8,145,178,0.15)', borderRadius: 10, padding: '10px', fontSize: 12, color: '#0891b2', textAlign: 'center', fontWeight: 700 }}>✅ Stock transferred</div>
                      )}
                    </div>
                  )}
                  {!isAdmin && (a.status === 'pending' || a.status === 'overdue') && (
                    <div style={{ background: 'rgba(217,119,6,0.08)', border: '1px solid rgba(217,119,6,0.15)', borderRadius: 10, padding: '8px 12px', fontSize: 11, color: '#d97706' }}>
                      ⏳ Waiting for admin to dispatch
                    </div>
                  )}
                </div>
              )
            })}

            {/* Indent cards */}
            {filterSource !== 'company' && (
              <>
                {filteredIndents.length === 0 && filterSource === 'distributor' && (
                  <div style={{ textAlign: 'center', padding: 40, color: '#475569' }}>
                    <div style={{ fontSize: 36, marginBottom: 10 }}>🔖</div>
                    <div style={{ fontWeight: 700 }}>No pending indents</div>
                  </div>
                )}
                {filteredIndents.map(indent => {
                  const dist = parties.find(p => p.id === indent.distributorId)
                  const distStock = dist?.stock?.[indent.productId] || 0
                  const sendQtyVal = parseInt(indentSendQty[indent.id!] ?? String(indent.requestedPackets))
                  const neededQty = isNaN(sendQtyVal) ? indent.requestedPackets : sendQtyVal
                  return (
                    <div key={indent.id} style={{ background: t.card, borderRadius: 16, padding: 16, border: '1.5px solid rgba(8,145,178,0.3)' }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 12 }}>
                        <div style={{ fontSize: 20, flexShrink: 0 }}>🔖</div>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                            <span style={{ fontSize: 10, fontWeight: 700, background: 'rgba(8,145,178,0.15)', color: '#0891b2', padding: '2px 7px', borderRadius: 99 }}>INDENT</span>
                            <span style={{ fontSize: 10, fontWeight: 700, background: 'rgba(217,119,6,0.12)', color: '#d97706', padding: '2px 7px', borderRadius: 99 }}>
                              {indent.status === 'partial' ? '🔄 Partial' : '⏳ Pending'}
                            </span>
                          </div>
                          <div style={{ fontWeight: 800, fontSize: 15, color: t.text }}>🏪 {indent.retailerName}</div>
                          <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>🚚 {indent.distributorName} · {indent.productName}</div>
                          <div style={{ fontSize: 11, color: '#64748b' }}>by {indent.requestedByName} · {new Date(indent.requestedAt).toLocaleDateString('en-IN')}</div>
                        </div>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
                        <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 10, padding: '10px', textAlign: 'center' }}>
                          <div style={{ fontSize: 16, fontWeight: 900, color: '#e2e8f0' }}>{indent.requestedPackets} pkts</div>
                          <div style={{ fontSize: 9, color: '#64748b', marginTop: 2 }}>requested</div>
                        </div>
                        <div style={{ background: distStock > 0 ? 'rgba(22,163,74,0.08)' : 'rgba(220,38,38,0.08)', border: `1px solid ${distStock > 0 ? 'rgba(22,163,74,0.2)' : 'rgba(220,38,38,0.3)'}`, borderRadius: 10, padding: '10px', textAlign: 'center' }}>
                          <div style={{ fontSize: 16, fontWeight: 900, color: distStock > 0 ? '#16a34a' : '#dc2626' }}>{distStock} pkts</div>
                          <div style={{ fontSize: 9, color: '#64748b', marginTop: 2 }}>dist. stock</div>
                        </div>
                      </div>
                      {distStock < neededQty && (
                        <div style={{ background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', borderRadius: 10, padding: '8px 12px', marginBottom: 10, fontSize: 12, color: '#dc2626' }}>
                          ⚠️ Distributor has {distStock} pkts — needs {neededQty} pkts to fulfill
                        </div>
                      )}
                      {isAdmin && (
                        <>
                          <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6 }}>Quantity to send (max: {indent.requestedPackets} pkts)</div>
                          {indentErrors[indent.id!] && (
                            <div style={{ fontSize: 11, color: '#dc2626', marginBottom: 6 }}>⚠️ {indentErrors[indent.id!]}</div>
                          )}
                          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                            <input
                              type="number"
                              value={indentSendQty[indent.id!] ?? String(indent.requestedPackets)}
                              onChange={e => {
                                const v = e.target.value; const n = parseInt(v)
                                setIndentSendQty(prev => ({ ...prev, [indent.id!]: v }))
                                if (!isNaN(n) && n > indent.requestedPackets) {
                                  setIndentErrors(prev => ({ ...prev, [indent.id!]: `Max ${indent.requestedPackets} pkts` }))
                                } else { setIndentErrors(prev => { const nx = { ...prev }; delete nx[indent.id!]; return nx }) }
                              }}
                              max={indent.requestedPackets}
                              style={{ flex: 1, background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)', border: `1.5px solid ${indentErrors[indent.id!] ? '#dc2626' : isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.12)'}`, borderRadius: 10, padding: '11px 14px', fontSize: 16, fontWeight: 700, color: t.text, outline: 'none' }}
                            />
                            <button
                              onClick={() => handleSendIndent(indent)}
                              disabled={sendingIndent === indent.id || distStock < 1}
                              style={{ background: sendingIndent === indent.id || distStock < 1 ? '#475569' : 'linear-gradient(135deg,#0e4f7a,#0891b2)', color: '#fff', border: 'none', borderRadius: 10, padding: '11px 20px', fontSize: 13, fontWeight: 800, whiteSpace: 'nowrap', opacity: distStock < 1 ? 0.6 : 1 }}>
                              {sendingIndent === indent.id ? '...' : '📦 Send'}
                            </button>
                          </div>
                          <button onClick={() => handleCancelIndent(indent)} disabled={sendingIndent === indent.id}
                            style={{ width: '100%', background: 'rgba(220,38,38,0.08)', color: '#dc2626', border: '1px solid rgba(220,38,38,0.2)', borderRadius: 10, padding: '8px', fontSize: 12, fontWeight: 700 }}>
                            🚫 Cancel Indent
                          </button>
                        </>
                      )}
                    </div>
                  )
                })}
              </>
            )}
          </>
        )}

        {/* ── ADD TAB ────────────────────────────────────────────────────── */}
        {tab === 'add' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Source selector */}
            <div>
              <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8, letterSpacing: 1, textTransform: 'uppercase' }}>Allocate From</div>
              <div style={{ display: 'flex', gap: 8 }}>
                {([
                  { val: 'company' as const,     label: '🏭 Company Stock' },
                  { val: 'distributor' as const, label: '🚚 Distributor Stock' },
                ]).map(opt => (
                  <button key={opt.val}
                    onClick={() => setForm({ ...emptyForm, fromType: opt.val })}
                    style={{
                      flex: 1,
                      background: form.fromType === opt.val ? 'rgba(22,163,74,0.15)' : isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
                      color: form.fromType === opt.val ? '#16a34a' : '#64748b',
                      border: `1.5px solid ${form.fromType === opt.val ? '#16a34a' : isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)'}`,
                      borderRadius: 12, padding: '12px', fontSize: 13, fontWeight: 800,
                    }}>
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Distributor source selector */}
            {form.fromType === 'distributor' && (
              <Field label="Source Distributor" error={errors.fromId}>
                <CustomSelect
                  value={form.fromId}
                  onChange={v => setForm({ ...form, fromId: v, partyId: '' })}
                  placeholder="Select distributor..."
                  options={parties.filter(p => p.type === 'distributor').map(p => ({
                    value: p.id!, label: `🚚 ${p.name}`, sub: p.place || p.address,
                  }))}
                  error={!!errors.fromId}
                />
              </Field>
            )}

            {/* Stock availability display */}
            {form.fromType === 'company' ? (
              (() => {
                const pStk = form.productId ? config.productStock?.[form.productId] : null
                const prodAvail = pStk ? pStk.total - pStk.locked : 0
                const productSelected = !!form.productId
                return (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <div style={{ flex: 1, background: !productSelected ? 'rgba(100,116,139,0.08)' : prodAvail > 0 ? 'rgba(22,163,74,0.08)' : 'rgba(220,38,38,0.08)', border: `1px solid ${!productSelected ? 'rgba(100,116,139,0.2)' : prodAvail > 0 ? 'rgba(22,163,74,0.2)' : 'rgba(220,38,38,0.3)'}`, borderRadius: 12, padding: '12px 14px' }}>
                      <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Company Available</div>
                      {!productSelected
                        ? <div style={{ fontSize: 13, color: '#64748b' }}>Select product first</div>
                        : <>
                          <div style={{ fontSize: 20, fontWeight: 900, color: prodAvail > 0 ? '#16a34a' : '#dc2626' }}>{toDisplay(prodAvail, config.packetsPerCarton)}</div>
                          {prodAvail === 0 && <div style={{ fontSize: 11, color: '#dc2626', marginTop: 2 }}>No stock — set stock in Stock Management</div>}
                        </>
                      }
                    </div>
                    {productSelected && form.packets && parseInt(form.packets) > 0 && (() => {
                      const after = prodAvail - toPackets(form.packets)
                      return (
                        <div style={{ flex: 1, background: after >= 0 ? 'rgba(8,145,178,0.08)' : 'rgba(220,38,38,0.1)', border: `1px solid ${after >= 0 ? 'rgba(8,145,178,0.2)' : 'rgba(220,38,38,0.3)'}`, borderRadius: 12, padding: '12px 14px' }}>
                          <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>After This</div>
                          <div style={{ fontSize: 20, fontWeight: 900, color: after >= 0 ? '#0891b2' : '#dc2626' }}>{toDisplay(Math.max(0, after), config.packetsPerCarton)}</div>
                          {after < 0 && <div style={{ fontSize: 11, color: '#dc2626', marginTop: 2 }}>Insufficient!</div>}
                        </div>
                      )
                    })()}
                  </div>
                )
              })()
            ) : (
              <div style={{ display: 'flex', gap: 8 }}>
                {(() => {
                  const distStock = selectedFromDist && form.productId ? (selectedFromDist.stock?.[form.productId] || 0) : null
                  return (
                    <>
                      <div style={{ flex: 1, background: distStock !== null && distStock > 0 ? 'rgba(22,163,74,0.08)' : 'rgba(100,116,139,0.08)', border: `1px solid ${distStock !== null && distStock > 0 ? 'rgba(22,163,74,0.2)' : 'rgba(100,116,139,0.2)'}`, borderRadius: 12, padding: '12px 14px' }}>
                        <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Distributor Stock</div>
                        {distStock === null
                          ? <div style={{ fontSize: 12, color: '#64748b' }}>Select distributor & product</div>
                          : <div style={{ fontSize: 20, fontWeight: 900, color: distStock > 0 ? '#16a34a' : '#dc2626' }}>{distStock} pkts</div>
                        }
                      </div>
                      {distStock !== null && form.packets && parseInt(form.packets) > 0 && (() => {
                        const after = distStock - toPackets(form.packets)
                        return (
                          <div style={{ flex: 1, background: after >= 0 ? 'rgba(8,145,178,0.08)' : 'rgba(220,38,38,0.1)', border: `1px solid ${after >= 0 ? 'rgba(8,145,178,0.2)' : 'rgba(220,38,38,0.3)'}`, borderRadius: 12, padding: '12px 14px' }}>
                            <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>After This</div>
                            <div style={{ fontSize: 20, fontWeight: 900, color: after >= 0 ? '#0891b2' : '#dc2626' }}>{Math.max(0, after)} pkts</div>
                            {after < 0 && <div style={{ fontSize: 11, color: '#dc2626', marginTop: 2 }}>Insufficient!</div>}
                          </div>
                        )
                      })()}
                    </>
                  )
                })()}
              </div>
            )}

            {form.fromType === 'company' && blockedRetailersCount > 0 && (
              <div style={{ background: 'rgba(217,119,6,0.08)', border: '1px solid rgba(217,119,6,0.2)', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: '#d97706' }}>
                ⚠️ {blockedRetailersCount} retailer{blockedRetailersCount > 1 ? 's' : ''} under distributors are hidden — use "Distributor Stock" to allocate to them.
              </div>
            )}

            <Field label={form.fromType === 'company' ? 'Distributor / Retailer' : 'Retailer'} error={errors.partyId}>
              <CustomSelect value={form.partyId} onChange={v => setForm({ ...form, partyId: v })}
                placeholder={form.fromType === 'distributor' && !form.fromId ? 'Select a source distributor first' : 'Select...'}
                options={addTabPartyOptions} error={!!errors.partyId} />
            </Field>

            {selectedParty && (
              <div style={{ background: 'rgba(8,145,178,0.08)', border: '1px solid rgba(8,145,178,0.15)', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: '#7dd3fc' }}>
                📍 {selectedParty.address} • 📞 {selectedParty.phone}
              </div>
            )}

            <Field label="Product" error={errors.productId}>
              {products.length === 0 ? (
                <div style={{ fontSize: 13, color: '#64748b', padding: '10px 0' }}>No products configured yet</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {products.map(p => (
                    <button key={p.id} onClick={() => setForm(f => ({ ...f, productId: p.id!, pricePerPacket: String(p.defaultPricePerUnit || '') }))}
                      style={{
                        background: form.productId === p.id
                          ? isDark ? 'rgba(22,163,74,0.15)' : 'rgba(22,163,74,0.1)'
                          : isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
                        border: `1.5px solid ${form.productId === p.id ? '#16a34a' : isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.1)'}`,
                        borderRadius: 12, padding: '12px 16px',
                        display: 'flex', alignItems: 'center', gap: 10,
                        color: form.productId === p.id ? '#6ee7b7' : isDark ? '#94a3b8' : '#64748b',
                        textAlign: 'left', cursor: 'pointer', width: '100%',
                      }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 700, fontSize: 14, color: form.productId === p.id ? (isDark ? '#6ee7b7' : '#16a34a') : t.text }}>{p.name}</div>
                        <div style={{ fontSize: 11, marginTop: 2, color: t.text2 }}>
                          {p.unitsPerCarton} {p.unitLabel}/carton · ₹{p.defaultPricePerUnit}/{p.unitLabel}
                        </div>
                      </div>
                      {form.productId === p.id && <span style={{ fontSize: 16, color: '#16a34a' }}>✓</span>}
                    </button>
                  ))}
                </div>
              )}
            </Field>

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
                style={inputStyle(!!errors.packets, isDark)} />
              {form.packets && parseInt(form.packets) > 0 && (
                <div style={{ marginTop: 6, fontSize: 12, color: '#6ee7b7', fontWeight: 600 }}>
                  = {toDisplay(toPackets(form.packets), config.packetsPerCarton)}
                  {form.pricePerPacket && parseFloat(form.pricePerPacket) > 0 && ` • ₹${(toPackets(form.packets) * parseFloat(form.pricePerPacket)).toLocaleString()}`}
                </div>
              )}
            </Field>

            {form.fromType === 'company' && (
              <>
                <Field label="Selling Price Per Single Packet (₹)" hint="Price you charge them per single packet" error={errors.pricePerPacket}>
                  <input type="number" value={form.pricePerPacket} onChange={e => setForm({ ...form, pricePerPacket: e.target.value })}
                    placeholder="e.g. 45" style={inputStyle(!!errors.pricePerPacket, isDark)} />
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
              </>
            )}

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
          const statusMatch = (p: Party) => networkStatusFilter === 'all' || (p as any).status === networkStatusFilter
          const distributors = parties.filter(p => p.type === 'distributor' && statusMatch(p))
          const independents = parties.filter(p => p.type === 'retailer' && !(p as any).underDistributorId && statusMatch(p))

          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Party status filter chips */}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {([
                  { val: 'all',      label: 'All' },
                  { val: 'active',   label: '🟢 Active' },
                  { val: 'prospect', label: '🟡 Prospect' },
                  { val: 'inactive', label: '⛔ Inactive' },
                ] as const).map(s => (
                  <button key={s.val} onClick={() => setNetworkStatusFilter(s.val)}
                    style={{
                      background: networkStatusFilter === s.val
                        ? s.val === 'all' ? (isDark ? 'rgba(22,163,74,0.2)' : 'rgba(22,163,74,0.12)') : s.val === 'active' ? 'rgba(22,163,74,0.15)' : s.val === 'prospect' ? 'rgba(217,119,6,0.15)' : 'rgba(220,38,38,0.12)'
                        : isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)',
                      color: networkStatusFilter === s.val
                        ? s.val === 'all' ? '#16a34a' : s.val === 'active' ? '#16a34a' : s.val === 'prospect' ? '#d97706' : '#dc2626'
                        : '#64748b',
                      border: `1px solid ${networkStatusFilter === s.val ? (s.val === 'active' ? '#16a34a' : s.val === 'prospect' ? '#d97706' : s.val === 'inactive' ? '#dc2626' : '#16a34a') : isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)'}`,
                      borderRadius: 20, padding: '5px 12px', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap',
                    }}>
                    {s.label}
                  </button>
                ))}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ fontSize: 11, color: '#64748b' }}>
                  {distributors.length} distributor{distributors.length !== 1 ? 's' : ''} · {parties.filter(p => p.type === 'retailer').length} retailer{parties.filter(p => p.type === 'retailer').length !== 1 ? 's' : ''}
                </div>
                {(() => {
                  const pending = indents.filter(i => i.status === 'requested' || i.status === 'partial').length
                  return pending > 0 ? (
                    <div style={{ background: 'rgba(217,119,6,0.15)', color: '#d97706', fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99 }}>
                      {pending} indent{pending !== 1 ? 's' : ''} pending
                    </div>
                  ) : null
                })()}
              </div>

              {distributors.length === 0 && (
                <div style={{ textAlign: 'center', padding: 32, color: '#475569' }}>
                  <div style={{ fontSize: 32, marginBottom: 10 }}>🚚</div>
                  <div style={{ fontWeight: 700 }}>No distributors yet</div>
                </div>
              )}

              {distributors.map(dist => {
                const receivedAllocs = allocations.filter(a => a.partyId === dist.id) // company → this distributor
                const outboundAllocs = allocations.filter(a => a.fromId === dist.id && a.fromType === 'distributor') // this distributor → retailers
                const receivedPackets = receivedAllocs.filter(a => a.status !== 'cancelled').reduce((s, a) => s + a.packets, 0)
                const sentToRetailers = outboundAllocs.filter(a => a.status === 'sent' || a.status === 'paid').reduce((s, a) => s + a.packets, 0)
                const pendingToRetailers = outboundAllocs.filter(a => a.status === 'pending' || a.status === 'overdue').reduce((s, a) => s + a.packets, 0)
                const creditDue = receivedAllocs.filter(a => a.status === 'sent' && a.paymentType === 'credit').reduce((s, a) => s + a.totalAmount, 0)
                const subRetailers = parties.filter(p => p.type === 'retailer' && (p as any).underDistributorId === dist.id)

                return (
                  <div key={dist.id} style={{ background: t.card, borderRadius: 16, border: '1.5px solid rgba(8,145,178,0.2)', overflow: 'hidden' }}>
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
                          { label: 'From Company', val: toDisplay(receivedPackets, config.packetsPerCarton), color: '#0891b2' },
                          { label: 'To Retailers', val: sentToRetailers > 0 ? toDisplay(sentToRetailers, config.packetsPerCarton) : pendingToRetailers > 0 ? `${toDisplay(pendingToRetailers, config.packetsPerCarton)} pending` : '—', color: sentToRetailers > 0 ? '#16a34a' : '#d97706' },
                          { label: 'Credit Due', val: creditDue > 0 ? `₹${(creditDue / 1000).toFixed(0)}k` : '—', color: '#7c3aed' },
                        ].map(s => (
                          <div key={s.label} style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 8, padding: '7px', textAlign: 'center' }}>
                            <div style={{ fontSize: 12, fontWeight: 900, color: s.color }}>{s.val}</div>
                            <div style={{ fontSize: 9, color: '#64748b', marginTop: 1 }}>{s.label}</div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Current stock for distributor */}
                    {(() => {
                      const stockEntries = products.length > 0
                        ? products.map(p => ({ id: p.id!, name: p.name, qty: dist.stock?.[p.id!] ?? 0 })).filter(e => e.qty > 0)
                        : Object.entries(dist.stock || {}).filter(([, v]) => (v as number) > 0).map(([id, qty]) => ({ id, name: id, qty: qty as number }))
                      if (stockEntries.length === 0) return null
                      return (
                        <div style={{ padding: '10px 16px 12px', borderTop: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}` }}>
                          <div style={{ fontSize: 10, color: '#6ee7b7', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 }}>📦 In Stock</div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                            {stockEntries.map(e => (
                              <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span style={{ fontSize: 12, color: t.text2 }}>{e.name}</span>
                                <span style={{ fontSize: 12, fontWeight: 800, color: '#6ee7b7' }}>{toDisplay(e.qty, config.packetsPerCarton)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )
                    })()}

                    {/* Pending Indents for this distributor */}
                    {(() => {
                      const distIndents = indents.filter(i => i.distributorId === dist.id && (i.status === 'requested' || i.status === 'partial'))
                      if (distIndents.length === 0) return null
                      return (
                        <div style={{ padding: '12px 16px', borderTop: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}` }}>
                          <div style={{ fontSize: 10, color: '#d97706', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10 }}>
                            Pending Indents ({distIndents.length})
                          </div>
                          {distIndents.map(indent => {
                            const distParty = parties.find(p => p.id === indent.distributorId)
                            const distStockN = distParty?.stock?.[indent.productId] || 0
                            return (
                            <div key={indent.id} style={{ background: isDark ? 'rgba(217,119,6,0.07)' : 'rgba(217,119,6,0.06)', border: '1px solid rgba(217,119,6,0.2)', borderRadius: 10, padding: '10px 12px', marginBottom: 8 }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                                <div>
                                  <div style={{ fontWeight: 700, fontSize: 13, color: t.text }}>{indent.retailerName}</div>
                                  <div style={{ fontSize: 11, color: t.text2, marginTop: 1 }}>{indent.productName}</div>
                                </div>
                                <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 99, flexShrink: 0, background: indent.status === 'requested' ? 'rgba(217,119,6,0.15)' : 'rgba(8,145,178,0.15)', color: indent.status === 'requested' ? '#d97706' : '#0891b2' }}>
                                  {indent.status === 'requested' ? 'Pending' : 'Partial'}
                                </span>
                              </div>
                              <div style={{ fontSize: 11, color: t.text2, marginBottom: 6, display: 'flex', gap: 10 }}>
                                <span>Requested: <strong style={{ color: t.text }}>{indent.requestedPackets} pkts</strong></span>
                                <span style={{ color: distStockN > 0 ? '#16a34a' : '#dc2626', fontWeight: 700 }}>Dist: {distStockN} pkts</span>
                              </div>
                              {indentErrors[indent.id!] && <div style={{ fontSize: 11, color: '#dc2626', marginBottom: 6 }}>⚠️ {indentErrors[indent.id!]}</div>}
                              <div style={{ display: 'flex', gap: 6 }}>
                                <input
                                  type="number"
                                  value={indentSendQty[indent.id!] ?? String(indent.requestedPackets)}
                                  onChange={e => {
                                    const v = e.target.value; const n = parseInt(v)
                                    setIndentSendQty(prev => ({ ...prev, [indent.id!]: v }))
                                    if (!isNaN(n) && n > indent.requestedPackets) {
                                      setIndentErrors(prev => ({ ...prev, [indent.id!]: `Max ${indent.requestedPackets} pkts` }))
                                    } else { setIndentErrors(prev => { const nx = { ...prev }; delete nx[indent.id!]; return nx }) }
                                  }}
                                  max={indent.requestedPackets}
                                  style={{ flex: 1, background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)', border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`, borderRadius: 8, padding: '8px 10px', fontSize: 13, color: t.text, outline: 'none', minWidth: 0 }}
                                />
                                <button
                                  onClick={() => handleSendIndent(indent)}
                                  disabled={sendingIndent === indent.id || distStockN < 1}
                                  style={{ background: distStockN < 1 ? '#475569' : 'rgba(8,145,178,0.15)', color: '#0891b2', border: '1px solid rgba(8,145,178,0.3)', borderRadius: 8, padding: '8px 12px', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap', opacity: distStockN < 1 ? 0.5 : 1 }}>
                                  {sendingIndent === indent.id ? '...' : '📦 Send'}
                                </button>
                                <button
                                  onClick={() => handleCancelIndent(indent)}
                                  disabled={sendingIndent === indent.id}
                                  style={{ background: 'rgba(220,38,38,0.1)', color: '#dc2626', border: '1px solid rgba(220,38,38,0.2)', borderRadius: 8, padding: '8px 10px', fontSize: 13, fontWeight: 700 }}>
                                  ✕
                                </button>
                              </div>
                            </div>
                            )
                          })}
                        </div>
                      )
                    })()}

                    {/* Retailers under this distributor */}
                    <div style={{ padding: '10px 16px 14px' }}>
                      <div style={{ fontSize: 10, color: '#64748b', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>
                        Retailers ({subRetailers.length})
                      </div>
                      {subRetailers.length === 0 ? (
                        <div style={{ fontSize: 12, color: '#334155', fontStyle: 'italic' }}>No retailers linked yet</div>
                      ) : subRetailers.map((r, i) => {
                        const rAllocs = allocations.filter(a => a.fromId === dist.id && a.fromType === 'distributor' && a.partyId === r.id)
                        const rSentAllocs = rAllocs.filter(a => a.status === 'sent' || a.status === 'paid')
                        const rPendingAllocs = rAllocs.filter(a => a.status === 'pending')
                        const rSentPackets = rSentAllocs.reduce((s, a) => s + a.packets, 0)
                        const rPendingPackets = rPendingAllocs.reduce((s, a) => s + a.packets, 0)
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
                              {rSentPackets > 0 && <div style={{ fontSize: 10, color: '#0891b2', marginTop: 1 }}>{rSentPackets} pkts sent</div>}
                              {rPendingPackets > 0 && <div style={{ fontSize: 10, color: '#d97706', marginTop: 1 }}>{rPendingPackets} pkts pending</div>}
                            </div>
                          </div>
                          {/* Recent allocations from distributor to this retailer */}
                          {rAllocs.slice(0, 3).map((a) => (
                            <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', background: 'rgba(255,255,255,0.03)', borderRadius: 6, padding: '5px 8px', marginTop: 5, fontSize: 11 }}>
                              <span style={{ color: '#64748b' }}>{a.sentAt ? new Date(a.sentAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : a.plannedDate} — {a.packets} pkts{a.productName ? ` · ${a.productName}` : ''}</span>
                              <span style={{ color: a.status === 'sent' || a.status === 'paid' ? '#16a34a' : '#d97706', fontWeight: 700 }}>
                                {a.status === 'sent' || a.status === 'paid' ? '✅ Sent' : '⏳ Pending'}
                              </span>
                            </div>
                          ))}
                          {(() => {
                            const rStockEntries = Object.entries(r.stock || {}).filter(([, qty]) => (qty as number) > 0)
                            if (rStockEntries.length === 0) return null
                            return (
                              <div style={{ background: isDark ? 'rgba(22,163,74,0.05)' : 'rgba(22,163,74,0.04)', border: '1px solid rgba(22,163,74,0.12)', borderRadius: 6, padding: '6px 8px', marginTop: 6 }}>
                                <div style={{ fontSize: 9, color: '#6ee7b7', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 3 }}>In Stock</div>
                                {rStockEntries.map(([pid, qty]) => {
                                  const prod = products.find(p => p.id === pid)
                                  return (
                                    <div key={pid} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                                      <span style={{ color: t.text2 }}>{prod?.name || pid}</span>
                                      <span style={{ fontWeight: 700, color: '#6ee7b7' }}>{toDisplay(qty as number, config.packetsPerCarton)}</span>
                                    </div>
                                  )
                                })}
                              </div>
                            )
                          })()}
                        </div>
                        )
                      })}
                    </div>
                    {/* History button — admin */}
                    {isAdmin && (
                      <div style={{ padding: '10px 16px 14px', borderTop: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}` }}>
                        <button onClick={() => setHistoryPartyId(dist.id!)}
                          style={{ width: '100%', background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)', border: `1px solid ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.1)'}`, borderRadius: 10, padding: '10px', fontSize: 13, fontWeight: 700, color: t.text2, cursor: 'pointer' }}>
                          View Full History →
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}

              {/* Independent retailers */}
              {independents.length > 0 && (
                <div style={{ background: t.card, borderRadius: 16, border: '1.5px solid rgba(22,163,74,0.15)', overflow: 'hidden' }}>
                  <div style={{ background: 'rgba(22,163,74,0.06)', padding: '12px 16px', fontSize: 12, color: '#6ee7b7', fontWeight: 700 }}>
                    🏪 Independent Retailers ({independents.length})
                  </div>
                  <div style={{ padding: '10px 16px 14px', display: 'flex', flexDirection: 'column', gap: 0 }}>
                    {independents.map((r, i) => {
                      const rAllocs = allocations.filter(a => a.partyId === r.id)
                      const rCredit = rAllocs.filter(a => a.status === 'sent' && a.paymentType === 'credit').reduce((s, a) => s + a.totalAmount, 0)
                      const rAllocated = rAllocs.filter(a => a.status !== 'cancelled').reduce((s, a) => s + a.packets, 0)
                      return (
                        <div key={r.id} style={{ paddingTop: i > 0 ? 10 : 0, marginTop: i > 0 ? 10 : 0, borderTop: i > 0 ? `1px solid ${isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.06)'}` : 'none' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span style={{ fontSize: 16 }}>🏪</span>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: 13, fontWeight: 700, color: t.text }}>{r.name}</div>
                              <div style={{ fontSize: 11, color: '#64748b' }}>{r.place || r.address}</div>
                            </div>
                            <div style={{ textAlign: 'right' }}>
                              <div style={{ fontSize: 10, color: (r as any).status === 'active' ? '#16a34a' : '#d97706', fontWeight: 700 }}>
                                {(r as any).status === 'active' ? '🟢 Active' : '🟡 Prospect'}
                              </div>
                              {rAllocated > 0 && <div style={{ fontSize: 10, color: '#0891b2', marginTop: 1 }}>{toDisplay(rAllocated, config.packetsPerCarton)} allocated</div>}
                              {rCredit > 0 && <div style={{ fontSize: 10, color: '#7c3aed', marginTop: 1 }}>₹{rCredit.toLocaleString()} due</div>}
                            </div>
                          </div>
                          {(() => {
                            const rStockEntries = Object.entries(r.stock || {}).filter(([, qty]) => (qty as number) > 0)
                            if (rStockEntries.length === 0) return null
                            return (
                              <div style={{ background: isDark ? 'rgba(22,163,74,0.05)' : 'rgba(22,163,74,0.04)', border: '1px solid rgba(22,163,74,0.12)', borderRadius: 6, padding: '6px 8px', marginTop: 6 }}>
                                <div style={{ fontSize: 9, color: '#6ee7b7', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 3 }}>In Stock</div>
                                {rStockEntries.map(([pid, qty]) => {
                                  const prod = products.find(p => p.id === pid)
                                  return (
                                    <div key={pid} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                                      <span style={{ color: t.text2 }}>{prod?.name || pid}</span>
                                      <span style={{ fontWeight: 700, color: '#6ee7b7' }}>{toDisplay(qty as number, config.packetsPerCarton)}</span>
                                    </div>
                                  )
                                })}
                              </div>
                            )
                          })()}
                          {isAdmin && (
                            <button onClick={() => setHistoryPartyId(r.id!)}
                              style={{ marginTop: 8, width: '100%', background: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)', border: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)'}`, borderRadius: 8, padding: '7px', fontSize: 12, fontWeight: 700, color: t.text2, cursor: 'pointer' }}>
                              History →
                            </button>
                          )}
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
      {modal}
    </div>
  )
}
