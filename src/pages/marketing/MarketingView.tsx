export default function MarketingView() {
  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(145deg,#0d1117,#0f172a)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 32 }}>
      <div style={{ fontSize: 64, marginBottom: 24 }}>📣</div>
      <div style={{ background: 'rgba(217,119,6,0.2)', color: '#d97706', fontSize: 11, fontWeight: 800, padding: '4px 12px', borderRadius: 99, letterSpacing: 1, marginBottom: 16 }}>COMING SOON</div>
      <div style={{ fontSize: 26, fontWeight: 900, color: '#fff', marginBottom: 12, textAlign: 'center' }}>Offline Marketing Dashboard</div>
      <div style={{ color: '#64748b', fontSize: 14, lineHeight: 1.8, textAlign: 'center', maxWidth: 280 }}>
        The Offline Marketing module is currently being built — on-ground campaigns, event tracking, physical distribution marketing and BTL activities will be available here soon.
      </div>
      <div style={{ marginTop: 32, background: '#161b22', border: '1px solid rgba(217,119,6,0.2)', borderRadius: 16, padding: '16px 20px', maxWidth: 300, width: '100%' }}>
        <div style={{ fontSize: 12, color: '#d97706', fontWeight: 700, marginBottom: 8 }}>🚧 Features being built:</div>
        {['On-ground campaign tracker', 'Event & exhibition management', 'Physical collateral tracking', 'BTL activity reports', 'Sampling & demo logs'].map(f => (
          <div key={f} style={{ fontSize: 12, color: '#475569', padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>• {f}</div>
        ))}
      </div>
    </div>
  )
}
