import { useMemo, useState } from 'react'
import * as XLSXLoader from '../lib/xlsxLoader'
import { useData } from '../data/DataProvider'
import { useFilters } from '../data/FiltersProvider'
import FilterBar from '../components/FilterBar'
import { Badge, Empty, Kpi, Modal, Panel, PaymentBadge, useToast } from '../components/ui'
import { applyFilters, PAYMENT_CGD } from '../lib/finance'
import { euro, sumBy } from '../lib/money'
import { formatDate, formatDateTime } from '../lib/dates'
import { decimalPt, downloadText, toCsv } from '../lib/csv'
import { parseBankStatement, suggestClassification } from '../lib/bankImport'
import { parseCsvText } from '../lib/cashImport'
import { supabase } from '../supabase'

export default function Movimentos() {
  const { bankRows, bank_transactions, bank_imports, categoriesById, propertiesById, reload } = useData()
  const { filters } = useFilters()
  const [importing, setImporting] = useState(false)
  const rows = useMemo(() => applyFilters(bankRows, { ...filters, payment: '' }).sort((a, b) => String(a.data).localeCompare(String(b.data)) || a.id - b.id), [bankRows, filters])
  const expense = rows.filter(r => r.contaComoDespesa)

  const exportCsv = () => downloadText(toCsv(
    ['Data', 'Data valor', 'Descrição', 'Categoria', 'Imóvel', 'Pagamento', 'Valor', 'Saldo', 'Conta como despesa'],
    rows.map(r => [r.data, r.source.data_valor, r.descricao, r.categoria, r.imovel, 'CGD', decimalPt(r.valor), decimalPt(r.saldo), r.contaComoDespesa ? 'Sim' : 'Não']),
  ), 'movimentos_cgd.csv')

  return (
    <>
      <FilterBar showPayment={false} onExport={exportCsv} extra={<button className="primary" onClick={() => setImporting(true)}>Importar extrato CGD</button>} />
      <div className="grid4">
        <Kpi color="blue" icon="▤" label="Movimentos" value={rows.length} note="Saídas da conta CGD" />
        <Kpi color="purple" icon="€" label="Despesas CGD" value={euro(sumBy(expense, r => r.valor))} note="Contam para a contabilidade" />
        <Kpi color="orange" icon="⇄" label="Fora das despesas" value={euro(sumBy(rows.filter(r => !r.contaComoDespesa), r => r.valor))} note="Ex.: transferências entre empresas" />
        <Kpi color="green" icon="?" label="Por classificar" value={rows.filter(r => ['Por classificar', 'Outros / por classificar'].includes(r.categoria)).length} note="Classifica em Editar categorias" />
      </div>
      <Panel title="Saídas da conta CGD" hint="Todos os movimentos do extrato bancário são tratados como pagamentos pela CGD. Aqui não entram as despesas em numerário.">
        <div className="tablewrap tall">
          <table>
            <thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th>Imóvel</th><th>Pagamento</th><th className="money">Valor</th><th className="money">Saldo</th></tr></thead>
            <tbody>
              {rows.length ? rows.map(r => (
                <tr key={r.id} className={r.contaComoDespesa ? '' : 'row-muted'}>
                  <td>{formatDate(r.data)}</td>
                  <td>{r.descricao}{r.source.notas && <div className="muted small">{r.source.notas}</div>}</td>
                  <td><Badge>{r.categoria}</Badge>{!r.contaComoDespesa && <div className="muted small">não conta como despesa</div>}</td>
                  <td>{r.imovel}</td>
                  <td><PaymentBadge value={PAYMENT_CGD} /></td>
                  <td className="money">{euro(r.valor)}</td>
                  <td className="money">{r.saldo == null ? '—' : euro(r.saldo)}</td>
                </tr>
              )) : <Empty colSpan={7}>Sem movimentos para os filtros selecionados.</Empty>}
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
  const [file, setFile] = useState(null)
  const [parsed, setParsed] = useState(null)
  const [busy, setBusy] = useState(false)
  const hashes = useMemo(() => new Set(existing.map(t => t.import_hash)), [existing])

  async function read(f) {
    setFile(f)
    setParsed(null)
    let matrix
    if (f.name.toLowerCase().endsWith('.csv')) matrix = parseCsvText(await f.text())
    else matrix = (await XLSXLoader.readWorkbook(f))[0]?.matrix || []
    const res = parseBankStatement(matrix)
    const records = res.records.map(r => ({ ...r, ...suggestClassification(r, existing), duplicado: hashes.has(r.import_hash) }))
    setParsed({ ...res, records })
  }

  async function save() {
    setBusy(true)
    const rows = parsed.records.filter(r => !r.duplicado).map(({ duplicado, ...r }) => r) // eslint-disable-line no-unused-vars
    const { data, error } = await supabase.rpc('import_bank_transactions', { p_rows: rows, p_file: file.name })
    setBusy(false)
    if (error) return toast(`Não foi possível importar: ${error.message}`, 'bad')
    toast(`Importados ${data.novos} movimentos novos (${data.duplicados} já existiam).`)
    onDone()
    onClose()
  }

  const novos = parsed?.records.filter(r => !r.duplicado) || []
  return (
    <Modal title="Importar extrato CGD" onClose={onClose} wide>
      <p className="muted">Exporta o extrato no Caixadirecta em Excel ou CSV. Só as saídas (débitos) são importadas; movimentos que já existem são ignorados. A categoria e o imóvel são sugeridos a partir de movimentos anteriores com a mesma descrição.</p>
      <label className="file-button"><input type="file" accept=".xlsx,.xls,.csv" onChange={e => e.target.files[0] && read(e.target.files[0])} />{file ? file.name : 'Escolher ficheiro do extrato'}</label>
      {parsed?.error && <div className="notice bad">{parsed.error}</div>}
      {parsed && !parsed.error && (
        <>
          <div className="notice">{parsed.records.length} saídas encontradas · <strong>{novos.length} novas</strong> · {parsed.records.length - novos.length} já existiam · {parsed.ignored} entradas/linhas ignoradas</div>
          <div className="tablewrap"><table className="mini-table"><thead><tr><th>Data</th><th>Descrição</th><th>Categoria sugerida</th><th>Imóvel</th><th className="money">Valor</th><th>Estado</th></tr></thead>
            <tbody>{parsed.records.map(r => (
              <tr key={r.import_hash} className={r.duplicado ? 'row-muted' : ''}>
                <td>{formatDate(r.data_mov)}</td><td>{r.descricao}</td>
                <td>{categoriesById.get(r.categoria_id)?.nome || 'Por classificar'}</td>
                <td>{propertiesById.get(r.imovel_id) || '—'}</td>
                <td className="money">{euro(r.valor)}</td><td>{r.duplicado ? 'Já existe' : 'Novo'}</td>
              </tr>
            ))}</tbody>
          </table></div>
          <div className="actions end"><button className="secondary" onClick={onClose}>Cancelar</button><button className="primary" disabled={busy || !novos.length} onClick={save}>{busy ? 'A importar…' : `Importar ${novos.length} movimentos`}</button></div>
        </>
      )}
    </Modal>
  )
}
