import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import BetaFeedback from './components/BetaFeedback'
import DensityCanvas from './components/DensityCanvas'
import { installAndroidBridge } from './lib/sync/capacitor-bridge'

// Мост ставим до первого рендера, чтобы createAuthProvider сразу увидел нативный мост.
void installAndroidBridge().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <DensityCanvas />
      <BetaFeedback />
    </StrictMode>,
  )
})
