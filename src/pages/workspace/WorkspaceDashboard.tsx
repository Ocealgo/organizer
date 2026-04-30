import { useState } from 'react'
import RemindersView from './RemindersView'
import ChecklistView from './ChecklistView'
import PinnedNotesView from './PinnedNotesView'

type WTab = 'reminders' | 'checklist' | 'notes'

export default function WorkspaceDashboard() {
  const [tab, setTab] = useState<WTab>('reminders')

  const tabs = [
    { id: 'reminders' as WTab, label: '📅 Reminders' },
    { id: 'checklist' as WTab, label: '✅ My Tasks' },
    { id: 'notes'    as WTab, label: '📌 Notes' },
  ]

  return (
    <div style={{ minHeight: '100vh', background: '#0d1117' }}>
      {/* Header */}
      <div style={{ background: 'linear-gradient(135deg,#1e3a5f,#1e40af)', padding: '16px 20px 0' }}>
        <div style={{ color: '#93c5fd', fontSize: 11, letterSpacing: 3, textTransform: 'uppercase', marginBottom: 2 }}>Founders Only 🔒</div>
        <div style={{ fontSize: 20, fontWeight: 900, marginBottom: 14 }}>Workspace</div>
        <div style={{ display: 'flex', gap: 4 }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{ flex: 1, background: tab === t.id ? 'rgba(255,255,255,0.2)' : 'transparent', color: tab === t.id ? '#fff' : 'rgba(255,255,255,0.45)', border: 'none', borderRadius: '12px 12px 0 0', padding: '10px 4px', fontSize: 11, fontWeight: 800 }}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: '14px' }}>
        {tab === 'reminders' && <RemindersView />}
        {tab === 'checklist' && <ChecklistView />}
        {tab === 'notes'     && <PinnedNotesView />}
      </div>
    </div>
  )
}
