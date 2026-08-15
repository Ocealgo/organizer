import { useState, useEffect } from 'react'
import { collection, addDoc, onSnapshot, updateDoc, doc, runTransaction, increment } from 'firebase/firestore'
import { db } from '../../firebase'
import { UnifiedAllocation, Party, PaymentType, AllocationStatus, Product, RetailerIndent, IndentStatus, StockConfig } from '../../types'
import { useAuth } from '../../context/AuthContext'
import { useTheme } from '../../context/ThemeContext'
import { useStockConfig, updateStockConfig, toDisplay } from '../../hooks/useFirebase'
import CustomSelect from '../../components/CustomSelect'
import DateInput from '../../components/DateInput'
import { useConfirm } from '../../hooks/useConfirm'
import { localDateStr, localMonthStr, localDateOffset } from '../../utils/date'
import { ledgerInTransaction } from '../../data/stockLedger'
import {
  PageHeader, TabBar, StatGrid, StatCard, Section, EmptyState,
  Field, ChipGroup, Note, GhostButton, PrimaryButton, inputStyle,
} from '../../components/ui'

interface Props { onBack: () => void; parties: Party[]; isAdmin?: boolean; highlightId?: string; salesRepOnly?: boolean }

const STATUS_LABEL: Record<AllocationStatus, string> = {
  pending: 'Pending', sent: 'Sent', paid: 'Paid', overdue: 'Overdue', cancelled: 'Cancelled',
}

/** Only two tones carry meaning here: something needs action, or it does not. */
const NEEDS_ACTION: AllocationStatus[] = ['pending', 'overdue']

export default function AllocationManager({ onBack, parties, isAdmin, highlightId, salesRepOnly }: Props) {
  const { appUser } = useAuth()
  const { t } = useTheme()
  const { config } = useStockConfig()
  const { modal, showConfirm, showDanger, showAlert } = useConfirm()
  const [allocations, setAllocations] = useState<UnifiedAllocation[]>([])
  const [stockMovements, setStockMovements] = useState<any[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [indents, setIndents] = useState<RetailerIndent[]>([])

  useEffect(() => {
    if (!highlightId || allocations.length === 0) return
    const base = salesRepOnly ? allocations.filter(a => a.createdBy === appUser?.uid) : allocations
    const idx = base.findIndex(a => a.id === highlightId)
    if (idx >= 0) setAllocPage(Math.floor(idx / ALLOC_PAGE_SIZE))
    setTimeout(() => {
      const el = document.getElementById(`alloc-${highlightId}`)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 300)
  }, [highlightId, allocations, salesRepOnly, appUser])
  const [tab, setTab] = useState<'list' | 'add' | 'network'>('list')
  const [saving, setSaving] = useState(false)
  const [acting, setActing] = useState<string | null>(null)
  const [dispatchDateAlloc, setDispatchDateAlloc] = useState<UnifiedAllocation | null>(null)
  const [dispatchDate, setDispatchDate] = useState(localDateStr())
  const [unit, setUnit] = useState<'packets' | 'cartons'>('packets')
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Allocation filters
  const [filterSource, setFilterSource] = useState<'all' | 'company' | 'distributor'>('all')
  const [filterStatus, setFilterStatus] = useState<'all' | AllocationStatus>('all')
  const [filterPayment, setFilterPayment] = useState<'all' | PaymentType>('all')
  const [filterParty, setFilterParty] = useState<string>('all')
  const [filterDistributor, setFilterDistributor] = useState<string>('all')
  const [allocPage, setAllocPage] = useState(0)
  const ALLOC_PAGE_SIZE = 5
  useEffect(() => { setAllocPage(0) }, [filterSource, filterStatus, filterPayment, filterParty, filterDistributor])
  // Network tab party status filter
  const [networkStatusFilter, setNetworkStatusFilter] = useState<'all' | 'active' | 'prospect' | 'inactive'>('all')
  const [networkPartyFilter, setNetworkPartyFilter] = useState<string>('')
  const [expandedRetailAllocs, setExpandedRetailAllocs] = useState<Set<string>>(new Set())
  const [historyPartyId, setHistoryPartyId] = useState<string | null>(null)

  // Allocation edit state
  const [allocEdit, setAllocEdit] = useState<{ id: string; packets: string; pricePerPacket: string; paymentType: PaymentType; plannedDate: string; creditDueDate: string } | null>(null)

  // Indent send state
  const [indentSendQty, setIndentSendQty] = useState<Record<string, string>>({})
  const [indentErrors, setIndentErrors] = useState<Record<string, string>>({})
  const [sendingIndent, setSendingIndent] = useState<string | null>(null)

  const emptyForm = {
    fromType: 'company' as 'company' | 'distributor',
    fromId: '',   // distributorId when fromType='distributor'
    partyId: '', productId: '', packets: '', pricePerPacket: '',
    paymentType: 'credit' as PaymentType,
    plannedDate: localDateOffset(1),
    creditDueDate: localDateOffset(30),
    notes: '',
  }
  const [form, setForm] = useState(emptyForm)

  const today = localDateStr()
  const available = config.total - config.locked

  useEffect(() => {
    return onSnapshot(collection(db, 'allocations_v2'), snap => {
      const raw = snap.docs.map(d => ({ id: d.id, ...d.data() } as UnifiedAllocation))
      // Compute overdue status client-side
      const now = today
      const processed = raw.map(a => {
        // Planned-date overdue: pending company allocation past its send date
        if (a.status === 'pending' && a.fromType !== 'distributor' && a.plannedDate && a.plannedDate < now)
          return { ...a, status: 'overdue' as AllocationStatus }
        // Credit-due overdue: sent credit allocation past its payment due date
        if (a.status === 'sent' && a.paymentType === 'credit' && (a as any).creditDueDate && (a as any).creditDueDate < now)
          return { ...a, status: 'overdue' as AllocationStatus }
        return a
      })
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
      const allocRef = await addDoc(collection(db, 'allocations_v2'), {
        fromType: form.fromType,
        fromId: isCompanyOrigin ? 'company' : form.fromId,
        fromName: isCompanyOrigin ? 'Ocealgo' : (fromDist?.name || ''),
        partyId: form.partyId, partyName: party.name, partyType: party.type,
        productId: form.productId, productName: product?.name || '',
        packets, cartons, pricePerPacket: price, totalAmount: packets * price,
        paymentType: form.paymentType, plannedDate,
        ...(form.paymentType === 'credit' && isCompanyOrigin ? { creditDueDate: form.creditDueDate } : {}),
        status: 'pending' as AllocationStatus, notes: form.notes,
        createdBy: appUser!.uid, createdByName: appUser!.name,
        createdAt: Date.now(), month: plannedDate.slice(0, 7),
        lockedAtCreation: isCompanyOrigin,
      })
      await addDoc(collection(db, 'alerts'), {
        type: 'new_allocation',
        message: `New allocation: ${toDisplay(packets, config.packetsPerCarton)} of ${product?.name || 'product'} to ${party.name}, from ${isCompanyOrigin ? 'Ocealgo' : fromDist?.name || 'a distributor'}`,
        relatedId: allocRef.id, read: false, createdAt: Date.now(),
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
      setIndentErrors(prev => ({ ...prev, [indent.id!]: 'Enter a quantity above zero.' })); return
    }
    if (qty > indent.requestedPackets) {
      setIndentErrors(prev => ({ ...prev, [indent.id!]: `They asked for ${indent.requestedPackets} packets — you cannot send more.` })); return
    }
    const dist = parties.find(p => p.id === indent.distributorId)
    const distStock = dist?.stock?.[indent.productId] || 0
    if (distStock < qty) {
      setIndentErrors(prev => ({ ...prev, [indent.id!]: `The distributor holds ${distStock} packets and you need ${qty}.` })); return
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

        ledgerInTransaction(tx, {
          partyId: indent.distributorId, partyName: indent.distributorName,
          productId: indent.productId, productName: indent.productName,
          delta: -qty, balanceAfter: currentStock - qty,
          reason: 'indent_out', refType: 'indent', refId: indent.id,
          byUid: appUser!.uid, byName: appUser!.name,
        })
        ledgerInTransaction(tx, {
          partyId: indent.retailerId, partyName: indent.retailerName,
          productId: indent.productId, productName: indent.productName,
          delta: qty, reason: 'indent_in', refType: 'indent', refId: indent.id,
          byUid: appUser!.uid, byName: appUser!.name,
        })
      })
      await addDoc(collection(db, 'stock_movements'), {
        fromId: indent.distributorId, fromName: indent.distributorName,
        toPartyId: indent.retailerId, toPartyName: indent.retailerName,
        packets: qty, cartons: 0, pricePerPacket: 0, totalAmount: 0,
        paymentType: 'cash', notes: 'Indent fulfilled',
        month: localMonthStr(),
        loggedBy: appUser!.uid, loggedByName: appUser!.name,
        date: localDateStr(), createdAt: Date.now(),
        productId: indent.productId, productName: indent.productName, indentId: indent.id,
      })
      setIndentSendQty(prev => { const n = { ...prev }; delete n[indent.id!]; return n })
    } catch (err: any) {
      setIndentErrors(prev => ({ ...prev, [indent.id!]: err.message || 'That could not be sent. Try again.' }))
    } finally { setSendingIndent(null) }
  }

  const handleCancelIndent = async (indent: RetailerIndent) => {
    if (!await showDanger('Cancel this indent?', `The stock request from ${indent.retailerName} is closed without being filled.`, 'Cancel it')) return
    setSendingIndent(indent.id!)
    try {
      await updateDoc(doc(db, 'retailer_indents', indent.id!), { status: 'cancelled' as IndentStatus })
    } finally { setSendingIndent(null) }
  }

  const saveAllocEdit = async () => {
    if (!allocEdit || !appUser) return
    const a = allocations.find(al => al.id === allocEdit.id)
    if (!a) return
    setSaving(true)
    try {
      const packets = parseInt(allocEdit.packets) || 0
      const cartons = Math.floor(packets / config.packetsPerCarton)
      const price = parseFloat(allocEdit.pricePerPacket) || 0
      const totalAmount = packets * price
      await updateDoc(doc(db, 'allocations_v2', allocEdit.id), {
        packets, cartons, pricePerPacket: price, totalAmount,
        paymentType: allocEdit.paymentType,
        plannedDate: allocEdit.plannedDate,
        ...(allocEdit.paymentType === 'credit' ? { creditDueDate: allocEdit.creditDueDate } : {}),
        updatedAt: Date.now(), updatedBy: appUser.uid, updatedByName: appUser.name,
      })
      setAllocEdit(null)
    } finally { setSaving(false) }
  }

  const handleCancelAllocation = async (a: UnifiedAllocation) => {
    const isCompany = a.fromType === 'company' || !(a as any).fromType
    const detail = isCompany
      ? `${toDisplay(a.packets, config.packetsPerCarton)} goes back into available stock.`
      : `The allocation for ${a.partyName} is removed.`
    if (!await showDanger('Cancel this allocation?', detail, 'Cancel it')) return
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
  const handleDispatch = async (a: UnifiedAllocation, sentDate: string) => {
    if (!isAdmin) return
    const isCompany = a.fromType === 'company' || !(a as any).fromType

    // UX pre-check (non-atomic — transaction re-validates atomically)
    if (isCompany) {
      const pStk = a.productId ? config.productStock?.[a.productId] : null
      const prodAvail = pStk ? pStk.total - pStk.locked : available
      if (a.packets > prodAvail) { await showAlert('Not enough stock', `Only ${toDisplay(prodAvail, config.packetsPerCarton)} of ${a.productName || 'this product'} is available.`); return }
    } else {
      const dist = parties.find(p => p.id === a.fromId)
      const distStock = (dist?.stock?.[a.productId]) || 0
      if (a.packets > distStock) { await showAlert('Not enough stock', `The distributor holds ${distStock} packets.`); return }
    }

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
            sentDate,
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

          // Ledger line rides in the same transaction as the stock change.
          ledgerInTransaction(tx, {
            partyId: a.partyId, partyName: a.partyName,
            productId: a.productId, productName: a.productName || a.productId,
            delta: a.packets, reason: 'dispatch_in',
            refType: 'allocation', refId: a.id,
            byUid: appUser!.uid, byName: appUser!.name, date: sentDate,
          })
        } else {
          // Distributor → retailer
          const distRef = doc(db, 'parties', a.fromId)
          const distSnap = await tx.get(distRef)
          const distStock = (distSnap.data()?.stock?.[a.productId] as number) || 0
          if (distStock < a.packets) throw new Error(`Distributor only has ${distStock} packets available`)

          tx.update(allocRef, {
            status: 'sent' as AllocationStatus,
            sentAt: Date.now(), sentBy: appUser!.uid, sentByName: appUser!.name,
            sentDate,
          })
          tx.update(distRef, { [`stock.${a.productId}`]: increment(-a.packets) })
          tx.update(partyRef, { [`stock.${a.productId}`]: increment(a.packets) })

          ledgerInTransaction(tx, {
            partyId: a.fromId, partyName: a.fromName || 'Distributor',
            productId: a.productId, productName: a.productName || a.productId,
            delta: -a.packets, balanceAfter: distStock - a.packets,
            reason: 'dispatch_out', refType: 'allocation', refId: a.id,
            byUid: appUser!.uid, byName: appUser!.name, date: sentDate,
          })
          ledgerInTransaction(tx, {
            partyId: a.partyId, partyName: a.partyName,
            productId: a.productId, productName: a.productName || a.productId,
            delta: a.packets, reason: 'dispatch_in',
            refType: 'allocation', refId: a.id,
            byUid: appUser!.uid, byName: appUser!.name, date: sentDate,
          })
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
        dispatchedAt: Date.now(), date: sentDate, createdAt: Date.now(),
      })
      if (a.paymentType === 'credit') {
        await addDoc(collection(db, 'credits'), {
          partyId: a.partyId, partyName: a.partyName, partyType: a.partyType,
          deliveryId: a.id, packets: a.packets, amount: a.totalAmount,
          status: 'outstanding', createdAt: Date.now(),
        })
      }
    } catch (err: any) {
      await showAlert('Could not dispatch', err.message || 'Something went wrong. Please try again.')
    } finally { setActing(null) }
  }

  // Admin marks credit paid — stock already moved at dispatch, just flip status
  const handleMarkPaid = async (a: UnifiedAllocation) => {
    if (!isAdmin) return
    if (!await showConfirm('Mark this as paid?', `₹${a.totalAmount.toLocaleString('en-IN')} received from ${a.partyName}.`, 'Mark paid')) return
    setActing(a.id!)
    try {
      await updateDoc(doc(db, 'allocations_v2', a.id!), { status: 'paid' as AllocationStatus, paidAt: Date.now() })
    } finally { setActing(null) }
  }

  // Filter allocations
  const filtered = allocations.filter(a => {
    if (salesRepOnly && a.createdBy !== appUser?.uid) return false
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

  // Summary counts (source-aware for pending badge)
  const sourceFiltered = allocations.filter(a => {
    if (filterSource === 'company' && a.fromType === 'distributor') return false
    if (filterSource === 'distributor' && a.fromType !== 'distributor') return false
    return true
  })
  const counts = {
    all: allocations.length,
    pending: sourceFiltered.filter(a => a.status === 'pending').length,
    overdue: allocations.filter(a => a.status === 'overdue').length,
    sent: allocations.filter(a => a.status === 'sent').length,
    paid: allocations.filter(a => a.status === 'paid').length,
    cancelled: allocations.filter(a => a.status === 'cancelled').length,
  }
  const totalCredit = allocations.filter(a => a.status === 'sent' && a.paymentType === 'credit').reduce((s, a) => s + a.totalAmount, 0)

  // Party options for list-tab filter (all parties including retailers under distributors)
  const partyOptions = parties.map(p => ({
 value: p.id!, label:`${p.type ==='distributor' ?'' :''} ${p.name}`,
    sub: `${p.category} • ${p.place || p.address}`,
    group: p.type === 'distributor' ? 'Distributors' : (p as any).underDistributorId ? 'Retailers (under Distributor)' : 'Independent Retailers',
  }))

  // Add-tab recipient options — depends on fromType
  const addTabPartyOptions = form.fromType === 'company'
    ? parties
        .filter(p => !(p.type === 'retailer' && (p as any).underDistributorId))
        .map(p => ({
 value: p.id!, label:`${p.type ==='distributor' ?'' :''} ${p.name}`,
          sub: `${p.category} • ${p.place || p.address}`,
          group: p.type === 'distributor' ? 'Distributors' : 'Independent Retailers',
        }))
    : form.fromId
      ? parties
          .filter(p => p.type === 'retailer' && (p as any).underDistributorId === form.fromId)
          .map(p => ({ value: p.id!, label:` ${p.name}`, sub:`${p.category} • ${p.place || p.address}` }))
      : []

  const blockedRetailersCount = parties.filter(p => p.type === 'retailer' && (p as any).underDistributorId).length

  const selectedParty = parties.find(p => p.id === form.partyId)
  const selectedFromDist = form.fromType === 'distributor' ? parties.find(p => p.id === form.fromId) : null

  const money = (n: number) => `₹${n.toLocaleString('en-IN')}`
  const shortDate = (ts: number) => new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })

  const action = (label: string, onClick: () => void, disabled?: boolean) => (
    <button className="oc-action" onClick={onClick} disabled={disabled}
      style={{ background: 'none', border: 'none', padding: 0, fontSize: 13, fontWeight: 400,
               color: t.text2, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1 }}>
      {label}
    </button>
  )

  // A party's product balances, as a quiet tinted block.
  const StockBlock = ({ entries }: { entries: { id: string; name: string; qty: number }[] }) => (
    <div style={{ background: t.tint, borderRadius: 6, padding: '11px 13px', marginTop: 12 }}>
      <div style={{ fontSize: 11, letterSpacing: '0.09em', textTransform: 'uppercase', color: t.text3, marginBottom: 7 }}>
        In stock
      </div>
      {entries.map(e => (
        <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 16,
                                 fontSize: 13, fontWeight: 400, color: t.text2, marginTop: 3 }}>
          <span>{e.name}</span>
          <span>{toDisplay(e.qty, config.packetsPerCarton)}</span>
        </div>
      ))}
    </div>
  )

  const stockEntriesOf = (p: Party) =>
    (products.length > 0
      ? products.map(pr => ({ id: pr.id!, name: pr.name, qty: p.stock?.[pr.id!] ?? 0 }))
      : Object.entries(p.stock || {}).map(([id, qty]) => ({ id, name: id, qty: qty as number }))
    ).filter(e => e.qty > 0)

  // A compact "date — quantity — status" line, used in every expanded list.
  const AllocLine = ({ a, prefix }: { a: UnifiedAllocation; prefix?: string }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 16,
                  marginTop: 6, fontSize: 13, fontWeight: 400 }}>
      <span style={{ color: t.text2 }}>
        {prefix ? `${prefix} · ` : ''}
        {a.sentAt ? shortDate(a.sentAt) : a.plannedDate} · {toDisplay(a.packets, config.packetsPerCarton)}
        {a.productName ? ` · ${a.productName}` : ''}
      </span>
      <span style={{ whiteSpace: 'nowrap', color: NEEDS_ACTION.includes(a.status) ? t.warn : t.text3 }}>
        {STATUS_LABEL[a.status] ?? a.status}
      </span>
    </div>
  )

  // ── HISTORY VIEW ───────────────────────────────────────────────────────────
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
    const histStock = stockEntriesOf(histParty)

    return (
      <>
        <div style={{ minHeight: '100vh', background: t.bg, paddingBottom: 40 }}>
          <PageHeader
            eyebrow={histParty.type === 'distributor' ? 'Distributor' : 'Retailer'}
            title={histParty.name}
            subtitle={`${histParty.place || histParty.address} · ${histParty.phone}`}
            onBack={() => setHistoryPartyId(null)}
          />

          <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 28 }}>
            <StatGrid>
              <StatCard
                value={toDisplay(receivedPkts, config.packetsPerCarton)}
                label={histParty.type === 'distributor' ? 'From the company' : 'Received'} />
              <StatCard
                value={sentOutPkts > 0 ? toDisplay(sentOutPkts, config.packetsPerCarton) : '—'}
                label={histParty.type === 'distributor' ? 'On to retailers' : 'Sent out'} />
              <StatCard
                value={outstanding > 0 ? money(outstanding) : '—'}
                label="Outstanding"
                context={outstanding > 0 ? 'On credit, not yet paid' : undefined} />
            </StatGrid>

            {histParty.type === 'distributor' && (
              <Section label="Current stock">
                {histStock.length === 0
                  ? <EmptyState title="No stock recorded" body="Nothing has been dispatched to them yet." />
                  : <StockBlock entries={histStock} />}
              </Section>
            )}

            <Section label={`Allocation history · ${partyAllocs.length}`}>
              {partyAllocs.length === 0 ? (
                <EmptyState title="No allocations yet" body="Allocations to and from this party will appear here." />
              ) : (
                <div style={{ borderBottom: `0.5px solid ${t.border}` }}>
                  {partyAllocs.map(a => {
                    const isOutbound = a.fromId === historyPartyId && a.fromType === 'distributor'
                    return (
                      <div key={a.id} style={{ borderTop: `0.5px solid ${t.border}`, padding: '16px 0' }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 15, fontWeight: 500, color: t.text }}>
                              {(a as any).productName || 'Unnamed product'}
                            </div>
                            <div style={{ fontSize: 13, fontWeight: 400, color: t.text3, marginTop: 3 }}>
                              {isOutbound ? `Out to ${a.partyName}` : 'In from Ocealgo'} ·{' '}
                              {new Date(a.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                            </div>
                            <div style={{ fontSize: 13, fontWeight: 400, color: t.text3, marginTop: 3 }}>
                              by {a.createdByName}
                            </div>
                          </div>
                          <div style={{ textAlign: 'right', flexShrink: 0 }}>
                            <div style={{ fontSize: 15, fontWeight: 500, color: t.text }}>
                              {toDisplay(a.packets, config.packetsPerCarton)}
                            </div>
                            <div style={{ fontSize: 13, fontWeight: 400, marginTop: 3,
                                          color: NEEDS_ACTION.includes(a.status) ? t.warn : t.text3 }}>
                              {STATUS_LABEL[a.status] ?? a.status}
                              {!isOutbound && ` · ${money(a.totalAmount)} ${a.paymentType}`}
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </Section>

            {histParty.type === 'distributor' && (
              <Section label={`Retailers under them · ${subRets.length}`}>
                {subRets.length === 0 ? (
                  <EmptyState title="No retailers linked" body="Link a retailer to this distributor from the network screen." />
                ) : (
                  <div style={{ borderBottom: `0.5px solid ${t.border}` }}>
                    {subRets.map(r => {
                      const rAllocs = outboundAllocs.filter(a => a.partyId === r.id)
                      const rSentPkts = rAllocs.filter(a => a.status === 'sent' || a.status === 'paid').reduce((s, a) => s + a.packets, 0)
                      const rPendingPkts = rAllocs.filter(a => a.status === 'pending').reduce((s, a) => s + a.packets, 0)
                      const rStock = stockEntriesOf(r)
                      return (
                        <div key={r.id} style={{ borderTop: `0.5px solid ${t.border}`, padding: '16px 0' }}>
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 15, fontWeight: 500, color: t.text }}>{r.name}</div>
                              <div style={{ fontSize: 13, fontWeight: 400, color: t.text3, marginTop: 3 }}>
                                {r.place || r.address}
                              </div>
                            </div>
                            <div style={{ fontSize: 14, fontWeight: 400, whiteSpace: 'nowrap', flexShrink: 0,
                                          color: rPendingPkts > 0 ? t.warn : t.text2 }}>
                              {rPendingPkts > 0
                                ? `${toDisplay(rPendingPkts, config.packetsPerCarton)} pending`
                                : rSentPkts > 0
                                  ? `${toDisplay(rSentPkts, config.packetsPerCarton)} sent`
                                  : '—'}
                            </div>
                          </div>
                          {rStock.length > 0 && <StockBlock entries={rStock} />}
                          {rAllocs.slice(0, 3).map(a => <AllocLine key={a.id} a={a} />)}
                        </div>
                      )
                    })}
                  </div>
                )}
              </Section>
            )}
          </div>
        </div>
        {modal}
      </>
    )
  }

  // ── MAIN ───────────────────────────────────────────────────────────────────
  const attention = counts.overdue > 0
    ? `${counts.overdue} overdue`
    : counts.pending > 0
      ? `${counts.pending} waiting to be dispatched`
      : 'Nothing is overdue'
  const pageCount = Math.ceil(filtered.length / ALLOC_PAGE_SIZE)

  return (
    <div style={{ minHeight: '100vh', background: t.bg, paddingBottom: 40 }}>
      <PageHeader
        eyebrow="Allocations"
        title="Stock allocations"
        subtitle={totalCredit > 0 ? `${attention} · ${money(totalCredit)} on credit` : attention}
        onBack={onBack}
        divider={false}
      />
      <TabBar
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'list', label: 'List' },
          { id: 'add', label: 'New' },
          { id: 'network', label: 'Network' },
        ]}
      />

      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 28 }}>

        {/* ── LIST ──────────────────────────────────────────────────────────── */}
        {tab === 'list' && (
          <>
            <StatGrid>
              <StatCard value={counts.pending} label="Pending"
                context={counts.overdue > 0 ? `${counts.overdue} of them overdue` : undefined} />
              <StatCard value={counts.sent} label="Sent" />
              <StatCard value={totalCredit > 0 ? money(totalCredit) : '—'} label="On credit"
                context={totalCredit > 0 ? 'Sent but not yet paid' : undefined} />
            </StatGrid>

            <Section label="Filter">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <ChipGroup
                  value={filterSource}
                  onChange={setFilterSource}
                  options={[
                    { id: 'all', label: 'Every source' },
                    { id: 'company', label: 'From the company' },
                    { id: 'distributor', label: 'From a distributor' },
                  ] as const}
                />

                <ChipGroup
                  value={filterStatus}
                  onChange={setFilterStatus}
                  options={(filterSource === 'distributor'
                    ? (['all', 'pending', 'sent', 'cancelled'] as const)
                    : (['all', 'overdue', 'pending', 'sent', 'paid', 'cancelled'] as const)
                  ).map(s => ({
                    id: s as 'all' | AllocationStatus,
                    label: s === 'all'
                      ? `Any status · ${counts.all}`
                      : s === 'pending' && counts.pending > 0
                        ? `Pending · ${counts.pending}`
                        : STATUS_LABEL[s as AllocationStatus],
                  }))}
                />

                {filterSource !== 'distributor' && (
                  <ChipGroup
                    value={filterPayment}
                    onChange={setFilterPayment}
                    options={[
                      { id: 'all', label: 'Cash and credit' },
                      { id: 'cash', label: 'Cash' },
                      { id: 'credit', label: 'Credit' },
                    ] as const}
                  />
                )}

                <div style={{ maxWidth: 460 }}>
                  <Field label="Party">
                    <CustomSelect value={filterParty} onChange={setFilterParty} placeholder="All parties"
                      options={[{ value: 'all', label: 'All parties' }, ...partyOptions]} />
                  </Field>
                </div>

                {filterSource !== 'company' && (
                  <div style={{ maxWidth: 460 }}>
                    <Field label="Distributor, for indents">
                      <CustomSelect
                        value={filterDistributor}
                        onChange={setFilterDistributor}
                        placeholder="All distributors"
                        options={[
                          { value: 'all', label: 'All distributors' },
                          ...parties.filter(p => p.type === 'distributor').map(p => ({
                            value: p.id!, label: p.name, sub: p.place || p.address,
                          })),
                        ]}
                      />
                    </Field>
                  </div>
                )}
              </div>
            </Section>

            <Section label={
              `${filtered.length} allocation${filtered.length !== 1 ? 's' : ''}` +
              (filterSource !== 'company' && filteredIndents.length > 0
                ? ` · ${filteredIndents.length} indent${filteredIndents.length !== 1 ? 's' : ''}`
                : '')
            }>
              {filtered.length === 0 ? (
                filterSource !== 'distributor' && (
                  <EmptyState
                    title="No allocations match"
                    body="Loosen a filter, or create a new allocation."
                    actionLabel="New allocation"
                    onAction={() => setTab('add')}
                  />
                )
              ) : (
                <div style={{ borderBottom: `0.5px solid ${t.border}` }}>
                  {filtered.slice(allocPage * ALLOC_PAGE_SIZE, (allocPage + 1) * ALLOC_PAGE_SIZE).map(a => {
                    const isOverdue = a.status === 'overdue'
                    const isSentCredit = a.status === 'sent' && a.paymentType === 'credit'
                    const daysUntil = Math.ceil((new Date(a.plannedDate).getTime() - Date.now()) / 86400000)
                    const isHighlighted = a.id === highlightId
                    const editing = allocEdit?.id === a.id
                    const timing = a.status === 'pending' || a.status === 'overdue'
                      ? isOverdue
                        ? 'Overdue'
                        : daysUntil <= 0 ? 'Due today' : daysUntil === 1 ? 'Due tomorrow' : `Due in ${daysUntil} days`
                      : a.sentAt ? `Sent ${shortDate(a.sentAt)}` : ''

                    return (
                      <div key={a.id} id={`alloc-${a.id}`}
                        style={{
                          borderTop: `0.5px solid ${t.border}`, padding: '18px 0',
                          background: isHighlighted ? t.tint : 'transparent',
                        }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 15, fontWeight: 500, color: t.text }}>{a.partyName}</div>
                            <div style={{ fontSize: 13, fontWeight: 400, color: t.text3, marginTop: 3 }}>
                              {a.fromType === 'distributor' ? a.fromName : 'Ocealgo'} to {a.partyName}
                              {a.productName ? ` · ${a.productName}` : ''}
                            </div>
                            <div style={{ fontSize: 13, fontWeight: 400, color: t.text3, marginTop: 3 }}>
                              {toDisplay(a.packets, config.packetsPerCarton)}
                              {a.fromType !== 'distributor' && ` · ${money(a.totalAmount)} ${a.paymentType}`}
                              {timing && ` · ${timing}`}
                            </div>
                            <div style={{ fontSize: 13, fontWeight: 400, color: t.text3, marginTop: 3 }}>
                              by {a.createdByName}
                            </div>
                          </div>
                          <div style={{ fontSize: 14, fontWeight: 400, whiteSpace: 'nowrap', flexShrink: 0,
                                        color: NEEDS_ACTION.includes(a.status) ? t.warn : t.text2 }}>
                            {STATUS_LABEL[a.status]}
                          </div>
                        </div>

                        {a.paymentType === 'credit' && (a as any).creditDueDate && a.status !== 'paid' && (
                          <div style={{ fontSize: 13, fontWeight: 400, marginTop: 8,
                                        color: a.status === 'overdue' ? t.warn : t.text3 }}>
                            {a.status === 'overdue' ? 'Payment was due ' : 'Payment due '}
                            {(a as any).creditDueDate}
                          </div>
                        )}

                        {a.notes && (
                          <div style={{ fontSize: 13, fontWeight: 400, color: t.text3, marginTop: 8, lineHeight: 1.5 }}>
                            {a.notes}
                          </div>
                        )}

                        {editing ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 16, maxWidth: 460 }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                              <Field label="Packets">
                                <input type="number" inputMode="numeric" value={allocEdit!.packets}
                                  onChange={e => setAllocEdit(p => p ? { ...p, packets: e.target.value } : p)}
                                  style={inputStyle(t)} />
                              </Field>
                              <Field label="Price per packet">
                                <input type="number" inputMode="decimal" value={allocEdit!.pricePerPacket}
                                  onChange={e => setAllocEdit(p => p ? { ...p, pricePerPacket: e.target.value } : p)}
                                  style={inputStyle(t)} />
                              </Field>
                            </div>
                            {(parseInt(allocEdit!.packets) || 0) > 0 && (parseFloat(allocEdit!.pricePerPacket) || 0) > 0 && (
                              <div style={{ fontSize: 13, fontWeight: 400, color: t.text2 }}>
                                That comes to {money((parseInt(allocEdit!.packets) || 0) * (parseFloat(allocEdit!.pricePerPacket) || 0))}.
                              </div>
                            )}
                            <Field label="Payment">
                              <ChipGroup
                                value={allocEdit!.paymentType}
                                onChange={pt => setAllocEdit(p => p ? { ...p, paymentType: pt } : p)}
                                options={[
                                  { id: 'cash' as PaymentType, label: 'Cash' },
                                  { id: 'credit' as PaymentType, label: 'Credit' },
                                ]}
                              />
                            </Field>
                            <Field label="Planned send date">
                              <DateInput type="date" value={allocEdit!.plannedDate}
                                onChange={v => setAllocEdit(p => p ? { ...p, plannedDate: v } : p)} />
                            </Field>
                            {allocEdit!.paymentType === 'credit' && (
                              <Field label="Payment due by">
                                <DateInput type="date" value={allocEdit!.creditDueDate}
                                  onChange={v => setAllocEdit(p => p ? { ...p, creditDueDate: v } : p)} />
                              </Field>
                            )}
                            <div style={{ display: 'flex', gap: 10 }}>
                              <PrimaryButton onClick={saveAllocEdit} disabled={saving}>
                                {saving ? 'Saving' : 'Save changes'}
                              </PrimaryButton>
                              <GhostButton onClick={() => setAllocEdit(null)}>Cancel</GhostButton>
                            </div>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 12 }}>
                            {a.status === 'pending' && a.fromType !== 'distributor' && action('Edit', () =>
                              setAllocEdit({
                                id: a.id!, packets: String(a.packets), pricePerPacket: String(a.pricePerPacket),
                                paymentType: (a.paymentType || 'credit') as PaymentType,
                                plannedDate: a.plannedDate, creditDueDate: (a as any).creditDueDate || '',
                              }))}

                            {isAdmin && (a.status === 'pending' || a.status === 'overdue') && (
                              <>
                                {action(
                                  acting === a.id ? 'Working' : a.fromType === 'distributor' ? 'Confirm sent' : 'Dispatch',
                                  () => { setDispatchDateAlloc(a); setDispatchDate(localDateStr()) },
                                  acting === a.id)}
                                {action('Cancel', () => handleCancelAllocation(a), acting === a.id)}
                              </>
                            )}

                            {isAdmin && a.fromType !== 'distributor' && isSentCredit &&
                              action(acting === a.id ? 'Working' : 'Mark paid', () => handleMarkPaid(a), acting === a.id)}

                            {!isAdmin && (a.status === 'pending' || a.status === 'overdue') && (
                              <span style={{ fontSize: 13, fontWeight: 400, color: t.text3 }}>
                                Waiting for an admin to dispatch this.
                              </span>
                            )}

                            {a.status === 'paid' && (
                              <span style={{ fontSize: 13, fontWeight: 400, color: t.text3 }}>
                                Paid in full{a.paidAt ? ` on ${new Date(a.paidAt).toLocaleDateString('en-IN')}` : ''}.
                              </span>
                            )}
                            {a.fromType !== 'distributor' && a.status === 'sent' && a.paymentType === 'cash' && (
                              <span style={{ fontSize: 13, fontWeight: 400, color: t.text3 }}>Cash received.</span>
                            )}
                            {a.fromType === 'distributor' && a.status === 'sent' && (
                              <span style={{ fontSize: 13, fontWeight: 400, color: t.text3 }}>Stock transferred.</span>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}

              {pageCount > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 16 }}>
                  <GhostButton onClick={() => setAllocPage(p => p - 1)} disabled={allocPage === 0}>Previous</GhostButton>
                  <span style={{ fontSize: 13, fontWeight: 400, color: t.text3 }}>
                    Page {allocPage + 1} of {pageCount}
                  </span>
                  <GhostButton onClick={() => setAllocPage(p => p + 1)} disabled={allocPage >= pageCount - 1}>Next</GhostButton>
                </div>
              )}
            </Section>

            {/* Indents */}
            {filterSource !== 'company' && (
              <Section label={`Indents · ${filteredIndents.length}`}>
                {filteredIndents.length === 0 ? (
                  filterSource === 'distributor' && (
                    <EmptyState title="No indents waiting"
                      body="Retailers request stock from their distributor here. Nothing is outstanding." />
                  )
                ) : (
                  <div style={{ borderBottom: `0.5px solid ${t.border}` }}>
                    {filteredIndents.map(indent => {
                      const dist = parties.find(p => p.id === indent.distributorId)
                      const distStock = dist?.stock?.[indent.productId] || 0
                      const sendQtyVal = parseInt(indentSendQty[indent.id!] ?? String(indent.requestedPackets))
                      const neededQty = isNaN(sendQtyVal) ? indent.requestedPackets : sendQtyVal
                      const short = distStock < neededQty
                      return (
                        <div key={indent.id} style={{ borderTop: `0.5px solid ${t.border}`, padding: '18px 0' }}>
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 15, fontWeight: 500, color: t.text }}>{indent.retailerName}</div>
                              <div style={{ fontSize: 13, fontWeight: 400, color: t.text3, marginTop: 3 }}>
                                Asked {indent.distributorName} for {indent.requestedPackets} packets of {indent.productName}
                              </div>
                              <div style={{ fontSize: 13, fontWeight: 400, color: t.text3, marginTop: 3 }}>
                                by {indent.requestedByName} · {new Date(indent.requestedAt).toLocaleDateString('en-IN')}
                              </div>
                            </div>
                            <div style={{ fontSize: 14, fontWeight: 400, whiteSpace: 'nowrap', flexShrink: 0,
                                          color: short ? t.warn : t.text2 }}>
                              {distStock} in stock
                            </div>
                          </div>

                          {short && (
                            <div style={{ marginTop: 12 }}>
                              <Note tone="warn">
                                {indent.distributorName} holds {distStock} packets and {neededQty} are needed.
                                Send what is available, or cancel the indent.
                              </Note>
                            </div>
                          )}

                          {isAdmin && (
                            <div style={{ marginTop: 16, maxWidth: 460 }}>
                              <Field label="Packets to send"
                                hint={`They asked for ${indent.requestedPackets}.`}
                                error={indentErrors[indent.id!]}>
                                <div style={{ display: 'flex', gap: 10 }}>
                                  <input
                                    type="number" inputMode="numeric"
                                    value={indentSendQty[indent.id!] ?? String(indent.requestedPackets)}
                                    onChange={e => {
                                      const v = e.target.value; const n = parseInt(v)
                                      setIndentSendQty(prev => ({ ...prev, [indent.id!]: v }))
                                      if (!isNaN(n) && n > indent.requestedPackets) {
                                        setIndentErrors(prev => ({ ...prev, [indent.id!]: `They asked for ${indent.requestedPackets} packets — you cannot send more.` }))
                                      } else { setIndentErrors(prev => { const nx = { ...prev }; delete nx[indent.id!]; return nx }) }
                                    }}
                                    max={indent.requestedPackets}
                                    style={inputStyle(t)}
                                  />
                                  <PrimaryButton
                                    onClick={() => handleSendIndent(indent)}
                                    disabled={sendingIndent === indent.id || distStock < 1}>
                                    {sendingIndent === indent.id ? 'Sending' : 'Send'}
                                  </PrimaryButton>
                                </div>
                              </Field>
                              <div style={{ marginTop: 12 }}>
                                {action('Cancel this indent', () => handleCancelIndent(indent), sendingIndent === indent.id)}
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </Section>
            )}
          </>
        )}

        {/* ── ADD ───────────────────────────────────────────────────────────── */}
        {tab === 'add' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 460 }}>
            <Field label="Allocate from">
              <ChipGroup
                value={form.fromType}
                onChange={v => setForm({ ...emptyForm, fromType: v })}
                options={[
                  { id: 'company' as const, label: 'Company stock' },
                  { id: 'distributor' as const, label: 'Distributor stock' },
                ]}
              />
            </Field>

            {form.fromType === 'distributor' && (
              <Field label="Source distributor" error={errors.fromId}>
                <CustomSelect
                  value={form.fromId}
                  onChange={v => setForm({ ...form, fromId: v, partyId: '' })}
                  placeholder="Pick a distributor"
                  options={parties.filter(p => p.type === 'distributor').map(p => ({
                    value: p.id!, label: p.name, sub: p.place || p.address,
                  }))}
                  error={!!errors.fromId}
                />
              </Field>
            )}

            {/* What is on hand, and what would be left */}
            {(() => {
              const isCompany = form.fromType === 'company'
              const pStk = isCompany && form.productId ? config.productStock?.[form.productId] : null
              const onHand = isCompany
                ? (form.productId ? (pStk ? pStk.total - pStk.locked : 0) : null)
                : (selectedFromDist && form.productId ? (selectedFromDist.stock?.[form.productId] || 0) : null)
              if (onHand === null) {
                return (
                  <Note>
                    {isCompany
                      ? 'Pick a product to see what is available.'
                      : 'Pick a distributor and a product to see what they hold.'}
                  </Note>
                )
              }
              const requested = form.packets ? toPackets(form.packets) : 0
              const after = onHand - requested
              return (
                <StatGrid>
                  <StatCard value={toDisplay(onHand, config.packetsPerCarton)}
                    label={isCompany ? 'Available' : 'They hold'}
                    context={onHand === 0 ? 'Nothing to allocate' : undefined} />
                  {requested > 0 && (
                    <StatCard value={toDisplay(Math.max(0, after), config.packetsPerCarton)}
                      label="Left after this"
                      context={after < 0 ? 'Not enough — reduce the quantity' : undefined} />
                  )}
                </StatGrid>
              )
            })()}

            {form.fromType === 'company' && blockedRetailersCount > 0 && (
              <Note>
                {blockedRetailersCount} retailer{blockedRetailersCount > 1 ? 's are' : ' is'} linked to a distributor
                and hidden here. Allocate to them from distributor stock instead.
              </Note>
            )}

            <Field label={form.fromType === 'company' ? 'Distributor or retailer' : 'Retailer'} error={errors.partyId}>
              <CustomSelect value={form.partyId} onChange={v => setForm({ ...form, partyId: v })}
                placeholder={form.fromType === 'distributor' && !form.fromId
                  ? 'Pick a source distributor first'
                  : 'Pick who receives this'}
                options={addTabPartyOptions} error={!!errors.partyId} />
              {selectedParty && (
                <div style={{ fontSize: 13, fontWeight: 400, color: t.text3, marginTop: 7 }}>
                  {selectedParty.address} · {selectedParty.phone}
                </div>
              )}
            </Field>

            <Field label="Product" error={errors.productId}>
              {products.length === 0 ? (
                <div style={{ fontSize: 13, fontWeight: 400, color: t.text3 }}>
                  No products yet. Add one in the Products screen first.
                </div>
              ) : (
                <div style={{ borderTop: `0.5px solid ${t.border}`, borderBottom: `0.5px solid ${t.border}` }}>
                  {products.map((p, i) => (
                    <button key={p.id} className="oc-row"
                      onClick={() => setForm(f => ({ ...f, productId: p.id!, pricePerPacket: String(p.defaultPricePerUnit || '') }))}
                      style={{
                        display: 'flex', alignItems: 'baseline', gap: 16, width: '100%', textAlign: 'left',
                        background: form.productId === p.id ? t.tint : 'none', border: 'none',
                        borderTop: i > 0 ? `0.5px solid ${t.border}` : 'none',
                        padding: '13px 12px', cursor: 'pointer',
                      }}>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: 'block', fontSize: 14,
                                       fontWeight: form.productId === p.id ? 500 : 400, color: t.text }}>
                          {p.name}
                        </span>
                        <span style={{ display: 'block', fontSize: 13, fontWeight: 400, color: t.text3, marginTop: 3 }}>
                          ₹{p.defaultPricePerUnit} per {p.unitLabel.replace(/s$/, '')} · {p.unitsPerCarton} per carton
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </Field>

            <Field label="Quantity" error={errors.packets}>
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
              <input type="number" inputMode="numeric" value={form.packets}
                onChange={e => setForm({ ...form, packets: e.target.value })}
                placeholder={unit === 'cartons' ? 'Number of cartons' : 'Number of packets'}
                style={inputStyle(t)} />
              {form.packets && parseInt(form.packets) > 0 && (
                <div style={{ marginTop: 7, fontSize: 13, fontWeight: 400, color: t.text3 }}>
                  That is {toDisplay(toPackets(form.packets), config.packetsPerCarton)}
                  {form.pricePerPacket && parseFloat(form.pricePerPacket) > 0 &&
                    `, worth ${money(toPackets(form.packets) * parseFloat(form.pricePerPacket))}`}.
                </div>
              )}
            </Field>

            {form.fromType === 'company' && (
              <>
                <Field label="Price per packet" hint="What you charge them for one packet."
                  error={errors.pricePerPacket}>
                  <input type="number" inputMode="decimal" value={form.pricePerPacket}
                    onChange={e => setForm({ ...form, pricePerPacket: e.target.value })}
                    placeholder="45" style={inputStyle(t)} />
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

                <Field label="Planned send date" hint="The day you intend to physically send the stock."
                  error={errors.plannedDate}>
                  <DateInput type="date" value={form.plannedDate} onChange={v => setForm({ ...form, plannedDate: v })} />
                </Field>

                {form.paymentType === 'credit' && (
                  <Field label="Payment due by"
                    hint="It moves to overdue on its own if payment has not arrived by then.">
                    <DateInput type="date" value={form.creditDueDate} onChange={v => setForm({ ...form, creditDueDate: v })} />
                  </Field>
                )}
              </>
            )}

            <Field label="Notes">
              <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
                placeholder="Anything worth recording about this allocation"
                rows={3}
                style={{ ...inputStyle(t), resize: 'vertical', lineHeight: 1.5 }} />
            </Field>

            <div style={{ marginTop: 4 }}>
              <PrimaryButton onClick={handleCreate} disabled={saving}>
                {saving ? 'Creating' : 'Create allocation'}
              </PrimaryButton>
            </div>
          </div>
        )}

        {/* ── NETWORK ───────────────────────────────────────────────────────── */}
        {tab === 'network' && (() => {
          const statusMatch = (p: Party) => networkStatusFilter === 'all' || (p as any).status === networkStatusFilter
          const partyMatch = (p: Party) => !networkPartyFilter || p.id === networkPartyFilter
          const netDistributors = parties.filter(p => p.type === 'distributor' && statusMatch(p) && partyMatch(p))
          const independents = parties.filter(p => p.type === 'retailer' && !(p as any).underDistributorId && statusMatch(p) && partyMatch(p))
          const networkPartyOptions = [
            ...parties.filter(p => p.type === 'distributor').map(p => ({ value: p.id!, label: p.name, group: 'Distributors' })),
            ...parties.filter(p => p.type === 'retailer' && !(p as any).underDistributorId).map(p => ({ value: p.id!, label: p.name, group: 'Independent retailers' })),
          ]
          const pendingIndents = indents.filter(i => i.status === 'requested' || i.status === 'partial').length
          const retailerCount = parties.filter(p => p.type === 'retailer').length

          return (
            <>
              <Section label="Filter">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <ChipGroup
                    value={networkStatusFilter}
                    onChange={setNetworkStatusFilter}
                    options={[
                      { id: 'all', label: 'Any status' },
                      { id: 'active', label: 'Active' },
                      { id: 'prospect', label: 'Prospect' },
                      { id: 'inactive', label: 'Inactive' },
                    ] as const}
                  />
                  <div style={{ maxWidth: 460 }}>
                    <CustomSelect
                      value={networkPartyFilter}
                      onChange={setNetworkPartyFilter}
                      placeholder="Everyone"
                      options={networkPartyOptions}
                    />
                  </div>
                </div>
              </Section>

              <StatGrid>
                <StatCard value={netDistributors.length} label="Distributors" />
                <StatCard value={retailerCount} label="Retailers" />
                <StatCard value={pendingIndents} label="Indents waiting"
                  context={pendingIndents > 0 ? 'Fill them from the list tab' : undefined} />
              </StatGrid>

              <Section label="Distributors">
                {netDistributors.length === 0 ? (
                  <EmptyState title="No distributors yet"
                    body="Add a distributor from the network screen to start allocating through them." />
                ) : (
                  <div style={{ borderBottom: `0.5px solid ${t.border}` }}>
                    {netDistributors.map(dist => {
                      const receivedAllocs = allocations.filter(a => a.partyId === dist.id)
                      const outboundAllocs = allocations.filter(a => a.fromId === dist.id && a.fromType === 'distributor')
                      const receivedPackets = receivedAllocs.filter(a => a.status !== 'cancelled').reduce((s, a) => s + a.packets, 0)
                      const sentToRetailers = outboundAllocs.filter(a => a.status === 'sent' || a.status === 'paid').reduce((s, a) => s + a.packets, 0)
                      const pendingToRetailers = outboundAllocs.filter(a => a.status === 'pending' || a.status === 'overdue').reduce((s, a) => s + a.packets, 0)
                      const creditDue = receivedAllocs.filter(a => a.status === 'sent' && a.paymentType === 'credit').reduce((s, a) => s + a.totalAmount, 0)
                      const subRetailers = parties.filter(p => p.type === 'retailer' && (p as any).underDistributorId === dist.id)
                      const distStockEntries = stockEntriesOf(dist)
                      const distIndents = indents.filter(i => i.distributorId === dist.id && (i.status === 'requested' || i.status === 'partial'))

                      return (
                        <div key={dist.id} style={{ borderTop: `0.5px solid ${t.border}`, padding: '20px 0' }}>
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 15, fontWeight: 500, color: t.text }}>{dist.name}</div>
                              <div style={{ fontSize: 13, fontWeight: 400, color: t.text3, marginTop: 3 }}>
                                {dist.place || dist.address} · {dist.phone}
                              </div>
                              <div style={{ fontSize: 13, fontWeight: 400, color: t.text3, marginTop: 3 }}>
                                {toDisplay(receivedPackets, config.packetsPerCarton)} in from the company ·{' '}
                                {sentToRetailers > 0
                                  ? `${toDisplay(sentToRetailers, config.packetsPerCarton)} on to retailers`
                                  : pendingToRetailers > 0
                                    ? `${toDisplay(pendingToRetailers, config.packetsPerCarton)} pending to retailers`
                                    : 'nothing out yet'}
                                {creditDue > 0 && ` · ${money(creditDue)} on credit`}
                              </div>
                            </div>
                            <div style={{ fontSize: 14, fontWeight: 400, whiteSpace: 'nowrap', flexShrink: 0,
                                          color: (dist as any).status === 'active' ? t.text2 : t.warn }}>
                              {(dist as any).status === 'active' ? 'Active' : 'Prospect'}
                            </div>
                          </div>

                          {distStockEntries.length > 0 && <StockBlock entries={distStockEntries} />}

                          {distIndents.length > 0 && (
                            <div style={{ marginTop: 16 }}>
                              <div style={{ fontSize: 11, letterSpacing: '0.09em', textTransform: 'uppercase',
                                            color: t.text3, marginBottom: 10 }}>
                                Indents waiting · {distIndents.length}
                              </div>
                              {distIndents.map(indent => {
                                const distStockN = dist.stock?.[indent.productId] || 0
                                return (
                                  <div key={indent.id} style={{ marginBottom: 16, maxWidth: 460 }}>
                                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
                                      <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontSize: 14, fontWeight: 400, color: t.text }}>
                                          {indent.retailerName}
                                        </div>
                                        <div style={{ fontSize: 13, fontWeight: 400, color: t.text3, marginTop: 3 }}>
                                          {indent.requestedPackets} packets of {indent.productName} ·{' '}
                                          {indent.status === 'requested' ? 'pending' : 'partly filled'}
                                        </div>
                                      </div>
                                      <div style={{ fontSize: 13, fontWeight: 400, whiteSpace: 'nowrap',
                                                    color: distStockN > 0 ? t.text3 : t.warn }}>
                                        {distStockN} in stock
                                      </div>
                                    </div>
                                    {isAdmin && (
                                      <div style={{ marginTop: 10 }}>
                                        {indentErrors[indent.id!] && (
                                          <div style={{ fontSize: 12, color: t.warn, marginBottom: 6 }}>
                                            {indentErrors[indent.id!]}
                                          </div>
                                        )}
                                        <div style={{ display: 'flex', gap: 10 }}>
                                          <input
                                            type="number" inputMode="numeric"
                                            value={indentSendQty[indent.id!] ?? String(indent.requestedPackets)}
                                            onChange={e => {
                                              const v = e.target.value; const n = parseInt(v)
                                              setIndentSendQty(prev => ({ ...prev, [indent.id!]: v }))
                                              if (!isNaN(n) && n > indent.requestedPackets) {
                                                setIndentErrors(prev => ({ ...prev, [indent.id!]: `They asked for ${indent.requestedPackets} packets — you cannot send more.` }))
                                              } else { setIndentErrors(prev => { const nx = { ...prev }; delete nx[indent.id!]; return nx }) }
                                            }}
                                            max={indent.requestedPackets}
                                            style={inputStyle(t)}
                                          />
                                          <PrimaryButton
                                            onClick={() => handleSendIndent(indent)}
                                            disabled={sendingIndent === indent.id || distStockN < 1}>
                                            {sendingIndent === indent.id ? 'Sending' : 'Send'}
                                          </PrimaryButton>
                                          <GhostButton onClick={() => handleCancelIndent(indent)}
                                            disabled={sendingIndent === indent.id}>
                                            Cancel
                                          </GhostButton>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                )
                              })}
                            </div>
                          )}

                          <div style={{ marginTop: 16 }}>
                            <div style={{ fontSize: 11, letterSpacing: '0.09em', textTransform: 'uppercase',
                                          color: t.text3, marginBottom: 10 }}>
                              Retailers · {subRetailers.length}
                            </div>
                            {subRetailers.length === 0 ? (
                              <div style={{ fontSize: 13, fontWeight: 400, color: t.text3 }}>
                                No retailers are linked to them yet.
                              </div>
                            ) : subRetailers.map(r => {
                              const rAllocs = allocations.filter(a => a.fromId === dist.id && a.fromType === 'distributor' && a.partyId === r.id)
                              const rSentPackets = rAllocs.filter(a => a.status === 'sent' || a.status === 'paid').reduce((s, a) => s + a.packets, 0)
                              const rPendingPackets = rAllocs.filter(a => a.status === 'pending').reduce((s, a) => s + a.packets, 0)
                              const rStock = stockEntriesOf(r)
                              const open = expandedRetailAllocs.has(r.id!)
                              return (
                                <div key={r.id} style={{ marginBottom: 14 }}>
                                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                      <div style={{ fontSize: 14, fontWeight: 400, color: t.text }}>{r.name}</div>
                                      <div style={{ fontSize: 13, fontWeight: 400, color: t.text3, marginTop: 3 }}>
                                        {r.place || r.address}
                                      </div>
                                    </div>
                                    <div style={{ fontSize: 13, fontWeight: 400, whiteSpace: 'nowrap',
                                                  color: rPendingPackets > 0 ? t.warn : t.text3 }}>
                                      {rPendingPackets > 0
                                        ? `${rPendingPackets} pkts pending`
                                        : rSentPackets > 0 ? `${rSentPackets} pkts sent` : '—'}
                                    </div>
                                  </div>
                                  {rStock.length > 0 && <StockBlock entries={rStock} />}
                                  {rAllocs.length > 0 && (
                                    <div style={{ marginTop: 8 }}>
                                      {action(open ? 'Hide dispatches' : 'Recent dispatches', () =>
                                        setExpandedRetailAllocs(prev => {
                                          const next = new Set(prev)
                                          if (next.has(r.id!)) next.delete(r.id!); else next.add(r.id!)
                                          return next
                                        }))}
                                    </div>
                                  )}
                                  {open && rAllocs.slice(0, 3).map(a => <AllocLine key={a.id} a={a} />)}
                                </div>
                              )
                            })}
                          </div>

                          {isAdmin && (
                            <div style={{ marginTop: 12 }}>
                              {action('View full history', () => setHistoryPartyId(dist.id!))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </Section>

              {independents.length > 0 && (
                <Section label={`Independent retailers · ${independents.length}`}>
                  <div style={{ borderBottom: `0.5px solid ${t.border}` }}>
                    {independents.map(r => {
                      const rAllocs = allocations.filter(a => a.partyId === r.id)
                      const rCredit = rAllocs.filter(a => a.status === 'sent' && a.paymentType === 'credit').reduce((s, a) => s + a.totalAmount, 0)
                      const rAllocated = rAllocs.filter(a => a.status !== 'cancelled').reduce((s, a) => s + a.packets, 0)
                      const rStock = stockEntriesOf(r)
                      const open = expandedRetailAllocs.has(r.id!)
                      const statusOrder: Record<string, number> = { overdue: 0, pending: 1, sent: 2, paid: 3 }
                      const recent = rAllocs
                        .filter(a => a.status !== 'cancelled')
                        .sort((a, b) => (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9))
                        .slice(0, 5)
                      return (
                        <div key={r.id} style={{ borderTop: `0.5px solid ${t.border}`, padding: '18px 0' }}>
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 15, fontWeight: 500, color: t.text }}>{r.name}</div>
                              <div style={{ fontSize: 13, fontWeight: 400, color: t.text3, marginTop: 3 }}>
                                {r.place || r.address}
                              </div>
                              <div style={{ fontSize: 13, fontWeight: 400, color: t.text3, marginTop: 3 }}>
                                {rAllocated > 0 ? `${toDisplay(rAllocated, config.packetsPerCarton)} allocated` : 'Nothing allocated yet'}
                                {rCredit > 0 && ` · ${money(rCredit)} due`}
                              </div>
                            </div>
                            <div style={{ fontSize: 14, fontWeight: 400, whiteSpace: 'nowrap', flexShrink: 0,
                                          color: (r as any).status === 'active' ? t.text2 : t.warn }}>
                              {(r as any).status === 'active' ? 'Active' : 'Prospect'}
                            </div>
                          </div>
                          {rStock.length > 0 && <StockBlock entries={rStock} />}
                          <div style={{ display: 'flex', gap: 14, marginTop: 12 }}>
                            {rAllocs.length > 0 && action(open ? 'Hide allocations' : 'Recent allocations', () =>
                              setExpandedRetailAllocs(prev => {
                                const next = new Set(prev)
                                if (next.has(r.id!)) next.delete(r.id!); else next.add(r.id!)
                                return next
                              }))}
                            {isAdmin && action('View full history', () => setHistoryPartyId(r.id!))}
                          </div>
                          {open && recent.map(a => <AllocLine key={a.id} a={a} />)}
                        </div>
                      )
                    })}
                  </div>
                </Section>
              )}
            </>
          )
        })()}
      </div>
      {modal}

      {/* Dispatch date confirmation */}
      {dispatchDateAlloc && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.55)' }}
            onClick={() => setDispatchDateAlloc(null)} />
          <div style={{ position: 'relative', zIndex: 1, background: t.bg2, borderRadius: 8,
                        padding: '24px 22px', maxWidth: 380, width: '100%',
                        border: `0.5px solid ${t.border2}` }}>
            <div style={{ fontSize: 17, fontWeight: 500, color: t.text, marginBottom: 6 }}>
              {dispatchDateAlloc.fromType === 'distributor' ? 'Confirm this was sent' : 'Dispatch this allocation'}
            </div>
            <div style={{ fontSize: 14, fontWeight: 400, color: t.text3, marginBottom: 20, lineHeight: 1.5 }}>
              {toDisplay(dispatchDateAlloc.packets, config.packetsPerCarton)} of{' '}
              {dispatchDateAlloc.productName} to {dispatchDateAlloc.partyName}.
            </div>

            <Field label="Date it was sent" hint="Today by default. Change it if you are recording a past dispatch.">
              <DateInput type="date" value={dispatchDate} onChange={setDispatchDate} />
            </Field>

            <div style={{ margin: '18px 0' }}>
              <Note tone="warn">
                {dispatchDateAlloc.fromType === 'distributor'
                  ? 'Only confirm this once the distributor has physically sent the stock.'
                  : 'Only dispatch once the stock has physically left the company.'}
              </Note>
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <PrimaryButton
                onClick={async () => { const a = dispatchDateAlloc; setDispatchDateAlloc(null); await handleDispatch(a, dispatchDate) }}
                disabled={acting === dispatchDateAlloc.id}>
                {dispatchDateAlloc.fromType === 'distributor' ? 'Confirm sent' : 'Dispatch'}
              </PrimaryButton>
              <GhostButton onClick={() => setDispatchDateAlloc(null)}>Cancel</GhostButton>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
