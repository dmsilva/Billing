import { useMemo, useState } from 'react'
import { supabase } from '../supabase'
import { useData } from '../data/DataProvider'
import { ConfirmButton, Panel, useToast } from './ui'
import { findDuplicates } from '../lib/duplicates'
import { euro } from '../lib/money'
import { formatDate } from '../lib/dates'

// Lista os movimentos repetidos de uma tabela do extrato e deixa apagar as cópias.
// table: 'bank_transactions' ou 'bank_credits'; score: qual manter; detail: texto extra por linha;
// locked(row): motivo para não apagar (ex.: tem uma fatura ligada).
export default function DuplicatesPanel({ table, rows, score, detail, locked, title }) {
  const { removeLocal } = useData()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const groups = useMemo(() => findDuplicates(rows, score), [rows, score])
  const certos = groups.filter(g => g.certeza === 'certo').flatMap(g => g.repetidos).filter(r => !locked?.(r))
  if (!groups.length) return null

  async function remove(list) {
    const ids = list.map(r => r.id)
    for (let i = 0; i < ids.length; i += 200) {
      const { error } = await supabase.from(table).delete().in('id', ids.slice(i, i + 200))
      if (error) return toast(`Não foi possível apagar: ${error.message}`, 'bad')
      removeLocal(table, ids.slice(i, i + 200))
    }
    toast(list.length === 1 ? 'Movimento repetido apagado.' : `${list.length} movimentos repetidos apagados.`)
  }

  const line = r => `${formatDate(r.data_mov)} · ${r.descricao} · ${euro(r.valor)}${r.saldo == null ? '' : ` · saldo ${euro(r.saldo)}`}`
  return (
    <Panel title={`${title} (${groups.reduce((n, g) => n + g.repetidos.length, 0)})`} className="dup-panel"
      hint="Movimentos que aparecem mais do que uma vez (o mesmo extrato importado duas vezes). Fica o que tem mais informação; apaga só a cópia."
      actions={<>
        <button type="button" className="secondary" onClick={() => setOpen(o => !o)}>{open ? 'Esconder' : 'Ver a lista'}</button>
        {certos.length > 0 && <ConfirmButton className="primary" confirmText={`Sim, apagar ${certos.length}`} onConfirm={() => remove(certos)}>Apagar as {certos.length} cópias certas</ConfirmButton>}
      </>}>
      {open && groups.map(g => (
        <div className={`dup-group ${g.certeza}`} key={`${g.manter.id}`}>
          <div className="dup-tag">{g.certeza === 'certo' ? 'Duplicado certo · mesmo valor e saldo' : 'Provável · confirma no extrato (pode ser um pagamento repetido a sério)'}</div>
          <div className="dup-row keep"><span className="badge ok">Fica</span><span>{line(g.manter)}{detail?.(g.manter) && <em> · {detail(g.manter)}</em>}</span></div>
          {g.repetidos.map(r => (
            <div className="dup-row" key={r.id}>
              <span className="badge pending">Cópia</span>
              <span>{line(r)}{detail?.(r) && <em> · {detail(r)}</em>}</span>
              {locked?.(r)
                ? <span className="muted small">{locked(r)}</span>
                : <ConfirmButton confirmText="Apagar" onConfirm={() => remove([r])}>Apagar cópia</ConfirmButton>}
            </div>
          ))}
        </div>
      ))}
    </Panel>
  )
}
