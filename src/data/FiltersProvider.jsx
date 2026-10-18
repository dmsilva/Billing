import { createContext, useContext, useEffect, useState } from 'react'

const FiltersContext = createContext(null)
const KEY = 'faturaclaro_filtros_v1'
const EMPTY = { month: '', property: '', payment: '', category: '', search: '' }

function initial() {
  try {
    return { ...EMPTY, ...JSON.parse(localStorage.getItem(KEY) || '{}'), search: '' }
  } catch {
    return EMPTY
  }
}

export function FiltersProvider({ children }) {
  const [filters, setFilters] = useState(initial)
  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify({ ...filters, search: '' })) } catch { /* sem armazenamento local */ }
  }, [filters])
  const set = patch => setFilters(f => ({ ...f, ...patch }))
  const clear = () => setFilters(EMPTY)
  return <FiltersContext.Provider value={{ filters, set, clear }}>{children}</FiltersContext.Provider>
}

export const useFilters = () => useContext(FiltersContext)
