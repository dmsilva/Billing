import { Fragment, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Panel } from '../components/ui'
import { perguntar } from '../data/perguntas'
import { parseBlocks, parseInline } from '../lib/markdownLite'

const EXEMPLOS = [
  'Temos a fatura da Makro de setembro?',
  'Quanto fizemos em numerário em setembro?',
  'Qual foi o lucro de cada mês este ano?',
  'Quanto gastámos em gás em 2026?',
  'Que faturas estão por pagar?',
  'Quais foram os 5 maiores fornecedores em outubro?',
]

function Inline({ text }) {
  return parseInline(text).map((p, i) =>
    p.bold != null ? <strong key={i}>{p.bold}</strong>
      : p.href ? <Link key={i} to={p.href}>{p.link}</Link>
        : <Fragment key={i}>{p.text}</Fragment>)
}

function Resposta({ text }) {
  return parseBlocks(text).map((b, i) => {
    if (b.type === 'table') {
      return (
        <div className="tablewrap" key={i}><table className="mini-table">
          <thead><tr>{b.head.map((h, j) => <th key={j}><Inline text={h} /></th>)}</tr></thead>
          <tbody>{b.rows.map((r, j) => <tr key={j}>{r.map((c, k) => <td key={k} className={/€\s*$/.test(c) ? 'money' : ''}><Inline text={c} /></td>)}</tr>)}</tbody>
        </table></div>
      )
    }
    if (b.type === 'list') return <ul key={i}>{b.items.map((it, j) => <li key={j}><Inline text={it} /></li>)}</ul>
    if (b.type === 'heading') return <h4 key={i}><Inline text={b.text} /></h4>
    return <p key={i}>{b.text.split('\n').map((l, j) => <Fragment key={j}>{j > 0 && <br />}<Inline text={l} /></Fragment>)}</p>
  })
}

export default function Perguntar() {
  const [mensagens, setMensagens] = useState([])
  const [texto, setTexto] = useState('')
  const [busy, setBusy] = useState(false)
  const [erro, setErro] = useState(null)
  const [desligada, setDesligada] = useState(false)
  const fim = useRef(null)

  useEffect(() => { fim.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [mensagens, busy])

  async function enviar(pergunta) {
    const q = (pergunta ?? texto).trim()
    if (!q || busy) return
    const conversa = [...mensagens, { role: 'user', content: q }]
    setMensagens(conversa); setTexto(''); setErro(null); setBusy(true)
    const r = await perguntar(conversa)
    setBusy(false)
    if (r.desligada) { setDesligada(true); setMensagens(mensagens); setTexto(q); return }
    if (r.error) { setErro(r.error); setMensagens(mensagens); setTexto(q); return }
    setMensagens([...conversa, { role: 'assistant', content: r.resposta }])
  }

  return (
    <Panel title="Pergunta sobre os dados" hint="Escreve como falarias com alguém do escritório. As respostas usam os dados reais da app (só consulta, nunca altera nada). Cada pergunta custa alguns cêntimos na conta da Anthropic."
      actions={mensagens.length > 0 && <button className="secondary small" disabled={busy} onClick={() => { setMensagens([]); setErro(null) }}>Nova conversa</button>}>
      {desligada && <div className="notice">As perguntas não estão disponíveis aqui: só funcionam na app publicada no Netlify, com a ANTHROPIC_API_KEY configurada.</div>}
      <div className="chat">
        {!mensagens.length && (
          <div className="chat-examples">
            <span className="muted small">Exemplos:</span>
            {EXEMPLOS.map(e => <button key={e} className="secondary small" onClick={() => enviar(e)} disabled={busy}>{e}</button>)}
          </div>
        )}
        {mensagens.map((m, i) => (
          <div key={i} className={`chat-msg ${m.role}`}>
            {m.role === 'user' ? m.content : <Resposta text={m.content} />}
          </div>
        ))}
        {busy && <div className="chat-msg assistant muted"><span className="spinner small" /> A consultar os dados…</div>}
        {erro && <div className="notice bad">{erro}</div>}
        <div ref={fim} />
      </div>
      <form className="chat-input" onSubmit={e => { e.preventDefault(); enviar() }}>
        <textarea
          value={texto} rows={2} maxLength={2000} placeholder="Ex.: temos a fatura FT 2026/123?"
          onChange={e => setTexto(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar() } }}
        />
        <button className="primary" type="submit" disabled={busy || !texto.trim()}>{busy ? 'A pensar…' : 'Perguntar'}</button>
      </form>
    </Panel>
  )
}
