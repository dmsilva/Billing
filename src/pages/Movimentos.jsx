import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import * as XLSXLoader from '../lib/xlsxLoader'
import { useData } from '../data/DataProvider'
import { useFilters } from '../data/FiltersProvider'
import FilterBar from '../components/FilterBar'
import { Empty, Kpi, Modal, Panel, PaymentBadge, useToast } from '../components/ui'
import { applyFilters, PAYMENT_CGD } from '../lib/finance'
import { euro, parseMoney, sumBy } from '../lib/money'
import { formatDate, formatDateTime } from '../lib/dates'
import { decimalPt, downloadText, toCsv } from '../lib/csv'
import { CREDIT_TYPES, goesToReception, guessPayer, matchTransfer, parseBankStatement, suggestClassification } from '../lib/bankImport'
import { parseCsvText } from '../lib/cashImport'
import { checkBalances, statementMatrix } from '../lib/pdfStatement'
import { supabase } from '../supabase'
import CategorySelect from '../components/CategorySelect'
import DuplicatesPanel from '../components/DuplicatesPanel'
import { ensureCategories } from '../data/categories'
import { UNCLASSIFIED } from '../lib/finance'

export default function Movimentos() {
  const { bankRows, bank_transactions, bank_imports, categoriesById, propertiesById, reload, upsertLocal, invoices, invoice_payments } = useData()
  const { filters } = useFilters()
  const toast = useToast()
  const [importing, setImporting] = useState(false)
  const [q, setQ] = useState('')
  const rows = useMemo(() => applyFilters(bankRows, { ...filters, payment: '' }).sort((a, b) => String(a.data).localeCompare(String(b.data)) || a.id - b.id), [bankRows, filters])
  // Pesquisa na tabela: descrição, categoria, imóvel, valor (ex.: 12,30 ou 12.30) ou data (ex.: 03/07).
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return rows
    return rows.filter(r => `${r.descricao} ${r.categoria} ${r.imovel} ${Number(r.valor).toFixed(2)} ${Number(r.valor).toFixed(2).replace('.', ',')} ${formatDate(r.data)} ${r.source.notas || ''}`.toLowerCase().includes(t))
  }, [rows, q])
  const expense = rows.filter(r => r.contaComoDespesa)

  // Movimentos com fatura ou pagamento ligado não se apagam (ficam como o original).
  const linkedIds = useMemo(() => new Set([...invoices, ...(invoice_payments || [])].map(x => x.bank_transaction_id).filter(Boolean)), [invoices, invoice_payments])
  const catName = t => categoriesById.get(t.categoria_id)?.nome || 'Por classificar'
  const dupScore = useCallback(t => (linkedIds.has(t.id) ? 8 : 0) + (UNCLASSIFIED.includes(catName(t)) ? 0 : 4) + (t.imovel_id ? 2 : 0) + (t.origem === 'legado' ? 1 : 0), [linkedIds, categoriesById]) // eslint-disable-line react-hooks/exhaustive-deps

  async function setCategory(r, categoria_id) {
    const { data, error } = await supabase.from('bank_transactions').update({ categoria_id }).eq('id', r.id).select().single()
    if (error) return toast(`Não foi possível guardar: ${error.message}`, 'bad')
    upsertLocal('bank_transactions', data)
    toast(`Categoria alterada para ${categoriesById.get(categoria_id)?.nome || 'Por classificar'}.`)
  }

  const exportCsv = () => downloadText(toCsv(
    ['Data', 'Data valor', 'Descrição', 'Categoria', 'Imóvel', 'Pagamento', 'Valor', 'Saldo', 'Conta como despesa'],
    rows.map(r => [r.data, r.source.data_valor, r.descricao, r.categoria, r.imovel, 'CGD', decimalPt(r.valor), decimalPt(r.saldo), r.contaComoDespesa ? 'Sim' : 'Não']),
  ), 'movimentos_cgd.csv')

  return (
    <>
      <FilterBar showPayment={false} onExport={exportCsv} extra={<button className="primary" onClick={() => setImporting(true)}>Importar extrato CGD</button>} />
      <div className="grid4">
        <Kpi color="blue" icon="▤" label="Movimentos" value={rows.length} note={<>Saídas da conta CGD · <Link to="/entradas">ver entradas</Link></>} />
        <Kpi color="purple" icon="€" label="Despesas CGD" value={euro(sumBy(expense, r => r.valor))} note="Contam para a contabilidade" />
        <Kpi color="orange" icon="⇄" label="Fora das despesas" value={euro(sumBy(rows.filter(r => !r.contaComoDespesa), r => r.valor))} note="Ex.: transferências entre empresas" />
        <Kpi color="green" icon="?" label="Por classificar" value={rows.filter(r => ['Por classificar', 'Outros / por classificar'].includes(r.categoria)).length} note="Altera a categoria diretamente na tabela" />
      </div>
      <DuplicatesPanel table="bank_transactions" title="Saídas repetidas" rows={bank_transactions} score={dupScore} detail={catName}
        locked={t => (linkedIds.has(t.id) ? 'Tem uma fatura ligada: confirma à mão' : null)} />
      <Panel title="Saídas da conta CGD" hint="Todos os movimentos do extrato bancário são tratados como pagamentos pela CGD. Aqui não entram as despesas em numerário.">
        <div className="filters flat">
          <input className="search" type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Pesquisar descrição, categoria, valor (ex.: 12,30) ou data (ex.: 03/07)…" aria-label="Pesquisar saídas" />
          {q.trim() && <span className="muted small">{shown.length} de {rows.length} movimentos</span>}
        </div>
        <div className="tablewrap tall">
          <table>
            <thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th>Imóvel</th><th>Pagamento</th><th className="money">Valor</th><th className="money">Saldo</th></tr></thead>
            <tbody>
              {shown.length ? shown.map(r => (
                <tr key={r.id} className={r.contaComoDespesa ? '' : 'row-muted'}>
                  <td>{formatDate(r.data)}</td>
                  <td>{r.descricao}{r.source.notas && <div className="muted small">{r.source.notas}</div>}</td>
                  <td><CategorySelect value={r.source.categoria_id} onChange={v => setCategory(r, v)} aria-label={`Categoria de ${r.descricao}`} />{!r.contaComoDespesa && <div className="muted small">não conta como despesa</div>}</td>
                  <td>{r.imovel}</td>
                  <td><PaymentBadge value={PAYMENT_CGD} /></td>
                  <td className="money">{euro(r.valor)}</td>
                  <td className="money">{r.saldo == null ? '—' : euro(r.saldo)}</td>
                </tr>
              )) : <Empty colSpan={7}>{q.trim() ? "Nenhuma saída encontrada para esta pesquisa." : "Sem movimentos para os filtros selecionados."}</Empty>}
            </tbody>
          </table>
        </div>
      </Panel>
      {bank_imports.length > 0 && (
        <Panel title="Importações do extrato">
          <table className="mini-table"><thead><tr><th>Data</th><th>Ficheiro</th><th className="money">Novos</th><th className="money">Já existiam</th></tr></thead>
            <tbody>{bank_imports.map(i => <tr key={i.id}><td>{formatDateTime(i.importado_em)}</td><td>{i.nome_ficheiro}</td><td className="money">{i.novos}</td><td className="money">{i.duplicados}</td></tr>)}</tbody>
          </table>
        </Panel>
      )}
      {importing && <BankImportModal onClose={() => setImporting(false)} existing={bank_transactions} categoriesById={categoriesById} propertiesById={propertiesById} onDone={() => { reload('bank_transactions'); reload('bank_imports') }} />}
    </>
  )
}

function BankImportModal({ onClose, existing, categoriesById, propertiesById, onDone }) {
  const toast = useToast()
  const { bank_credits, transferencias, creditsReady, reload, categories, upsertLocal } = useData()
  const [file, setFile] = useState(null)
  const [parsed, setParsed] = useState(null)
  const [busy, setBusy] = useState(false)
  // Um movimento já existe se tiver a mesma chave ou, havendo saldo, o mesmo valor e saldo
  // (o PDF e o Excel do banco escrevem a descrição e a data de movimento de forma diferente).
  const sameMove = r => `${Number(r.valor).toFixed(2)}|${Number(r.saldo).toFixed(2)}`
  const hashes = useMemo(() => new Set([...existing.map(t => t.import_hash), ...existing.filter(t => t.saldo != null).map(sameMove)]), [existing])
  const creditHashes = useMemo(() => new Set([...bank_credits.map(c => c.import_hash), ...bank_credits.filter(c => c.saldo != null).map(sameMove)]), [bank_credits])
  const known = (set, r) => set.has(r.import_hash) || (r.saldo != null && set.has(sameMove(r)))

  async function read(f) {
    setFile(f)
    setParsed(null)
    let matrix
    let saldos = null
    const name = f.name.toLowerCase()
    try {
      if (name.endsWith('.csv')) matrix = parseCsvText(await f.text())
      else if (name.endsWith('.pdf') || f.type === 'application/pdf') {
        const { pdfTextItems } = await import('../lib/pdfLoader')
        matrix = statementMatrix(await pdfTextItems(await f.arrayBuffer()))
        saldos = checkBalances(matrix, parseMoney)
      } else matrix = (await XLSXLoader.readWorkbook(f))[0]?.matrix || []
    } catch (e) {
      return setParsed({ records: [], credits: [], ignored: 0, error: `Não foi possível ler o ficheiro: ${e.message}` })
    }
    const res = parseBankStatement(matrix)
    if (saldos && !res.error && !res.records.length && !res.credits.length) res.error = 'Não encontrei movimentos neste PDF. Se for um PDF digitalizado (imagem), exporta o extrato em Excel no Caixadirecta.'
    res.saldos = saldos
    const records = res.records.map(r => ({ ...r, ...suggestClassification(r, existing, categories), duplicado: known(hashes, r) }))
    // Entradas: liga às transferências já registadas à mão; as de hóspedes vão por omissão para a receção.
    const taken = new Set()
    const credits = res.credits.map(c => {
      const duplicado = known(creditHashes, c)
      const match = duplicado ? null : matchTransfer(c, transferencias, taken)
      if (match) taken.add(match.id)
      return { ...c, duplicado, transferencia: match, rececao: !match && goesToReception(c.tipo) }
    })
    setParsed({ ...res, records, credits })
  }

  const setCredit = (hash, patch) => setParsed(p => ({ ...p, credits: p.credits.map(c => (c.import_hash === hash ? { ...c, ...patch } : c)) }))

  async function save() {
    setBusy(true)
    const msgs = []
    if (novos.length) {
      let idOf
      try { idOf = await ensureCategories(novos.map(r => r.categoria_nova), categories, upsertLocal) } catch (e) { setBusy(false); return toast(e.message, 'bad') }
      const rows = novos.map(({ duplicado, categoria_nova, ...r }) => ({ ...r, categoria_id: categoria_nova ? idOf(categoria_nova) : r.categoria_id })) // eslint-disable-line no-unused-vars
      const { data, error } = await supabase.rpc('import_bank_transactions', { p_rows: rows, p_file: file.name })
      if (error) { setBusy(false); return toast(`Não foi possível importar: ${error.message}`, 'bad') }
      msgs.push(`${data.novos} saídas novas`)
    }
    if (creditsReady && novasEntradas.length) {
      const rows = novasEntradas.map(c => ({
        import_hash: c.import_hash, data_mov: c.data_mov, data_valor: c.data_valor, descricao: c.descricao, valor: c.valor, saldo: c.saldo,
        tipo: c.tipo, rececao: c.rececao, ordenante: guessPayer(c.descricao), transferencia_id: c.transferencia?.id || null,
      }))
      const { data, error } = await supabase.rpc('import_bank_credits', { p_rows: rows, p_file: file.name })
      if (error) { setBusy(false); return toast(`As saídas foram importadas, mas as entradas não: ${error.message}`, 'bad') }
      msgs.push(`${data.novos} entradas novas${data.transferencias ? ` (${data.transferencias} enviadas para a receção)` : ''}${data.ligadas ? `, ${data.ligadas} ligadas a transferências já registadas` : ''}`)
      reload('bank_credits')
      reload('transferencias')
    }
    setBusy(false)
    toast(`Importado: ${msgs.join(' e ')}.`)
    onDone()
    onClose()
  }

  const novos = parsed?.records.filter(r => !r.duplicado) || []
  const novasEntradas = parsed?.credits.filter(c => !c.duplicado) || []
  const total = novos.length + (creditsReady ? novasEntradas.length : 0)
  return (
    <Modal title="Importar extrato CGD" onClose={onClose} wide>
      <p className="muted">Escolhe o extrato da CGD em PDF, Excel ou CSV. As saídas (débitos) entram como despesas; as entradas (créditos: Expedia, Stripe, transferências de hóspedes…) entram como recebimentos, à parte. Movimentos que já existem são ignorados. A categoria e o imóvel das saídas são sugeridos a partir de movimentos anteriores com a mesma descrição.</p>
      <label className="file-button"><input type="file" accept=".pdf,.xlsx,.xls,.csv" onChange={e => e.target.files[0] && read(e.target.files[0])} />{file ? file.name : 'Escolher ficheiro do extrato'}</label>
      {parsed?.error && <div className="notice bad">{parsed.error}</div>}
      {parsed && !parsed.error && (
        <>
          <div className="notice">{parsed.records.length} saídas ({novos.length} novas) · {parsed.credits.length} entradas ({novasEntradas.length} novas){parsed.ignored ? ` · ${parsed.ignored} linhas sem valor ignoradas` : ''}</div>
          {parsed.saldos && (parsed.saldos.erradas
            ? <div className="notice bad">Atenção: em {parsed.saldos.erradas} linha(s) o saldo não bate certo com o movimento. Confirma os valores abaixo antes de importar ou usa o Excel do Caixadirecta.</div>
            : parsed.saldos.verificadas > 0 && <div className="notice ok">✓ Leitura do PDF confirmada pelos saldos ({parsed.saldos.verificadas} movimentos conferidos).</div>)}
          <div className="subhead">Saídas</div>
          <div className="tablewrap"><table className="mini-table"><thead><tr><th>Data</th><th>Descrição</th><th>Categoria sugerida</th><th>Imóvel</th><th className="money">Valor</th><th>Estado</th></tr></thead>
            <tbody>{parsed.records.length ? parsed.records.map(r => (
              <tr key={r.import_hash} className={r.duplicado ? 'row-muted' : ''}>
                <td>{formatDate(r.data_mov)}</td><td>{r.descricao}</td>
                <td>{r.categoria_nova ? `${r.categoria_nova} (nova)` : categoriesById.get(r.categoria_id)?.nome || 'Por classificar'}</td>
                <td>{propertiesById.get(r.imovel_id) || '—'}</td>
                <td className="money">{euro(r.valor)}</td><td>{r.duplicado ? 'Já existe' : 'Novo'}</td>
              </tr>
            )) : <Empty colSpan={6}>Sem saídas neste ficheiro.</Empty>}</tbody>
          </table></div>
          <div className="subhead">Entradas</div>
          {!creditsReady && parsed.credits.length > 0 && <div className="notice warn">As entradas só são importadas depois de executar <strong>supabase/06_entradas_transferencias.sql</strong> no Supabase. Podes importar já as saídas e voltar a importar o mesmo extrato depois: nada fica duplicado.</div>}
          <div className="tablewrap"><table className="mini-table"><thead><tr><th>Data</th><th>Descrição</th><th>Origem</th><th>Receção</th><th className="money">Valor</th><th>Estado</th></tr></thead>
            <tbody>{parsed.credits.length ? parsed.credits.map(c => (
              <tr key={c.import_hash} className={c.duplicado ? 'row-muted' : ''}>
                <td>{formatDate(c.data_mov)}</td><td>{c.descricao}</td>
                <td>{c.duplicado ? c.tipo : <select className="inline-select" value={c.tipo} onChange={e => setCredit(c.import_hash, { tipo: e.target.value })} aria-label="Origem">{CREDIT_TYPES.map(x => <option key={x}>{x}</option>)}</select>}</td>
                <td>{c.duplicado ? '—' : c.transferencia
                  ? <span className="small">Liga a “{c.transferencia.ordenante || 'transferência'}” de {formatDate(c.transferencia.data)}</span>
                  : <label className="check-inline"><input type="checkbox" checked={c.rececao} onChange={e => setCredit(c.import_hash, { rececao: e.target.checked })} /> Enviar</label>}</td>
                <td className="money">{euro(c.valor)}</td><td>{c.duplicado ? 'Já existe' : 'Nova'}</td>
              </tr>
            )) : <Empty colSpan={6}>Sem entradas neste ficheiro.</Empty>}</tbody>
          </table></div>
          <div className="actions end"><button className="secondary" onClick={onClose}>Cancelar</button><button className="primary" disabled={busy || !total} onClick={save}>{busy ? 'A importar…' : `Importar ${total} movimentos`}</button></div>
        </>
      )}
    </Modal>
  )
}
