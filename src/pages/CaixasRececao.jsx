import { useMemo, useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { useData } from '../data/DataProvider'
import { useFilters } from '../data/FiltersProvider'
import { supabase } from '../supabase'
import { Badge, Empty, Kpi, Panel, Select, useToast } from '../components/ui'
import { importarCaixasApp } from '../data/caixasApp'
import { alertas, CAIXAS_APP_INICIO, compararTurnos, estadoEnvelope, estadoTpa, METODOS, totaisDias } from '../lib/caixaApp'
import { SHIFT_INFO } from '../lib/reconciliation'
import { euroExact, parseMoney, sumBy } from '../lib/money'
import { formatDate, formatDateTime, monthLabel, monthOf, todayIso } from '../lib/dates'

const ALERTA_ICON = { diferenca: '⚠️', observacao: '💬', envelope: '✉️', mudou: '↻', tpa: '💳', aberto: '⏳' }
const RECARREGAR = ['caixa_app_dias', 'caixa_app_turnos', 'caixa_app_pendentes', 'cash_closes', 'cash_imports']

export default function CaixasRececao() {
  const { caixa_app_dias: dias, caixa_app_turnos: turnos, caixasAppReady, reload, upsertLocal } = useData()
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
          <p>Desde {formatDate(CAIXAS_APP_INICIO)} as caixas vêm da app da receção (os dias anteriores continuam os do Excel). Guarda só os totais de cada forma de pagamento por turno. A importação é automática ao abrires a Fatura Chalet e não duplica dias.</p>
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
        <Kpi color="orange" icon="CV" label="CV / Expedia / Airbnb" value={euroExact(tot.cvVirtual + tot.expedia + tot.airbnb)} note="Totais dos turnos" />
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

      <TurnosPanel dias={diasMes} turnos={turnosMes} />
      <EnvelopesPanel turnos={turnosMes} upsertLocal={upsertLocal} />
      <TpaPanel dias={diasMes} reload={reload} />
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

// Ordem pedida pelo Daniel: numerário, multibanco, cartão, CV, Expedia, Airbnb (e transferência).
const COLUNAS = ['numerario', 'multibanco', 'cartao', 'cvVirtual', 'expedia', 'airbnb', 'transferencia']

function TurnosPanel({ dias, turnos }) {
  const n = COLUNAS.length + 4
  return (
    <Panel title="Totais por turno" hint="Quem fechou cada turno e o total de cada forma de pagamento. A linha do dia soma os três turnos.">
      <div className="tablewrap"><table className="mini-table">
        <thead><tr><th>Dia</th><th>Turno</th><th>Fechado por</th>{COLUNAS.map(m => <th key={m} className="money">{METODOS[m]}</th>)}<th className="money">Total</th></tr></thead>
        <tbody>{dias.length ? dias.flatMap(d => {
          const doDia = turnos.filter(t => t.data === d.data).sort(compararTurnos)
          return [
            ...doDia.map(t => (
              <tr key={t.id} className={t.diferenca && Number(t.diferenca) !== 0 ? 'row-alert' : ''}>
                <td>{formatDate(t.data)}</td>
                <td>{t.turno} <span className="muted small">{SHIFT_INFO[t.turno]?.nome}</span></td>
                <td>{t.fechado ? <>{t.fechado_por || '—'} <span className="muted small">{formatDateTime(t.fechado_em)}</span></> : <span className="muted">aberto</span>}</td>
                {COLUNAS.map(m => <td key={m} className="money">{euroExact(t.totais?.[m] || 0)}</td>)}
                <td className="money"><strong>{euroExact(t.totais?.total || 0)}</strong></td>
              </tr>
            )),
            <tr key={`${d.data}-dia`} className="cash-total-row">
              <td colSpan={3}><strong>Dia {formatDate(d.data)}</strong>{!d.dia_fechado && <span className="muted small"> (com turnos abertos)</span>}</td>
              {COLUNAS.map(m => <td key={m} className="money"><strong>{euroExact(d.totais?.[m] || 0)}</strong></td>)}
              <td className="money"><strong>{euroExact(d.totais?.total || 0)}</strong></td>
            </tr>,
          ]
        }) : <Empty colSpan={n}>Ainda não há dias importados. Carrega em “Importar caixas”.</Empty>}</tbody>
      </table></div>
    </Panel>
  )
}
