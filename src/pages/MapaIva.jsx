import { useMemo, useState } from 'react'
import { useData } from '../data/DataProvider'
import { useFilters } from '../data/FiltersProvider'
import { Empty, Kpi, Panel, Select } from '../components/ui'
import { ISENCOES, mapaIva, mapaIvaAno, taxaLabel } from '../lib/mapaIva'
import { saftMonths } from '../lib/saftReconcile'
import { euro, sub, sum } from '../lib/money'
import { monthLabel, monthOf, monthShort } from '../lib/dates'
import { decimalPt, downloadText, toCsv } from '../lib/csv'

// IVA das faturas de compras do mês (indicativo: só as que têm o IVA preenchido).
function ivaCompras(invoices, month) {
  const doMes = invoices.filter(i => monthOf(i.data) === month && i.estado !== 'Rejeitada')
  const comIva = doMes.filter(i => i.iva != null)
  return { iva: sum(comIva.map(i => Number(i.iva))), comIva: comIva.length, semIva: doMes.length - comIva.length }
}

// Mapa de IVA das vendas (SAF-T do InvoiceXpress) por taxa, mês a mês.
export default function MapaIva() {
  const { saft_documentos, invoices, saftReady } = useData()
  const { filters, set } = useFilters()
  const months = useMemo(() => saftMonths(saft_documentos), [saft_documentos])
  const month = months.includes(filters.month) ? filters.month : months.at(-1) || ''
  const years = useMemo(() => [...new Set(months.map(m => m.slice(0, 4)))], [months])
  const [vista, setVista] = useState('mes')
  const year = month.slice(0, 4)

  const doMes = useMemo(() => saft_documentos.filter(d => monthOf(d.data) === month), [saft_documentos, month])
  const r = useMemo(() => mapaIva(doMes), [doMes])
  const ano = useMemo(() => (year ? mapaIvaAno(saft_documentos, year) : null), [saft_documentos, year])
  const compras = useMemo(() => ivaCompras(invoices, month), [invoices, month])

  const exportCsv = () => vista === 'mes'
    ? downloadText(toCsv(['Taxa', 'Documentos', 'Base tributável', 'IVA', 'Total'],
      [...r.linhas.map(l => [taxaLabel(l), l.documentos, decimalPt(l.base), decimalPt(l.iva), decimalPt(l.total)]), ['Total', r.documentos, decimalPt(r.base), decimalPt(r.iva), decimalPt(r.total)]]), `mapa_iva_${month}.csv`)
    : downloadText(toCsv(['Mês', ...ano.taxas.flatMap(t => [`Base ${taxaLabel(t)}`, `IVA ${taxaLabel(t)}`]), 'Base total', 'IVA total'],
      ano.meses.map(m => [m.mes, ...ano.taxas.flatMap(t => [decimalPt(m.porTaxa[t.key]?.base || 0), decimalPt(m.porTaxa[t.key]?.iva || 0)]), decimalPt(m.base), decimalPt(m.iva)])), `mapa_iva_${year}.csv`)

  return (
    <>
      {!saftReady && <div className="notice bad">Para usar esta página é preciso executar uma vez o ficheiro <strong>supabase/16_saft_invoicexpress.sql</strong> no SQL Editor do Supabase.</div>}
      <div className="filters">
        <Select value={vista} onChange={setVista} options={[{ value: 'mes', label: 'Um mês' }, { value: 'ano', label: 'Ano, mês a mês' }]} aria-label="Vista" />
        {vista === 'mes'
          ? <Select value={month} onChange={v => set({ month: v })} options={months.map(v => ({ value: v, label: monthLabel(v) }))} placeholder="Sem SAF-T importado" aria-label="Mês" />
          : <Select value={year} onChange={y => set({ month: months.filter(m => m.startsWith(y)).at(-1) })} options={years} aria-label="Ano" />}
        {month && <button className="secondary" onClick={exportCsv}>Exportar CSV</button>}
      </div>

      {!month ? (
        <Panel title="Ainda não há SAF-T">
          <p>O mapa de IVA sai do SAF-T que a app vai buscar ao InvoiceXpress (página <strong>Faturado</strong>). Assim que houver um mês importado, aparece aqui a base e o IVA por taxa.</p>
        </Panel>
      ) : vista === 'mes' ? (
        <>
          <div className="grid4">
            <Kpi color="blue" icon="Σ" label="Base tributável" value={euro(r.base)} note={`${r.documentos} documentos (sem anulados, notas de crédito a subtrair)`} />
            <Kpi color="purple" icon="%" label="IVA liquidado (vendas)" value={euro(r.iva)} note={`IVA declarado nos documentos: ${euro(r.ivaDocumentos)}`} />
            <Kpi color="orange" icon="↘" label="IVA nas faturas de compras" value={euro(compras.iva)} note={`${compras.comIva} faturas com IVA${compras.semIva ? ` · ${compras.semIva} sem IVA preenchido` : ''}`} />
            <Kpi color="green" icon="≈" label="Diferença (indicativa)" value={euro(sub(r.iva, compras.iva))} note="IVA das vendas − IVA das compras; o apuramento oficial é o da contabilidade" />
          </div>
          {Math.abs(r.diferencaIva) >= 0.05 && <div className="notice">O IVA somado por taxa difere {euro(r.diferencaIva)} do IVA que os documentos declaram: são arredondamentos linha a linha. Confere com o mapa de IVA do InvoiceXpress.</div>}
          {r.docsSemTaxas > 0 && <div className="notice bad">{r.docsSemTaxas} documento(s) importados antes do mapa de IVA não têm o IVA por taxa. Carrega em <strong>Ir buscar ao InvoiceXpress</strong> na página Faturado para voltar a importar {monthLabel(month)}.</div>}
          <Panel title={`Mapa de IVA · ${monthLabel(month)}`} hint="Vendas do InvoiceXpress (SAF-T). Deve bater com o mapa de IVA do InvoiceXpress para o mesmo mês.">
            <div className="tablewrap">
              <table className="mini-table">
                <thead><tr><th>Taxa</th><th className="money">Documentos</th><th className="money">Base tributável</th><th className="money">IVA</th><th className="money">Total</th></tr></thead>
                <tbody>
                  {r.linhas.length ? r.linhas.map(l => (
                    <tr key={`${l.taxa}${l.isencao}`}>
                      <td>{taxaLabel(l)}{l.isencao && ISENCOES[l.isencao] && <div className="muted small">{ISENCOES[l.isencao]}</div>}</td>
                      <td className="money">{l.documentos}</td>
                      <td className="money">{euro(l.base)}</td>
                      <td className="money">{euro(l.iva)}</td>
                      <td className="money">{euro(l.total)}</td>
                    </tr>
                  )) : <Empty colSpan={5}>Sem IVA por taxa neste mês.</Empty>}
                </tbody>
                <tfoot><tr><th>Total</th><th className="money">{r.documentos}</th><th className="money">{euro(r.base)}</th><th className="money">{euro(r.iva)}</th><th className="money">{euro(r.total)}</th></tr></tfoot>
              </table>
            </div>
          </Panel>
        </>
      ) : (
        <Panel title={`Mapa de IVA · ${year}`} hint="Base e IVA por taxa em cada mês importado do InvoiceXpress.">
          <div className="tablewrap">
            <table className="mini-table">
              <thead>
                <tr><th>Mês</th>{ano.taxas.map(t => <th key={t.key} className="money" colSpan={2}>{taxaLabel(t)}</th>)}<th className="money">Base total</th><th className="money">IVA total</th></tr>
                <tr className="row-muted"><th />{ano.taxas.map(t => [<th key={`${t.key}b`} className="money">Base</th>, <th key={`${t.key}i`} className="money">IVA</th>])}<th /><th /></tr>
              </thead>
              <tbody>
                {ano.meses.map(m => (
                  <tr key={m.mes}>
                    <td><button className="link-btn" onClick={() => { set({ month: m.mes }); setVista('mes') }}>{monthShort(m.mes)}</button></td>
                    {ano.taxas.map(t => [<td key={`${t.key}b`} className="money">{euro(m.porTaxa[t.key]?.base || 0)}</td>, <td key={`${t.key}i`} className="money">{euro(m.porTaxa[t.key]?.iva || 0)}</td>])}
                    <td className="money">{euro(m.base)}</td>
                    <td className="money"><strong>{euro(m.iva)}</strong></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr><th>Total</th>{ano.taxas.map(t => [<th key={`${t.key}b`} className="money">{euro(sum(ano.meses.map(m => m.porTaxa[t.key]?.base || 0)))}</th>, <th key={`${t.key}i`} className="money">{euro(sum(ano.meses.map(m => m.porTaxa[t.key]?.iva || 0)))}</th>])}<th className="money">{euro(ano.total.base)}</th><th className="money">{euro(ano.total.iva)}</th></tr>
              </tfoot>
            </table>
          </div>
        </Panel>
      )}
    </>
  )
}
