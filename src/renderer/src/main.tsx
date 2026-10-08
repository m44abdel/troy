import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ReviewWindow } from './ReviewWindow'

// The macOS window is translucent (vibrancy), so styles can let it show through.
document.documentElement.dataset.platform = navigator.userAgent.includes('Mac') ? 'mac' : 'other'

// A review window is opened with #review={"repo":…,"number":…}; the main window has no hash.
const review = location.hash.startsWith('#review=')
  ? JSON.parse(decodeURIComponent(location.hash.slice('#review='.length)))
  : null

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {review ? <ReviewWindow repo={review.repo} number={review.number} /> : <App />}
  </StrictMode>
)
