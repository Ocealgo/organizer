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

  return (
    <div className="oc-overlay" style={{ zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.55)' }}
        onClick={isAlert ? onConfirm : onCancel} />

      <div style={{
        position: 'relative', zIndex: 1, background: t.bg2, borderRadius: 8,
        padding: '24px 22px 22px', maxWidth: 380, width: '100%',
        border: `0.5px solid ${t.border2}`,
      }}>
        {/* The destructive case is the only one that gets colour, and only on
            the eyebrow — the buttons stay neutral so neither reads as safe. */}
        {isDanger && (
          <div style={{ fontSize: 11, letterSpacing: '0.09em', textTransform: 'uppercase',
                        color: t.warn, marginBottom: 8 }}>
            Cannot be undone
          </div>
        )}

        <div style={{ fontSize: 17, fontWeight: 500, color: t.text, lineHeight: 1.35,
                      marginBottom: detail ? 8 : 22 }}>
          {message}
        </div>

        {detail && (
          <div style={{ fontSize: 14, fontWeight: 400, color: t.text3, lineHeight: 1.6,
                        marginBottom: 22, whiteSpace: 'pre-line' }}>
            {detail}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onConfirm}
            style={{
              background: t.text, border: 'none', borderRadius: 6,
              padding: '11px 16px', fontSize: 13, fontWeight: 500, color: t.bg, cursor: 'pointer',
            }}>
            {confirmLabel || (isAlert ? 'OK' : isDanger ? 'Delete' : 'Confirm')}
          </button>
          {!isAlert && (
            <button className="oc-action" onClick={onCancel}
              style={{
                background: 'none', border: `0.5px solid ${t.border2}`, borderRadius: 6,
                padding: '11px 16px', fontSize: 13, fontWeight: 400, color: t.text, cursor: 'pointer',
              }}>
              {cancelLabel || 'Cancel'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
