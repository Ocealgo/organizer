import { useState, useEffect } from 'react'
import { collection, addDoc, updateDoc, doc, query, orderBy } from 'firebase/firestore'
import { onSnapshot } from '../../data/live'
import { db } from '../../firebase'
import { ChecklistItem, WorkspaceCategory, AppUser } from '../../types'
import { useAuth } from '../../context/AuthContext'
import { useTheme } from '../../context/ThemeContext'
import { Eyebrow, EmptyState, GhostButton, PrimaryButton, inputStyle } from '../../components/ui'

const CATEGORIES: WorkspaceCategory[] = ['Finance', 'Operations', 'Sales', 'Marketing', 'General']

export default function ChecklistView() {
  const { appUser } = useAuth()
  const { t } = useTheme()
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
  const viewingAdmin = admins.find(a => a.uid === selectedAdmin)

  const chip = (active: boolean) => ({
    background: 'none',
    border: `0.5px solid ${active ? t.text2 : t.border}`,
    borderRadius: 99,
    padding: '5px 12px',
    fontSize: 12,
    fontWeight: 400,
    color: active ? t.text : t.text3,
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Whose list */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {[{ uid: appUser?.uid || '', name: 'Mine' },
          ...admins.filter(a => a.uid !== appUser?.uid).map(a => ({ uid: a.uid, name: a.name }))
        ].map(a => (
          <button key={a.uid} className="oc-action" onClick={() => setSelectedAdmin(a.uid)}
            style={chip(selectedAdmin === a.uid)}>
            {a.name}
          </button>
        ))}
      </div>

      {/* Progress */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 500, color: t.text }}>
            {isMyList ? 'Your tasks' : `${viewingAdmin?.name ?? 'Their'} tasks`}
          </div>
          <div style={{ fontSize: 13, color: t.text3, marginTop: 2 }}>
            {adminItems.length === 0
              ? 'Nothing on the list'
              : `${completed.length} of ${adminItems.length} done`}
          </div>
        </div>
        {isMyList && (
          <GhostButton onClick={() => setShowAdd(!showAdd)}>
            {showAdd ? 'Cancel' : 'Add a task'}
          </GhostButton>
        )}
      </div>

      {/* Add form */}
      {showAdd && isMyList && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })}
            placeholder="What needs doing?"
            onKeyDown={e => e.key === 'Enter' && handleAdd()}
            style={inputStyle(t)} />
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {CATEGORIES.map(c => (
              <button key={c} className="oc-action" onClick={() => setForm({ ...form, category: c })}
                style={chip(form.category === c)}>
                {c}
              </button>
            ))}
          </div>
          <div>
            <PrimaryButton onClick={handleAdd} disabled={saving || !form.title.trim()}>
              {saving ? 'Saving…' : 'Add it'}
            </PrimaryButton>
          </div>
        </div>
      )}

      {/* Category filter */}
      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
        <button className="oc-action" onClick={() => setCatFilter('all')} style={chip(catFilter === 'all')}>
          All
        </button>
        {CATEGORIES.map(c => (
          <button key={c} className="oc-action" onClick={() => setCatFilter(c)} style={chip(catFilter === c)}>
            {c}
          </button>
        ))}
      </div>

      {adminItems.length === 0 ? (
        <EmptyState
          title={isMyList ? 'Your list is clear' : 'Nothing on this list'}
          body={isMyList
            ? 'Add the things you keep meaning to do — chase a payment, call a distributor, check a price.'
            : 'This person has not added any tasks yet.'}
          actionLabel={isMyList && !showAdd ? 'Add a task' : undefined}
          onAction={isMyList && !showAdd ? () => setShowAdd(true) : undefined}
        />
      ) : (
        <>
          {pending.length > 0 && (
            <div>
              <div style={{ marginBottom: 10 }}><Eyebrow>To do ({pending.length})</Eyebrow></div>
              <div style={{ borderBottom: `0.5px solid ${t.border}` }}>
                {pending.map(item => (
                  <TaskItem key={item.id} item={item} canToggle={isMyList} onToggle={() => toggleItem(item)} />
                ))}
              </div>
            </div>
          )}

          {completed.length > 0 && (
            <div>
              <div style={{ marginBottom: 10 }}><Eyebrow>Done ({completed.length})</Eyebrow></div>
              <div style={{ borderBottom: `0.5px solid ${t.border}` }}>
                {completed.map(item => (
                  <TaskItem key={item.id} item={item} canToggle={isMyList} onToggle={() => toggleItem(item)} />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function TaskItem({ item, canToggle, onToggle }: { item: ChecklistItem; canToggle: boolean; onToggle: () => void }) {
  const { t } = useTheme()
  return (
    <div className={canToggle ? 'oc-row' : undefined}
      style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '13px 10px', borderTop: `0.5px solid ${t.border}` }}>
      <button onClick={canToggle ? onToggle : undefined}
        aria-pressed={item.completed}
        style={{
          width: 17, height: 17, borderRadius: 4, flexShrink: 0, marginTop: 2,
          border: `1px solid ${item.completed ? t.text2 : t.border2}`,
          background: item.completed ? t.text2 : 'none',
          cursor: canToggle ? 'pointer' : 'default',
        }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 14, fontWeight: 400,
          color: item.completed ? t.text3 : t.text,
          textDecoration: item.completed ? 'line-through' : 'none',
        }}>
          {item.title}
        </div>
        <div style={{ fontSize: 12, color: t.text3, marginTop: 3 }}>
          {item.category}
          {item.completed && item.completedAt &&
            ` · done ${new Date(item.completedAt).toLocaleDateString('en-IN')}`}
        </div>
      </div>
      {!canToggle && <span style={{ fontSize: 12, color: t.text3, flexShrink: 0 }}>View only</span>}
    </div>
  )
}
