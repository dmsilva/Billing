// Extrai os dados do HTML legado para scripts/legacy-data.json e valida a integridade.
// Uso: node scripts/extract-legacy-data.mjs
import { writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadLegacyData, legacySummary } from './lib/legacy.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const data = loadLegacyData(join(root, 'legacy', 'index.html'))

if (data.cashCloses.length !== 819) throw new Error(`Esperados 819 fechos, encontrados ${data.cashCloses.length}`)
const july = data.cashCloses.find(r => r.date === '2026-07-02' && r.shift === '23h')
if (!july || july.money !== 251.95 || july.cv !== 1192.18 || july.mb !== 364.92) throw new Error('Falha na integridade: 02/07/2026 23h')
const jan = data.cashCloses.find(r => r.date === '2026-01-01' && r.shift === '7h')
if (!jan || jan.money !== 16 || jan.cv !== 210.68) throw new Error('Falha na integridade: 01/01/2026 7h')

console.log(JSON.stringify(legacySummary(data), null, 2))
const out = join(root, 'scripts', 'legacy-data.json')
writeFileSync(out, JSON.stringify(data))
console.log(`Escrito em ${out}`)
