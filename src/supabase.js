import { createClient } from '@supabase/supabase-js'
import { createLocalClient } from './local/localClient'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

// "npm run local": base de dados dentro do navegador, sem Supabase. Nunca entra no build de produção.
export const localMode = import.meta.env.MODE === 'offline'

export const supabaseConfigured = localMode || Boolean(url && key)

// Apenas a chave pública (anon/publishable). A chave service_role nunca entra no frontend.
export const supabase = localMode
  ? createLocalClient()
  : supabaseConfigured
    ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } })
    : null

export const BUCKET = 'faturas'
