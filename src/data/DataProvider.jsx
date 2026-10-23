import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../supabase'
import { bankToRow, invoiceToRow } from '../lib/finance'

const DataContext = createContext(null)

// Tabelas carregadas para a administradora. O Supabase devolve no máximo 1000 linhas por pedido,
// por isso lemos por páginas.
const TABLES = {
  properties: { select: '*', order: 'nome' },
  categories: { select: '*', order: 'nome' },
  bank_transactions: { select: '*', order: 'data_mov' },
  invoices: { select: '*, invoice_files(id, nome_ficheiro, mime, storage_path, tamanho, created_at)', order: 'data' },
  invoice_lines: { select: '*', order: 'id' },
  cash_closes: { select: '*', order: 'data' },
  cash_checks: { select: '*', order: 'id' },
  tpa_records: { select: '*', order: 'data' },
  cash_imports: { select: '*', order: 'importado_em', ascending: false },
  bank_imports: { select: '*', order: 'importado_em', ascending: false },
  profiles: { select: '*', order: 'email' },
  // Só existe depois de executar supabase/05_faturas_por_pagar.sql; sem ela a aplicação continua a funcionar.
  invoice_payments: { select: '*', order: 'data', optional: true },
  // Só existem depois de executar supabase/06_entradas_transferencias.sql.
  bank_credits: { select: '*', order: 'data_mov', optional: true },
  transferencias: { select: '*', order: 'data', optional: true },
  // Só existe depois de executar supabase/07_encargos_pessoal.sql.
  encargos_pessoal: { select: '*', order: 'mes', optional: true },
}

const PAGE = 1000

export async function fetchAll(table, { select = '*', order = 'id', ascending = true, optional = false } = {}) {
  const rows = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from(table).select(select).order(order, { ascending }).order('id', { ascending: true }).range(from, from + PAGE - 1)
    if (error) {
      if (optional) return null
      throw error
    }
    rows.push(...data)
    if (data.length < PAGE) return rows
  }
}

export function DataProvider({ children }) {
  const [state, setState] = useState(() => Object.fromEntries(Object.keys(TABLES).map(t => [t, []])))
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [online, setOnline] = useState(true)
  const [missing, setMissing] = useState([])
  const timers = useRef({})

  const reload = useCallback(async table => {
    try {
      const rows = await fetchAll(table, TABLES[table])
      setState(s => ({ ...s, [table]: rows || [] }))
    } catch (e) {
      setError(`${table}: ${e.message}`)
    }
  }, [])

  const reloadAll = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const entries = await Promise.all(Object.entries(TABLES).map(async ([t, cfg]) => [t, await fetchAll(t, cfg)]))
      setState(Object.fromEntries(entries.map(([t, rows]) => [t, rows || []])))
      setMissing(entries.filter(([, rows]) => rows === null).map(([t]) => t))
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    reloadAll()
    // Sincronização entre dispositivos: qualquer alteração noutro dispositivo recarrega a tabela.
    const channel = supabase.channel('faturaclaro-sync')
    for (const table of Object.keys(TABLES)) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => {
        clearTimeout(timers.current[table])
        timers.current[table] = setTimeout(() => reload(table), 400)
      })
    }
    channel.on('postgres_changes', { event: '*', schema: 'public', table: 'invoice_files' }, () => {
      clearTimeout(timers.current.invoice_files)
      timers.current.invoice_files = setTimeout(() => reload('invoices'), 400)
    })
    channel.subscribe(status => setOnline(status === 'SUBSCRIBED'))
    const t = timers.current
    return () => {
      Object.values(t).forEach(clearTimeout)
      supabase.removeChannel(channel)
    }
  }, [reload, reloadAll])

  // Atualização local imediata depois de uma gravação bem-sucedida (sem esperar pelo tempo real).
  const upsertLocal = useCallback((table, rows) => {
    const list = Array.isArray(rows) ? rows : [rows]
    setState(s => {
      const map = new Map(s[table].map(r => [r.id, r]))
      for (const r of list) map.set(r.id, { ...map.get(r.id), ...r })
      return { ...s, [table]: [...map.values()] }
    })
  }, [])

  const removeLocal = useCallback((table, ids) => {
    const set = new Set(Array.isArray(ids) ? ids : [ids])
    setState(s => ({ ...s, [table]: s[table].filter(r => !set.has(r.id)) }))
  }, [])

  const derived = useMemo(() => {
    const categoriesById = new Map(state.categories.map(c => [c.id, c]))
    const propertiesById = new Map(state.properties.map(p => [p.id, p.nome]))
    return {
      categoriesById,
      propertiesById,
      bankRows: state.bank_transactions.map(t => bankToRow(t, categoriesById, propertiesById)),
      invoiceRows: state.invoices.map(i => invoiceToRow(i, categoriesById, propertiesById)),
      categoryNames: state.categories.filter(c => c.ativo !== false).map(c => c.nome).sort((a, b) => a.localeCompare(b, 'pt')),
      propertyNames: state.properties.filter(p => p.ativo !== false).map(p => p.nome),
    }
  }, [state])

  const value = { ...state, ...derived, paymentsReady: !missing.includes('invoice_payments'), creditsReady: !missing.includes('bank_credits') && !missing.includes('transferencias'), encargosReady: !missing.includes('encargos_pessoal'), loading, error, online, reload, reloadAll, upsertLocal, removeLocal }
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}

export const useData = () => useContext(DataContext)
