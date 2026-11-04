import { useEffect, useState } from 'react'

// Botão "Instalar no telemóvel". No Android/Chrome usa o pedido de instalação do navegador;
// no iPhone/iPad explica o passo no Safari. Não aparece quando a app já está instalada.
let deferred = null
const listeners = new Set()
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; listeners.forEach(f => f()) })
  window.addEventListener('appinstalled', () => { deferred = null; listeners.forEach(f => f()) })
}

const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

export default function InstallApp({ className = '' }) {
  const [, force] = useState(0)
  const [help, setHelp] = useState(false)
  useEffect(() => { const f = () => force(n => n + 1); listeners.add(f); return () => listeners.delete(f) }, [])
  if (isStandalone()) return null
  if (deferred) {
    return <button type="button" className={`install-btn ${className}`} onClick={async () => { const e = deferred; deferred = null; force(n => n + 1); await e.prompt() }}>📲 Instalar no telemóvel</button>
  }
  if (!isIOS()) return null
  return (
    <div className={`install-help ${className}`}>
      <button type="button" className="install-btn" onClick={() => setHelp(h => !h)}>📲 Instalar no telemóvel</button>
      {help && <div className="install-steps">No <b>Safari</b>, toca em <b>Partilhar</b> <span aria-hidden>⬆︎</span> e depois em <b>Adicionar ao ecrã principal</b>. A app fica com ícone próprio e abre sem a barra do navegador.</div>}
    </div>
  )
}
