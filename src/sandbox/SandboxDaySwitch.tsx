import { SANDBOX, sandboxDay, chooseSandboxDay, SandboxDay } from './dayShift'

/**
 * The switch for dayShift: a small bar pinned to the bottom of the screen,
 * saying which day the app thinks it is and offering the other two.
 *
 * Plain colours rather than theme tokens: it sits outside the app's providers
 * on purpose, so it still shows when something inside them has broken.
 */
export default function SandboxDaySwitch() {
  if (!SANDBOX) return null
  const today = new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })
  const options: [SandboxDay, string][] = [['real', 'Real day'], ['workday', 'Working day'], ['sunday', 'Sunday']]
  return (
    <>
    {/* Room at the end of the page, so the last row can scroll clear of the bar. */}
    <div aria-hidden style={{ height: 64 }} />
    <div role="region" aria-label="Sandbox day" style={{
      position: 'fixed', left: 12, bottom: 'calc(12px + env(safe-area-inset-bottom, 0px))', zIndex: 9999,
      display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', maxWidth: 'calc(100vw - 24px)',
      background: '#1f2937', color: '#f9fafb', border: '1px solid #4b5563', borderRadius: 10,
      padding: '6px 8px', font: '12px system-ui, sans-serif', boxShadow: '0 4px 14px rgba(0,0,0,.35)',
    }}>
      <span style={{ padding: '0 4px' }}>
        Sandbox · <b>{today}</b>
      </span>
      {options.map(([k, label]) => (
        <button key={k} onClick={() => chooseSandboxDay(k)} aria-pressed={sandboxDay.choice === k}
          style={{
            font: 'inherit', cursor: 'pointer', borderRadius: 99, padding: '4px 10px',
            border: '1px solid ' + (sandboxDay.choice === k ? '#f9fafb' : '#4b5563'),
            background: sandboxDay.choice === k ? '#f9fafb' : 'transparent',
            color: sandboxDay.choice === k ? '#111827' : '#e5e7eb',
          }}>
          {label}
        </button>
      ))}
    </div>
    </>
  )
}
