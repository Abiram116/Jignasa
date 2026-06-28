import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.tsx'
import './index.css'

// Matches vite.config.ts's `base` -- GitHub Pages serves this at /Jignasa/,
// not domain root, so the router's basename has to agree or links break.
const basename = import.meta.env.VITE_STATIC_DEMO === 'true' ? '/Jignasa' : '/'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={basename}>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
