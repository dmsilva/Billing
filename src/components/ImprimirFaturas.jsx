import { useMemo, useState } from 'react'
import { supabase } from '../supabase'
import { useData } from '../data/DataProvider'
import { Modal, useToast } from './ui'
import { normalizePages, printRuleFor, validPages } from '../lib/paginas'

const SHEET_KEY = 'faturas-imprimir-folha-nova'
const readSheet = () => { try { return localStorage.getItem(SHEET_KEY) !== '0' } catch { return true } }
const saveSheet = v => { try { localStorage.setItem(SHEET_KEY, v ? '1' : '0') } catch { /* sem armazenamento */ } }

// Junta várias faturas num só PDF para imprimir de uma vez, só com as páginas que interessam
// de cada fornecedor (ex.: CUR 1-2, Vodafone 1). As páginas vêm das regras por fornecedor e
// podem ser mudadas aqui; "Guardar" fica para a próxima vez.
//
// items: [{ id, names: [nome, remetente, assunto…] }]   (o primeiro nome é o que se mostra)
// build({ pagesById, newSheet }) -> Promise<{ pdf, pages, count, failed, withoutFiles }>
export default function ImprimirFaturas({ items, build, onClose }) {
  const { regras_fornecedor = [], upsertLocal } = useData()
  const toast = useToast()
  const ready = regras_fornecedor.some(r => 'paginas_imprimir' in r)
  const groups = useMemo(() => {
    const m = new Map()
    for (const it of items) {
      const rule = printRuleFor(it.names, regras_fornecedor)
      const key = rule ? `r${rule.id}` : `n${it.names[0] || 'Sem fornecedor'}`
      const g = m.get(key) || { key, name: rule?.fornecedor || it.names[0] || 'Sem fornecedor', rule, ids: [] }
      g.ids.push(it.id)
      m.set(key, g)
    }
    return [...m.values()].sort((a, b) => b.ids.length - a.ids.length || a.name.localeCompare(b.name))
  }, [items, regras_fornecedor])
  const [pages, setPages] = useState(() => Object.fromEntries(groups.map(g => [g.key, g.rule?.paginas_imprimir || ''])))
  const [save, setSave] = useState(() => new Set())
  const [newSheet, setNewSheet] = useState(readSheet)
  const [busy, setBusy] = useState(null)

  const bad = groups.filter(g => !validPages(pages[g.key]))

  async function saveRules() {
    for (const g of groups.filter(x => save.has(x.key))) {
      const paginas_imprimir = normalizePages(pages[g.key])
      const q = g.rule
        ? supabase.from('regras_fornecedor').update({ paginas_imprimir }).eq('id', g.rule.id)
        : supabase.from('regras_fornecedor').insert({ fornecedor: g.name, paginas_imprimir, nota: 'Páginas a imprimir' })
      const { data, error } = await q.select().single()
      if (error) toast(`Não foi possível guardar as páginas de ${g.name}: ${error.message}`, 'bad')
      else upsertLocal('regras_fornecedor', data)
    }
  }

  async function go() {
    if (bad.length) return toast(`Páginas mal escritas em ${bad.map(g => g.name).join(', ')}. Usa por exemplo 1-2 ou 1,3.`, 'bad')
    // A janela abre-se já (no clique) para o navegador não a bloquear; o PDF entra quando estiver pronto.
    const win = window.open('', '_blank')
    if (win) win.document.write('<p style="font-family:sans-serif;padding:24px">A juntar as faturas…</p>')
    setBusy({ done: 0, total: 0 })
    saveSheet(newSheet)
    try {
      if (ready && save.size) await saveRules()
      const pagesById = {}
      for (const g of groups) for (const id of g.ids) pagesById[id] = normalizePages(pages[g.key])
      const res = await build({ pagesById, newSheet, onProgress: (done, total) => setBusy({ done, total }) })
      if (!res.pdf) { win?.close(); return toast('Não foi possível juntar nenhum dos ficheiros.', 'bad') }
      const url = URL.createObjectURL(new Blob([res.pdf], { type: 'application/pdf' }))
      if (win && !win.closed) win.location.href = url
      else {
        const a = document.createElement('a')
        a.href = url
        a.download = `faturas-imprimir-${new Date().toISOString().slice(0, 10)}.pdf`
        a.click()
      }
      setTimeout(() => URL.revokeObjectURL(url), 10 * 60 * 1000)
      const notes = [
        res.withoutFiles?.length ? `${res.withoutFiles.length} sem ficheiro` : '',
        res.failed?.length ? `${res.failed.length} ficheiro${res.failed.length === 1 ? '' : 's'} ficou de fora (${res.failed.slice(0, 5).map(e => e.row.fornecedor || 'Sem fornecedor').join(', ')})` : '',
      ].filter(Boolean).join('; ')
      toast(`PDF pronto: ${res.count} fatura${res.count === 1 ? '' : 's'}, ${res.pages} página${res.pages === 1 ? '' : 's'}. Imprime com Ctrl+P / ⌘P.${notes ? ` Atenção: ${notes}.` : ''}`, notes ? 'bad' : 'ok')
      onClose()
    } catch (e) {
      win?.close()
      toast(`Não foi possível juntar as faturas: ${e.message}`, 'bad')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Modal title="Imprimir faturas" onClose={onClose}>
      <p>{items.length} fatura{items.length === 1 ? '' : 's'} num só PDF. Escolhe as páginas de cada fornecedor (vazio = todas; ex.: <strong>1-2</strong>, <strong>1</strong> ou <strong>1,3</strong>).</p>
      <div className="tablewrap">
        <table className="mini-table">
          <thead><tr><th>Fornecedor</th><th className="money">Faturas</th><th>Páginas</th>{ready && <th>Guardar</th>}</tr></thead>
          <tbody>
            {groups.map(g => (
              <tr key={g.key}>
                <td>{g.name}</td>
                <td className="money">{g.ids.length}</td>
                <td>
                  <input value={pages[g.key]} placeholder="todas" style={{ width: 90 }} aria-label={`Páginas de ${g.name}`}
                    className={validPages(pages[g.key]) ? '' : 'invalid'}
                    onChange={e => { const v = e.target.value; setPages(p => ({ ...p, [g.key]: v })); if (normalizePages(v) !== normalizePages(g.rule?.paginas_imprimir)) setSave(s => new Set(s).add(g.key)) }} />
                </td>
                {ready && <td><label className="check-inline"><input type="checkbox" checked={save.has(g.key)} onChange={e => setSave(s => { const n = new Set(s); e.target.checked ? n.add(g.key) : n.delete(g.key); return n })} /> para a próxima</label></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <label className="check-inline" style={{ margin: '12px 0', whiteSpace: 'normal' }}>
        <input type="checkbox" checked={newSheet} onChange={e => setNewSheet(e.target.checked)} /> Vou imprimir frente e verso: cada fatura começa numa folha nova
      </label>
      {!ready && <p className="small muted">Para a aplicação se lembrar das páginas de cada fornecedor, executa o <code>supabase/20_paginas_imprimir.sql</code> no Supabase.</p>}
      <div className="actions end">
        <button type="button" className="secondary" onClick={onClose}>Cancelar</button>
        <button type="button" className="primary" disabled={!!busy} onClick={go}>{busy ? `A juntar ${busy.done}/${busy.total}…` : '🖨 Abrir PDF para imprimir'}</button>
      </div>
    </Modal>
  )
}
