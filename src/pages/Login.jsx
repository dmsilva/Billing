import { useState } from 'react'
import { useAuth } from '../auth/AuthProvider'

export default function Login() {
  const { signIn, resetPassword } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const isRececao = window.location.pathname.startsWith('/rececao')

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    const { error } = await signIn(email.trim(), password)
    setBusy(false)
    if (error) setMsg({ tone: 'bad', text: error.message === 'Invalid login credentials' ? 'Email ou palavra-passe incorretos.' : error.message })
  }

  async function forgot() {
    if (!email.trim()) return setMsg({ tone: 'bad', text: 'Escreve primeiro o teu email.' })
    const { error } = await resetPassword(email.trim())
    setMsg(error ? { tone: 'bad', text: error.message } : { tone: 'ok', text: 'Enviámos um email com o link para definir uma nova palavra-passe.' })
  }

  return (
    <div className="center-screen">
      <form className="auth-card" onSubmit={submit}>
        <div className="brand dark"><strong>Fatura<span>Claro</span></strong><small>{isRececao ? 'Envio de faturas · Receção' : 'Gestão financeira'}</small></div>
        <h2>Entrar</h2>
        <label>Email<input type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required /></label>
        <label>Palavra-passe<input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required /></label>
        <button className="primary full" disabled={busy}>{busy ? 'A entrar…' : 'Entrar'}</button>
        <button type="button" className="link-btn" onClick={forgot}>Esqueci-me da palavra-passe</button>
        {msg && <div className={`notice ${msg.tone}`}>{msg.text}</div>}
      </form>
    </div>
  )
}
