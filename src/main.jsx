import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import './styles.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)

// Service worker: torna a app instalável no telemóvel (só na versão publicada).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}))
}

// Depois de uma publicação nova, uma página que já estava aberta pede ficheiros antigos (/assets/…)
// que já não existem ("Failed to fetch dynamically imported module"). Recarrega uma vez para ir buscar a versão nova.
window.addEventListener('vite:preloadError', event => {
  let ultimo = 0
  try { ultimo = Number(sessionStorage.getItem('recarregou-versao') || 0) } catch { /* sem armazenamento */ }
  if (Date.now() - ultimo < 30000) return // já recarregou há pouco: deixa o erro aparecer
  event.preventDefault()
  try { sessionStorage.setItem('recarregou-versao', String(Date.now())) } catch { /* sem armazenamento */ }
  window.location.reload()
})
