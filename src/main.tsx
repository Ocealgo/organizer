import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
// Imported for its side effect, and imported here rather than in a component:
// Chrome fires `beforeinstallprompt` once and early, so the listener has to be
// registered before React renders or the offer is missed for good.
import './device/installPrompt'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
