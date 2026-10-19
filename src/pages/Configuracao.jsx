import { useMemo, useState } from 'react'
import { useData } from '../data/DataProvider'
import { supabase } from '../supabase'
import { Badge, Panel, useToast } from '../components/ui'
import expected from '../data/legacyExpected.json'
import { accountingRows, cashCloseTotal, totals } from '../lib/finance'
import { euroExact, sameAmount, sum, sumBy } from '../lib/money'
import { formatDate } from '../lib/dates'
import { planLegacyImport, readLegacyExport } from '../lib/legacyBrowser'

export default function Configuracao() {
  return (
    <>
      <ValidationPanel />
      <LegacyBrowserImport />
      <PropertiesPanel />
    </>
  )
}

function Check({ label, ok, got, want, note }) {
  return (
    <tr>
      <td>{label}</td>
      <td className="money">{want}</td>
      <td className="money">{got}</td>
      <td>{ok ? <Badge tone="ok">✓ Bate certo</Badge> : <Badge tone="bad">✕ Diferente</Badge>}{note && <div className="muted small">{note}</div>}</td>
    </tr>
  )
}

function ValidationPanel() {
  const { bank_transactions, invoices, invoice_lines, cash_closes, cash_imports, bankRows, invoiceRows } = useData()
  const e = expected
  const bank = bank_transactions.filter(t => t.origem === 'legado')
  const inv = invoices.filter(i => i.origem === 'legado')
  const lines = invoice_lines.filter(l => l.legacy_idx != null)
  const closes = cash_closes.filter(c => c.data >= e.cashCloses.firstDate && c.data <= e.cashCloses.lastDate)
  const closesTotal = sum(closes.map(cashCloseTotal))
  const changedByImports = cash_imports.filter(i => !i.anulada_em && i.alterados > 0).length
  const july = totals(accountingRows(bankRows, invoiceRows).filter(r => String(r.data).startsWith('2026-07')))
  const fmt = (n, v) => `${n} · ${euroExact(v)}`

  return (
    <Panel title="Validação dos dados migrados" hint="Compara o que está no Supabase com os totais do HTML legado V36. Se tudo estiver verde, não se perdeu nenhum registo.">
      <div className="tablewrap">
        <table>
          <thead><tr><th>Conjunto</th><th className="money">Legado</th><th className="money">Supabase</th><th>Resultado</th></tr></thead>
          <tbody>
            <Check label="Movimentos CGD" want={fmt(e.bank.count, e.bank.total)} got={fmt(bank.length, sumBy(bank, t => t.valor))} ok={bank.length === e.bank.count && sameAmount(sumBy(bank, t => t.valor), e.bank.total)} />
            <Check label="Faturas em numerário" want={fmt(e.cashInvoices.count, e.cashInvoices.total)} got={fmt(inv.length, sumBy(inv, i => i.valor))} ok={inv.length === e.cashInvoices.count && sameAmount(sumBy(inv, i => i.valor), e.cashInvoices.total)} note={inv.length === e.cashInvoices.count ? null : 'Alguma fatura legada foi eliminada ou editada.'} />
            <Check label="Linhas de produtos" want={fmt(e.items.count, e.items.total)} got={fmt(lines.length, sumBy(lines, l => l.valor))} ok={lines.length === e.items.count && sameAmount(sumBy(lines, l => l.valor), e.items.total)} />
            <Check label={`Fechos de caixa (${formatDate(e.cashCloses.firstDate)} a ${formatDate(e.cashCloses.lastDate)})`} want={fmt(e.cashCloses.count, e.cashCloses.total)} got={fmt(closes.length, closesTotal)}
              ok={closes.length === e.cashCloses.count && sameAmount(closesTotal, e.cashCloses.total)}
              note={changedByImports ? `${changedByImports} importação(ões) alteraram fechos; os valores anteriores estão no histórico da Caixa diária.` : null} />
          </tbody>
        </table>
      </div>
      <div className="detail-note">
        Julho de 2026 (mês do extrato legado): CGD {euroExact(july.cgd)} + Numerário {euroExact(july.numerario)} = <strong>{euroExact(july.total)}</strong> de despesa contabilística
        (as transferências entre empresas, {euroExact(e.bankCompanyTransfers.total)}, ficam fora).
      </div>
    </Panel>
  )
}

function LegacyBrowserImport() {
  const db = useData()
  const toast = useToast()
  const [payload, setPayload] = useState(null)
  const [busy, setBusy] = useState(false)
  const plan = useMemo(() => (payload ? planLegacyImport(readLegacyExport(payload), { bank: db.bank_transactions, categories: db.categories, closes: db.cash_closes, checks: db.cash_checks, tpa: db.tpa_records }) : null), [payload, db.bank_transactions, db.categories, db.cash_closes, db.cash_checks, db.tpa_records])

  async function read(file) {
    try {
      const json = JSON.parse(await file.text())
      if (!json.localStorage && !json.despesas_app_categories_v2 && !json.faturaclaro_envelopes_v2) throw new Error('não parece uma exportação da FaturaClaro antiga')
      setPayload(json)
    } catch (e) {
      toast(`Ficheiro inválido: ${e.message}`, 'bad')
    }
  }

  async function apply() {
    setBusy(true)
    const done = { categorias: 0, fechos: 0, conferencias: 0, tpa: 0, erros: [] }
    try {
      const { error: e0 } = await supabase.from('legacy_browser_imports').insert({ payload, resumo: { categorias: plan.categoryChanges.length, fechos: plan.closesDiff.novos.length + plan.closesDiff.alterados.length, conferencias: plan.checks.length, tpa: plan.tpa.length } })
      if (e0) throw e0
      const catIds = new Map(db.categories.map(c => [c.nome, c.id]))
      for (const nome of plan.newCategories) {
        const { data, error } = await supabase.from('categories').insert({ nome }).select().single()
        if (error) done.erros.push(error.message); else catIds.set(nome, data.id)
      }
      for (const ch of plan.categoryChanges) {
        const { error } = await supabase.from('bank_transactions').update({ categoria_id: catIds.get(ch.para) }).eq('id', ch.bank_transaction_id)
        if (error) done.erros.push(error.message); else done.categorias++
      }
      const closeRows = [...plan.closesDiff.novos, ...plan.closesDiff.alterados.map(a => a.depois)]
      if (closeRows.length) {
        const { error } = await supabase.rpc('import_cash_closes', { p_rows: closeRows, p_file: 'Dados do navegador (HTML legado)', p_origem: 'navegador' })
        if (error) done.erros.push(error.message); else done.fechos = closeRows.length
      }
      if (plan.checks.length) {
        const { data: closes, error: ec } = await supabase.from('cash_closes').select('id, data, turno').in('data', [...new Set(plan.checks.map(c => c.data))])
        if (ec) throw ec
        const byKey = new Map(closes.map(c => [`${c.data}|${c.turno}`, c.id]))
        const rows = plan.checks.filter(c => byKey.has(`${c.data}|${c.turno}`)).map(c => ({ cash_close_id: byKey.get(`${c.data}|${c.turno}`), tipo: c.tipo, valor_esperado: c.valor_esperado, valor_real: c.valor_real }))
        for (let i = 0; i < rows.length; i += 200) {
          const { error } = await supabase.from('cash_checks').upsert(rows.slice(i, i + 200), { onConflict: 'cash_close_id,tipo', ignoreDuplicates: true })
          if (error) done.erros.push(error.message); else done.conferencias += rows.slice(i, i + 200).length
        }
      }
      if (plan.tpa.length) {
        const { error } = await supabase.from('tpa_records').upsert(plan.tpa, { onConflict: 'data,turno' })
        if (error) done.erros.push(error.message); else done.tpa = plan.tpa.length
      }
      toast(`Importado: ${done.categorias} categorias, ${done.fechos} fechos, ${done.conferencias} conferências, ${done.tpa} TPA.${done.erros.length ? ` Erros: ${done.erros.join('; ')}` : ''}`, done.erros.length ? 'bad' : 'ok')
      setPayload(null)
      db.reloadAll()
    } catch (e) {
      toast(`Erro: ${e.message}`, 'bad')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel title="Importar dados do navegador antigo" hint="O HTML antigo guardava alterações de categoria, conferências de envelopes, fechos importados e valores TPA apenas no navegador. Recupera-os aqui para não se perder nada.">
      <ol className="howto">
        <li>No computador onde usavas a versão antiga, abre o ficheiro <code>legacy/index.html</code> desta versão (no mesmo navegador e na mesma pasta onde estava o antigo).</li>
        <li>No menu lateral carrega em <strong>“⇩ Exportar dados deste navegador”</strong>. É descarregado o ficheiro <code>faturaclaro-dados-navegador.json</code>.</li>
        <li>Escolhe esse ficheiro aqui, revê o resumo e confirma.</li>
      </ol>
      <label className="file-button"><input type="file" accept="application/json,.json" onChange={e => e.target.files[0] && read(e.target.files[0])} />Escolher ficheiro JSON</label>
      {plan && (
        <div className="import-plan">
          <ul>
            <li><strong>{plan.categoryChanges.length}</strong> alterações de categoria{plan.newCategories.length ? ` (${plan.newCategories.length} categorias novas: ${plan.newCategories.join(', ')})` : ''}</li>
            <li><strong>{plan.closesDiff.novos.length}</strong> fechos novos e <strong>{plan.closesDiff.alterados.length}</strong> fechos com valores diferentes ({plan.closesDiff.iguais.length} iguais)</li>
            <li><strong>{plan.checks.length}</strong> conferências de envelopes</li>
            <li><strong>{plan.tpa.length}</strong> registos TPA</li>
          </ul>
          {plan.skipped.length > 0 && <details className="notice"><summary>{plan.skipped.length} itens não serão aplicados</summary><ul>{plan.skipped.slice(0, 50).map((s, i) => <li key={i}>{s}</li>)}</ul></details>}
          <p className="muted small">Uma cópia integral do ficheiro fica guardada no Supabase. Os fechos alterados ficam no histórico da Caixa diária e podem ser anulados.</p>
          <div className="actions"><button className="secondary" onClick={() => setPayload(null)}>Cancelar</button><button className="primary" disabled={busy} onClick={apply}>{busy ? 'A importar…' : 'Importar para o Supabase'}</button></div>
        </div>
      )}
    </Panel>
  )
}

function PropertiesPanel() {
  const { properties, upsertLocal } = useData()
  const toast = useToast()
  const [nome, setNome] = useState('')
  async function add() {
    if (!nome.trim()) return
    const { data, error } = await supabase.from('properties').insert({ nome: nome.trim() }).select().single()
    if (error) return toast(error.message, 'bad')
    upsertLocal('properties', data)
    setNome('')
  }
  async function toggle(p) {
    const { data, error } = await supabase.from('properties').update({ ativo: !p.ativo }).eq('id', p.id).select().single()
    if (error) return toast(error.message, 'bad')
    upsertLocal('properties', data)
  }
  return (
    <Panel title="Imóveis">
      <div className="chips">
        {properties.map(p => <label key={p.id} className={`chip ${p.ativo ? '' : 'off'}`}><input type="checkbox" checked={p.ativo} onChange={() => toggle(p)} /> {p.nome}</label>)}
      </div>
      <div className="filters flat"><input value={nome} onChange={e => setNome(e.target.value)} placeholder="Novo imóvel…" onKeyDown={e => e.key === 'Enter' && add()} /><button className="primary" onClick={add}>Adicionar imóvel</button></div>
    </Panel>
  )
}
