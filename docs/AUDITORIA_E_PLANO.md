# FaturaClaro — Auditoria e plano de migração

Data: 18/10/2026

## 1. O que foi encontrado

| Fonte | Onde | Estado |
|---|---|---|
| HTML legado V36 (aplicação principal) | `legacy/index.html` (216 KB) | Analisado na íntegra |
| Página da receção legada | `legacy/rececao.html` | Analisada |
| App Next.js + SQLite (tentativa anterior) | `src/`, `scripts/`, `tests/` no repositório `dmsilva/Billing` | Analisada; usa uma stack não autorizada |
| Convenções das outras aplicações | repositório `dmsilva/Inventory` (React + Vite + Supabase + Netlify) | Reutilizadas |
| `PROJECT_BRIEF.md` | **Não encontrado** (nem no repositório, nem nos ficheiros do projeto) | Em falta |
| Excel `Caixas Diárias 2026.xlsx` | **Não encontrado** | Em falta; os 819 fechos já estão incorporados no HTML |

### Dados reais incorporados no HTML legado

| Conjunto | Registos | Total | Observações |
|---|---|---|---|
| Movimentos CGD (`DATA.transactions`) | 143 | 124 736,02 € | Julho 2026; todos "Chalet D'Ávila"; 2 transferências entre empresas (5 150,00 €) |
| Faturas em numerário (`CASH_INVOICES`) | 13 | 1 354,49 € | Julho 2026 |
| Produtos identificados (`ITEMS`) | 59 | 1 610,24 € | 1 linha sem valor ("Manteiga — compra autónoma", por consolidar) |
| Fechos de caixa (`ALL_CASH_DATA`) | 819 | 700 758,986 € | Jan–Set 2026, 3 turnos/dia; Dinheiro 32 525,47 · CV 440 347,392 · MB 225 332,324 · City MB 2 553,80 |

Totais contabilísticos de julho: CGD (sem transferências entre empresas) 119 586,02 € + Numerário 1 354,49 € = **120 940,51 €**.

### Dados que só existem no navegador (localStorage)

O HTML guardava no navegador da utilizadora: alterações de categoria (`despesas_app_categories_v2`), conferências de envelopes (`faturaclaro_envelopes_v2`), fechos importados (`faturaclaro_cash_closes_v1`) e registos TPA (`faturaclaro_tpa_v1`). Estes dados **não estão em nenhum ficheiro** e perdem-se se não forem exportados. O plano inclui uma exportação a partir do HTML legado e uma importação na nova aplicação.

### Funcionalidades do legado (todas a manter)

Visão geral (KPI, gráfico mensal, donut por categoria, faturas recentes, pequeno-almoço, alertas, resumo por imóvel, análise detalhada do mês com maiores fornecedores agrupando salários e financiamentos); CGD / Extrato; Faturas; Numerário; Produtos (filtro, pesquisa, CSV, estado manteiga/detergentes); Categorias (CGD vs Numerário); Editar categorias (com nova categoria, exportar, repor); Caixa diária (importação Excel/CSV, totais por turno); Conferência (CV → MB → Numerário → próximo envelope, OK/Enter, valor real, diferenças, corrigir, limpar); TPA / CGD (secção escondida); Faturas recebidas; página da Receção (fotografias/PDF); filtros globais (mês, imóvel, pagamento, categoria, pesquisa); exportação CSV.

### Problemas encontrados

1. **App Next.js anterior**: usa Next.js, SQLite (`better-sqlite3`) e referências a Prisma/Vercel. Viola a stack obrigatória e não persiste em servidor gerido. Será substituída (fica no histórico do Git).
2. **Leitura de valores**: o `moneyVal` do legado transforma "1.234,56" em 0 €. A nova versão lê corretamente formatos portugueses.
3. **Ordem da conferência**: a ordenação por texto do legado punha 15h antes de 7h. A nova versão segue a ordem cronológica 7h → 15h → 23h.
4. **Dupla contagem**: uma fatura paga por CGD não pode somar outra vez ao extrato. Regra nova: só faturas em numerário entram como despesa adicional; faturas CGD são documentos de suporte (podem ser ligadas ao movimento).
5. **9 salários classificados "Outros / por classificar"** (descrições com "ORDE…"). O legado já os agrupava como salários na análise de fornecedores; a classificação original é mantida e aparecem como "por classificar" nos alertas, para decisão da administradora.
6. **Endesa / Chalet do Lago**: o aviso do legado diz que dois pagamentos Endesa (CPE PT0002000133379727RQ) pertencem ao Chalet do Lago, mas nos dados os 10 movimentos Endesa estão todos em "Chalet D'Ávila" e não indicam CPE. Os dados são migrados tal como estão; o imóvel pode ser corrigido na aplicação.
7. **Valores com 3 casas decimais** no Excel: CV de 03/01/2026 7h (165,642 €) e MB de 05/02/2026 23h (162,394 €). São guardados exatamente como estão (sem arredondar) e assinalados na conferência.
8. Fotografias da receção eram enviadas em base64 para um `/api/invoices` que nunca existiu em produção.

## 2. Plano de migração

**Stack**: React + Vite (JavaScript, como no Inventory), `@supabase/supabase-js`, Supabase Auth + PostgreSQL + Storage privado, Netlify com `netlify.toml` na raiz. Bibliotecas auxiliares: `react-router-dom` (rotas), `recharts` (gráficos), `xlsx` (Excel), `vitest` (testes).

### Fase 1 — Base de dados Supabase
- `supabase/01_schema.sql`: imóveis, categorias (com indicação "conta como despesa"), fornecedores, movimentos CGD, faturas, ficheiros, linhas de produtos, fechos de caixa, conferências + histórico de correções, TPA, importações, perfis.
- `supabase/02_policies.sql`: RLS por papel (administradora / receção), bucket `faturas` **privado**.
- `supabase/03_seed_legacy.sql`: gerado automaticamente a partir do HTML legado, idempotente, com verificação final de contagens e totais (aborta se algo não bater certo).

### Fase 2 — Aplicação
Todas as páginas do legado em React, com filtros globais, gráficos, e sincronização em tempo real entre dispositivos (Supabase Realtime).

### Fase 3 — Faturas e receção
Gestão de faturas com ficheiros originais e linhas de produtos; página independente `/rececao` para fotografias/PDF; validação pela administradora.

### Fase 4 — Caixa e conferência
Importação Excel/CSV com pré-visualização (novos / alterados / iguais) antes de gravar; conferência com OK/Enter, diferenças, correção e histórico.

### Fase 5 — Migração do navegador, testes e documentação
Exportador no HTML legado e importador na nova app; testes das regras financeiras e dos totais migrados; README com publicação no Netlify e configuração do Supabase.

## 3. O que precisa da Daniel/administradora
- Criar (ou indicar) o projeto Supabase e colocar `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` no Netlify.
- Executar os 3 ficheiros SQL no SQL Editor.
- Criar as utilizadoras no Supabase Auth e promover a administradora.
- Enviar o `PROJECT_BRIEF.md` e o Excel original, se existirem, para confirmar regras e testar a importação com o ficheiro real.
