import { useState, useEffect } from 'react'
import { collection } from 'firebase/firestore'
import { onSnapshot } from '../../data/live'
import { db } from '../../firebase'
import { Party, Dispatch, MonthlyRequest, Product } from '../../types'
import DateInput from '../../components/DateInput'
import { useAuth } from '../../context/AuthContext'
import { can } from '../../auth/permissions'
import { useTheme } from '../../context/ThemeContext'
import { useStockConfig, updateStockConfig, toDisplay, setProductStock } from '../../hooks/useFirebase'
import { localMonthStr } from '../../utils/date'
import {
  PageHeader, TabBar, StatGrid, StatCard, Section, EmptyState,
  ChipGroup, GhostButton, PrimaryButton, inputStyle,
} from '../../components/ui'

interface Props { onBack: () => void }

/** A quiet horizontal meter. No gradient — one solid fill on a tinted track. */
function Meter({ pct }: { pct: number }) {
  const { t } = useTheme()
  return (
    <div style={{ background: t.tint, borderRadius: 99, height: 3, overflow: 'hidden' }}>
      <div style={{ height: '100%', background: t.text2, width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </div>
  )
}

export default function StockManager({ onBack }: Props) {
  const { appUser } = useAuth()
  const { t } = useTheme()
  const { config } = useStockConfig()
  const [parties, setParties] = useState<Party[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [dispatches, setDispatches] = useState<Dispatch[]>([])
  const [requests, setRequests] = useState<MonthlyRequest[]>([])
  const [tab, setTab] = useState<'overview' | 'history' | 'monthly'>('overview')
  const [selectedMonth, setSelectedMonth] = useState(localMonthStr())
  const [editCarton, setEditCarton] = useState(false)
  const [newCarton, setNewCarton] = useState('')
  const [editingProductActive, setEditingProductActive] = useState<string | null>(null)
  const [editingProductStock, setEditingProductStock] = useState<Record<string, string>>({})
  const [partyStatusFilter, setPartyStatusFilter] = useState<'all' | 'active' | 'prospect' | 'inactive'>('all')

  const isAdmin = can(appUser, 'edit_stock')

  // Aggregate display values from per-product stock
  const hasProductStock = config.productStock && Object.keys(config.productStock).length > 0
  const displayTotal = hasProductStock ? Object.values(config.productStock!).reduce((s, p) => s + p.total, 0) : config.total
  const displayLocked = hasProductStock ? Object.values(config.productStock!).reduce((s, p) => s + p.locked, 0) : config.locked
  const displayAvailable = displayTotal - displayLocked
  const totalDispatched = dispatches.filter(d => !d.fromType || d.fromType === 'company').reduce((s, d) => s + (d.packets || 0), 0)

  useEffect(() => {
    const u1 = onSnapshot(collection(db, 'parties'), s => setParties(s.docs.map(d => ({ id: d.id, ...d.data() } as Party))))
    const u2 = onSnapshot(collection(db, 'dispatches'), s => setDispatches(s.docs.map(d => ({ id: d.id, ...d.data() } as Dispatch)).sort((a, b) => b.createdAt - a.createdAt)))
    const u3 = onSnapshot(collection(db, 'monthly_requests'), s => setRequests(s.docs.map(d => ({ id: d.id, ...d.data() } as MonthlyRequest))))
    const u4 = onSnapshot(collection(db, 'products'), s => setProducts(s.docs.map(d => ({ id: d.id, ...d.data() } as Product)).filter(p => p.active)))
    return () => { u1(); u2(); u3(); u4() }
  }, [])

  const handleSaveProductStock = async (productId: string) => {
    const val = parseInt(editingProductStock[productId] || '')
    if (isNaN(val) || val < 0) return
    await setProductStock(productId, val)
    setEditingProductActive(null)
  }

  const updateCarton = async () => {
    const val = parseInt(newCarton)
    if (isNaN(val) || val < 1) return
    await updateStockConfig({ packetsPerCarton: val })
    setEditCarton(false); setNewCarton('')
  }

  const filteredParties = partyStatusFilter === 'all'
    ? parties
    : parties.filter(p => (p as any).status === partyStatusFilter)

  const monthOf = dispatches.filter(d => d.month === selectedMonth)
  const monthlyTotal = monthOf.reduce((s, d) => s + d.packets, 0)
  const monthlyRevenue = monthOf.reduce((s, d) => s + d.totalAmount, 0)
  const utilisation = (totalDispatched + displayTotal) > 0
    ? Math.round((totalDispatched / (totalDispatched + displayTotal)) * 100) : 0

  const when = (ts: number, long = false) =>
    new Date(ts).toLocaleString('en-IN', { dateStyle: long ? 'medium' : 'short', timeStyle: 'short' })

  const money = (n: number) => `₹${n.toLocaleString('en-IN')}`

  return (
    <div style={{ minHeight: '100vh', background: t.bg, paddingBottom: 40 }}>
      <PageHeader
        eyebrow="Inventory"
        title="Stock"
        subtitle={`${toDisplay(displayAvailable, config.packetsPerCarton)} available of ${toDisplay(displayTotal, config.packetsPerCarton)} held`}
        onBack={onBack}
        divider={false}
      />
      <TabBar
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'history', label: 'History' },
          { id: 'monthly', label: 'Monthly' },
        ]}
      />

      <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 28 }}>

        {/* OVERVIEW */}
        {tab === 'overview' && (
          <>
            <StatGrid>
              <StatCard value={toDisplay(displayTotal, config.packetsPerCarton)} label="Held" />
              <StatCard value={toDisplay(displayLocked, config.packetsPerCarton)} label="Locked"
                context="Committed to allocations" />
              <StatCard value={toDisplay(displayAvailable, config.packetsPerCarton)} label="Available"
                context="Free to dispatch" />
            </StatGrid>

            <Section label="Utilisation">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 400, color: t.text2 }}>Dispatched against everything received</span>
                <span style={{ fontSize: 14, fontWeight: 500, color: t.text }}>{utilisation}%</span>
              </div>
              <Meter pct={utilisation} />
            </Section>

            {isAdmin && (
              <Section label="Carton size">
                {editCarton ? (
                  <div style={{ display: 'flex', gap: 8, maxWidth: 420 }}>
                    <input type="number" inputMode="numeric" value={newCarton} autoFocus
                      onChange={e => setNewCarton(e.target.value)} placeholder="Packets per carton"
                      style={inputStyle(t)} />
                    <PrimaryButton onClick={updateCarton}>Save</PrimaryButton>
                    <GhostButton onClick={() => setEditCarton(false)}>Cancel</GhostButton>
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
                    <span style={{ fontSize: 14, fontWeight: 400, color: t.text }}>
                      One carton holds {config.packetsPerCarton} packets
                    </span>
                    <button className="oc-action" onClick={() => { setEditCarton(true); setNewCarton(String(config.packetsPerCarton)) }}
                      style={{ background: 'none', border: 'none', padding: 0, fontSize: 13, fontWeight: 400, color: t.text2, cursor: 'pointer' }}>
                      Change
                    </button>
                  </div>
                )}
              </Section>
            )}

            {isAdmin && (
              <Section label="Stock per product">
                {products.length === 0 ? (
                  <EmptyState
                    title="No active products"
                    body="Add products in the Products screen before setting stock against them."
                  />
                ) : (
                  <div style={{ borderBottom: `0.5px solid ${t.border}` }}>
                    {products.map(p => {
                      const pStk = config.productStock?.[p.id!]
                      const pTotal = pStk?.total ?? 0
                      const pLocked = pStk?.locked ?? 0
                      const pAvail = pTotal - pLocked
                      const isEditing = editingProductActive === p.id
                      return (
                        <div key={p.id} style={{ borderTop: `0.5px solid ${t.border}`, padding: '16px 0' }}>
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 15, fontWeight: 500, color: t.text }}>{p.name}</div>
                              <div style={{ fontSize: 13, fontWeight: 400, color: t.text3, marginTop: 3 }}>
                                {toDisplay(pTotal, config.packetsPerCarton)} held ·{' '}
                                {toDisplay(pLocked, config.packetsPerCarton)} locked
                              </div>
                            </div>
                            <div style={{ fontSize: 14, fontWeight: 400, color: pAvail > 0 ? t.text2 : t.warn, whiteSpace: 'nowrap' }}>
                              {toDisplay(pAvail, config.packetsPerCarton)} free
                            </div>
                            {!isEditing && (
                              <button className="oc-action"
                                onClick={() => { setEditingProductActive(p.id!); setEditingProductStock(prev => ({ ...prev, [p.id!]: String(pTotal) })) }}
                                style={{ background: 'none', border: 'none', padding: 0, fontSize: 13, fontWeight: 400, color: t.text2, cursor: 'pointer', flexShrink: 0 }}>
                                Set total
                              </button>
                            )}
                          </div>
                          {isEditing && (
                            <div style={{ display: 'flex', gap: 8, marginTop: 12, maxWidth: 420 }}>
                              <input type="number" inputMode="numeric" autoFocus
                                value={editingProductStock[p.id!] ?? ''}
                                onChange={e => setEditingProductStock(prev => ({ ...prev, [p.id!]: e.target.value }))}
                                placeholder="Total packets in stock" style={inputStyle(t)} />
                              <PrimaryButton onClick={() => handleSaveProductStock(p.id!)}>Save</PrimaryButton>
                              <GhostButton onClick={() => setEditingProductActive(null)}>Cancel</GhostButton>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </Section>
            )}

            <Section label="Recent dispatches">
              {dispatches.length === 0 ? (
                <EmptyState title="Nothing dispatched yet" body="Dispatches appear here as soon as the first allocation goes out." />
              ) : (
                <div style={{ borderBottom: `0.5px solid ${t.border}` }}>
                  {dispatches.slice(0, 5).map(d => (
                    <div key={d.id} style={{ display: 'flex', alignItems: 'baseline', gap: 16, borderTop: `0.5px solid ${t.border}`, padding: '14px 0' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 15, fontWeight: 500, color: t.text }}>{d.partyName}</div>
                        <div style={{ fontSize: 13, fontWeight: 400, color: t.text3, marginTop: 3 }}>
                          {toDisplay(d.packets, config.packetsPerCarton)} · {when(d.dispatchedAt)}
                        </div>
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 400, color: d.paymentType === 'cash' ? t.text2 : t.warn, whiteSpace: 'nowrap' }}>
                        {d.paymentType === 'cash' ? 'Cash' : 'Credit'}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Section>
          </>
        )}

        {/* HISTORY */}
        {tab === 'history' && (
          <>
            <Section label="Month">
              <div style={{ maxWidth: 220 }}>
                <DateInput type="month" value={selectedMonth} onChange={v => setSelectedMonth(v)} />
              </div>
            </Section>

            {monthOf.length === 0 ? (
              <EmptyState title="No dispatches this month" body="Pick another month, or dispatch an allocation to start the record." />
            ) : (
              <div style={{ borderBottom: `0.5px solid ${t.border}` }}>
                {monthOf.map(d => (
                  <div key={d.id} style={{ borderTop: `0.5px solid ${t.border}`, padding: '16px 0' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 15, fontWeight: 500, color: t.text }}>{d.partyName}</div>
                        <div style={{ fontSize: 13, fontWeight: 400, color: t.text3, marginTop: 3 }}>
                          {when(d.dispatchedAt, true)} · by {d.dispatchedByName}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div style={{ fontSize: 15, fontWeight: 500, color: t.text }}>{money(d.totalAmount)}</div>
                        <div style={{ fontSize: 13, fontWeight: 400, color: d.paymentType === 'cash' ? t.text3 : t.warn, marginTop: 3 }}>
                          {toDisplay(d.packets, config.packetsPerCarton)} · {d.paymentType === 'cash' ? 'Cash' : 'Credit'}
                        </div>
                      </div>
                    </div>
                    {d.notes && (
                      <div style={{ fontSize: 13, fontWeight: 400, color: t.text3, marginTop: 8, lineHeight: 1.5 }}>
                        {d.notes}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* MONTHLY SUMMARY */}
        {tab === 'monthly' && (
          <>
            <Section label="Month">
              <div style={{ maxWidth: 220 }}>
                <DateInput type="month" value={selectedMonth} onChange={v => setSelectedMonth(v)} />
              </div>
            </Section>

            <StatGrid>
              <StatCard value={toDisplay(monthlyTotal, config.packetsPerCarton)} label="Dispatched" />
              <StatCard value={money(monthlyRevenue)} label="Value" />
              <StatCard value={monthOf.length} label="Dispatches" />
            </StatGrid>

            <Section label="By distributor and retailer">
              <div style={{ marginBottom: 16 }}>
                <ChipGroup
                  value={partyStatusFilter}
                  onChange={setPartyStatusFilter}
                  options={[
                    { id: 'all', label: 'All' },
                    { id: 'active', label: 'Active' },
                    { id: 'prospect', label: 'Prospect' },
                    { id: 'inactive', label: 'Inactive' },
                  ] as const}
                />
              </div>

              {(() => {
                const rows = filteredParties.filter(party =>
                  monthOf.some(d => d.partyId === party.id) ||
                  requests.some(r => r.partyId === party.id && r.month === selectedMonth))
                if (rows.length === 0) {
                  return <EmptyState title="Nothing to show" body="No party in this filter had activity in the selected month." />
                }
                return (
                  <div style={{ borderBottom: `0.5px solid ${t.border}` }}>
                    {rows.map(party => {
                      const pd = monthOf.filter(d => d.partyId === party.id)
                      const req = requests.find(r => r.partyId === party.id && r.month === selectedMonth)
                      const dispatched = pd.reduce((s, d) => s + d.packets, 0)
                      return (
                        <div key={party.id} style={{ borderTop: `0.5px solid ${t.border}`, padding: '16px 0' }}>
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 15, fontWeight: 500, color: t.text }}>{party.name}</div>
                              <div style={{ fontSize: 13, fontWeight: 400, color: t.text3, marginTop: 3 }}>
                                {party.category} · {party.place || party.address}
                              </div>
                            </div>
                            {req && (
                              <div style={{ fontSize: 14, fontWeight: 400, whiteSpace: 'nowrap',
                                            color: req.status === 'fulfilled' ? t.text2 : t.warn }}>
                                {req.status === 'fulfilled' ? 'Fulfilled' : req.status === 'partial' ? 'Partly filled' : 'Pending'}
                              </div>
                            )}
                          </div>

                          {req && (
                            <div style={{ marginTop: 12 }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 400, color: t.text3, marginBottom: 6 }}>
                                <span>Asked for {toDisplay(req.requestedPackets, config.packetsPerCarton)}</span>
                                <span>Sent {toDisplay(dispatched, config.packetsPerCarton)}</span>
                              </div>
                              <Meter pct={req.requestedPackets > 0 ? (dispatched / req.requestedPackets) * 100 : 0} />
                            </div>
                          )}

                          {pd.map(d => (
                            <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 16, marginTop: 12 }}>
                              <span style={{ fontSize: 13, fontWeight: 400, color: t.text2 }}>
                                {toDisplay(d.packets, config.packetsPerCarton)} · {when(d.dispatchedAt)}
                              </span>
                              <span style={{ fontSize: 13, fontWeight: 400, color: d.paymentType === 'cash' ? t.text2 : t.warn, whiteSpace: 'nowrap' }}>
                                {money(d.totalAmount)} {d.paymentType === 'cash' ? 'cash' : 'credit'}
                              </span>
                            </div>
                          ))}
                        </div>
                      )
                    })}
                  </div>
                )
              })()}
            </Section>
          </>
        )}
      </div>
    </div>
  )
}
