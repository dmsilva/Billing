# Notas para o Claude

- Stack fixa: React + Vite, Supabase (`@supabase/supabase-js`), Netlify. Não introduzir Next.js, Prisma, Drizzle nem outro alojamento.
- Interface e documentação em português europeu.
- Nunca substituir dados reais por dados de demonstração nem perder registos. Os dados migrados vêm de `legacy/index.html` via `npm run seed:build`.
- Só a chave anon do Supabase no frontend; nunca `service_role`. A criação de contas usa a `SUPABASE_SERVICE_ROLE_KEY` apenas na função do Netlify `netlify/functions/criar-utilizador.mjs` (o modo local tem o equivalente em `src/local/localClient.js`). A `ANTHROPIC_API_KEY` só existe na função `netlify/functions/ler-fatura.mjs` (leitura automática na Receção).
- Regras financeiras em `src/lib/finance.js` (faturas CGD nunca somam; numerário soma; categorias com `conta_como_despesa=false` ficam fora). Somar sempre com `src/lib/money.js` (milésimos de euro).
- Supabase devolve no máximo 1000 linhas por pedido: usar o carregamento paginado de `src/data/DataProvider.jsx`.
- Faturas "Por pagar" ficam fora dos totais até `liquidar_faturas` (em `supabase/05_faturas_por_pagar.sql`) as passar a CGD/Numerário. Alterações novas de esquema vão em ficheiros SQL numerados à parte (o Daniel executa-os no Supabase).
- Segurança via RLS em `supabase/02_policies.sql`; o bucket `faturas` é privado (links assinados).
- Antes de terminar: `npm test`, `npm run build` e, havendo PostgreSQL, `npm run test:sql` (não como root).
