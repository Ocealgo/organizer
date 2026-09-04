import { Component, ErrorInfo, ReactNode } from 'react'

/**
 * Show the error instead of a blank screen.
 *
 * React unmounts the whole tree when a render throws, so without one of these
 * a single bad line anywhere produces an empty page and nothing else — no
 * message, no clue which screen, nothing to report but "it went blank". That
 * is the least debuggable failure a web app has, and until now it was the only
 * kind this app could produce.
 *
 * A class component because that is the only thing React lets catch a render
 * error; there is no hook for it.
 */
interface Props { children: ReactNode }
interface State { error: Error | null; info: string }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: '' }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Console first, so it is in the log even if the person never reads the
    // screen — and so a colleague can be asked to paste it.
    console.error('[app] render failed', error, info.componentStack)
    this.setState({ info: (info.componentStack || '').split('\n').slice(0, 6).join('\n') })
  }

  render() {
    const { error, info } = this.state
    if (!error) return this.props.children

    return (
      <div style={{
        minHeight: '100vh', background: '#0d1117', color: '#f1f5f9',
        padding: '40px 20px', fontFamily: "'Trebuchet MS', sans-serif",
      }}>
        <div style={{ maxWidth: 620, margin: '0 auto' }}>
          <div style={{ fontSize: 20, fontWeight: 500, marginBottom: 10 }}>
            This screen stopped
          </div>
          <div style={{ fontSize: 14, color: '#94a3b8', lineHeight: 1.7, marginBottom: 22 }}>
            Nothing you did caused it and nothing has been lost. Go back and carry on — if it
            keeps happening, send whoever looks after the app the lines below.
          </div>

          {/* The message and where it came from. Deliberately on the page and
              not only in the console: the people who hit this are on phones,
              where there is no console to open. */}
          <div style={{
            background: 'rgba(220,38,38,0.10)', border: '1px solid rgba(220,38,38,0.35)',
            borderRadius: 8, padding: '14px 16px', marginBottom: 22,
          }}>
            <div style={{ fontSize: 13, color: '#fca5a5', lineHeight: 1.6, wordBreak: 'break-word' }}>
              {error.message || String(error)}
            </div>
            {info && (
              <pre style={{
                fontSize: 11, color: '#94a3b8', marginTop: 10, whiteSpace: 'pre-wrap',
                fontFamily: 'ui-monospace, monospace', lineHeight: 1.5,
              }}>{info.trim()}</pre>
            )}
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button
              onClick={() => this.setState({ error: null, info: '' })}
              style={{
                background: 'none', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 6,
                padding: '12px 18px', minHeight: 44, fontSize: 14, color: '#f1f5f9', cursor: 'pointer',
              }}>
              Try again
            </button>
            <button
              onClick={() => { window.location.href = '/' }}
              style={{
                background: 'none', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 6,
                padding: '12px 18px', minHeight: 44, fontSize: 14, color: '#f1f5f9', cursor: 'pointer',
              }}>
              Back to the start
            </button>
          </div>
        </div>
      </div>
    )
  }
}
