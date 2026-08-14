import { useState } from 'react'
import RemindersView from './RemindersView'
import ChecklistView from './ChecklistView'
import PinnedNotesView from './PinnedNotesView'
import { useTheme } from '../../context/ThemeContext'

type WTab = 'reminders' | 'checklist' | 'notes'

const TABS: { id: WTab; label: string }[] = [
  { id: 'reminders', label: 'Reminders' },
  { id: 'checklist', label: 'Tasks' },
  { id: 'notes', label: 'Notes' },
]

export default function WorkspaceDashboard() {
  const { t } = useTheme()
  const [tab, setTab] = useState<WTab>('reminders')

  // Rendered inside the dashboard's Workspace tab, so no page chrome here —
  // just a quiet sub-switch and the content.
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', gap: 20, borderBottom: `0.5px solid ${t.border}` }}>
        {TABS.map(x => (
          <button key={x.id} className="oc-action" onClick={() => setTab(x.id)}
            style={{
              background: 'none', border: 'none', padding: '12px 0 10px',
              fontSize: 13, fontWeight: tab === x.id ? 500 : 400,
              color: tab === x.id ? t.text : t.text2,
              borderBottom: `2px solid ${tab === x.id ? t.text : 'transparent'}`,
              marginBottom: '-0.5px', cursor: 'pointer', whiteSpace: 'nowrap',
            }}>
            {x.label}
          </button>
        ))}
      </div>

      {tab === 'reminders' && <RemindersView />}
      {tab === 'checklist' && <ChecklistView />}
      {tab === 'notes' && <PinnedNotesView />}
    </div>
  )
}
