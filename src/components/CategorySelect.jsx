import { useState } from 'react'
import { useData } from '../data/DataProvider'
import { supabase } from '../supabase'
import { useToast } from './ui'

// Seleção de categoria com opção de criar uma nova.
export default function CategorySelect({ value, onChange, className = 'editselect', ...rest }) {
  const { categories, upsertLocal } = useData()
  const toast = useToast()
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const unclassified = categories.find(c => c.nome === 'Por classificar')
  const list = [...categories].filter(c => c.ativo !== false || c.id === value).sort((a, b) => a.nome.localeCompare(b.nome, 'pt'))

  async function create() {
    const nome = name.trim()
    if (!nome) return setCreating(false)
    const existing = categories.find(c => c.nome.toLowerCase() === nome.toLowerCase())
    if (existing) { onChange(existing.id); setCreating(false); setName(''); return }
    const { data, error } = await supabase.from('categories').insert({ nome }).select().single()
    if (error) return toast(`Não foi possível criar a categoria: ${error.message}`, 'bad')
    upsertLocal('categories', data)
    onChange(data.id)
    setCreating(false)
    setName('')
  }

  if (creating) {
    return (
      <span className="inline-create">
        <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Nome da nova categoria…" onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); create() } if (e.key === 'Escape') setCreating(false) }} />
        <button type="button" className="primary small" onClick={create}>Criar</button>
      </span>
    )
  }
  return (
    <select className={className} value={value ?? unclassified?.id ?? ''} onChange={e => (e.target.value === '__nova__' ? setCreating(true) : onChange(e.target.value ? Number(e.target.value) : null))} {...rest}>
      <option value={unclassified?.id ?? ''}>Por classificar</option>
      {list.filter(c => c.nome !== 'Por classificar').map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
      <option value="__nova__">+ Nova categoria…</option>
    </select>
  )
}
