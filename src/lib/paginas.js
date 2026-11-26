import { ruleFor } from './autoInvoices.js'

// Páginas a imprimir: "1-2", "1", "1,3-4". Vazio ou "todas" = todas.
export const PAGES_RE = /^\s*\d+(\s*-\s*\d+)?(\s*,\s*\d+(\s*-\s*\d+)?)*\s*$/

export function validPages(spec) {
  const s = String(spec ?? '').trim()
  return !s || /^todas$/i.test(s) || PAGES_RE.test(s)
}

export function normalizePages(spec) {
  const s = String(spec ?? '').trim()
  if (!s || /^todas$/i.test(s)) return null
  return s.replace(/\s+/g, '')
}

// Índices (a contar de 0) das páginas a usar num documento com `count` páginas.
// Páginas que não existem são ignoradas; se nada sobrar, usam-se todas.
export function parsePages(spec, count) {
  const all = Array.from({ length: count }, (_, i) => i)
  const s = normalizePages(spec)
  if (!s || !PAGES_RE.test(s)) return all
  const out = []
  for (const part of s.split(',')) {
    const [a, b = a] = part.split('-').map(Number)
    for (let p = Math.min(a, b); p <= Math.max(a, b) && p <= count; p++) if (p >= 1 && !out.includes(p - 1)) out.push(p - 1)
  }
  return out.length ? out : all
}

// Regra do fornecedor para as páginas: tenta o nome, depois o remetente completo (ex.: o domínio
// "vodafone.pt") e o assunto do email.
export function printRuleFor(names, rules = []) {
  const withPages = rules.filter(r => normalizePages(r.paginas_imprimir))
  for (const n of names) {
    const r = n && ruleFor(n, withPages)
    if (r) return r
  }
  return null
}
