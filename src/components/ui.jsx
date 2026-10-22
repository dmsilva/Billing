import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { euro } from '../lib/money'

export function Panel({ title, hint, actions, children, className = '' }) {
  return (
    <section className={`dash-panel ${className}`}>
      {(title || actions) && (
        <div className="dash-panel-head">
          <div>
            {title && <h3>{title}</h3>}
            {hint && <p>{hint}</p>}
          </div>
          {actions && <div className="actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  )
}

export function Kpi({ color = 'blue', icon, label, value, note }) {
  return (
    <div className={`dash-kpi ${color}`}>
      <div className="kpi-icon">{icon}</div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        {note && <small>{note}</small>}
      </div>
    </div>
  )
}

export function RankBars({ rows, max, empty = 'Sem dados.', format = euro, onClick }) {
  if (!rows.length) return <div className="emptybox">{empty}</div>
  const top = max ?? Math.max(...rows.map(r => r.value), 1)
  return rows.map(r => (
    <div className={`rankbar ${onClick ? 'clickable' : ''}`} key={r.label} onClick={onClick ? () => onClick(r) : undefined}>
      <span title={r.label}>{r.label}</span>
      <div className="track"><i style={{ width: `${Math.max(2, (r.value / top) * 100)}%` }} /></div>
      <strong className="money">{format(r.value)}</strong>
    </div>
  ))
}

export function Badge({ children, tone = '' }) {
  return <span className={`badge ${tone}`}>{children}</span>
}

export function PaymentBadge({ value }) {
  return <Badge tone={value === 'CGD' ? 'bank' : value === 'Por pagar' ? 'pending' : 'cash'}>{value}</Badge>
}

export function StateBadge({ value }) {
  const tone = value === 'Validada' ? 'ok' : value === 'Rejeitada' ? 'bad' : 'pending'
  return <Badge tone={tone}>{value}</Badge>
}

export function Empty({ children = 'Sem dados.', colSpan }) {
  if (colSpan) return <tr><td colSpan={colSpan} className="empty">{children}</td></tr>
  return <div className="emptybox">{children}</div>
}

export function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    const onKey = e => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Fechar">✕</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  )
}

// Confirmação em dois passos dentro da página (sem diálogos do navegador).
export function ConfirmButton({ children, confirmText = 'Confirmar', onConfirm, className = 'secondary', disabled }) {
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const timer = useRef()
  useEffect(() => () => clearTimeout(timer.current), [])
  if (!asking) {
    return (
      <button type="button" className={className} disabled={disabled} onClick={() => { setAsking(true); timer.current = setTimeout(() => setAsking(false), 6000) }}>
        {children}
      </button>
    )
  }
  return (
    <span className="confirm-inline">
      <button type="button" className="danger" disabled={busy} onClick={async () => { setBusy(true); try { await onConfirm() } finally { setBusy(false); setAsking(false) } }}>
        {busy ? 'A processar…' : confirmText}
      </button>
      <button type="button" className="secondary" onClick={() => setAsking(false)}>Cancelar</button>
    </span>
  )
}

const ToastContext = createContext(() => {})

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const push = useCallback((text, tone = 'ok') => {
    const id = Math.random().toString(36).slice(2)
    setToasts(t => [...t, { id, text, tone }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), tone === 'bad' ? 8000 : 3500)
  }, [])
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map(t => <div key={t.id} className={`toast ${t.tone}`}>{t.text}</div>)}
      </div>
    </ToastContext.Provider>
  )
}

export const useToast = () => useContext(ToastContext)

export function Select({ value, onChange, options, placeholder, ...rest }) {
  return (
    <select value={value ?? ''} onChange={e => onChange(e.target.value)} {...rest}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map(o => (typeof o === 'object' ? <option key={o.value} value={o.value}>{o.label}</option> : <option key={o} value={o}>{o}</option>))}
    </select>
  )
}
