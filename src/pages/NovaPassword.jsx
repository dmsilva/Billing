import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'

// Destino do link de convite / recuperação enviado pelo Supabase.
export default function NovaPassword() {
  const { updatePassword, session } = useAuth()
  const nav = useNavigate()
  const [password, setPassword] = useState('')
  const [msg, setMsg] = useState(null)

  async function submit(e) {
    e.preventDefault()
    if (password.length < 8) return setMsg({ tone: 'bad', text: 'A palavra-passe deve ter pelo menos 8 caracteres.' })
    const { error } = await updatePassword(password)
    if (error) return setMsg({ tone: 'bad', text: error.message })
    nav('/', { replace: true })
  }

  return (
    <div className="center-screen">
      <form className="auth-card" onSubmit={submit}>
        <div className="brand dark"><strong>Fatura<span>Claro</span></strong></div>
        <h2>Definir palavra-passe</h2>
        {!session && <div className="notice">A abrir a sessão a partir do link do email…</div>}
        <label>Nova palavra-passe<input type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} /></label>
        <button className="primary full" disabled={!session}>Guardar</button>
        {msg && <div className={`notice ${msg.tone}`}>{msg.text}</div>}
      </form>
    </div>
  )
}
