import { useState, useEffect } from 'react'
import { collection, addDoc, updateDoc, doc, query, orderBy } from 'firebase/firestore'
import { onSnapshot } from '../../data/live'
import { db } from '../../firebase'
import { PinnedNote } from '../../types'
import { useAuth } from '../../context/AuthContext'
import { useTheme } from '../../context/ThemeContext'
import { useConfirm } from '../../hooks/useConfirm'
import { EmptyState, GhostButton, PrimaryButton, inputStyle } from '../../components/ui'

const MAX_PINS = 10

export default function PinnedNotesView() {
  const { appUser } = useAuth()
  const { t } = useTheme()
  const [notes, setNotes] = useState<PinnedNote[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const { modal, showAlert } = useConfirm()

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
    if (active.length >= MAX_PINS) {
      await showAlert('All ten pins are in use', 'Archive one note before bringing this back.')
      return
    }
    await updateDoc(doc(db, 'pinned_notes', id), { archived: false })
  }

  const timeAgo = (ts: number) => {
    const diff = Date.now() - ts
    const mins = Math.floor(diff / 60000)
    const hrs  = Math.floor(diff / 3600000)
    const days = Math.floor(diff / 86400000)
    if (mins < 1)  return 'Just now'
    if (mins < 60) return `${mins}m ago`
    if (hrs < 24)  return `${hrs}h ago`
    return `${days}d ago`
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ fontSize: 13, color: t.text3 }}>
          {active.length} of {MAX_PINS} pins used
          {active.length >= MAX_PINS && (
            <span style={{ color: t.warn }}> · a new note will archive the oldest</span>
          )}
        </div>
        <GhostButton onClick={() => setShowAdd(!showAdd)}>
          {showAdd ? 'Cancel' : 'Pin a note'}
        </GhostButton>
      </div>

      {showAdd && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            placeholder="Something the team should see — e.g. Rajan wants 500 packets in June, confirm the price first"
            rows={3}
            style={{ ...inputStyle(t), resize: 'none', lineHeight: 1.6 }}
          />
          <div>
            <PrimaryButton onClick={handleAdd} disabled={saving || !content.trim()}>
              {saving ? 'Pinning…' : 'Pin it'}
            </PrimaryButton>
          </div>
        </div>
      )}

      {active.length === 0 ? (
        <EmptyState
          title="Nothing pinned"
          body="Pin a short note when something needs to stay in front of the team — a price to confirm, a promise made, a number to chase."
          actionLabel={showAdd ? undefined : 'Pin a note'}
          onAction={showAdd ? undefined : () => setShowAdd(true)}
        />
      ) : (
        <div style={{ borderBottom: `0.5px solid ${t.border}` }}>
          {active.map(note => (
            <div key={note.id} style={{ borderTop: `0.5px solid ${t.border}`, padding: '16px 0' }}>
              <div style={{ fontSize: 15, fontWeight: 400, color: t.text, lineHeight: 1.6 }}>
                {note.content}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 10 }}>
                <span style={{ fontSize: 12, color: t.text3 }}>
                  {note.createdByName} · {timeAgo(note.createdAt)}
                </span>
                <button className="oc-action" onClick={() => archiveNote(note.id!)}
                  style={{ background: 'none', border: 'none', padding: 0, fontSize: 12, color: t.text2, cursor: 'pointer' }}>
                  Archive
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {archived.length > 0 && (
        <div>
          <button className="oc-action" onClick={() => setShowArchived(!showArchived)}
            style={{ background: 'none', border: 'none', padding: 0, fontSize: 13, color: t.text2, cursor: 'pointer' }}>
            {showArchived ? 'Hide' : 'Show'} archived ({archived.length})
          </button>
          {showArchived && (
            <div style={{ borderBottom: `0.5px solid ${t.border}`, marginTop: 12 }}>
              {archived.map(note => (
                <div key={note.id} style={{ borderTop: `0.5px solid ${t.border}`, padding: '14px 0' }}>
                  <div style={{ fontSize: 14, color: t.text3, lineHeight: 1.6 }}>{note.content}</div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 8 }}>
                    <span style={{ fontSize: 12, color: t.text3 }}>
                      {note.createdByName} · {new Date(note.createdAt).toLocaleDateString('en-IN')}
                    </span>
                    <button className="oc-action" onClick={() => unarchiveNote(note.id!)}
                      style={{ background: 'none', border: 'none', padding: 0, fontSize: 12, color: t.accent, cursor: 'pointer' }}>
                      Bring back
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {modal}
    </div>
  )
}
