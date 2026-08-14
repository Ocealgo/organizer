import { useState, useEffect } from 'react'
import { collection, addDoc, onSnapshot, updateDoc, doc, query, orderBy } from 'firebase/firestore'
import { db } from '../../firebase'
import { ChecklistItem, WorkspaceCategory, AppUser } from '../../types'
import { useAuth } from '../../context/AuthContext'

const CATEGORIES: WorkspaceCategory[] = ['Finance', 'Operations', 'Sales', 'Marketing', 'General']
const CAT_COLOR: Record<WorkspaceCategory, string> = {
  Finance: '#16a34a', Operations: '#0891b2', Sales: '#f59e0b', Marketing: '#7c3aed', General: '#64748b',
}
const CAT_EMOJI: Record<WorkspaceCategory, string> = {
  Finance: '💰', Operations: '⚙️', Sales: '🤝', Marketing: '📣', General: '📝',
}

export default function ChecklistView() {
  const { appUser } = useAuth()
  const [items, setItems] = useState<ChecklistItem[]>([])
  const [admins, setAdmins] = useState<AppUser[]>([])
  const [selectedAdmin, setSelectedAdmin] = useState<string>(appUser?.uid || '')
  const [showAdd, setShowAdd] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ title: '', category: 'General' as WorkspaceCategory })
  const [catFilter, setCatFilter] = useState<'all' | WorkspaceCategory>('all')

  useEffect(() => {
    const q = query(collection(db, 'checklist_items'), orderBy('createdAt', 'desc'))
    return onSnapshot(q, snap => {
      setItems(snap.docs.map(d => ({ id: d.id, ...d.data() } as ChecklistItem)))
    })
  }, [])

  useEffect(() => {
    return onSnapshot(collection(db, 'users'), snap => {
      setAdmins(snap.docs
        .map(d => ({ uid: d.id, ...d.data() } as AppUser))
        .filter(u => u.status === 'approved' && (u.role === 'admin' || u.role === 'super_admin' || u.role === 'sales_manager')))
    })
  }, [])

  useEffect(() => {
    if (appUser) setSelectedAdmin(appUser.uid)
  }, [appUser])

  const handleAdd = async () => {
    if (!form.title.trim()) return
    setSaving(true)
    try {
      await addDoc(collection(db, 'checklist_items'), {
        title: form.title.trim(),
        category: form.category,
        completed: false,
        ownerId: appUser!.uid,
        ownerName: appUser!.name,
        createdAt: Date.now(),
      })
      setForm({ title: '', category: 'General' })
      setShowAdd(false)
    } finally { setSaving(false) }
  }

  const toggleItem = async (item: ChecklistItem) => {
    if (item.ownerId !== appUser?.uid) return // Only owner can toggle
    await updateDoc(doc(db, 'checklist_items', item.id!), {
      completed: !item.completed,
      completedAt: !item.completed ? Date.now() : null,
    })
  }

  const isMyList = selectedAdmin === appUser?.uid

  const adminItems = items.filter(i => {
    if (i.ownerId !== selectedAdmin) return false
    if (catFilter !== 'all' && i.category !== catFilter) return false
    return true
  })

  const pending   = adminItems.filter(i => !i.completed)
  const completed = adminItems.filter(i => i.completed)
  const pct = adminItems.length > 0 ? Math.round((completed.length / adminItems.length) * 100) : 0

  const viewingAdmin = admins.find(a => a.uid === selectedAdmin)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Admin selector */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {[{ uid: appUser?.uid || '', name: 'Me' }, ...admins.filter(a => a.uid !== appUser?.uid).map(a => ({ uid: a.uid, name: a.name }))].map(a => (
          <button key={a.uid} onClick={() => setSelectedAdmin(a.uid)}
            style={{ background: selectedAdmin === a.uid ? 'rgba(59,130,246,0.2)' : 'rgba(255,255,255,0.04)', color: selectedAdmin === a.uid ? '#93c5fd' : '#64748b', border: `1px solid ${selectedAdmin === a.uid ? 'rgba(59,130,246,0.4)' : 'rgba(255,255,255,0.06)'}`, borderRadius: 20, padding: '6px 14px', fontSize: 12, fontWeight: 700 }}>
            {a.name}
          </button>
        ))}
      </div>

      {/* Progress + Add */}
      <div style={{ background: '#161b22', borderRadius: 14, padding: 14, border: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{isMyList ? 'My Checklist' : `${viewingAdmin?.name}'s Checklist`}</div>
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{completed.length}/{adminItems.length} done</div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ fontSize: 18, fontWeight: 900, color: '#93c5fd' }}>{pct}%</div>
            {isMyList && (
              <button onClick={() => setShowAdd(!showAdd)}
                style={{ background: 'rgba(59,130,246,0.2)', border: '1px solid rgba(59,130,246,0.3)', color: '#93c5fd', borderRadius: 8, padding: '6px 12px', fontSize: 11, fontWeight: 700 }}>
                + Add
              </button>
            )}
          </div>
        </div>
        <div style={{ background: 'rgba(255,255,255,0.06)', borderRadius: 99, height: 6, overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: 'linear-gradient(90deg,#1e40af,#3b82f6)', borderRadius: 99, transition: 'width 0.5s' }} />
        </div>
      </div>

      {/* Add form */}
      {showAdd && isMyList && (
        <div style={{ background: '#161b22', borderRadius: 14, padding: 14, border: '1px solid rgba(59,130,246,0.2)', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })}
            placeholder="What needs to be done?"
            onKeyDown={e => e.key === 'Enter' && handleAdd()}
            style={{ background: 'rgba(255,255,255,0.06)', border: '1.5px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '11px 14px', fontSize: 14, color: '#fff', outline: 'none', width: '100%', boxSizing: 'border-box' }} />
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {CATEGORIES.map(c => (
              <button key={c} onClick={() => setForm({ ...form, category: c })}
                style={{ background: form.category === c ? `${CAT_COLOR[c]}22` : 'rgba(255,255,255,0.04)', color: form.category === c ? CAT_COLOR[c] : '#64748b', border: `1px solid ${form.category === c ? CAT_COLOR[c] : 'rgba(255,255,255,0.06)'}`, borderRadius: 20, padding: '5px 12px', fontSize: 11, fontWeight: 700 }}>
                {CAT_EMOJI[c]} {c}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setShowAdd(false)} style={{ flex: 1, background: 'rgba(255,255,255,0.04)', border: 'none', color: '#64748b', borderRadius: 10, padding: 10, fontSize: 13, fontWeight: 700 }}>Cancel</button>
            <button onClick={handleAdd} disabled={saving} style={{ flex: 2, background: saving ? '#475569' : 'linear-gradient(135deg,#1e3a5f,#1e40af)', color: '#fff', border: 'none', borderRadius: 10, padding: 10, fontSize: 13, fontWeight: 800 }}>
              {saving ? 'Saving...' : 'Add Task ✅'}
            </button>
          </div>
        </div>
      )}

      {/* Category filter */}
      <div style={{ display: 'flex', gap: 6, overflowX: 'auto' }}>
        <button onClick={() => setCatFilter('all')}
          style={{ background: catFilter === 'all' ? '#1e40af' : 'rgba(255,255,255,0.04)', color: catFilter === 'all' ? '#fff' : '#64748b', border: 'none', borderRadius: 20, padding: '5px 12px', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>
          All
        </button>
        {CATEGORIES.map(c => (
          <button key={c} onClick={() => setCatFilter(c)}
            style={{ background: catFilter === c ? `${CAT_COLOR[c]}22` : 'rgba(255,255,255,0.04)', color: catFilter === c ? CAT_COLOR[c] : '#64748b', border: `1px solid ${catFilter === c ? CAT_COLOR[c] : 'rgba(255,255,255,0.06)'}`, borderRadius: 20, padding: '5px 12px', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>
            {CAT_EMOJI[c]} {c}
          </button>
        ))}
      </div>

      {/* Pending items */}
      {pending.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 11, color: '#64748b', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>Pending ({pending.length})</div>
          {pending.map(item => (
            <TaskItem key={item.id} item={item} canToggle={isMyList} onToggle={() => toggleItem(item)} />
          ))}
        </div>
      )}

      {/* Completed items */}
      {completed.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 11, color: '#64748b', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>Completed ({completed.length})</div>
          {completed.map(item => (
            <TaskItem key={item.id} item={item} canToggle={isMyList} onToggle={() => toggleItem(item)} />
          ))}
        </div>
      )}

      {adminItems.length === 0 && (
        <div style={{ textAlign: 'center', padding: 32, color: '#475569' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>✅</div>
          <div style={{ fontWeight: 700 }}>{isMyList ? 'Your checklist is empty' : 'No tasks yet'}</div>
          {isMyList && <div style={{ fontSize: 13, marginTop: 6 }}>Tap "+ Add" to create your first task</div>}
        </div>
      )}
    </div>
  )
}

function TaskItem({ item, canToggle, onToggle }: { item: ChecklistItem; canToggle: boolean; onToggle: () => void }) {
  const catColor = CAT_COLOR[item.category]
  const catEmoji = CAT_EMOJI[item.category]
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, background: item.completed ? 'rgba(255,255,255,0.02)' : '#161b22', borderRadius: 12, padding: '12px 14px', border: `1px solid ${item.completed ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.06)'}`, opacity: item.completed ? 0.65 : 1 }}>
      <button onClick={canToggle ? onToggle : undefined}
        style={{ width: 20, height: 20, borderRadius: 5, border: `2px solid ${item.completed ? '#16a34a' : catColor}`, background: item.completed ? '#16a34a' : 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: canToggle ? 'pointer' : 'default', flexShrink: 0, marginTop: 1 }}>
        {item.completed && <span style={{ color: '#fff', fontSize: 11, fontWeight: 900 }}>✓</span>}
      </button>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, color: item.completed ? '#64748b' : '#e2e8f0', fontWeight: 600, textDecoration: item.completed ? 'line-through' : 'none' }}>{item.title}</div>
        <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
          <span style={{ fontSize: 10, background: `${catColor}20`, color: catColor, padding: '2px 8px', borderRadius: 99 }}>{catEmoji} {item.category}</span>
          {item.completed && item.completedAt && (
            <span style={{ fontSize: 10, color: '#475569' }}>Done {new Date(item.completedAt).toLocaleDateString('en-IN')}</span>
          )}
        </div>
      </div>
      {!canToggle && <div style={{ fontSize: 10, color: '#475569' }}>👁️ View only</div>}
    </div>
  )
}
