import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Buffer } from 'buffer'
import './index.css'
import App from './App.tsx'

if (typeof window !== 'undefined') (window as unknown as { Buffer: typeof Buffer }).Buffer = Buffer
if (typeof globalThis !== 'undefined') (globalThis as unknown as { Buffer?: typeof Buffer }).Buffer = Buffer

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
