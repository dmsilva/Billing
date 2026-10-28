import { useEffect, useRef } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { useData } from '../data/DataProvider'
import { supabase } from '../supabase'
import { useToast } from './ui'
import { planAutoUpdates } from '../lib/autoInvoices'

const INVOICE_SELECT = '*, invoice_files(id, nome_ficheiro, mime, storage_path, tamanho, created_at)'

// Sempre que chegam faturas novas ou um extrato novo, classifica as faturas e confere-as com o extrato.
export default function AutoConferencia() {
  const { profile, user } = useAuth()
  const { loading, invoices, bank_transactions, categories, invoice_payments, upsertLocal } = useData()
  const toast = useToast()
  const running = useRef(false)
  const lastKey = useRef('')

  useEffect(() => {
    if (loading || profile?.role !== 'admin' || running.current || !categories.length) return
    const key = `${invoices.length}|${bank_transactions.length}|${invoices.filter(i => i.origem === 'rececao' && i.estado === 'Por validar').length}`
    if (key === lastKey.current) return
    lastKey.current = key
    const plan = planAutoUpdates({ invoices, transactions: bank_transactions, categories, payments: invoice_payments, userId: user?.id })
    if (!plan.invoices.length && !plan.transactions.length) return
    running.current = true
    ;(async () => {
      let conferidas = 0
      let classificadas = 0
      for (const { id, patch } of plan.invoices) {
        const { data, error } = await supabase.from('invoices').update(patch).eq('id', id).select(INVOICE_SELECT)
        if (error || !data?.length) continue
        upsertLocal('invoices', data)
        if (patch.bank_transaction_id) conferidas++
        if (patch.categoria_id) classificadas++
      }
      for (const { id, patch } of plan.transactions) {
        const { data, error } = await supabase.from('bank_transactions').update(patch).eq('id', id).select()
        if (!error && data?.length) upsertLocal('bank_transactions', data)
      }
      running.current = false
      const parts = [conferidas && `${conferidas} fatura${conferidas === 1 ? '' : 's'} conferida${conferidas === 1 ? '' : 's'} com o extrato`, classificadas && `${classificadas} classificada${classificadas === 1 ? '' : 's'} automaticamente`].filter(Boolean)
      if (parts.length) toast(`${parts.join(' · ')}.`)
    })()
  }, [loading, profile, user, invoices, bank_transactions, categories, invoice_payments, upsertLocal, toast])

  return null
}
