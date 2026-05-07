import React from 'react'
import { useTheme } from '../context/ThemeContext'

export interface ModalConfig {
  message: string
  detail?: string
  confirmLabel?: string
  cancelLabel?: string
  type?: 'confirm' | 'danger' | 'alert'
  onConfirm: () => void
  onCancel?: () => void
}

export default function ConfirmModal({ message, detail, confirmLabel, cancelLabel, type = 'confirm', onConfirm, onCancel }: ModalConfig) {
  const { t } = useTheme()
  const isAlert = type === 'alert'
  const isDanger = type === 'danger'
  const accentColor = isDanger ? '#ef4444' : '#22c55e'
  const accentBg = isDanger ? 'rgba(239,68,68,0.08)' : 'rgba(34,197,94,0.08)'
  const accentBorder = isDanger ? 'rgba(239,68,68,0.2)' : 'rgba(34,197,94,0.2)'
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
        onClick={isAlert ? onConfirm : onCancel} />
      <div style={{ position: 'relative', zIndex: 1, background: t.card, borderRadius: 20, padding: '28px 22px 22px', maxWidth: 360, width: '100%', border: `1.5px solid ${isDanger ? 'rgba(239,68,68,0.2)' : t.border2}`, boxShadow: '0 24px 64px rgba(0,0,0,0.45)' }}>
        <div style={{ fontSize: 17, fontWeight: 800, color: t.text, textAlign: 'center', marginBottom: detail ? 8 : 20, lineHeight: 1.3 }}>{message}</div>
        {detail && <div style={{ fontSize: 13, color: t.text2, textAlign: 'center', marginBottom: 20, lineHeight: 1.6 }}>{detail}</div>}
        <div style={{ display: 'flex', gap: 10 }}>
          {!isAlert && (
            <button onClick={onCancel}
              style={{ flex: 1, background: t.bg3, border: `1px solid ${t.border2}`, borderRadius: 12, padding: '13px', fontSize: 14, fontWeight: 700, color: t.text2, cursor: 'pointer' }}>
              {cancelLabel || 'Cancel'}
            </button>
          )}
          <button onClick={onConfirm}
            style={{ flex: 1, background: isAlert ? t.bg3 : accentBg, border: `1.5px solid ${isAlert ? t.border2 : accentBorder}`, borderRadius: 12, padding: '13px', fontSize: 14, fontWeight: 800, color: isAlert ? t.text : accentColor, cursor: 'pointer' }}>
            {confirmLabel || (isAlert ? 'OK' : isDanger ? 'Delete' : 'Confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}
