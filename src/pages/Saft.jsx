import { useMemo, useState } from 'react'
import { useData } from '../data/DataProvider'
import { useFilters } from '../data/FiltersProvider'
import { supabase } from '../supabase'
import { Badge, Empty, Kpi, Modal, Panel, Select, useToast } from '../components/ui'
import { MEIOS, readSaftFile } from '../lib/saft'
import { saftMonths, saftReconcile } from '../lib/saftReconcile'
import { euro } from '../lib/money'
import { formatDate, formatDateTime, monthLabel } from '../lib/dates'
import { decimalPt, downloadText, toCsv } from '../lib/csv'

const tone = v => (Math.abs(v) < 0.005 ? '' : v > 0 ? 'negative' : 'positive')

// SAF-T: o que foi faturado (fonte oficial) contra a caixa diária e as entradas no banco.
export default function Saft() {
  const { saft_documentos, saft_imports, cash_closes, bank_credits, saftReady, reload } = useData()
  const { filters, set } = useFilters()
  const [importing, setImporting] = useState(false)
  const months = useMemo(() => saftMonths(saft_documentos), [saft_documentos])
  const month = months.includes(filters.month) ? filters.month : months.at(-1) || ''
  const r = useMemo(() => (month ? saftReconcile(month, { docs: saft_documentos, closes: cash_closes, credits: bank_credits }) : null), [month, saft_documentos, cash_closes, bank_credits])
  const ultimo = saft_imports[0]

  const exportCsv = () => downloadText(toCsv(
    ['Dia', 'Documentos', 'Faturado SAF-T', 'City tax', 'Caixa', 'Caixa MB+CV', 'TPA no banco', 'Faturado - caixa'],
    r.dias.map(d => [d.dia, d.documentos, decimalPt(d.faturado), decimalPt(d.cityTax), decimalPt(d.caixa), decimalPt(d.cartoes), decimalPt(d.tpa), decimalPt(d.diferenca)]),
  ), `saft_${month}.csv`)

  return (
    <>
      {!saftReady && <div className="notice bad">Para usar esta página é preciso executar uma vez o ficheiro <strong>supabase/08_saft.sql</strong> no SQL Editor do Supabase.</div>}
      <div className="filters">
        <Select value={month} onChange={v => set({ month: v })} options={months.map(v => ({ value: v, label: monthLabel(v) }))} placeholder="Sem SAF-T importado" aria-label="Mês" />
        {r && <button className="secondary" onClick={exportCsv}>Exportar CSV</button>}
        <button className="primary" disabled={!saftReady} onClick={() => setImporting(true)}>Importar SAF-T</button>
      </div>
      {ultimo && <div className="notice">Último SAF-T: <strong>{ultimo.ficheiro || 'sem nome'}</strong> ({formatDate(ultimo.inicio)} a {formatDate(ultimo.fim)}, {ultimo.documentos} documentos), importado em {formatDateTime(ultimo.importado_em)}.</div>}

      {!r ? (
        <Panel title="Ainda não há SAF-T">
          <p>Exporta o SAF-T de faturação de um mês no programa de faturação (o ficheiro .xml ou o .zip) e importa-o aqui. A app passa a usar o SAF-T como o faturado oficial e mostra o que não bate com a caixa diária e o banco.</p>
        </Panel>
      ) : (
        <>
          <div className="grid4">
            <Kpi color="green" icon="§" label="Faturado (SAF-T)" value={euro(r.faturado)} note={`${r.faturas} faturas − ${r.notasCredito.length} notas de crédito`} />
            <Kpi color="purple" icon="🏛" label="Taxa turística" value={euro(r.cityTax)} note={`Sem taxa turística: ${euro(r.semCityTax)}`} />
            <Kpi color="blue" icon="↘" label="Recebido que a app vê" value={euro(r.recebido)} note={`Caixa ${euro(r.caixa)} + banco ${euro(r.banco)}`} />
            <Kpi color={r.diferenca > 0 ? 'red' : 'orange'} icon="≠" label="Faturado − recebido" value={euro(r.diferenca)} note={r.diferenca > 0 ? 'Faturado que ainda não se vê a entrar' : 'Entrou mais do que se faturou'} />
          </div>

          <Problemas r={r} />

          <div className="twocol">
            <Panel title="De onde veio o dinheiro" hint="O TPA no banco não soma: é o MB e o CV da caixa a chegar à conta.">
              <table className="mini-table">
                <tbody>
                  <tr><td>Caixa diária (dinheiro, CV, MB, City MB)</td><td className="money">{euro(r.caixa)}</td></tr>
                  {r.bancoPorTipo.map(t => <tr key={t.tipo}><td>Banco: {t.tipo}</td><td className="money">{euro(t.total)}</td></tr>)}
                  <tr><td><strong>Recebido</strong></td><td className="money"><strong>{euro(r.recebido)}</strong></td></tr>
                  <tr className="row-muted"><td>TPA no banco (só para conferir a caixa)</td><td className="money">{r.temTpa ? euro(r.tpa) : 'extrato por importar'}</td></tr>
                </tbody>
              </table>
            </Panel>
            <Panel title="Faturado por canal" hint="Pelo cliente, pelo email do hóspede (…@guest.booking.com, …@m.expediapartnercentral.com) ou pela descrição da fatura.">
              <table className="mini-table">
                <tbody>{r.porCanal.map(c => <tr key={c.canal}><td>{c.canal}</td><td className="money">{euro(c.total)}</td></tr>)}</tbody>
              </table>
              <div className="hint">Para os outros canais aparecerem, a receção pode escrever o canal (por exemplo “AIRBNB” ou “GRUPO”) na descrição da fatura.</div>
            </Panel>
          </div>

          <Panel title="Dia a dia" hint="Faturado no SAF-T contra a caixa do dia e o TPA no banco. Num só dia a diferença pode ser só de datas (pago num dia, faturado no check-out); o que conta é o total do mês.">
            <div className="tablewrap tall">
              <table className="mini-table">
                <thead><tr><th>Dia</th><th className="money">Docs</th><th className="money">Faturado</th><th className="money">Taxa tur.</th><th className="money">Caixa</th><th className="money">Caixa MB+CV</th><th className="money">TPA banco</th><th className="money">Faturado − caixa</th><th /></tr></thead>
                <tbody>
                  {r.dias.length ? r.dias.map(d => (
                    <tr key={d.dia}>
                      <td>{formatDate(d.dia)}</td>
                      <td className="money">{d.documentos}</td>
                      <td className="money">{euro(d.faturado)}</td>
                      <td className="money">{euro(d.cityTax)}</td>
                      <td className="money">{euro(d.caixa)}</td>
                      <td className="money">{euro(d.cartoes)}</td>
                      <td className="money">{euro(d.tpa)}</td>
                      <td className={`money ${tone(d.diferenca)}`}>{euro(d.diferenca)}</td>
                      <td>{d.semCaixa ? <Badge tone="bad">sem caixa</Badge> : d.tpaNaoBate ? <Badge tone="pending">TPA ≠ caixa</Badge> : null}</td>
                    </tr>
                  )) : <Empty colSpan={9}>Sem dias neste mês.</Empty>}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      )}

      {importing && <ImportModal onClose={() => setImporting(false)} onDone={m => { setImporting(false); reload('saft_documentos'); reload('saft_imports'); if (m) set({ month: m }) }} />}
    </>
  )
}

function Problemas({ r }) {
  const [open, setOpen] = useState(null)
  const meiosTexto = r.meios.map(m => `${MEIOS[m.meio] || m.meio}: ${m.count}`).join(' · ')
  const soTransferencia = r.meios.length > 0 && r.meios[0].meio === 'TB' && r.meios[0].count >= 0.9 * r.meios.reduce((a, m) => a + m.count, 0)
  const items = [
    r.diasSemCaixa.length > 0 && { id: 'semCaixa', tone: 'bad', titulo: `${r.diasSemCaixa.length} dia(s) com faturas e sem caixa diária`, texto: 'Falta lançar ou importar a caixa destes dias.', lista: r.diasSemCaixa.map(d => `${formatDate(d.dia)}: faturado ${euro(d.faturado)}`) },
    r.diasTpaNaoBate.length > 0 && { id: 'tpa', tone: 'pending', titulo: `${r.diasTpaNaoBate.length} dia(s) em que o TPA no banco não bate com o MB + CV da caixa`, texto: 'Pode ser um turno por lançar ou um pagamento que entrou no dia seguinte.', lista: r.diasTpaNaoBate.map(d => `${formatDate(d.dia)}: caixa ${euro(d.cartoes)} · banco ${euro(d.tpa)}`) },
    r.semRecibo.length > 0 && { id: 'semRecibo', tone: 'pending', titulo: `${r.semRecibo.length} fatura(s) sem recibo: ${euro(r.semRecibo.reduce((a, d) => a + Number(d.total), 0))}`, texto: 'Faturado mas ainda sem pagamento registado no programa de faturação.', lista: r.semRecibo.map(d => `${d.numero} · ${formatDate(d.data)} · ${d.cliente} · ${euro(d.total)}`) },
    r.recebidoAMenos.length > 0 && { id: 'aMenos', tone: 'pending', titulo: `${r.recebidoAMenos.length} fatura(s) com recibo abaixo do total`, lista: r.recebidoAMenos.map(d => `${d.numero} · ${d.cliente} · total ${euro(d.total)} · recebido ${euro(d.valor_recebido)}`) },
    r.anuladasSemSubstituicao.length > 0 && { id: 'anuladas', tone: 'pending', titulo: `${r.anuladasSemSubstituicao.length} fatura(s) anulada(s) sem nova fatura para o mesmo cliente`, texto: 'Confirmar se foram cancelamentos ou no-shows.', lista: r.anuladasSemSubstituicao.map(d => `${d.numero} · ${formatDate(d.data)} · ${d.cliente} · ${euro(d.total)}`) },
    r.notasCredito.length > 0 && { id: 'nc', tone: '', titulo: `${r.notasCredito.length} nota(s) de crédito: ${euro(r.notasCredito.reduce((a, d) => a + Number(d.total), 0))}`, lista: r.notasCredito.map(d => `${d.numero} · ${formatDate(d.data)} · ${d.cliente} · ${euro(d.total)}${d.referencias?.length ? ` · corrige ${d.referencias.join(', ')}` : ''}`) },
    r.saltos.length > 0 && { id: 'saltos', tone: 'bad', titulo: `${r.saltos.length} número(s) em falta na numeração`, texto: 'Documentos que não vieram no ficheiro.', lista: r.saltos },
    soTransferencia && { id: 'meios', tone: 'pending', titulo: 'Os recibos dizem quase todos “transferência”', texto: `O programa de faturação marca os recibos como transferência mesmo quando o pagamento foi em MB, cartão ou numerário (${meiosTexto}). Por isso o meio de pagamento do SAF-T não serve para cruzar; convém falar com a contabilidade.` },
  ].filter(Boolean)

  return (
    <Panel title="O que precisa de atenção" hint="O SAF-T é o que está certo; estes pontos mostram onde a caixa, o banco ou a faturação precisam de ajuste.">
      {items.length ? (
        <ul className="calc-list">
          {items.map(i => (
            <li key={i.id}>
              <Badge tone={i.tone}>{i.tone === 'bad' ? 'corrigir' : i.tone === 'pending' ? 'ver' : 'info'}</Badge> <strong>{i.titulo}</strong>
              {i.texto && <div className="muted small">{i.texto}</div>}
              {i.lista && <div><button className="link-btn" onClick={() => setOpen(open === i.id ? null : i.id)}>{open === i.id ? 'Esconder' : 'Ver lista'}</button></div>}
              {open === i.id && <ul className="small">{i.lista.map(x => <li key={x}>{x}</li>)}</ul>}
            </li>
          ))}
        </ul>
      ) : <p>Está tudo a bater certo neste mês.</p>}
    </Panel>
  )
}

function ImportModal({ onClose, onDone }) {
  const toast = useToast()
  const [parsed, setParsed] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  async function pick(file) {
    setError(null)
    setParsed(null)
    if (!file) return
    try {
      setParsed(await readSaftFile(file))
    } catch (e) {
      setError(e.message)
    }
  }

  async function save() {
    setBusy(true)
    const { info, docs, recibosFora } = parsed
    const { data, error: err } = await supabase.rpc('importar_saft', { p_info: info, p_docs: docs, p_recibos_fora: recibosFora })
    setBusy(false)
    if (err) return toast(`Não foi possível importar: ${err.message}`, 'bad')
    toast(`SAF-T importado: ${data.documentos} documentos${data.substituidos ? ` (substituíram ${data.substituidos} do mesmo período)` : ''}.`)
    onDone(info.inicio.slice(0, 7))
  }

  const info = parsed?.info
  const anuladas = parsed?.docs.filter(d => d.estado === 'A').length || 0
  return (
    <Modal title="Importar SAF-T" onClose={onClose}>
      <p className="muted">Escolhe o SAF-T de faturação exportado do programa de faturação (.xml ou .zip). Se já importaste o mesmo período, os documentos são substituídos.</p>
      <input type="file" accept=".xml,.zip,application/xml,text/xml,application/zip" onChange={e => pick(e.target.files?.[0])} />
      {error && <div className="notice bad">{error}</div>}
      {info && (
        <table className="mini-table">
          <tbody>
            <tr><td>Empresa</td><td>{info.empresa} (NIF {info.nif})</td></tr>
            <tr><td>Período</td><td>{formatDate(info.inicio)} a {formatDate(info.fim)}</td></tr>
            <tr><td>Documentos</td><td>{parsed.docs.length} ({anuladas} anulados) · {info.recibos} recibos</td></tr>
            <tr><td>Faturado</td><td><strong>{euro(info.total)}</strong></td></tr>
          </tbody>
        </table>
      )}
      <div className="actions end">
        <button className="secondary" onClick={onClose}>Cancelar</button>
        <button className="primary" disabled={!parsed || busy} onClick={save}>{busy ? 'A importar…' : 'Importar'}</button>
      </div>
    </Modal>
  )
}
