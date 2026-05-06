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
  const { t, theme } = useTheme()
  const isDark = theme === 'dark'
  const isAlert = type === 'alert'
  const isDanger = type === 'danger'
  const accentColor = isDanger ? '#dc2626' : '#16a34a'
  const accentBg = isDanger ? 'rgba(220,38,38,0.12)' : 'rgba(22,163,74,0.12)'
  const emoji = isAlert ? 'ℹ️' : isDanger ? '⚠️' : '❓'
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
        onClick={isAlert ? onConfirm : onCancel} />
      <div style={{ position: 'relative', background: t.card, borderRadius: 20, padding: '28px 22px 22px', maxWidth: 360, width: '100%', border: `1.5px solid ${isDanger ? 'rgba(220,38,38,0.35)' : isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`, boxShadow: '0 24px 64px rgba(0,0,0,0.45)' }}>
        <div style={{ fontSize: 38, textAlign: 'center', marginBottom: 14 }}>{emoji}</div>
        <div style={{ fontSize: 17, fontWeight: 800, color: t.text, textAlign: 'center', marginBottom: detail ? 8 : 20, lineHeight: 1.3 }}>{message}</div>
        {detail && <div style={{ fontSize: 13, color: t.text2, textAlign: 'center', marginBottom: 20, lineHeight: 1.6 }}>{detail}</div>}
        <div style={{ display: 'flex', gap: 10 }}>
          {!isAlert && (
            <button onClick={onCancel}
              style={{ flex: 1, background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)', border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`, borderRadius: 12, padding: '13px', fontSize: 14, fontWeight: 700, color: t.text2, cursor: 'pointer' }}>
              {cancelLabel || 'Cancel'}
            </button>
          )}
          <button onClick={onConfirm}
            style={{ flex: 1, background: isAlert ? (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)') : accentBg, border: `1.5px solid ${isAlert ? (isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)') : accentColor}`, borderRadius: 12, padding: '13px', fontSize: 14, fontWeight: 800, color: isAlert ? t.text : accentColor, cursor: 'pointer' }}>
            {confirmLabel || (isAlert ? 'OK' : isDanger ? 'Delete' : 'Confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}
