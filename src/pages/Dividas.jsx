import { useCallback, useEffect, useMemo, useState } from 'react'
import { ConfirmButton, Empty, Panel, useToast } from '../components/ui'
import { euro, numberPt, parseMoney } from '../lib/money'
import { formatDate, monthLabel, todayIso } from '../lib/dates'
import { supabase } from '../supabase'
import { extrato, FORMAS, resumoPorPessoa, TABELA_DIVIDAS, TIPOS, VALOR_HORA_PADRAO, valorHoras } from '../lib/dividas'

const NOVO = { pessoa: '', tipo: 'pagamento', forma: 'horas', data: todayIso(), horas: '', valorHora: String(VALOR_HORA_PADRAO), valor: '', descontarMes: todayIso().slice(0, 7), descricao: '' }

function descreve(m) {
  if (m.tipo === 'divida') return TIPOS.divida
  if (m.tipo === 'adiantamento') return `${TIPOS.adiantamento} · descontar no salário de ${monthLabel(m.descontar_mes)}`
  if (m.forma === 'horas') return `${FORMAS.horas}: ${numberPt(m.horas)} h × ${euro(m.valor_hora)}`
  if (m.forma === 'salario') return `${FORMAS.salario} de ${monthLabel(m.descontar_mes)}`
  return `Pagamento em ${FORMAS.dinheiro.toLowerCase()}`
}

export default function Dividas() {
  const toast = useToast()
  const [movimentos, setMovimentos] = useState(null)
  const [falta, setFalta] = useState(false)
  const [form, setForm] = useState(NOVO)
  const [aberta, setAberta] = useState(null)
  const [busy, setBusy] = useState(false)

  const carregar = useCallback(async () => {
    const { data, error } = await supabase.from(TABELA_DIVIDAS).select('*').order('data', { ascending: true }).limit(1000)
    if (error) { setFalta(true); setMovimentos([]); return }
    setFalta(false)
    setMovimentos(data)
  }, [])
  useEffect(() => { carregar() }, [carregar])

  const resumo = useMemo(() => resumoPorPessoa(movimentos || []), [movimentos])
  const pessoas = resumo.map(r => r.pessoa)
  const set = alteracao => setForm(f => ({ ...f, ...alteracao }))
  const porHoras = form.tipo === 'pagamento' && form.forma === 'horas'
  const comMes = form.tipo === 'adiantamento' || (form.tipo === 'pagamento' && form.forma === 'salario')
  const valor = porHoras ? (parseMoney(form.horas) && parseMoney(form.valorHora) ? valorHoras(parseMoney(form.horas), parseMoney(form.valorHora)) : null) : parseMoney(form.valor)

  async function gravar(e) {
    e.preventDefault()
    if (!form.pessoa.trim()) return toast('Escreve o nome da pessoa.', 'bad')
    if (!(valor > 0)) return toast(porHoras ? 'Indica as horas e o valor por hora.' : 'Indica o valor.', 'bad')
    setBusy(true)
    const linha = {
      pessoa: form.pessoa.trim(),
      tipo: form.tipo,
      forma: form.tipo === 'pagamento' ? form.forma : null,
      data: form.data,
      descricao: form.descricao.trim() || null,
      horas: porHoras ? parseMoney(form.horas) : null,
      valor_hora: porHoras ? parseMoney(form.valorHora) : null,
      valor,
      descontar_mes: comMes ? form.descontarMes : null,
    }
    const { error } = await supabase.from(TABELA_DIVIDAS).insert(linha)
    setBusy(false)
    if (error) return toast(error.message, 'bad')
    toast('Registado.')
    setForm(f => ({ ...NOVO, pessoa: f.pessoa, tipo: f.tipo, forma: f.forma, valorHora: f.valorHora }))
    setAberta(linha.pessoa)
    carregar()
  }

  async function alterar(id, alteracao) {
    const { error } = await supabase.from(TABELA_DIVIDAS).update(alteracao).eq('id', id)
    if (error) return toast(error.message, 'bad')
    carregar()
  }

  async function apagar(id) {
    const { error } = await supabase.from(TABELA_DIVIDAS).delete().eq('id', id)
    if (error) return toast(error.message, 'bad')
    carregar()
  }

  if (falta) {
    return <Panel title="Dívidas e adiantamentos"><div className="notice warn">Para usar esta página, executa uma vez o ficheiro supabase/19_dividas_colaboradores.sql no Supabase.</div></Panel>
  }

  return (
    <>
      <div className="notice">Página só para uso interno: nada daqui vai para a folha da contabilidade nem para os ficheiros enviados ao contabilista. Os adiantamentos de salário são descontados sozinhos no ficheiro para o banco do mês indicado.</div>
      <Panel title="Por pessoa" hint="Clica numa pessoa para ver todos os movimentos.">
        <div className="tablewrap"><table className="mini-table">
          <thead><tr><th>Pessoa</th><th className="money">Dívida</th><th className="money">Já pagou</th><th className="money">Falta pagar</th><th className="money">Horas extra</th><th className="money">Por descontar no salário</th></tr></thead>
          <tbody>{movimentos === null ? <Empty colSpan={6}>A carregar…</Empty> : resumo.length ? resumo.map(r => (
            <tr key={r.pessoa} className="clickable" onClick={() => setAberta(a => (a === r.pessoa ? null : r.pessoa))}>
              <td><strong>{r.pessoa}</strong></td>
              <td className="money">{euro(r.divida)}</td>
              <td className="money">{euro(r.pago)}</td>
              <td className={`money ${r.falta > 0 ? 'bad' : 'ok'}`}><strong>{euro(r.falta)}</strong></td>
              <td className="money">{r.horas ? `${numberPt(r.horas)} h` : ''}</td>
              <td className="money">{r.porDescontar ? <span className="bad">{euro(r.porDescontar)}</span> : ''}
                {r.pendentes.length > 0 && <small>{r.pendentes.map(m => monthLabel(m.descontar_mes)).join(', ')}</small>}</td>
            </tr>
          )) : <Empty colSpan={6}>Ainda não há nada registado.</Empty>}</tbody>
        </table></div>
      </Panel>

      {resumo.filter(r => r.pessoa === aberta).map(r => (
        <Panel key={r.pessoa} title={`Movimentos de ${r.pessoa}`} hint="O saldo é o que falta pagar da dívida depois de cada movimento. Um desconto no salário só abate depois de descontado.">
          <div className="tablewrap"><table className="mini-table">
            <thead><tr><th>Data</th><th>Movimento</th><th>Notas</th><th className="money">Valor</th><th className="money">Saldo da dívida</th><th /></tr></thead>
            <tbody>{extrato(r.movimentos).map(m => (
              <tr key={m.id}>
                <td>{formatDate(m.data)}</td>
                <td>{descreve(m)}
                  {(m.tipo === 'adiantamento' || m.forma === 'salario') && <small className={m.descontado_em ? '' : 'warn'}>{m.descontado_em ? `Descontado em ${formatDate(m.descontado_em.slice(0, 10))}` : 'Ainda por descontar'}</small>}
                </td>
                <td>{m.descricao}</td>
                <td className="money">{m.tipo === 'divida' ? '' : '−'}{euro(m.valor)}</td>
                <td className="money">{m.tipo === 'adiantamento' ? '' : euro(m.saldo)}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {(m.tipo === 'adiantamento' || m.forma === 'salario') && (m.descontado_em
                    ? <button className="link-btn" onClick={() => alterar(m.id, { descontado_em: null, descontado_envio: null })}>Voltar a pôr por descontar</button>
                    : <button className="link-btn" onClick={() => alterar(m.id, { descontado_em: new Date().toISOString() })}>Já descontei</button>)}{' '}
                  <ConfirmButton className="link-btn" confirmText="Apagar" onConfirm={() => apagar(m.id)}>Apagar</ConfirmButton>
                </td>
              </tr>
            ))}</tbody>
          </table></div>
        </Panel>
      ))}

      <Panel title="Registar" hint="Dívida nova, pagamento (horas extra, dinheiro ou desconto no salário) ou adiantamento de salário.">
        <form onSubmit={gravar}>
          <div className="form-grid">
            <label>Pessoa
              <input list="dividas-pessoas" value={form.pessoa} onChange={e => set({ pessoa: e.target.value })} placeholder="Ex.: Fábio" />
              <datalist id="dividas-pessoas">{pessoas.map(p => <option key={p} value={p} />)}</datalist>
            </label>
            <label>O que é
              <select value={form.tipo} onChange={e => set({ tipo: e.target.value })}>
                {Object.entries(TIPOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            {form.tipo === 'pagamento' && (
              <label>Como pagou
                <select value={form.forma} onChange={e => set({ forma: e.target.value })}>
                  {Object.entries(FORMAS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
            )}
            <label>Data
              <input type="date" value={form.data} onChange={e => set({ data: e.target.value, descontarMes: e.target.value.slice(0, 7) || form.descontarMes })} />
            </label>
            {porHoras ? <>
              <label>Horas
                <input inputMode="decimal" value={form.horas} onChange={e => set({ horas: e.target.value })} placeholder="Ex.: 41" />
              </label>
              <label>Valor por hora (€)
                <input inputMode="decimal" value={form.valorHora} onChange={e => set({ valorHora: e.target.value })} />
              </label>
            </> : (
              <label>Valor (€)
                <input inputMode="decimal" value={form.valor} onChange={e => set({ valor: e.target.value })} placeholder="0,00" />
              </label>
            )}
            {comMes && (
              <label>Descontar no salário de
                <input type="month" value={form.descontarMes} onChange={e => set({ descontarMes: e.target.value })} />
              </label>
            )}
            <label className="span2">Notas
              <input value={form.descricao} onChange={e => set({ descricao: e.target.value })} placeholder="Ex.: 6 dias de férias trabalhados" />
            </label>
          </div>
          <div className="actions">
            <button className="primary" disabled={busy}>Registar{valor > 0 ? ` ${euro(valor)}` : ''}</button>
          </div>
        </form>
      </Panel>
    </>
  )
}
