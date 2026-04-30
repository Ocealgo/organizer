import { useState, useEffect } from 'react'
import { collection, addDoc, onSnapshot, updateDoc, doc, query, orderBy } from 'firebase/firestore'
import { db } from '../../firebase'
import { PinnedNote } from '../../types'
import { useAuth } from '../../context/AuthContext'

const MAX_PINS = 10

export default function PinnedNotesView() {
  const { appUser } = useAuth()
  const [notes, setNotes] = useState<PinnedNote[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [showArchived, setShowArchived] = useState(false)

  useEffect(() => {
    const q = query(collection(db, 'pinned_notes'), orderBy('createdAt', 'desc'))
    return onSnapshot(q, snap => {
      setNotes(snap.docs.map(d => ({ id: d.id, ...d.data() } as PinnedNote)))
    })
  }, [])

  const active   = notes.filter(n => !n.archived)
  const archived = notes.filter(n => n.archived)

  const handleAdd = async () => {
    if (!content.trim()) return
    setSaving(true)
    try {
      // If at limit, archive the oldest
      if (active.length >= MAX_PINS) {
        const oldest = [...active].sort((a, b) => a.createdAt - b.createdAt)[0]
        await updateDoc(doc(db, 'pinned_notes', oldest.id!), { archived: true })
      }
      await addDoc(collection(db, 'pinned_notes'), {
        content: content.trim(),
        createdBy: appUser!.uid,
        createdByName: appUser!.name,
        createdAt: Date.now(),
        archived: false,
      })
      setContent('')
      setShowAdd(false)
    } finally { setSaving(false) }
  }

  const archiveNote = async (id: string) => {
    await updateDoc(doc(db, 'pinned_notes', id), { archived: true })
  }

  const unarchiveNote = async (id: string) => {
    // Check if there's room
    if (active.length >= MAX_PINS) {
      alert(`Max ${MAX_PINS} pinned notes. Archive one first.`)
      return
    }
    await updateDoc(doc(db, 'pinned_notes', id), { archived: false })
  }

  const timeAgo = (ts: number) => {
    const diff = Date.now() - ts
    const mins = Math.floor(diff / 60000)
    const hrs  = Math.floor(diff / 3600000)
    const days = Math.floor(diff / 86400000)
    if (mins < 1)  return 'just now'
    if (mins < 60) return `${mins}m ago`
    if (hrs < 24)  return `${hrs}h ago`
    return `${days}d ago`
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Header info */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 12, color: '#64748b' }}>
          {active.length}/{MAX_PINS} pins used
          {active.length >= MAX_PINS && <span style={{ color: '#d97706', marginLeft: 6 }}>• Adding new will archive oldest</span>}
        </div>
        <button onClick={() => setShowAdd(!showAdd)}
          style={{ background: 'rgba(59,130,246,0.2)', border: '1px solid rgba(59,130,246,0.3)', color: '#93c5fd', borderRadius: 10, padding: '7px 14px', fontSize: 12, fontWeight: 700 }}>
          📌 Pin Note
        </button>
      </div>

      {/* Capacity bar */}
      <div style={{ background: 'rgba(255,255,255,0.06)', borderRadius: 99, height: 4, overflow: 'hidden' }}>
        <div style={{ width: `${(active.length / MAX_PINS) * 100}%`, height: '100%', background: active.length >= MAX_PINS ? '#dc2626' : 'linear-gradient(90deg,#1e40af,#3b82f6)', borderRadius: 99, transition: 'width 0.5s' }} />
      </div>

      {/* Add form */}
      {showAdd && (
        <div style={{ background: '#161b22', borderRadius: 14, padding: 14, border: '1px solid rgba(59,130,246,0.2)', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <textarea value={content} onChange={e => setContent(e.target.value)}
            placeholder="Quick note for the team... (e.g. Rajan wants 500 pkts June — confirm price)"
            rows={3}
            style={{ background: 'rgba(255,255,255,0.06)', border: '1.5px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '11px 14px', fontSize: 14, color: '#fff', outline: 'none', width: '100%', boxSizing: 'border-box', resize: 'none' }} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => { setShowAdd(false); setContent('') }} style={{ flex: 1, background: 'rgba(255,255,255,0.04)', border: 'none', color: '#64748b', borderRadius: 10, padding: 10, fontSize: 13, fontWeight: 700 }}>Cancel</button>
            <button onClick={handleAdd} disabled={saving || !content.trim()} style={{ flex: 2, background: saving ? '#475569' : 'linear-gradient(135deg,#1e3a5f,#1e40af)', color: '#fff', border: 'none', borderRadius: 10, padding: 10, fontSize: 13, fontWeight: 800 }}>
              {saving ? 'Pinning...' : 'Pin Note 📌'}
            </button>
          </div>
        </div>
      )}

      {/* Active notes */}
      {active.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 32, color: '#475569' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>📌</div>
          <div style={{ fontWeight: 700 }}>No pinned notes yet</div>
          <div style={{ fontSize: 13, marginTop: 6 }}>Pin quick notes for the founding team</div>
        </div>
      ) : active.map((note, i) => (
        <div key={note.id}
          style={{ background: '#161b22', borderRadius: 14, padding: 16, border: '1px solid rgba(59,130,246,0.15)', position: 'relative' }}>
          {/* Pin number */}
          <div style={{ position: 'absolute', top: -8, left: 12, background: '#1e40af', color: '#fff', fontSize: 9, fontWeight: 900, padding: '2px 8px', borderRadius: 99 }}>
            📌 {i + 1}
          </div>
          <div style={{ fontSize: 14, color: '#e2e8f0', lineHeight: 1.6, marginBottom: 10, marginTop: 4 }}>{note.content}</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <span style={{ fontSize: 11, color: '#3b82f6', fontWeight: 600 }}>— {note.createdByName}</span>
              <span style={{ fontSize: 11, color: '#475569' }}>{timeAgo(note.createdAt)}</span>
            </div>
            <button onClick={() => archiveNote(note.id!)}
              style={{ background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.15)', color: '#dc2626', borderRadius: 8, padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}>
              Archive
            </button>
          </div>
        </div>
      ))}

      {/* Archived section */}
      {archived.length > 0 && (
        <div>
          <button onClick={() => setShowArchived(!showArchived)}
            style={{ background: 'none', border: 'none', color: '#475569', fontSize: 12, cursor: 'pointer', padding: '4px 0', fontWeight: 700 }}>
            {showArchived ? '▼' : '▶'} Archived ({archived.length})
          </button>
          {showArchived && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
              {archived.map(note => (
                <div key={note.id} style={{ background: 'rgba(255,255,255,0.02)', borderRadius: 12, padding: 14, border: '1px solid rgba(255,255,255,0.04)', opacity: 0.6 }}>
                  <div style={{ fontSize: 13, color: '#64748b', lineHeight: 1.5, marginBottom: 8 }}>{note.content}</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 11, color: '#475569' }}>— {note.createdByName} · {new Date(note.createdAt).toLocaleDateString('en-IN')}</span>
                    <button onClick={() => unarchiveNote(note.id!)}
                      style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.15)', color: '#3b82f6', borderRadius: 8, padding: '3px 8px', fontSize: 10, cursor: 'pointer' }}>
                      Unpin
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
