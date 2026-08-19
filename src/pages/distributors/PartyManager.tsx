import { useState, useEffect } from 'react'
import { collection, addDoc, deleteDoc, doc, updateDoc, deleteField } from 'firebase/firestore'
import { onSnapshot } from '../../data/live'
import { db } from '../../firebase'
import {
  Party, PartyType, PartyCategory, Dispatch, UnifiedAllocation, Product, GeoPoint,
  OutletType, OUTLET_TYPE_LABEL, PIN_SOURCE_LABEL, PIN_MOVE_ALERT_M,
} from '../../types'
import { useAuth } from '../../context/AuthContext'
import { can } from '../../auth/permissions'
import { useTheme } from '../../context/ThemeContext'
import { useStockConfig, toDisplay } from '../../hooks/useFirebase'
import { setPartyPin, accurateEnoughForPin } from '../../data/partyPin'
import { getFixOrReason, distanceM } from '../../device/location'
import CustomSelect from '../../components/CustomSelect'
import LazyMap from '../../components/LazyMap'
import AllocationManager from './AllocationManager'
import CSVImporter from './CSVImporter'
import { useConfirm } from '../../hooks/useConfirm'
import { INDIAN_STATES } from '../../data'
import {
  PageHeader, TabBar, Section, EmptyState, Field, ChipGroup, Note,
  GhostButton, PrimaryButton, inputStyle,
} from '../../components/ui'

interface Props { onBack: () => void }

const CATEGORIES: PartyCategory[] = ['FMCG', 'Pharma', 'General Store', 'Supermarket', 'Online', 'Other']
const PARTY_PAGE_SIZE = 5

function validatePhone(p: string) { return /^[6-9]\d{9}$/.test(p.trim()) }

const emptyForm = {
  name: '', type: 'distributor' as PartyType, category: 'FMCG' as PartyCategory,
  outletType: 'distributor' as OutletType,
  phone: '', address: '', place: '', district: '', state: '', pincode: '', quantity: '',
  lowStockThreshold: '', underDistributorId: '', email: '',
  productId: '', productName: '',
}

const ALLOC_STATUS_LABEL: Record<string, string> = {
  pending: 'Pending', sent: 'Sent', overdue: 'Cut off', paid: 'Paid',
}

export default function PartyManager({ onBack }: Props) {
  const { appUser } = useAuth()
  const { t } = useTheme()
  const { config } = useStockConfig()
  const { modal, showDanger } = useConfirm()
  const [parties, setParties] = useState<Party[]>([])
  const [allocations, setAllocations] = useState<UnifiedAllocation[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [tab, setTab] = useState<'list' | 'add' | 'allocations' | 'import'>('list')
  const [dispatches, setDispatches] = useState<Dispatch[]>([])
  const [expandedDispatch, setExpandedDispatch] = useState<string | null>(null)
  const [expandedRetailAlloc, setExpandedRetailAlloc] = useState<string | null>(null)
  const [typeFilter, setTypeFilter] = useState<'all' | 'distributor' | 'retailer'>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'prospect' | 'inactive'>('all')
  const [categoryFilter, setCategoryFilter] = useState<'all' | PartyCategory>('all')
  const [distributorFilter, setDistributorFilter] = useState<'all' | 'independent' | string>('all')
  const [placeSearch, setPlaceSearch] = useState('')
  const [districtFilter, setDistrictFilter] = useState<string>('all')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [unit, setUnit] = useState<'packets' | 'cartons'>('packets')
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  /**
   * The pin as the form currently proposes it, applied on save like every
   * other field. Kept out of `form` because it is not a string and, unlike the
   * rest, moving it has to be written down rather than just written.
   */
  const [pinDraft, setPinDraft] = useState<{ lat: number; lng: number } | null>(null)
  const [showMap, setShowMap] = useState(false)
  const [locating, setLocating] = useState(false)
  const [pinNote, setPinNote] = useState<string | null>(null)
  /** Set when Save was pressed and something above it was not filled in. */
  const [blocked, setBlocked] = useState(false)
  const [focusParent, setFocusParent] = useState(false)
  const [showEmail, setShowEmail] = useState(false)
  const [showAllocation, setShowAllocation] = useState(false)
  const [partyPage, setPartyPage] = useState(0)

  const canEditParties = can(appUser, 'edit_parties')
  const canDeleteParties = can(appUser, 'delete_parties')
  const canDispatch = can(appUser, 'dispatch_allocations')
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

  useEffect(() => { setPartyPage(0) }, [typeFilter, statusFilter, categoryFilter, distributorFilter, placeSearch, districtFilter])

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
    if (districtFilter !== 'all' && (p as any).district !== districtFilter) return false
    return true
  })

  const toPackets = (qty: string) => {
    const n = parseInt(qty) || 0
    return unit === 'cartons' ? n * config.packetsPerCarton : n
  }

  const validate = () => {
    const e: Record<string, string> = {}
    if (!form.name.trim()) e.name = 'Enter a name.'
    if (!validatePhone(form.phone)) e.phone = 'Enter a 10-digit Indian mobile number.'
    if (!form.address.trim()) e.address = 'Enter the address.'
    if (!form.place.trim()) e.place = 'Enter the place or area.'
    if (!form.district.trim()) e.district = 'Enter the district.'
    if (!form.state.trim()) e.state = 'Pick the state.'
    if (!/^\d{6}$/.test(form.pincode.trim())) e.pincode = 'Enter a 6-digit pincode.'

    const phoneDup = parties.find(p => p.id !== editingId && p.phone.trim() === form.phone.trim())
    if (phoneDup) e.phone = `This number is already registered to ${phoneDup.name}.`

    const locDup = parties.find(p =>
      p.id !== editingId &&
      p.name.trim().toLowerCase() === form.name.trim().toLowerCase() &&
      (p.place || '').toLowerCase() === form.place.trim().toLowerCase() &&
      (p.district || '').toLowerCase() === form.district.trim().toLowerCase() &&
      (p.pincode || '') === form.pincode.trim()
    )
    if (locDup) e.name = `A ${locDup.type} called ${locDup.name} already exists at ${locDup.place}, ${locDup.district} ${locDup.pincode}.`

    setErrors(e)
    return Object.keys(e).length === 0
  }

  const startEdit = (p: Party) => {
    const packets = p.packetsAllocated || 0
    setForm({
      name: p.name, type: p.type, category: p.category || 'FMCG',
      outletType: p.outletType ?? (p.type === 'distributor' ? 'distributor' : 'general'),
      phone: p.phone, address: p.address, place: p.place || '',
      district: p.district || '',
      state: p.state || '',
      pincode: p.pincode || '',
      quantity: String(packets),
      lowStockThreshold: String(p.lowStockThreshold || 0),
      underDistributorId: p.underDistributorId || '',
      email: p.email || '',
      productId: (p as any).productId || '',
      productName: (p as any).productName || '',
    })
    setUnit('packets')
    setEditingId(p.id!)
    setPinDraft(p.coordinates ? { lat: p.coordinates.lat, lng: p.coordinates.lng } : null)
    setShowMap(false)
    setPinNote(null)
    setFocusParent(false)
    setShowEmail(!!p.email)
    setShowAllocation(packets > 0)
    setTab('add')
  }

  const startChangeParent = (p: Party) => {
    startEdit(p)
    setFocusParent(true)
  }

  const resetForm = () => {
    setForm(emptyForm); setEditingId(null); setErrors({}); setBlocked(false)
    setPinDraft(null); setShowMap(false); setPinNote(null)
    setFocusParent(false); setShowEmail(false); setShowAllocation(false)
  }

  /** The party being edited, when one is — the source for the pin's history. */
  const editingParty = editingId ? parties.find(p => p.id === editingId) ?? null : null
  const savedPin = editingParty?.coordinates ?? null
  const pinMovedM = savedPin && pinDraft ? Math.round(distanceM(savedPin, pinDraft)) : null
  const pinChanged = !!pinDraft && (!savedPin || (pinMovedM ?? 0) > 0)

  /**
   * "It is here, not there" — for whoever is actually standing at the shop.
   *
   * The best correction to a pin comes from somebody at the door with a good
   * fix, not from an office reading an address. A vague fix is refused for
   * this the same way it is refused on a first visit: it may prove a visit
   * happened, but it may not decide where a shop is.
   */
  async function pinFromHere() {
    if (!appUser) return
    setLocating(true); setPinNote(null)
    const { fix, issue } = await getFixOrReason({ capturedBy: appUser.uid })
    setLocating(false)
    if (!fix) {
      setPinNote(issue === 'denied'
        ? 'Location is switched off for Ocealgo, so it cannot be read from here.'
        : 'No location available right now. Place the pin on the map instead.')
      return
    }
    if (!accurateEnoughForPin(fix)) {
      setPinNote(`Your location is only accurate to about ${Math.round(fix.accuracy)} m — too vague to register a shop by. Place the pin on the map instead.`)
      return
    }
    setPinDraft({ lat: fix.lat, lng: fix.lng })
    setPinNote(`Taken from where you are standing, accurate to about ${Math.round(fix.accuracy)} m.`)
  }

  const handleSave = async () => {
    // Named at the button. Every error is drawn beside its own field, and with
    // the map open those fields are several screens up — so a Save that failed
    // validation produced no visible response at all, which reads as a button
    // that does not work rather than a form that is not finished.
    if (!validate()) { setBlocked(true); return }
    setBlocked(false)
    setSaving(true)
    try {
      const packets = toPackets(form.quantity)
      const cartons = unit === 'cartons' ? parseInt(form.quantity) : Math.floor(packets / config.packetsPerCarton)
      const underDist = distributors.find(d => d.id === form.underDistributorId)
      const data: any = {
        name: form.name.trim(), type: form.type, category: form.category,
        outletType: form.outletType,
        phone: form.phone.trim(), address: form.address.trim(), place: form.place.trim(),
        district: form.district.trim(),
        state: form.state.trim(),
        pincode: form.pincode.trim(),
        ...(form.email.trim() ? { email: form.email.trim() } : {}),
        ...(form.productId ? { productId: form.productId, productName: form.productName } : {}),
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

      // A pin placed here is placed by somebody who may be nowhere near the
      // shop, so it carries no accuracy figure — `how: 'map'` is the honest
      // description of what it is, and the history says who did it.
      const placedPin: GeoPoint | null = pinDraft
        ? { lat: pinDraft.lat, lng: pinDraft.lng, accuracy: 0,
            capturedAt: Date.now(), capturedBy: appUser!.uid }
        : null

      if (editingId) {
        await updateDoc(doc(db, 'parties', editingId), data)
        // Separately, and only when it actually moved. Moving a shop's pin is
        // moving its geofence, so it goes through the one path that records
        // the move rather than being folded into a field update.
        if (placedPin && pinChanged && editingParty) {
          await setPartyPin(editingParty, placedPin, 'map', appUser!)
        }
        setEditingId(null)
      } else {
        data.addedBy = appUser!.uid
        data.addedByName = appUser!.name
        data.createdAt = Date.now()
        data.status = 'prospect'
        if (placedPin) {
          data.coordinates = placedPin
          data.coordinatesSetBy = appUser!.uid
          data.coordinatesSetByName = appUser!.name
          data.coordinatesSetAt = placedPin.capturedAt
          data.coordinatesHistory = [{
            at: placedPin.capturedAt, by: appUser!.uid, byName: appUser!.name,
            to: placedPin, how: 'map',
          }]
        }
        await addDoc(collection(db, 'parties'), data)
        if (appUser?.role === 'offline_sales' || appUser?.role === 'online_sales') {
          await addDoc(collection(db, 'alerts'), {
            type: 'new_party',
            message: `${appUser.name} added ${form.type}: ${form.name.trim()} — needs ${toDisplay(packets, config.packetsPerCarton)}`,
            relatedId: form.name, toRole: 'admin_group',
            read: false, createdAt: Date.now(),
          })
        }
      }
      resetForm()
      setTab('list')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    const outstanding = allocations
      .filter((a) =>
        a.partyId === id &&
        a.paymentType === 'credit' &&
        (a.status === 'sent' || a.status === 'overdue') &&
        (a as any).fromType !== 'distributor',
      )
      .reduce((s, a) => s + Math.max(0, (a.totalAmount || 0) - ((a as any).paidAmount || 0)), 0)

    if (outstanding > 0) {
      await showDanger(
        'Dues are still open',
        `This party owes ₹${outstanding.toLocaleString('en-IN')} on credit. Clear it before deleting the record.`,
        'OK',
      )
      return
    }

    if (!await showDanger('Delete this entry?', 'The record and its details are removed. This cannot be undone.')) return
    setDeleting(id)
    await deleteDoc(doc(db, 'parties', id))
    setDeleting(null)
  }

  if (tab === 'import') return <CSVImporter onBack={() => setTab('list')} onDone={() => setTab('list')} />
  if (tab === 'allocations') return <AllocationManager onBack={() => setTab('list')} parties={parties} isAdmin={canDispatch} />

  const distributorOptions = distributors.map(d => ({ value: d.id!, label: d.name }))
  const uniqueDistricts = [...new Set(parties.map(p => p.district).filter(Boolean))].sort() as string[]
  const pageCount = Math.ceil(filtered.length / PARTY_PAGE_SIZE)

  const action = (label: string, onClick: () => void, disabled?: boolean) => (
    <button className="oc-action" onClick={onClick} disabled={disabled}
      style={{ background: 'none', border: 'none', padding: 0, fontSize: 13, fontWeight: 400,
               color: t.text2, cursor: 'pointer', opacity: disabled ? 0.5 : 1 }}>
      {label}
    </button>
  )

  const subLine = (text: string) => (
    <div style={{ fontSize: 13, fontWeight: 400, color: t.text3, marginTop: 3 }}>{text}</div>
  )

  return (
    <div style={{ minHeight: '100vh', background: t.bg, paddingBottom: 40 }}>
      <PageHeader
        eyebrow="Network"
        title="Distributors and retailers"
        subtitle={`${distributors.length} distributors · ${parties.filter(p => p.type === 'retailer').length} retailers`}
        onBack={onBack}
        divider={false}
      />
      <TabBar
        value={tab}
        onChange={id => { setTab(id); if (id !== 'add') resetForm() }}
        tabs={[
          { id: 'list', label: 'All' },
          { id: 'add', label: editingId ? 'Editing' : 'Add' },
          ...(canEditParties ? [{ id: 'import' as const, label: 'Import' }] : []),
          { id: 'allocations', label: 'Allocations' },
        ]}
      />

      {/* A column of records, not a table — capped so the lines stay a
          readable length on a wide screen. */}
      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 28, maxWidth: 820 }}>

        {/* LIST */}
        {tab === 'list' && (
          <>
            <Section label="Find">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ maxWidth: 460 }}>
                  <input value={placeSearch} onChange={e => setPlaceSearch(e.target.value)}
                    placeholder="Search by name, place or area" style={inputStyle(t)} />
                </div>

                <ChipGroup
                  value={typeFilter}
                  onChange={f => { setTypeFilter(f); if (f === 'distributor') setDistributorFilter('all') }}
                  options={[
                    { id: 'all', label: 'Everyone' },
                    { id: 'distributor', label: 'Distributors' },
                    { id: 'retailer', label: 'Retailers' },
                  ] as const}
                />

                <ChipGroup
                  value={statusFilter}
                  onChange={setStatusFilter}
                  options={[
                    { id: 'all', label: 'Any status' },
                    { id: 'active', label: 'Active' },
                    { id: 'prospect', label: 'Prospect' },
                    { id: 'inactive', label: 'Inactive' },
                  ] as const}
                />

                <ChipGroup
                  value={categoryFilter}
                  onChange={setCategoryFilter}
                  options={[{ id: 'all' as const, label: 'Any category' },
                            ...CATEGORIES.map(c => ({ id: c, label: c }))]}
                />

                {uniqueDistricts.length > 0 && (
                  <ChipGroup
                    value={districtFilter}
                    onChange={setDistrictFilter}
                    options={[{ id: 'all', label: 'Any district' },
                              ...uniqueDistricts.map(d => ({ id: d, label: d }))]}
                  />
                )}

                {typeFilter !== 'distributor' && distributors.length > 0 && (
                  <div style={{ maxWidth: 460 }}>
                    <Field label="Under distributor">
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
                    </Field>
                  </div>
                )}
              </div>
            </Section>

            <Section label={`Showing ${filtered.length} of ${parties.length}`}>
              {filtered.length === 0 ? (
                <EmptyState
                  title="Nothing matches those filters"
                  body="Loosen a filter, or add a new distributor or retailer."
                  actionLabel="Add one"
                  onAction={() => setTab('add')}
                />
              ) : (
                <div style={{ borderBottom: `0.5px solid ${t.border}` }}>
                  {filtered.slice(partyPage * PARTY_PAGE_SIZE, (partyPage + 1) * PARTY_PAGE_SIZE).map(p => {
                    const pAllocs = allocations.filter(a => a.partyId === p.id && a.status !== 'cancelled')
                    const allocatedPkts = pAllocs.reduce((s, a) => s + a.packets, 0)
                    const stockEntries = Object.entries(p.stock || {}).filter(([, qty]) => (qty as number) > 0)
                    return (
                      <div key={p.id} style={{ borderTop: `0.5px solid ${t.border}`, padding: '18px 0' }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 15, fontWeight: 500, color: t.text }}>
                              {p.name}
                              <span style={{ fontSize: 13, fontWeight: 400, color: t.text3, marginLeft: 8 }}>
                                {p.type === 'distributor' ? 'Distributor' : 'Retailer'} · {p.category}
                              </span>
                            </div>
                            {subLine(p.phone + (p.email ? ` · ${p.email}` : ''))}
                            {subLine([p.address, p.place].filter(Boolean).join(', '))}
                            {(p.district || p.state || p.pincode) &&
                              subLine([p.district, p.state, p.pincode].filter(Boolean).join(', '))}
                            {p.underDistributorName && subLine(`Under ${p.underDistributorName}`)}
                            {/* Answering "where is this shop?" without making
                                anyone open the edit form to find out — and
                                saying plainly when nobody knows, since that is
                                why its visits carry no distance. */}
                            <div style={{ fontSize: 13, fontWeight: 400, color: t.text3, marginTop: 3 }}>
                              {p.coordinates ? (
                                <a href={`https://www.google.com/maps?q=${p.coordinates.lat},${p.coordinates.lng}`}
                                  target="_blank" rel="noopener noreferrer"
                                  style={{ color: t.accent, textDecoration: 'underline', textUnderlineOffset: 3 }}>
                                  On the map
                                </a>
                              ) : 'No position set — visits here record no distance'}
                            </div>
                          </div>
                          <div style={{ fontSize: 14, fontWeight: 400, color: t.text2, whiteSpace: 'nowrap', flexShrink: 0 }}>
                            {toDisplay(allocatedPkts, config.packetsPerCarton)}
                          </div>
                        </div>

                        {stockEntries.length > 0 && (
                          <div style={{ marginTop: 12, background: t.tint, borderRadius: 6, padding: '11px 13px' }}>
                            <div style={{ fontSize: 11, letterSpacing: '0.09em', textTransform: 'uppercase',
                                          color: t.text3, marginBottom: 7 }}>
                              In stock
                            </div>
                            {stockEntries.map(([pid, qty]) => {
                              const prod = products.find(pr => pr.id === pid)
                              return (
                                <div key={pid} style={{ display: 'flex', justifyContent: 'space-between',
                                                        fontSize: 13, fontWeight: 400, color: t.text2, marginTop: 3 }}>
                                  <span>{prod?.name || pid}</span>
                                  <span>{toDisplay(qty as number, config.packetsPerCarton)}</span>
                                </div>
                              )
                            })}
                          </div>
                        )}

                        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 12 }}>
                          {action('Edit', () => startEdit(p))}
                          {p.type === 'retailer' && action('Change parent', () => startChangeParent(p))}
                          {p.type === 'distributor' && action(
                            expandedDispatch === p.id ? 'Hide dispatches' : 'Dispatches',
                            () => setExpandedDispatch(expandedDispatch === p.id ? null : p.id!))}
                          {p.type === 'retailer' && action(
                            expandedRetailAlloc === p.id ? 'Hide allocations' : 'Allocations',
                            () => setExpandedRetailAlloc(expandedRetailAlloc === p.id ? null : p.id!))}
                          {canDeleteParties && action('Delete', () => handleDelete(p.id!), deleting === p.id)}
                        </div>

                        {p.type === 'distributor' && expandedDispatch === p.id && (() => {
                          const pd = dispatches.filter(d => d.partyId === p.id).slice(0, 3)
                          return pd.length === 0 ? (
                            <div style={{ fontSize: 13, fontWeight: 400, color: t.text3, marginTop: 12 }}>
                              Nothing dispatched to them yet.
                            </div>
                          ) : (
                            <div style={{ marginTop: 12 }}>
                              {pd.map(d => (
                                <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between',
                                                         alignItems: 'baseline', gap: 16, marginTop: 6,
                                                         fontSize: 13, fontWeight: 400 }}>
                                  <span style={{ color: t.text2 }}>
                                    {toDisplay(d.packets, config.packetsPerCarton)} ·{' '}
                                    {new Date(d.dispatchedAt || d.createdAt).toLocaleDateString('en-IN')}
                                  </span>
                                  <span style={{ color: d.paymentType === 'cash' ? t.text3 : t.warn, whiteSpace: 'nowrap' }}>
                                    {d.paymentType === 'cash' ? 'Cash' : 'Credit'}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )
                        })()}

                        {p.type === 'retailer' && expandedRetailAlloc === p.id && (() => {
                          const statusOrder: Record<string, number> = { overdue: 0, pending: 1, sent: 2, paid: 3 }
                          const pa = allocations
                            .filter(a => a.partyId === p.id && a.status !== 'cancelled')
                            .sort((a, b) => (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9))
                            .slice(0, 5)
                          return pa.length === 0 ? (
                            <div style={{ fontSize: 13, fontWeight: 400, color: t.text3, marginTop: 12 }}>
                              No allocations for them yet.
                            </div>
                          ) : (
                            <div style={{ marginTop: 12 }}>
                              {pa.map(a => (
                                <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between',
                                                         alignItems: 'baseline', gap: 16, marginTop: 6,
                                                         fontSize: 13, fontWeight: 400 }}>
                                  <span style={{ color: t.text2 }}>
                                    {toDisplay(a.packets, config.packetsPerCarton)} · {a.plannedDate}
                                  </span>
                                  <span style={{ whiteSpace: 'nowrap',
                                                 color: a.status === 'paid' ? t.text3 : t.warn }}>
                                    {ALLOC_STATUS_LABEL[a.status] ?? a.status}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )
                        })()}

                        <div style={{ fontSize: 12, fontWeight: 400, color: t.text3, marginTop: 12 }}>
                          Added by {p.addedByName}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {pageCount > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 16 }}>
                  <GhostButton onClick={() => setPartyPage(p => Math.max(0, p - 1))} disabled={partyPage === 0}>
                    Previous
                  </GhostButton>
                  <span style={{ fontSize: 13, fontWeight: 400, color: t.text3 }}>
                    Page {partyPage + 1} of {pageCount}
                  </span>
                  <GhostButton onClick={() => setPartyPage(p => Math.min(pageCount - 1, p + 1))}
                    disabled={partyPage >= pageCount - 1}>
                    Next
                  </GhostButton>
                </div>
              )}
            </Section>
          </>
        )}

        {/* ADD / EDIT */}
        {tab === 'add' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 460 }}>
            {editingId && <Note>Editing an existing entry. Changes apply the moment you save.</Note>}

            {!editingId && (
              <Field label="Type">
                <ChipGroup
                  value={form.type}
                  onChange={ty => setForm({
                    ...form, type: ty,
                    outletType: ty === 'distributor' ? 'distributor' : 'general',
                    ...(ty === 'distributor' ? { underDistributorId: '' } : {}),
                  })}
                  options={[
                    { id: 'distributor' as PartyType, label: 'Distributor' },
                    { id: 'retailer' as PartyType, label: 'Retailer' },
                  ]}
                />
              </Field>
            )}

            <Field label="Channel"
              hint="Decides which extra fields a rep must fill in when visiting them.">
              <CustomSelect
                value={form.outletType}
                onChange={v => setForm({ ...form, outletType: v as OutletType })}
                searchable={false}
                options={(Object.keys(OUTLET_TYPE_LABEL) as OutletType[])
                  .map(k => ({ value: k, label: OUTLET_TYPE_LABEL[k] }))}
              />
            </Field>

            {!editingId && (
              <Note>
                New entries start as a prospect — a contact who is not buying yet. Move them to active once
                they place an order, and to inactive if they stop.
              </Note>
            )}

            <Field label="Category">
              <ChipGroup
                value={form.category}
                onChange={c => setForm({ ...form, category: c })}
                options={CATEGORIES.map(c => ({ id: c, label: c }))}
              />
            </Field>

            {form.type === 'retailer' && distributors.length > 0 && (
              <Field
                label="Parent distributor"
                hint={focusParent
                  ? 'Pick the distributor this retailer now buys through.'
                  : 'Link a retailer to a distributor to track distribution. Leave it unset for an independent retailer.'}>
                <CustomSelect
                  value={form.underDistributorId}
                  onChange={v => { setForm({ ...form, underDistributorId: v }); setFocusParent(false) }}
                  placeholder="Independent retailer"
                  options={[{ value: '', label: 'Independent retailer' }, ...distributorOptions]}
                />
              </Field>
            )}

            <Field label="Full name" error={errors.name}>
              <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                placeholder="Rajan Enterprises" style={inputStyle(t)} />
            </Field>

            <Field label="Phone number" error={errors.phone}>
              <input type="tel" inputMode="numeric" value={form.phone}
                onChange={e => setForm({ ...form, phone: e.target.value.replace(/\D/g, '').slice(0, 10) })}
                placeholder="10-digit mobile number" style={inputStyle(t)} />
            </Field>

            {!showEmail ? (
              <GhostButton onClick={() => setShowEmail(true)} style={{ alignSelf: 'flex-start' }}>
                Add an email address
              </GhostButton>
            ) : (
              <Field label="Email address">
                <input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}
                  placeholder="rajan@example.com" style={inputStyle(t)} />
                <div style={{ marginTop: 8 }}>
                  {action('Remove email', () => { setShowEmail(false); setForm({ ...form, email: '' }) })}
                </div>
              </Field>
            )}

            <Field label="Full address" error={errors.address}>
              <input type="text" value={form.address} onChange={e => setForm({ ...form, address: e.target.value })}
                placeholder="12/A, MG Road, Koramangala" style={inputStyle(t)} />
            </Field>

            <Field label="Place or area" hint="Used for filtering the list." error={errors.place}>
              <input type="text" value={form.place} onChange={e => setForm({ ...form, place: e.target.value })}
                placeholder="Koramangala" style={inputStyle(t)} />
            </Field>

            <Field label="District" error={errors.district}>
              <input type="text" value={form.district} onChange={e => setForm({ ...form, district: e.target.value })}
                placeholder="Ernakulam" style={inputStyle(t)} />
            </Field>

            <Field label="State" error={errors.state}>
              <CustomSelect
                value={form.state}
                onChange={v => setForm({ ...form, state: v })}
                placeholder="Pick a state"
                options={INDIAN_STATES.map(s => ({ value: s, label: s }))}
                error={!!errors.state}
                searchable
              />
            </Field>

            <Field label="Pincode" error={errors.pincode}>
              <input type="text" inputMode="numeric" value={form.pincode}
                onChange={e => setForm({ ...form, pincode: e.target.value.replace(/\D/g, '').slice(0, 6) })}
                placeholder="6-digit pincode" style={inputStyle(t)} />
            </Field>

            {/* ── Where the shop is ───────────────────────────────────────────
                The pin is the geofence every visit to this shop is measured
                against, so this is not a decorative field. It was previously
                set once by whichever rep happened to punch in first and could
                never be corrected by anybody — a fix that landed across the
                road branded honest visits as out-of-range for good. */}
            <div style={{ borderTop: `0.5px solid ${t.border}`, paddingTop: 20,
                          display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 400, color: t.text }}>Position on the map</div>

              <div style={{ fontSize: 13, fontWeight: 400, color: t.text3, lineHeight: 1.6 }}>
                {!pinDraft
                  ? 'Not set. Visits to this outlet are recorded without a distance until it is.'
                  : !savedPin
                    ? 'A new position will be registered when you save.'
                    : pinMovedM === 0
                      ? `${savedPin.lat.toFixed(5)}, ${savedPin.lng.toFixed(5)}`
                      : `Moving it ${pinMovedM} m from where it is now.`}
                {savedPin && editingParty?.coordinatesSetByName && pinMovedM === 0 && (
                  <div style={{ marginTop: 3 }}>
                    Set by {editingParty.coordinatesSetByName}
                    {editingParty.coordinatesSetAt
                      ? ` on ${new Date(editingParty.coordinatesSetAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}
                    {editingParty.coordinatesHistory?.length
                      ? ` — ${PIN_SOURCE_LABEL[editingParty.coordinatesHistory[editingParty.coordinatesHistory.length - 1].how]}`
                      : ''}.
                  </div>
                )}
              </div>

              {pinMovedM !== null && pinMovedM > PIN_MOVE_ALERT_M && (
                <Note tone="warn">
                  That is further than any visit could have been judged against. Saving it
                  will tell the admin team, because a shop that moves this far is a
                  different place rather than a corrected one.
                </Note>
              )}

              <div className="oc-wrap" style={{ gap: 10 }}>
                <GhostButton onClick={() => setShowMap(!showMap)}>
                  {showMap ? 'Hide the map' : pinDraft ? 'Move it on the map' : 'Place it on the map'}
                </GhostButton>
                <GhostButton onClick={pinFromHere} disabled={locating}>
                  {locating ? 'Reading your location…' : 'Set from where I am standing'}
                </GhostButton>
                {pinChanged && (
                  <GhostButton onClick={() => {
                    setPinDraft(savedPin ? { lat: savedPin.lat, lng: savedPin.lng } : null)
                    setPinNote(null)
                  }}>
                    Undo
                  </GhostButton>
                )}
              </div>

              {pinNote && (
                <div style={{ fontSize: 13, color: t.text3, lineHeight: 1.6 }}>{pinNote}</div>
              )}

              {showMap && (
                <div>
                  <LazyMap
                    value={pinDraft ? { ...pinDraft, accuracy: 0, capturedAt: 0 } : null}
                    onChange={(lat, lng) => { setPinDraft({ lat, lng }); setPinNote(null) }}
                    search
                    height={280}
                  />
                  {/* Its own way out. A map fills a phone screen and eats the
                      swipe that would carry you down to Save. */}
                  <div style={{ marginTop: 12 }}>
                    <GhostButton onClick={() => setShowMap(false)}>
                      {pinChanged ? 'Use this position' : 'Done with the map'}
                    </GhostButton>
                  </div>
                </div>
              )}

              {/* Every position this shop has had. A movable pin is a movable
                  geofence; showing the moves is what keeps moving one honest. */}
              {(editingParty?.coordinatesHistory?.length ?? 0) > 1 && (
                <div>
                  <div style={{ fontSize: 12, color: t.text3, marginBottom: 6 }}>History</div>
                  <div style={{ borderBottom: `0.5px solid ${t.border}` }}>
                    {[...editingParty!.coordinatesHistory!].reverse().map((h, i) => (
                      <div key={i} style={{ borderTop: `0.5px solid ${t.border}`, padding: '8px 0',
                                            fontSize: 12, color: t.text3, lineHeight: 1.6 }}>
                        {new Date(h.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                        {' · '}{h.byName}
                        {' · '}{h.movedM !== undefined ? `moved it ${h.movedM} m` : PIN_SOURCE_LABEL[h.how]}
                        {h.movedM !== undefined && ` (${PIN_SOURCE_LABEL[h.how]})`}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Optional allocation — hidden for retailers under a distributor */}
            {!(form.type === 'retailer' && form.underDistributorId) && (
              !showAllocation ? (
                <GhostButton onClick={() => setShowAllocation(true)} style={{ alignSelf: 'flex-start' }}>
                  Add an opening allocation
                </GhostButton>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20,
                              borderTop: `0.5px solid ${t.border}`, paddingTop: 20 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 16 }}>
                    <div style={{ fontSize: 13, fontWeight: 400, color: t.text }}>Opening allocation</div>
                    {action('Remove', () => {
                      setShowAllocation(false)
                      setForm({ ...form, quantity: '', lowStockThreshold: '', productId: '', productName: '' })
                    })}
                  </div>

                  <Field label="Product">
                    {products.length === 0 ? (
                      <div style={{ fontSize: 13, fontWeight: 400, color: t.text3 }}>
                        No products added yet. Add one in the Products screen first.
                      </div>
                    ) : (
                      <ChipGroup
                        value={form.productId}
                        onChange={id => {
                          const pr = products.find(x => x.id === id)
                          setForm({ ...form, productId: id, productName: pr?.name || '' })
                        }}
                        options={products.map(pr => ({ id: pr.id!, label: pr.name }))}
                      />
                    )}
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

                  {canEditParties && (
                    <Field label="Low stock alert"
                      hint="An admin is alerted when what they hold falls below this.">
                      <input type="number" inputMode="numeric" value={form.lowStockThreshold}
                        onChange={e => setForm({ ...form, lowStockThreshold: e.target.value })}
                        placeholder="50" style={inputStyle(t)} />
                    </Field>
                  )}
                </div>
              )
            )}

            {blocked && Object.keys(errors).length > 0 && (
              <div style={{ fontSize: 13, color: t.warn, lineHeight: 1.6 }}>
                {Object.values(errors).join(' ')}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
              <PrimaryButton onClick={handleSave} disabled={saving}>
                {saving ? 'Saving' : editingId ? 'Save changes'
                  : `Add ${form.type === 'distributor' ? 'distributor' : 'retailer'}`}
              </PrimaryButton>
              <GhostButton onClick={() => { resetForm(); setTab('list') }}>Cancel</GhostButton>
            </div>
          </div>
        )}
      </div>
      {modal}
    </div>
  )
}
