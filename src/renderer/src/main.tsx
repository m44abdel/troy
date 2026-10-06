import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

// The macOS window is translucent (vibrancy), so styles can let it show through.
document.documentElement.dataset.platform = navigator.userAgent.includes('Mac') ? 'mac' : 'other'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
