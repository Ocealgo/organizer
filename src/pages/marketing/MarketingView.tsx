import { useTheme } from '../../context/ThemeContext'
import { PageHeader, Section } from '../../components/ui'

const PLANNED = [
  'On-ground campaign tracker',
  'Events and exhibitions',
  'Physical collateral tracking',
  'Below-the-line activity reports',
  'Sampling and demo logs',
]

export default function MarketingView() {
  const { t } = useTheme()
  return (
    <div style={{ minHeight: '100vh', background: t.bg }}>
      <PageHeader
        eyebrow="Not built yet"
        title="Offline marketing"
        subtitle="On-ground campaigns, events and physical distribution will live here. Nothing works in this screen yet."
      />
      <div style={{ padding: 20, maxWidth: 460 }}>
        <Section label="Planned">
          <div style={{ borderBottom: `0.5px solid ${t.border}` }}>
            {PLANNED.map(f => (
              <div key={f} style={{ borderTop: `0.5px solid ${t.border}`, padding: '13px 0',
                                    fontSize: 14, fontWeight: 400, color: t.text2 }}>
                {f}
              </div>
            ))}
          </div>
        </Section>
      </div>
    </div>
  )
}
