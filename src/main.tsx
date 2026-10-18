// First, before anything reads the clock. Does nothing outside the sandbox.
import './sandbox/dayShift'
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
// Imported for its side effect, and imported here rather than in a component:
// Chrome fires `beforeinstallprompt` once and early, so the listener has to be
// registered before React renders or the offer is missed for good.
import './device/installPrompt'
import ErrorBoundary from './components/ErrorBoundary'
import SandboxDaySwitch from './sandbox/SandboxDaySwitch'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {/* Outside App on purpose. A crash in the auth gate or the theme provider
        would otherwise still produce the blank screen this exists to prevent. */}
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
    <SandboxDaySwitch />
  </React.StrictMode>
)
