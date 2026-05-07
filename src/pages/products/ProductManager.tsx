import React, { useState, useEffect } from 'react'
import { collection, addDoc, onSnapshot, updateDoc, doc, deleteDoc } from 'firebase/firestore'
import { db } from '../../firebase'
import { Product } from '../../types'
import { useAuth } from '../../context/AuthContext'
import { useTheme } from '../../context/ThemeContext'
import { useConfirm } from '../../hooks/useConfirm'

interface Props { onBack: () => void }

function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: React.ReactNode }) {
  const { t } = useTheme()
  return (
    <div>
      <div style={{ fontSize: 11, color: t.text2, marginBottom: 6, letterSpacing: 1, textTransform: 'uppercase' }}>{label}</div>
      {hint && <div style={{ fontSize: 11, color: t.text2, marginBottom: 6 }}>{hint}</div>}
      {children}
      {error && <div style={{ fontSize: 11, color: '#ef4444', marginTop: 4 }}>{error}</div>}
    </div>
  )
}

const UNIT_LABELS = ['packets', 'bottles', 'units', 'pcs', 'boxes', 'sachets']

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

  const inputStyle: React.CSSProperties = {
    width: '100%', background: t.bg3, border: `1.5px solid ${t.border2}`,
    borderRadius: 12, padding: '13px 16px', fontSize: 16,
    color: t.text, outline: 'none', boxSizing: 'border-box',
  }

  const validate = () => {
    const e: Record<string, string> = {}
    if (!form.name.trim()) e.name = 'Product name is required'
    if (!form.defaultPricePerUnit || parseFloat(form.defaultPricePerUnit) <= 0) e.price = 'Enter a valid price'
    if (!form.unitsPerCarton || parseInt(form.unitsPerCarton) <= 0) e.carton = 'Enter units per carton'
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
    } finally { setSaving(false) }
  }

  const toggleActive = async (p: Product) => {
    await updateDoc(doc(db, 'products', p.id!), { active: !p.active })
  }

  const handleDelete = async (p: Product) => {
    if (!await showDanger(`Delete "${p.name}"?`, 'This cannot be undone.')) return
    await deleteDoc(doc(db, 'products', p.id!))
  }

  const cancelEdit = () => {
    setForm(emptyForm)
    setEditingId(null)
    setErrors({})
    setTab('list')
  }

  return (
    <div style={{ minHeight: '100vh', background: t.bg, paddingBottom: 40 }}>
      <div style={{ background: '#000000', padding: '20px 20px 0' }}>
        <button onClick={onBack} style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: 'rgba(255,255,255,0.7)', padding: '6px 14px', borderRadius: 20, fontSize: 12, marginBottom: 14 }}>← Back</button>
        <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11, letterSpacing: 3, textTransform: 'uppercase', marginBottom: 2 }}>Catalogue</div>
        <div style={{ fontSize: 20, fontWeight: 900, color: '#fff', marginBottom: 14 }}>Products</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {([
            { id: 'list', label: `All (${products.length})` },
            { id: 'add',  label: editingId ? 'Editing' : 'Add New' },
          ] as const).map(tb => (
            <button key={tb.id} onClick={() => { if (tb.id === 'list') cancelEdit(); else setTab('add') }}
              style={{ background: tab === tb.id ? 'rgba(255,255,255,0.2)' : 'transparent', color: tab === tb.id ? '#fff' : 'rgba(255,255,255,0.5)', border: 'none', borderRadius: '12px 12px 0 0', padding: '9px 18px', fontSize: 12, fontWeight: 700 }}>
              {tb.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: '16px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* LIST */}
        {tab === 'list' && (
          products.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: t.text3 }}>
              <div style={{ fontWeight: 700, fontSize: 16, color: t.text2 }}>No products yet</div>
              <div style={{ fontSize: 14, marginTop: 6 }}>Tap "Add New" to add your first product</div>
            </div>
          ) : products.map(p => (
            <div key={p.id} style={{ background: t.card, borderRadius: 14, padding: 16, border: `1px solid ${p.active ? t.border2 : t.border}`, opacity: p.active ? 1 : 0.55 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 46, height: 46, background: p.active ? 'rgba(255,255,255,0.08)' : t.bg3, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 800, color: t.text2, flexShrink: 0 }}>
                  {p.name.charAt(0).toUpperCase()}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 800, fontSize: 16, color: t.text }}>{p.name}</div>
                  <div style={{ fontSize: 13, color: t.text2, marginTop: 3 }}>
                    ₹{p.defaultPricePerUnit}/{p.unitLabel} • {p.unitsPerCarton} {p.unitLabel}/carton
                  </div>
                </div>
                {/* Edit + Toggle + Delete */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <button onClick={() => startEdit(p)}
                    style={{ background: t.bg3, border: `1px solid ${t.border2}`, color: t.text, borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 700 }}>
                    Edit
                  </button>
                  <button onClick={() => toggleActive(p)}
                    style={{ background: p.active ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)', border: `1px solid ${p.active ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}`, color: p.active ? '#22c55e' : '#ef4444', borderRadius: 8, padding: '6px 10px', fontSize: 11, fontWeight: 700 }}>
                    {p.active ? 'On' : 'Off'}
                  </button>
                  <button onClick={() => handleDelete(p)}
                    style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#ef4444', borderRadius: 8, padding: '6px 10px', fontSize: 11, fontWeight: 700 }}>
                    Del
                  </button>
                </div>
              </div>
            </div>
          ))
        )}

        {/* ADD / EDIT */}
        {tab === 'add' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {editingId && (
              <div style={{ background: t.bg3, border: `1px solid ${t.border2}`, borderRadius: 10, padding: '10px 14px', fontSize: 13, color: t.text2 }}>
                Editing existing product — changes save immediately
              </div>
            )}

            <Field label="Product Name" error={errors.name}>
              <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Baby Wet Wipes" style={inputStyle} />
            </Field>

            <Field label="Unit Label" hint="What do you call one item?">
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {UNIT_LABELS.map(u => (
                  <button key={u} onClick={() => setForm({ ...form, unitLabel: u })}
                    style={{ background: form.unitLabel === u ? t.primary : t.bg3, color: form.unitLabel === u ? t.primaryText : t.text2, border: `1.5px solid ${form.unitLabel === u ? t.primary : t.border2}`, borderRadius: 20, padding: '8px 16px', fontSize: 13, fontWeight: 700 }}>
                    {u}
                  </button>
                ))}
              </div>
            </Field>

            <Field label={`Default Price Per ${form.unitLabel} (₹)`} hint="Can be overridden per allocation" error={errors.price}>
              <input type="number" value={form.defaultPricePerUnit} onChange={e => setForm({ ...form, defaultPricePerUnit: e.target.value })}
                placeholder="e.g. 45" style={inputStyle} />
            </Field>

            <Field label={`${form.unitLabel.charAt(0).toUpperCase() + form.unitLabel.slice(1)} Per Carton`} error={errors.carton}>
              <input type="number" value={form.unitsPerCarton} onChange={e => setForm({ ...form, unitsPerCarton: e.target.value })}
                placeholder="e.g. 12" style={inputStyle} />
              {form.unitsPerCarton && form.defaultPricePerUnit && (
                <div style={{ fontSize: 13, color: '#22c55e', marginTop: 6, fontWeight: 600 }}>
                  1 carton = {form.unitsPerCarton} {form.unitLabel} = ₹{(parseInt(form.unitsPerCarton) * parseFloat(form.defaultPricePerUnit)).toLocaleString()}
                </div>
              )}
            </Field>

            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={cancelEdit}
                style={{ flex: 1, background: t.bg3, border: 'none', color: t.text2, borderRadius: 12, padding: 14, fontSize: 14, fontWeight: 700 }}>
                Cancel
              </button>
              <button onClick={handleSave} disabled={saving}
                style={{ flex: 2, background: saving ? t.bg3 : t.primary, color: saving ? t.text2 : t.primaryText, border: 'none', borderRadius: 12, padding: 14, fontSize: 15, fontWeight: 800 }}>
                {saving ? 'Saving...' : editingId ? 'Save Changes' : 'Add Product'}
              </button>
            </div>
          </div>
        )}
      {modal}
      </div>
    </div>
  )
}
