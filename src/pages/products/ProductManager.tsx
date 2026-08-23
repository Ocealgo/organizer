import { useState, useEffect } from 'react'
import { collection, addDoc, updateDoc, doc, deleteDoc } from 'firebase/firestore'
import { onSnapshot } from '../../data/live'
import { db } from '../../firebase'
import { Product } from '../../types'
import { useAuth } from '../../context/AuthContext'
import { useTheme } from '../../context/ThemeContext'
import { useConfirm } from '../../hooks/useConfirm'
import {
  PageHeader, TabBar, EmptyState, Field, ChipGroup, Note,
  GhostButton, PrimaryButton, inputStyle,
} from '../../components/ui'

interface Props { onBack: () => void }

const UNIT_LABELS = ['packets', 'bottles', 'units', 'pcs', 'boxes', 'sachets'] as const

const emptyForm = { name: '', unitLabel: 'packets', defaultPricePerUnit: '', unitsPerCarton: '' }

export default function ProductManager({ onBack }: Props) {
  const { appUser } = useAuth()
  const { t } = useTheme()
  const { modal, showDanger } = useConfirm()
  const [products, setProducts] = useState<Product[]>([])
  const [tab, setTab] = useState<'list' | 'add'>('list')
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm)

  useEffect(() => {
    return onSnapshot(collection(db, 'products'), snap => {
      setProducts(snap.docs.map(d => ({ id: d.id, ...d.data() } as Product))
        .sort((a, b) => a.name.localeCompare(b.name)))
    })
  }, [])

  const validate = () => {
    const e: Record<string, string> = {}
    if (!form.name.trim()) e.name = 'Enter a product name.'
    if (!form.defaultPricePerUnit || parseFloat(form.defaultPricePerUnit) <= 0) e.price = 'Enter a price above zero.'
    if (!form.unitsPerCarton || parseInt(form.unitsPerCarton) <= 0) e.carton = 'Enter how many go in a carton.'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const startEdit = (p: Product) => {
    setForm({
      name: p.name,
      unitLabel: p.unitLabel,
      defaultPricePerUnit: String(p.defaultPricePerUnit),
      unitsPerCarton: String(p.unitsPerCarton),
    })
    setEditingId(p.id!)
    setErrors({})
    setTab('add')
  }

  const handleSave = async () => {
    if (!validate()) return
    setSaving(true)
    try {
      const data = {
        name: form.name.trim(),
        unitLabel: form.unitLabel,
        defaultPricePerUnit: parseFloat(form.defaultPricePerUnit),
        unitsPerCarton: parseInt(form.unitsPerCarton),
      }
      if (editingId) {
        await updateDoc(doc(db, 'products', editingId), data)
      } else {
        await addDoc(collection(db, 'products'), {
          ...data, active: true,
          createdBy: appUser!.uid, createdAt: Date.now(),
        })
      }
      setForm(emptyForm)
      setEditingId(null)
      setErrors({})
      setTab('list')
    } catch (e) { await report(editingId ? 'save that product' : 'add that product', e) }
    finally { setSaving(false) }
  }

  // A rejected write used to do nothing at all, which is indistinguishable
  // from a button that does not work.
  const report = async (what: string, e: any) => {
    console.error(`[ProductManager] ${what} failed`, e)
    await showDanger(
      `Could not ${what}`,
      e?.code === 'permission-denied'
        ? 'Firestore rejected this. Managing products needs an admin account, or the manage_products permission.'
        : e?.message || 'Something went wrong. Please try again.',
      'OK',
    )
  }

  const toggleActive = async (p: Product) => {
    try {
      await updateDoc(doc(db, 'products', p.id!), { active: !p.active })
    } catch (e) { await report('change that product', e) }
  }

  const handleDelete = async (p: Product) => {
    if (!await showDanger(
      `Delete ${p.name}?`,
      'Past allocations and stock records keep their own copy of the name, so history is not affected. This cannot be undone.',
    )) return
    try {
      await deleteDoc(doc(db, 'products', p.id!))
    } catch (e) { await report('delete that product', e) }
  }

  const cancelEdit = () => {
    setForm(emptyForm)
    setEditingId(null)
    setErrors({})
    setTab('list')
  }

  const action = (label: string, onClick: () => void) => (
    <button className="oc-action" onClick={onClick}
      style={{ background: 'none', border: 'none', padding: 0, fontSize: 13, fontWeight: 400, color: t.text2, cursor: 'pointer' }}>
      {label}
    </button>
  )

  return (
    <div style={{ minHeight: 'var(--oc-screen)', background: t.bg, paddingBottom: 40 }}>
      <PageHeader eyebrow="Catalogue" title="Products" onBack={onBack} divider={false} />
      <TabBar
        value={tab}
        onChange={id => { if (id === 'list') cancelEdit(); else setTab('add') }}
        tabs={[
          { id: 'list', label: `All ${products.length}` },
          { id: 'add', label: editingId ? 'Editing' : 'Add product' },
        ]}
      />

      {tab === 'list' && (
        products.length === 0 ? (
          <div style={{ padding: '28px 20px 0' }}>
            <EmptyState
              title="No products yet"
              body="Add the products your team sells. Prices set here become the default on every allocation."
              actionLabel="Add a product"
              onAction={() => setTab('add')}
            />
          </div>
        ) : (
          <div className="oc-list-flush" style={{ borderBottom: `0.5px solid ${t.border}` }}>
            {products.map(p => (
              <div key={p.id}
                style={{
                  display: 'flex', alignItems: 'baseline', gap: 16,
                  borderTop: `0.5px solid ${t.border}`, padding: '16px 20px',
                  opacity: p.active ? 1 : 0.5,
                }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 500, color: t.text }}>
                    {p.name}
                    {!p.active && (
                      <span style={{ fontSize: 12, fontWeight: 400, color: t.text3, marginLeft: 8 }}>
                        Hidden
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 400, color: t.text3, marginTop: 3 }}>
                    ₹{p.defaultPricePerUnit} per {p.unitLabel.replace(/s$/, '')} · {p.unitsPerCarton} {p.unitLabel} per carton
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 14, flexShrink: 0 }}>
                  {action('Edit', () => startEdit(p))}
                  {action(p.active ? 'Hide' : 'Show', () => toggleActive(p))}
                  {action('Delete', () => handleDelete(p))}
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {tab === 'add' && (
        <div style={{ padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 460 }}>
          {editingId && <Note>Editing an existing product. Changes apply the moment you save.</Note>}

          <Field label="Product name" error={errors.name}>
            <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
              placeholder="Baby wet wipes" style={inputStyle(t)} />
          </Field>

          <Field label="Unit" hint="What one item is called on an invoice.">
            <ChipGroup options={UNIT_LABELS} value={form.unitLabel as typeof UNIT_LABELS[number]}
              onChange={u => setForm({ ...form, unitLabel: u })} />
          </Field>

          <Field label={`Price per ${form.unitLabel.replace(/s$/, '')}`}
            hint="A rep can override this on an individual allocation." error={errors.price}>
            <input type="number" inputMode="decimal" value={form.defaultPricePerUnit}
              onChange={e => setForm({ ...form, defaultPricePerUnit: e.target.value })}
              placeholder="45" style={inputStyle(t)} />
          </Field>

          <Field label={`${form.unitLabel.charAt(0).toUpperCase() + form.unitLabel.slice(1)} per carton`} error={errors.carton}>
            <input type="number" inputMode="numeric" value={form.unitsPerCarton}
              onChange={e => setForm({ ...form, unitsPerCarton: e.target.value })}
              placeholder="12" style={inputStyle(t)} />
            {form.unitsPerCarton && form.defaultPricePerUnit && (
              <div style={{ fontSize: 13, fontWeight: 400, color: t.text3, marginTop: 7 }}>
                One carton is {form.unitsPerCarton} {form.unitLabel}, worth ₹
                {(parseInt(form.unitsPerCarton) * parseFloat(form.defaultPricePerUnit)).toLocaleString('en-IN')}.
              </div>
            )}
          </Field>

          <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
            <PrimaryButton onClick={handleSave} disabled={saving}>
              {saving ? 'Saving' : editingId ? 'Save changes' : 'Add product'}
            </PrimaryButton>
            <GhostButton onClick={cancelEdit}>Cancel</GhostButton>
          </div>
        </div>
      )}
      {modal}
    </div>
  )
}
