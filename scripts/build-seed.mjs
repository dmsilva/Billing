// Gera supabase/03_seed_legacy.sql a partir dos dados reais do HTML legado.
// Uso: npm run seed:build
import { writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadLegacyData } from './lib/legacy.mjs'
import { buildSeedSql } from './lib/seed.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const { sql, summary } = buildSeedSql(loadLegacyData(join(root, 'legacy', 'index.html')))
writeFileSync(join(root, 'supabase', '03_seed_legacy.sql'), sql)
writeFileSync(join(root, 'src', 'data', 'legacyExpected.json'), JSON.stringify(summary, null, 2) + '\n')
console.log('Escrito supabase/03_seed_legacy.sql e src/data/legacyExpected.json')
