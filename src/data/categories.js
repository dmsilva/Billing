import { supabase } from '../supabase'

// Garante que as categorias com estes nomes existem; devolve Map nome → id.
// Cria as que faltam (a administradora pode criar categorias, como em Editar categorias).
export async function ensureCategories(names, categories, upsertLocal) {
  const byName = new Map(categories.map(c => [c.nome.toLowerCase(), c.id]))
  for (const nome of new Set(names.filter(Boolean))) {
    if (byName.has(nome.toLowerCase())) continue
    const { data, error } = await supabase.from('categories').insert({ nome }).select().single()
    if (error) throw new Error(`Não foi possível criar a categoria ${nome}: ${error.message}`)
    upsertLocal('categories', data)
    byName.set(nome.toLowerCase(), data.id)
  }
  return name => byName.get(String(name).toLowerCase()) ?? null
}
