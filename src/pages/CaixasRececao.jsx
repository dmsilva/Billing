import { useMemo, useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { useData } from '../data/DataProvider'
import { useFilters } from '../data/FiltersProvider'
import { supabase } from '../supabase'
import { Badge, Empty, Kpi, Panel, Select, useToast } from '../components/ui'
import { importarCaixasApp } from '../data/caixasApp'
import { alertas, CAIXAS_APP_INICIO, compararTurnos, documentosVisiveis, estadoEnvelope, estadoTpa, METODOS, resumoPendentes, totaisDias } from '../lib/caixaApp'
import { SHIFT_INFO } from '../lib/reconciliation'
import { euroExact, parseMoney, sumBy } from '../lib/money'
import { formatDate, formatDateTime, monthLabel, monthOf, todayIso } from '../lib/dates'

const ALERTA_ICON = { diferenca: '⚠️', observacao: '💬', envelope: '✉️', mudou: '↻', tpa: '💳', aberto: '⏳' }
const RECARREGAR = ['caixa_app_dias', 'caixa_app_turnos', 'caixa_app_pendentes', 'cash_closes', 'cash_imports']

export default function CaixasRececao() {
  const { caixa_app_dias: dias, caixa_app_turnos: turnos, caixa_app_pendentes: pendentes, caixasAppReady, reload, upsertLocal } = useData()
  const { filters, set } = useFilters()
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  const meses = useMemo(() => [...new Set(dias.map(d => monthOf(d.data)))].sort().reverse().map(m => ({ value: m, label: monthLabel(m) })), [dias])
  const noMes = d => !filters.month || monthOf(d) === filters.month
  const diasMes = useMemo(() => dias.filter(d => noMes(d.data)).sort((a, b) => b.data.localeCompare(a.data)), [dias, filters.month]) // eslint-disable-line react-hooks/exhaustive-deps
  const turnosMes = useMemo(() => turnos.filter(t => noMes(t.data)).sort(compararTurnos).reverse(), [turnos, filters.month]) // eslint-disable-line react-hooks/exhaustive-deps
  const avisos = useMemo(() => alertas({ dias: diasMes, turnos: turnosMes, hoje: todayIso() }), [diasMes, turnosMes])
  const tot = totaisDias(diasMes)
  const ultima = dias.reduce((a, d) => (d.importado_em > a ? d.importado_em : a), '')
  const porConferir = turnos.filter(t => t.fechado && t.envelope_recebido == null).sort(compararTurnos)
  const tpaPorConferir = dias.filter(d => d.dia_fechado && d.tpa_talao == null).length

  async function importar() {
    setBusy(true)
    const r = await importarCaixasApp()
    setBusy(false)
    if (r.error) return toast(r.error, 'bad')
    for (const t of RECARREGAR) reload(t)
    if (!r.periodo) return toast('Já estava tudo importado.')
    toast(`Importados ${r.dias} dias (${formatDate(r.periodo.from)} a ${formatDate(r.periodo.to)}): ${r.fechos} fechos novos ou alterados na Caixa diária.`)
  }

  if (!caixasAppReady) {
    return <div className="notice bad">Para ligar a app de caixa da receção, corre primeiro o ficheiro <code>supabase/15_caixas_app.sql</code> no SQL Editor do Supabase e recarrega a página.</div>
  }

  return (
    <div className="cash-page">
      <div className="cash-hero">
        <div>
          <div className="eyebrow">ENTRADAS · APP DE CAIXA</div>
          <h2>Caixas da receção</h2>
          <p>Desde {formatDate(CAIXAS_APP_INICIO)} as caixas vêm da app da receção (os dias anteriores continuam os do Excel). A importação é automática ao abrires a Fatura Chalet e não duplica dias.</p>
        </div>
        <div className="cash-hero-actions">
          <Select value={filters.month} onChange={v => set({ month: v })} options={meses} placeholder="Todos os meses" />
          <button className="primary" disabled={busy} onClick={importar}>{busy ? 'A importar…' : 'Importar caixas'}</button>
        </div>
      </div>
      <div className="notice">Última importação: <strong>{ultima ? formatDateTime(ultima) : 'ainda nenhuma'}</strong> · {dias.length} dias guardados.</div>

      <div className="cash-kpis">
        <Kpi color="green" icon="€" label="Numerário" value={euroExact(tot.numerario)} note={`${porConferir.length} envelopes por conferir`} />
        <Kpi color="purple" icon="MB" label="Multibanco + cartão" value={euroExact(tot.multibanco + tot.cartao)} note={`${tpaPorConferir} dias sem talão do TPA`} />
        <Kpi color="orange" icon="CV" label="CV / Expedia / Airbnb" value={euroExact(tot.cvVirtual + tot.expedia + tot.airbnb)} note="Pendentes até a plataforma pagar" />
        <Kpi color="blue" icon="Σ" label="Total" value={euroExact(tot.total)} note={`Transferências ${euroExact(tot.transferencia)} · taxa turística ${euroExact(tot.taxaTuristica)}`} />
      </div>

      <Panel title="Atenção" hint="Diferenças e observações dos turnos, envelopes e talões que não batem.">
        {avisos.length ? (
          <div className="tablewrap"><table className="mini-table">
            <thead><tr><th /><th>Dia</th><th>Turno</th><th>O quê</th><th className="money">Diferença</th><th>Observação / nota</th></tr></thead>
            <tbody>{avisos.map((a, i) => (
              <tr key={i} className={a.tipo === 'observacao' || a.tipo === 'aberto' ? '' : 'row-alert'}>
                <td>{ALERTA_ICON[a.tipo]}</td><td>{formatDate(a.data)}</td><td>{a.turno || '—'}</td><td>{a.texto}</td>
                <td className="money">{a.valor != null ? <strong className={a.valor < 0 ? 'neg' : ''}>{euroExact(a.valor)}</strong> : ''}</td>
                <td>{a.observacao ? <em>“{a.observacao}”</em> : ''}</td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <div className="emptybox">Nada a assinalar neste período. 👍</div>}
      </Panel>

      <EnvelopesPanel turnos={turnosMes} upsertLocal={upsertLocal} />
      <TpaPanel dias={diasMes} reload={reload} />
      <PlataformasPanel pendentes={pendentes} reload={reload} />
      <DiasPanel dias={diasMes} turnos={turnosMes} />
    </div>
  )
}

function EnvelopesPanel({ turnos, upsertLocal }) {
  const { user } = useAuth()
  const toast = useToast()
  const [outro, setOutro] = useState({})
  const [verTodos, setVerTodos] = useState(false)
  const fechados = turnos.filter(t => t.fechado)
  const lista = verTodos ? fechados : fechados.filter(t => t.envelope_recebido == null || estadoEnvelope(t).estado !== 'ok')

  async function gravar(t, valor, nota) {
    const patch = { envelope_recebido: valor, envelope_esperado: t.envelope, envelope_nota: nota || null, envelope_em: new Date().toISOString(), envelope_por: user?.id ?? null }
    const { data, error } = await supabase.from('caixa_app_turnos').update(patch).eq('id', t.id).select().single()
    if (error) return toast(error.message, 'bad')
    upsertLocal('caixa_app_turnos', data)
    setOutro(o => ({ ...o, [t.id]: undefined }))
    toast(`Envelope de ${formatDate(t.data)} ${t.turno} registado.`)
  }
  async function desfazer(t) {
    const { data, error } = await supabase.from('caixa_app_turnos').update({ envelope_recebido: null, envelope_esperado: null, envelope_nota: null, envelope_em: null, envelope_por: null }).eq('id', t.id).select().single()
    if (error) return toast(error.message, 'bad')
    upsertLocal('caixa_app_turnos', data)
  }
  function gravarOutro(t) {
    const f = outro[t.id] || {}
    const v = parseMoney(f.valor)
    if (v === null || v < 0) return toast('Escreve o valor que veio no envelope.', 'bad')
    gravar(t, v, f.nota)
  }

  return (
    <Panel title="Numerário · envelopes" hint="Confirma turno a turno o dinheiro que veio no envelope." actions={<label className="small"><input type="checkbox" checked={verTodos} onChange={e => setVerTodos(e.target.checked)} /> ver também os conferidos</label>}>
      <div className="tablewrap"><table className="mini-table">
        <thead><tr><th>Dia</th><th>Turno</th><th>Fechado por</th><th className="money">Contado</th><th className="money">Fundo segue</th><th className="money">Envelope (app)</th><th>Conferência</th></tr></thead>
        <tbody>{lista.length ? lista.map(t => {
          const st = estadoEnvelope(t)
          const f = outro[t.id]
          return (
            <tr key={t.id} className={st.estado === 'diferente' ? 'row-alert' : ''}>
              <td>{formatDate(t.data)}</td><td>{t.turno} <span className="muted small">{SHIFT_INFO[t.turno]?.nome}</span></td><td>{t.fechado_por || '—'}</td>
              <td className="money">{euroExact(t.numerario_contado)}</td><td className="money">{euroExact(t.fundo_segue)}</td>
              <td className="money"><strong>{euroExact(t.envelope)}</strong></td>
              <td>
                {st.estado === 'por_conferir' && !f && (
                  <span className="actions">
                    <button className="primary" onClick={() => gravar(t, Number(t.envelope || 0))}>Recebido</button>
                    <button className="secondary" onClick={() => setOutro(o => ({ ...o, [t.id]: { valor: '', nota: '' } }))}>Outro valor</button>
                  </span>
                )}
                {st.estado === 'por_conferir' && f && (
                  <span className="actions">
                    <input inputMode="decimal" placeholder="Valor no envelope" value={f.valor} onChange={e => setOutro(o => ({ ...o, [t.id]: { ...f, valor: e.target.value } }))} style={{ width: 110 }} />
                    <input placeholder="Nota" value={f.nota} onChange={e => setOutro(o => ({ ...o, [t.id]: { ...f, nota: e.target.value } }))} />
                    <button className="primary" onClick={() => gravarOutro(t)}>Guardar</button>
                    <button className="link-btn" onClick={() => setOutro(o => ({ ...o, [t.id]: undefined }))}>Cancelar</button>
                  </span>
                )}
                {st.estado === 'ok' && <span><Badge tone="ok">Recebido {euroExact(t.envelope_recebido)}</Badge>{st.mudou && <Badge tone="pending">a app mudou</Badge>} <button className="link-btn" onClick={() => desfazer(t)}>desfazer</button></span>}
                {st.estado === 'diferente' && <span><Badge tone="bad">Veio {euroExact(t.envelope_recebido)} ({euroExact(st.diferenca)})</Badge>{t.envelope_nota && <em> “{t.envelope_nota}”</em>} <button className="link-btn" onClick={() => desfazer(t)}>desfazer</button></span>}
              </td>
            </tr>
          )
        }) : <Empty colSpan={7}>Todos os envelopes deste período estão conferidos.</Empty>}</tbody>
      </table></div>
    </Panel>
  )
}

function TpaPanel({ dias, reload }) {
  const { user } = useAuth()
  const toast = useToast()
  const [form, setForm] = useState({})
  async function gravar(d) {
    const f = form[d.data] || {}
    const v = f.valor === '' ? null : parseMoney(f.valor)
    if (f.valor !== '' && (v === null || v < 0)) return toast('Escreve o total do talão de fecho do TPA.', 'bad')
    const { error } = await supabase.from('caixa_app_dias').update({ tpa_talao: v, tpa_nota: f.nota || null, tpa_em: v === null ? null : new Date().toISOString(), tpa_por: v === null ? null : user?.id ?? null }).eq('data', d.data)
    if (error) return toast(error.message, 'bad')
    setForm(o => ({ ...o, [d.data]: undefined }))
    reload('caixa_app_dias')
  }
  return (
    <Panel title="Multibanco + cartão · talão do TPA" hint="Escreve o total do talão de fecho do TPA do dia; a Fatura Chalet compara com multibanco + cartão da app.">
      <div className="tablewrap"><table className="mini-table">
        <thead><tr><th>Dia</th><th className="money">Multibanco</th><th className="money">Cartão</th><th className="money">MB + cartão</th><th className="money">CV virtual</th><th>Talão do TPA</th><th>Resultado</th></tr></thead>
        <tbody>{dias.length ? dias.map(d => {
          const st = estadoTpa(d)
          const f = form[d.data]
          return (
            <tr key={d.data} className={st.estado === 'diferente' ? 'row-alert' : ''}>
              <td>{formatDate(d.data)}{!d.dia_fechado && <span className="muted small"> (aberto)</span>}</td>
              <td className="money">{euroExact(d.totais?.multibanco || 0)}</td><td className="money">{euroExact(d.totais?.cartao || 0)}</td>
              <td className="money"><strong>{euroExact(st.esperado)}</strong></td><td className="money muted">{euroExact(d.totais?.cvVirtual || 0)}</td>
              <td>{f ? (
                <span className="actions">
                  <input inputMode="decimal" placeholder="Total do talão" value={f.valor} onChange={e => setForm(o => ({ ...o, [d.data]: { ...f, valor: e.target.value } }))} style={{ width: 110 }} />
                  <input placeholder="Nota" value={f.nota} onChange={e => setForm(o => ({ ...o, [d.data]: { ...f, nota: e.target.value } }))} />
                  <button className="primary" onClick={() => gravar(d)}>Guardar</button>
                </span>
              ) : (
                <button className="link-btn" onClick={() => setForm(o => ({ ...o, [d.data]: { valor: d.tpa_talao == null ? '' : String(d.tpa_talao).replace('.', ','), nota: d.tpa_nota || '' } }))}>{d.tpa_talao == null ? 'Escrever talão' : `${euroExact(d.tpa_talao)} ✎`}</button>
              )}</td>
              <td>
                {st.estado === 'por_conferir' && <Badge tone="pending">Por conferir</Badge>}
                {st.estado === 'ok' && <Badge tone="ok">Bate certo</Badge>}
                {st.estado === 'diferente' && <span><Badge tone="bad">Diferença {euroExact(st.diferenca)}</Badge>{st.pareceCv && <span className="small"> = CV virtual?</span>}{d.tpa_nota && <em> “{d.tpa_nota}”</em>}</span>}
              </td>
            </tr>
          )
        }) : <Empty colSpan={7}>Ainda não há dias importados.</Empty>}</tbody>
      </table></div>
    </Panel>
  )
}

function PlataformasPanel({ pendentes, reload }) {
  const { user } = useAuth()
  const toast = useToast()
  const grupos = resumoPendentes(pendentes)
  const [tab, setTab] = useState('cvVirtual')
  const [sel, setSel] = useState(() => new Set())
  const [nota, setNota] = useState('')
  const [verConfirmados, setVerConfirmados] = useState(false)
  const g = grupos.find(x => x.metodo === tab)
  const escolhidos = g.abertos.filter(p => sel.has(p.id))

  async function confirmar() {
    if (!escolhidos.length) return
    const { error } = await supabase.from('caixa_app_pendentes').update({ confirmado_em: new Date().toISOString(), confirmado_por: user?.id ?? null, nota: nota || null }).in('id', escolhidos.map(p => p.id))
    if (error) return toast(error.message, 'bad')
    toast(`${escolhidos.length} pagamentos ${g.nome} marcados como recebidos (${euroExact(sumBy(escolhidos, p => p.valor))}).`)
    setSel(new Set())
    setNota('')
    reload('caixa_app_pendentes')
  }
  async function reabrir(p) {
    const { error } = await supabase.from('caixa_app_pendentes').update({ confirmado_em: null, confirmado_por: null, nota: null }).eq('id', p.id)
    if (error) return toast(error.message, 'bad')
    reload('caixa_app_pendentes')
  }
  const toggle = id => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  return (
    <Panel title="CV virtual, Expedia e Airbnb · por receber" hint="Ficam pendentes até confirmares que o pagamento da plataforma entrou. Escolhe os que vieram num pagamento e confirma.">
      <div className="actions" style={{ marginBottom: 10 }}>
        {grupos.map(x => (
          <button key={x.metodo} className={x.metodo === tab ? 'primary' : 'secondary'} onClick={() => { setTab(x.metodo); setSel(new Set()) }}>
            {x.nome} · {x.abertos.length} · {euroExact(x.total)}
          </button>
        ))}
      </div>
      <div className="tablewrap"><table className="mini-table">
        <thead><tr><th><input type="checkbox" checked={g.abertos.length > 0 && escolhidos.length === g.abertos.length} onChange={e => setSel(e.target.checked ? new Set(g.abertos.map(p => p.id)) : new Set())} /></th><th>Dia</th><th>Documento</th><th>Cliente</th><th>Reserva</th><th>Quarto</th><th className="money">Valor</th></tr></thead>
        <tbody>{g.abertos.length ? g.abertos.map(p => (
          <tr key={p.id} className="clickable" onClick={() => toggle(p.id)}>
            <td><input type="checkbox" checked={sel.has(p.id)} readOnly /></td><td>{formatDate(p.data)}</td>
            <td>{p.numero}{p.tipo === 'nota_credito' && <Badge tone="pending">NC</Badge>}</td><td>{p.cliente || '—'}</td><td>{p.reserva || '—'}</td><td>{p.quarto || '—'}</td>
            <td className="money">{euroExact(p.valor)}</td>
          </tr>
        )) : <Empty colSpan={7}>Nada pendente de {g.nome}.</Empty>}</tbody>
      </table></div>
      {escolhidos.length > 0 && (
        <div className="actions" style={{ marginTop: 10 }}>
          <input placeholder="Nota (ex.: pagamento Expedia de 12/11 no extrato)" value={nota} onChange={e => setNota(e.target.value)} style={{ minWidth: 280 }} />
          <button className="primary" onClick={confirmar}>Confirmar entrada de {escolhidos.length} · {euroExact(sumBy(escolhidos, p => p.valor))}</button>
        </div>
      )}
      <label className="small" style={{ display: 'block', marginTop: 10 }}><input type="checkbox" checked={verConfirmados} onChange={e => setVerConfirmados(e.target.checked)} /> ver os já recebidos ({g.confirmados.length})</label>
      {verConfirmados && g.confirmados.length > 0 && (
        <table className="mini-table"><tbody>{g.confirmados.map(p => (
          <tr key={p.id} className="row-muted"><td>{formatDate(p.data)}</td><td>{p.numero}{p.anulada && <Badge tone="bad">anulado na app</Badge>}</td><td>{p.cliente || '—'}</td><td className="money">{euroExact(p.valor)}</td><td>Recebido {formatDateTime(p.confirmado_em)}{p.nota && <em> “{p.nota}”</em>}</td><td><button className="link-btn" onClick={() => reabrir(p)}>reabrir</button></td></tr>
        ))}</tbody></table>
      )}
    </Panel>
  )
}

function DiasPanel({ dias, turnos }) {
  const [aberto, setAberto] = useState(null)
  const metodos = Object.keys(METODOS)
  return (
    <Panel title="Dias importados" hint="Totais da app por dia. Carrega num dia para ver os turnos e os documentos.">
      <div className="tablewrap"><table className="mini-table">
        <thead><tr><th>Dia</th>{metodos.map(m => <th key={m} className="money">{METODOS[m]}</th>)}<th className="money">Total</th><th className="money">Taxa tur.</th></tr></thead>
        <tbody>{dias.length ? dias.flatMap(d => {
          const linhas = [(
            <tr key={d.data} className={`clickable${aberto === d.data ? ' row-selected' : ''}`} onClick={() => setAberto(aberto === d.data ? null : d.data)}>
              <td>{formatDate(d.data)}{!d.dia_fechado && <span className="muted small"> (aberto)</span>}</td>
              {metodos.map(m => <td key={m} className="money">{euroExact(d.totais?.[m] || 0)}</td>)}
              <td className="money"><strong>{euroExact(d.totais?.total || 0)}</strong></td><td className="money">{euroExact(d.totais?.taxaTuristica || 0)}</td>
            </tr>
          )]
          if (aberto === d.data) linhas.push(<tr key={`${d.data}-det`}><td colSpan={metodos.length + 3}><DiaDetalhe dia={d} turnos={turnos.filter(t => t.data === d.data).sort(compararTurnos)} /></td></tr>)
          return linhas
        }) : <Empty colSpan={metodos.length + 3}>Ainda não há dias importados. Carrega em “Importar caixas”.</Empty>}</tbody>
      </table></div>
    </Panel>
  )
}

function DiaDetalhe({ dia, turnos }) {
  const docs = documentosVisiveis(dia)
  const pag = p => Object.entries(p || {}).filter(([, v]) => Number(v)).map(([k, v]) => `${METODOS[k] || k} ${euroExact(v)}`).join(' · ')
  return (
    <div>
      <table className="mini-table">
        <thead><tr><th>Turno</th><th>Fechado</th><th className="money">Fundo inicial</th><th className="money">Esperado</th><th className="money">Contado</th><th className="money">Diferença</th><th className="money">Envelope</th><th>Observação</th></tr></thead>
        <tbody>{turnos.map(t => (
          <tr key={t.id} className={t.diferenca && Number(t.diferenca) !== 0 ? 'row-alert' : ''}>
            <td>{t.turno}</td><td>{t.fechado ? `${formatDateTime(t.fechado_em)} · ${t.fechado_por || ''}` : 'aberto'}</td>
            <td className="money">{euroExact(t.fundo_inicial)}</td><td className="money">{euroExact(t.numerario_esperado)}</td><td className="money">{euroExact(t.numerario_contado)}</td>
            <td className="money"><strong>{euroExact(t.diferenca)}</strong></td><td className="money">{euroExact(t.envelope)}</td><td>{t.observacao || ''}</td>
          </tr>
        ))}</tbody>
      </table>
      <div className="subhead">{docs.length} documentos</div>
      <table className="mini-table">
        <thead><tr><th>Nº</th><th>Turno</th><th>Hora</th><th>Por</th><th>Cliente</th><th>Quarto</th><th>Origem</th><th className="money">Valor</th><th>Pagamentos</th></tr></thead>
        <tbody>{docs.map((x, i) => (
          <tr key={`${x.numero}-${i}`} className={x.anulada ? 'row-muted' : ''}>
            <td>{x.numero}{x.tipo === 'nota_credito' && <Badge tone="pending">NC{x.faturaOrigem ? ` de ${x.faturaOrigem}` : ''}</Badge>}{x.anulada && <Badge tone="bad">anulada</Badge>}</td>
            <td>{x.turno}</td><td>{x.hora}</td><td>{x.por}</td><td>{x.cliente}{x.nif ? ` (${x.nif})` : ''}</td><td>{x.quarto}</td><td>{x.origem}</td>
            <td className="money">{euroExact(x.valor)}</td>
            <td className="small">{pag(x.pagamentos)}{x.anulada && x.motivoAnulacao ? ` — ${x.motivoAnulacao}` : ''}{x.motivo ? ` — ${x.motivo}` : ''}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  )
}
