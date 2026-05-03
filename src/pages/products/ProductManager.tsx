import React, { useState, useEffect } from 'react'
import { collection, addDoc, onSnapshot, updateDoc, doc } from 'firebase/firestore'
import { db } from '../../firebase'
import { Product } from '../../types'
import { useAuth } from '../../context/AuthContext'
import { useTheme } from '../../context/ThemeContext'

interface Props { onBack: () => void }

function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: React.ReactNode }) {
  const { t } = useTheme()
  return (
    <div>
      <div style={{ fontSize: 11, color: t.text2, marginBottom: 6, letterSpacing: 1, textTransform: 'uppercase' }}>{label}</div>
      {hint && <div style={{ fontSize: 11, color: '#6ee7b7', marginBottom: 6 }}>💡 {hint}</div>}
      {children}
      {error && <div style={{ fontSize: 11, color: '#dc2626', marginTop: 4 }}>⚠️ {error}</div>}
    </div>
  )
}

export default function ProductManager({ onBack }: Props) {
  const { appUser } = useAuth()
  const { t } = useTheme()
  const [products, setProducts] = useState<Product[]>([])
  const [tab, setTab] = useState<'list' | 'add'>('list')
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [form, setForm] = useState({
    name: '', unitLabel: 'packets',
    defaultPricePerUnit: '', unitsPerCarton: '',
  })

  useEffect(() => {
    return onSnapshot(collection(db, 'products'), snap => {
      setProducts(snap.docs.map(d => ({ id: d.id, ...d.data() } as Product))
        .sort((a, b) => a.name.localeCompare(b.name)))
    })
  }, [])

  const validate = () => {
    const e: Record<string, string> = {}
    if (!form.name.trim()) e.name = 'Product name is required'
    if (!form.defaultPricePerUnit || parseFloat(form.defaultPricePerUnit) <= 0) e.price = 'Enter a valid price'
    if (!form.unitsPerCarton || parseInt(form.unitsPerCarton) <= 0) e.carton = 'Enter units per carton'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const handleAdd = async () => {
    if (!validate()) return
    setSaving(true)
    try {
      await addDoc(collection(db, 'products'), {
        name: form.name.trim(),
        unitLabel: form.unitLabel,
        defaultPricePerUnit: parseFloat(form.defaultPricePerUnit),
        unitsPerCarton: parseInt(form.unitsPerCarton),
        active: true,
        createdBy: appUser!.uid,
        createdAt: Date.now(),
      })
      setForm({ name: '', unitLabel: 'packets', defaultPricePerUnit: '', unitsPerCarton: '' })
      setErrors({})
      setTab('list')
    } finally { setSaving(false) }
  }

  const toggleActive = async (p: Product) => {
    await updateDoc(doc(db, 'products', p.id!), { active: !p.active })
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', background: t.bg3,
    border: `1.5px solid ${t.border2}`,
    borderRadius: 12, padding: '13px 16px',
    fontSize: 15, color: t.text, outline: 'none', boxSizing: 'border-box',
  }

  return (
    <div style={{ minHeight: '100vh', background: t.bg, paddingBottom: 40 }}>
      <div style={{ background: 'linear-gradient(135deg,#1a5c42,#16a34a)', padding: '20px 20px 0' }}>
        <button onClick={onBack} style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: '#bbf7d0', padding: '6px 14px', borderRadius: 20, fontSize: 12, marginBottom: 14 }}>← Back</button>
        <div style={{ color: '#bbf7d0', fontSize: 11, letterSpacing: 3, textTransform: 'uppercase', marginBottom: 2 }}>Products 📦</div>
        <div style={{ fontSize: 20, fontWeight: 900, color: '#fff', marginBottom: 14 }}>Manage Products</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {(['list', 'add'] as const).map(tb => (
            <button key={tb} onClick={() => setTab(tb)}
              style={{ background: tab === tb ? 'rgba(255,255,255,0.2)' : 'transparent', color: tab === tb ? '#fff' : 'rgba(255,255,255,0.5)', border: 'none', borderRadius: '12px 12px 0 0', padding: '9px 18px', fontSize: 12, fontWeight: 700 }}>
              {tb === 'list' ? `📋 All Products (${products.length})` : '➕ Add Product'}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: '16px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {tab === 'list' && (
          products.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: t.text3 }}>
              <div style={{ fontSize: 36, marginBottom: 10 }}>📦</div>
              <div style={{ fontWeight: 700, color: t.text2 }}>No products yet</div>
              <div style={{ fontSize: 13, marginTop: 6 }}>Tap "Add Product" to get started</div>
            </div>
          ) : products.map(p => (
            <div key={p.id} style={{ background: t.card, borderRadius: 14, padding: 16, border: `1px solid ${p.active ? 'rgba(22,163,74,0.2)' : t.border}`, opacity: p.active ? 1 : 0.6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 44, height: 44, background: p.active ? 'rgba(22,163,74,0.15)' : t.bg3, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>
                  📦
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 800, fontSize: 16, color: t.text }}>{p.name}</div>
                  <div style={{ fontSize: 12, color: t.text2, marginTop: 3 }}>
                    ₹{p.defaultPricePerUnit}/{p.unitLabel} • {p.unitsPerCarton} {p.unitLabel}/carton
                  </div>
                </div>
                <button onClick={() => toggleActive(p)}
                  style={{ background: p.active ? 'rgba(22,163,74,0.12)' : 'rgba(220,38,38,0.1)', border: `1px solid ${p.active ? 'rgba(22,163,74,0.3)' : 'rgba(220,38,38,0.2)'}`, color: p.active ? '#16a34a' : '#dc2626', borderRadius: 10, padding: '6px 12px', fontSize: 11, fontWeight: 700 }}>
                  {p.active ? '✅ Active' : '⏸️ Off'}
                </button>
              </div>
            </div>
          ))
        )}

        {tab === 'add' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Field label="Product Name" error={errors.name}>
              <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Baby Wipes" style={inputStyle} />
            </Field>

            <Field label="Unit Label" hint="What do you call one item?">
              <div style={{ display: 'flex', gap: 8 }}>
                {['packets', 'bottles', 'units', 'pcs'].map(u => (
                  <button key={u} onClick={() => setForm({ ...form, unitLabel: u })}
                    style={{ flex: 1, background: form.unitLabel === u ? 'rgba(22,163,74,0.15)' : t.bg3, color: form.unitLabel === u ? '#16a34a' : t.text2, border: `1.5px solid ${form.unitLabel === u ? '#16a34a' : t.border2}`, borderRadius: 10, padding: '10px 6px', fontSize: 12, fontWeight: 700 }}>
                    {u}
                  </button>
                ))}
              </div>
            </Field>

            <Field label="Default Price Per Unit (₹)" hint="Can be overridden per allocation" error={errors.price}>
              <input type="number" value={form.defaultPricePerUnit} onChange={e => setForm({ ...form, defaultPricePerUnit: e.target.value })}
                placeholder="e.g. 45" style={inputStyle} />
            </Field>

            <Field label="Units Per Carton" error={errors.carton}>
              <input type="number" value={form.unitsPerCarton} onChange={e => setForm({ ...form, unitsPerCarton: e.target.value })}
                placeholder="e.g. 12" style={inputStyle} />
            </Field>

            <button onClick={handleAdd} disabled={saving}
              style={{ background: saving ? '#475569' : 'linear-gradient(135deg,#1a5c42,#16a34a)', color: '#fff', border: 'none', borderRadius: 14, padding: 16, fontSize: 15, fontWeight: 800 }}>
              {saving ? 'Saving...' : 'Add Product 📦'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
