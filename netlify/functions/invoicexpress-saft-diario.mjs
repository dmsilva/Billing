// Todos os dias às 6h (Lisboa, ~5h UTC) vai buscar o SAF-T ao InvoiceXpress:
// do dia 1 ao 5 fecha o mês anterior; no resto do mês atualiza o mês corrente.
import { createClient } from '@supabase/supabase-js'
import { contaDe, mesAutomatico, sincronizarMes } from '../../src/lib/invoicexpress.js'

export default async () => {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key || !process.env.INVOICEXPRESS_API_KEY) {
    console.log('InvoiceXpress: falta configurar SUPABASE_SERVICE_ROLE_KEY, INVOICEXPRESS_CONTA ou INVOICEXPRESS_API_KEY.')
    return new Response('sem configuração', { status: 200 })
  }
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  // As funções agendadas param aos 30 s: espera-se até ~22 s pelo ficheiro. Se não ficar pronto,
  // o InvoiceXpress continua a prepará-lo e a corrida do dia seguinte apanha-o.
  const r = await sincronizarMes({ admin, conta: contaDe(process.env.INVOICEXPRESS_CONTA), apiKey: process.env.INVOICEXPRESS_API_KEY, mes: mesAutomatico(), automatico: true, esperarMs: 22000 })
  console.log('InvoiceXpress:', JSON.stringify(r))
  return new Response(JSON.stringify(r), { status: 200, headers: { 'content-type': 'application/json' } })
}

export const config = { schedule: '0 5 * * *' }
