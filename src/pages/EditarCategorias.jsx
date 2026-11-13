import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useData } from '../data/DataProvider'
import { supabase } from '../supabase'
import CategorySelect from '../components/CategorySelect'
import { Badge, ConfirmButton, Empty, Panel, Select, useToast } from '../components/ui'
import { UNCLASSIFIED } from '../lib/finance'
import { SUPPLIER_RULES } from '../lib/bankImport'
import { ensureCategories } from '../data/categories'
import { formatDate } from '../lib/dates'
import { euro } from '../lib/money'
import { downloadText } from '../lib/csv'
import { isUnclassified, ruleFor, ruleKey } from '../lib/autoInvoices'

const PAGAMENTOS = [{ value: 'Por pagar', label: 'Por pagar (liquido depois)' }, { value: 'CGD', label: 'CGD (cartão / débito direto)' }, { value: 'Numerário', label: 'Numerário' }, { value: 'Airbnb', label: 'Airbnb (pago pela Airbnb)' }]

export default function EditarCategorias() {
  const { bank_transactions, invoices, regras_fornecedor, regrasFornecedorReady, categories, categoriesById, properties, propertiesById, upsertLocal, removeLocal, reload } = useData()
  const toast = useToast()
  const [params] = useSearchParams()
  const [cat, setCat] = useState(params.get('filtro') === 'por-classificar' ? '__por_classificar__' : '')
  const [q, setQ] = useState('')
  const [newCat, setNewCat] = useState('')
  const [ruleSup, setRuleSup] = useState('')
  const [ruleCat, setRuleCat] = useState(null)
  const [rulePag, setRulePag] = useState('')

  const rows = useMemo(() => bank_transactions
    .map(t => ({ ...t, categoria: categoriesById.get(t.categoria_id)?.nome || 'Por classificar' }))
    .filter(t => !cat || (cat === '__por_classificar__' ? UNCLASSIFIED.includes(t.categoria) : t.categoria === cat))
    .filter(t => !q.trim() || `${t.descricao} ${t.data_mov} ${t.categoria}`.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => String(a.data_mov).localeCompare(String(b.data_mov)) || a.id - b.id), [bank_transactions, categoriesById, cat, q])
  const changed = bank_transactions.filter(t => t.categoria_original && categoriesById.get(t.categoria_id)?.nome !== t.categoria_original)

  async function update(t, patch) {
    const { data, error } = await supabase.from('bank_transactions').update(patch).eq('id', t.id).select().single()
    if (error) return toast(`Não foi possível guardar: ${error.message}`, 'bad')
    upsertLocal('bank_transactions', data)
  }

  async function addCategory() {
    const nome = newCat.trim()
    if (!nome) return
    const { data, error } = await supabase.from('categories').insert({ nome }).select().single()
    if (error) return toast(error.code === '23505' ? 'Essa categoria já existe.' : error.message, 'bad')
    upsertLocal('categories', data)
    setNewCat('')
    toast(`Categoria “${nome}” criada.`)
  }

  async function toggleExpense(c) {
    const { data, error } = await supabase.from('categories').update({ conta_como_despesa: !c.conta_como_despesa }).eq('id', c.id).select().single()
    if (error) return toast(error.message, 'bad')
    upsertLocal('categories', data)
  }

  // Regras de fornecedores: quantos movimentos apanham e quantos estão por classificar.
  const ruleStats = useMemo(() => SUPPLIER_RULES.map(([re, nome, nota]) => {
    const hits = bank_transactions.filter(t => re.test(String(t.descricao || '').toUpperCase()))
    const cat = t => categoriesById.get(t.categoria_id)?.nome || 'Por classificar'
    return { nome, nota, hits, porClassificar: hits.filter(t => UNCLASSIFIED.includes(cat(t))), outra: hits.filter(t => !UNCLASSIFIED.includes(cat(t)) && cat(t) !== nome) }
  }), [bank_transactions, categoriesById])
  const toApply = ruleStats.flatMap(r => r.porClassificar.map(t => ({ t, nome: r.nome })))

  async function applyRules() {
    let idOf
    try { idOf = await ensureCategories(toApply.map(x => x.nome), categories, upsertLocal) } catch (e) { return toast(e.message, 'bad') }
    let n = 0
    for (const { t, nome } of toApply) {
      const { data, error } = await supabase.from('bank_transactions').update({ categoria_id: idOf(nome) }).eq('id', t.id).select().single()
      if (error) return toast(`Parou ao fim de ${n}: ${error.message}`, 'bad')
      upsertLocal('bank_transactions', data)
      n++
    }
    toast(`${n} movimentos classificados.`)
  }

  // Regras por fornecedor: faturas de cada regra e as que não batem certo com ela.
  const rulesTable = regrasFornecedorReady
  const supplierRules = useMemo(() => regras_fornecedor.map(r => {
    const hits = invoices.filter(i => i.estado !== 'Rejeitada' && ruleFor(i.fornecedor, regras_fornecedor)?.id === r.id)
    const outraCat = r.categoria_id ? hits.filter(i => i.categoria_id !== r.categoria_id) : []
    // Pagamento: só as que ainda não estão ligadas a um pagamento nem ao extrato (as liquidadas ficam).
    const outroPag = r.pagamento ? hits.filter(i => i.pagamento !== r.pagamento && !i.payment_id && !i.bank_transaction_id && !i.liquidada_em && i.origem !== 'legado') : []
    return { ...r, hits, outraCat, outroPag }
  }), [regras_fornecedor, invoices])
  const supplierNames = useMemo(() => [...new Set(invoices.map(i => i.fornecedor).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt')), [invoices])
  const rulePreview = ruleKey(ruleSup).length >= 3 ? invoices.filter(i => i.estado !== 'Rejeitada' && ruleFor(i.fornecedor, [{ id: 0, fornecedor: ruleSup }])) : []

  async function addRule() {
    const fornecedor = ruleSup.trim()
    if (ruleKey(fornecedor).length < 3) return toast('Escreve o nome do fornecedor.', 'bad')
    const categoria_id = ruleCat && !isUnclassified(ruleCat, categoriesById) ? ruleCat : null
    if (!categoria_id && !rulePag) return toast('Escolhe a categoria e/ou o pagamento.', 'bad')
    const { data, error } = await supabase.from('regras_fornecedor').insert({ fornecedor, categoria_id, pagamento: rulePag || null }).select().single()
    if (error) return toast(error.code === '23505' ? 'Já existe uma regra para este fornecedor.' : error.message, 'bad')
    upsertLocal('regras_fornecedor', data)
    setRuleSup('')
    setRuleCat(null)
    setRulePag('')
    toast(`Regra para ${fornecedor} criada: as faturas novas ficam logo assim.`)
  }

  async function changeRule(r, patch) {
    if ('categoria_id' in patch && isUnclassified(patch.categoria_id, categoriesById)) patch = { categoria_id: null }
    const { data, error } = await supabase.from('regras_fornecedor').update(patch).eq('id', r.id).select().single()
    if (error) return toast(error.message, 'bad')
    upsertLocal('regras_fornecedor', data)
  }

  async function deleteRule(r) {
    const { error } = await supabase.from('regras_fornecedor').delete().eq('id', r.id)
    if (error) return toast(error.message, 'bad')
    removeLocal('regras_fornecedor', [r.id])
  }

  async function applyRule(r, list, patch, what) {
    let n = 0
    for (const i of list) {
      const { data, error } = await supabase.from('invoices').update(patch).eq('id', i.id).select('*, invoice_files(id, nome_ficheiro, mime, storage_path, tamanho, created_at)')
      if (error) return toast(`Parou ao fim de ${n}: ${error.message}`, 'bad')
      if (data?.length) upsertLocal('invoices', data)
      n++
    }
    toast(`${n} fatura${n === 1 ? '' : 's'} de ${r.fornecedor} ${n === 1 ? 'passou' : 'passaram'} para ${what}.`)
  }

  function exportChanges() {
    const out = changed.map(t => ({ id: t.id, legacy_idx: t.legacy_idx, data: t.data_mov, descricao: t.descricao, categoria_original: t.categoria_original, categoria_atual: categoriesById.get(t.categoria_id)?.nome }))
    downloadText(JSON.stringify({ exportedAt: new Date().toISOString(), alteracoes: out }, null, 2), 'alteracoes_categorias.json', 'application/json')
  }

  async function resetAll() {
    const byName = new Map(categories.map(c => [c.nome, c.id]))
    let n = 0
    for (const t of changed) {
      const id = byName.get(t.categoria_original)
      if (!id) continue
      const { error } = await supabase.from('bank_transactions').update({ categoria_id: id }).eq('id', t.id)
      if (!error) n++
    }
    reload('bank_transactions')
    toast(`${n} movimentos repostos na categoria original.`)
  }

  return (
    <>
      <Panel title="Editar categorias" hint="Altera a categoria ou o imóvel de qualquer saída CGD. As alterações ficam guardadas no Supabase, sincronizadas entre dispositivos, e registadas no histórico.">
        <div className="filters flat">
          <Select value={cat} onChange={setCat} options={[{ value: '__por_classificar__', label: 'Por classificar' }, ...categories.map(c => ({ value: c.nome, label: c.nome }))]} placeholder="Todas as categorias" />
          <input className="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Pesquisar movimento…" />
          <input value={newCat} onChange={e => setNewCat(e.target.value)} placeholder="Nome da nova categoria…" onKeyDown={e => e.key === 'Enter' && addCategory()} />
          <button className="primary" onClick={addCategory}>Adicionar categoria</button>
          <button className="secondary" onClick={exportChanges} disabled={!changed.length}>Exportar alterações</button>
          <ConfirmButton disabled={!changed.length} confirmText={`Repor ${changed.length} movimentos`} onConfirm={resetAll}>Repor alterações</ConfirmButton>
        </div>
        <div className="tablewrap tall">
          <table>
            <thead><tr><th>Data</th><th>Movimento</th><th className="money">Valor</th><th>Categoria atual</th><th>Nova categoria</th><th>Imóvel</th></tr></thead>
            <tbody>
              {rows.length ? rows.map(t => (
                <tr key={t.id}>
                  <td>{formatDate(t.data_mov)}</td>
                  <td>{t.descricao}{t.categoria_original && t.categoria !== t.categoria_original && <div className="muted small">Original: {t.categoria_original}</div>}</td>
                  <td className="money">{euro(t.valor)}</td>
                  <td><Badge>{t.categoria}</Badge></td>
                  <td><CategorySelect value={t.categoria_id} onChange={v => update(t, { categoria_id: v })} /></td>
                  <td><Select className="editselect" value={t.imovel_id ?? ''} onChange={v => update(t, { imovel_id: v ? Number(v) : null })} options={properties.map(p => ({ value: p.id, label: p.nome }))} placeholder="Sem imóvel" title={propertiesById.get(t.imovel_id)} /></td>
                </tr>
              )) : <Empty colSpan={6}>Não existem movimentos para este filtro.</Empty>}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel title="Regras por fornecedor" hint="Faturas novas destes fornecedores ficam logo com esta categoria e este pagamento, mesmo que a receção não escolha. O nome serve escrito de outra forma (ex.: “Grão de Trigo” apanha “Graotrigo Lda”).">
        {!rulesTable ? <p className="muted">Para usar isto, executa primeiro <code>supabase/14_regras_fornecedor.sql</code> no SQL Editor do Supabase.</p> : (
          <>
            <div className="tablewrap">
              <table className="mini-table">
                <thead><tr><th>Fornecedor</th><th>Categoria</th><th>Pagamento</th><th className="money">Faturas</th><th>Antigas que não batem certo</th><th></th></tr></thead>
                <tbody>
                  {supplierRules.length ? supplierRules.map(r => (
                    <tr key={r.id}>
                      <td>{r.fornecedor}{r.nota && <div className="muted small">{r.nota}</div>}</td>
                      <td><CategorySelect value={r.categoria_id} onChange={v => changeRule(r, { categoria_id: v })} /></td>
                      <td><Select className="editselect" value={r.pagamento || ''} onChange={v => changeRule(r, { pagamento: v || null })} options={PAGAMENTOS} placeholder="O que escolherem" /></td>
                      <td className="money">{r.hits.length}</td>
                      <td>
                        {r.outraCat.length > 0 && <ConfirmButton className="secondary small" confirmText={`Mudar ${r.outraCat.length}`} onConfirm={() => applyRule(r, r.outraCat, { categoria_id: r.categoria_id }, `“${categoriesById.get(r.categoria_id)?.nome}”`)}>{r.outraCat.length} noutra categoria</ConfirmButton>}
                        {' '}{r.outroPag.length > 0 && <ConfirmButton className="secondary small" confirmText={`Passar ${r.outroPag.length} a ${r.pagamento}`} onConfirm={() => applyRule(r, r.outroPag, { pagamento: r.pagamento }, r.pagamento.toLowerCase())}>{r.outroPag.length} não estão “{r.pagamento}”</ConfirmButton>}
                        {!r.outraCat.length && !r.outroPag.length && <span className="muted">—</span>}
                      </td>
                      <td><ConfirmButton className="secondary small" confirmText="Apagar regra" onConfirm={() => deleteRule(r)}>Apagar</ConfirmButton></td>
                    </tr>
                  )) : <Empty colSpan={6}>Ainda não há regras por fornecedor.</Empty>}
                </tbody>
              </table>
            </div>
            <div className="filters flat">
              <input list="fornecedores-faturas" value={ruleSup} onChange={e => setRuleSup(e.target.value)} placeholder="Fornecedor (ex.: Grão de Trigo)…" />
              <datalist id="fornecedores-faturas">{supplierNames.map(n => <option key={n} value={n} />)}</datalist>
              <CategorySelect value={ruleCat} onChange={setRuleCat} />
              <Select value={rulePag} onChange={setRulePag} options={PAGAMENTOS} placeholder="Pagamento: o que escolherem" />
              <button className="primary" onClick={addRule}>Criar regra</button>
              {ruleSup.trim() && <span className="muted small">{rulePreview.length} fatura{rulePreview.length === 1 ? '' : 's'} já registada{rulePreview.length === 1 ? '' : 's'} com este nome</span>}
            </div>
          </>
        )}
      </Panel>
      <Panel title="Fornecedores conhecidos" hint="Movimentos novos destes fornecedores entram já com esta categoria. Aqui podes aplicar a regra aos que ainda estão por classificar; os que já têm outra categoria não são alterados."
        actions={toApply.length > 0 && <ConfirmButton className="primary" confirmText={`Classificar ${toApply.length}`} onConfirm={applyRules}>Aplicar aos {toApply.length} por classificar</ConfirmButton>}>
        <table className="mini-table">
          <thead><tr><th>Fornecedor</th><th>Categoria</th><th className="money">Movimentos</th><th className="money">Por classificar</th><th className="money">Com outra categoria</th></tr></thead>
          <tbody>{ruleStats.map(r => (
            <tr key={r.nota}><td>{r.nota}</td><td>{r.nome}</td><td className="money">{r.hits.length}</td><td className="money">{r.porClassificar.length}</td>
              <td className="money" title={r.outra.map(t => `${t.descricao}: ${categoriesById.get(t.categoria_id)?.nome}`).join('\n')}>{r.outra.length}</td></tr>
          ))}</tbody>
        </table>
      </Panel>
      <Panel title="Categorias" hint="Desmarca “conta como despesa” para movimentos que não são gastos da empresa (ex.: transferências entre empresas do grupo).">
        <div className="chips">
          {categories.map(c => (
            <label key={c.id} className={`chip ${c.conta_como_despesa ? '' : 'off'}`}>
              <input type="checkbox" checked={c.conta_como_despesa} onChange={() => toggleExpense(c)} /> {c.nome}
            </label>
          ))}
        </div>
      </Panel>
    </>
  )
}
