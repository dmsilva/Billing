# FaturaClaro

Gestão financeira do alojamento: despesas CGD e numerário, faturas com documento original e linhas de produtos, caixa diária, conferência de envelopes e envio de faturas pela receção.

**Stack:** React + Vite (frontend) · Supabase (Auth, base de dados, Storage privado, Realtime) · Netlify (alojamento).

---

## O que a aplicação faz

| Página | Para quê |
| --- | --- |
| **Dashboard** | KPIs do mês (CGD, numerário, total, caixa), gráficos mensais, por categoria e por imóvel, alertas do que precisa de atenção. |
| **Análise** | Despesa por fornecedor, categoria, imóvel e mês, com filtros. |
| **Movimentos CGD** | Extrato bancário; importação do extrato da CGD em PDF, Excel ou CSV (sem duplicar movimentos já existentes; o PDF é lido no navegador e conferido pelos saldos) com sugestão de categoria. As saídas entram como despesas e as entradas (créditos) como recebimentos, à parte. |
| **Entradas no banco** | Créditos do extrato (Expedia/Travelscape, Booking, Airbnb, Stripe, transferências de hóspedes…) por origem; nunca contam como despesa. Gestão das transferências que a receção vê: enviar do extrato ou adicionar à mão (ficam ligadas ao extrato quando este é importado). |
| **Faturas** | Todas as faturas, com documento original (foto/PDF), linhas de produtos e ligação a um movimento CGD. |
| **Numerário** | Faturas pagas em dinheiro, que são as únicas faturas que somam à despesa. |
| **Recebidas** | Faturas enviadas pela receção à espera de validação. |
| **Por liquidar** | Faturas registadas como “Por pagar”, agrupadas por fornecedor. Escolhem-se várias e regista-se um só pagamento (CGD ou numerário), que pode ser anulado. |
| **Produtos** | Análise por produto e tipo de produto (linhas das faturas). |
| **Categorias / Editar categorias** | Totais por categoria e reclassificação de movimentos (com histórico). |
| **Caixa diária** | Fechos por turno (7h, 15h, 23h), importação do Excel da caixa com pré-visualização, histórico e anulação, edição manual e TPA. |
| **Conferência** | Conferência dos envelopes na ordem CV → MB → Numerário → próximo envelope. `Enter` ou **OK** aceita; escrever o valor real regista a diferença; cada conferência pode ser corrigida e fica com histórico. |
| **Receção** (`/rececao`) | Página simples para telemóvel: tirar foto ou escolher foto/PDF, confirmar os campos (lidos automaticamente da fatura quando a leitura está ligada) e enviar. Aba **Transferências**: pesquisar se a transferência de um hóspede já chegou e alocá-la a um imóvel/quarto e reserva (sem ver o extrato nem o saldo). |
| **Utilizadores** | Atribuir papéis (administrador, receção, pendente). |
| **Configuração** | Validação dos dados migrados, importação dos dados guardados no navegador antigo, imóveis. |

### Regras contabilísticas

- **Despesa CGD** = movimentos bancários negativos, exceto categorias marcadas como "não conta como despesa" (por exemplo, transferências entre empresas).
- **Despesa em numerário** = faturas com método *Numerário*, com valor e não rejeitadas.
- **Faturas CGD nunca somam**: são o comprovativo de um movimento bancário que já está contado. Podem ser ligadas a esse movimento.
- Os valores são somados em milésimos de euro para evitar erros de arredondamento.
- **Faturas por pagar** não entram nos totais até serem liquidadas; nessa altura passam a CGD (não somam) ou Numerário (somam).

Estas regras estão em `src/lib/finance.js` e cobertas por testes em `tests/`.

### Papéis

- **admin**: acesso total.
- **rececao**: só a página `/rececao`. Pode enviar faturas e ver as suas, sem acesso a dados financeiros.
- **pendente**: conta criada mas sem acesso, até um administrador lhe atribuir um papel.

A segurança é garantida no Supabase por RLS (`supabase/02_policies.sql`), não apenas na interface. O bucket `faturas` é **privado**: os ficheiros só abrem por links assinados válidos durante 1 hora.

---

## Dados migrados

Todos os dados reais do HTML antigo (`legacy/index.html`, V36) estão em `supabase/03_seed_legacy.sql`. Nada foi substituído por dados de demonstração.

| Conjunto | Registos | Total |
| --- | ---: | ---: |
| Movimentos CGD | 143 | 124 736,02 € |
| Faturas em numerário | 13 | 1 354,49 € |
| Linhas de produtos | 59 | 1 610,24 € |
| Fechos de caixa (01/01/2026 a 30/09/2026) | 819 | 700 758,986 € |

O próprio seed verifica estes números no fim e falha (sem gravar nada) se algum não bater certo. Na aplicação, **Configuração → Validação dos dados migrados** faz a mesma comparação sobre o que está no Supabase.

### Dados que estavam só no navegador

O HTML antigo guardava no `localStorage` do navegador as alterações de categoria, as conferências de envelopes, os fechos importados e os valores TPA. Para não os perder:

1. No computador e navegador onde se usava a versão antiga, abrir `legacy/index.html` desta versão a partir da **mesma pasta** onde estava o ficheiro antigo (o `localStorage` depende da localização do ficheiro).
2. No menu lateral, carregar em **⇩ Exportar dados deste navegador**. É descarregado `faturaclaro-dados-navegador.json`.
3. Na nova aplicação, **Configuração → Importar dados do navegador antigo**, escolher o ficheiro, rever o resumo e confirmar.

É guardada uma cópia integral do ficheiro no Supabase (`legacy_browser_imports`).

---

## Experimentar no computador (sem Supabase)

Precisa apenas do [Node.js](https://nodejs.org) 20 ou mais recente e do git.

```bash
git clone -b claude/faturaclaro-react-supabase https://github.com/dmsilva/Billing.git faturaclaro
cd faturaclaro
npm install
npm run local
```

Abrir http://localhost:5173 e entrar com:

- **admin@local** para a administradora (aplicação completa)
- **rececao@local** para a receção (página de envio de faturas)
- ou uma conta criada em **Utilizadores → Criar utilizador** (com a palavra-passe que definiste)

A palavra-passe pode ser qualquer uma.

No modo local, a aplicação corre uma base PostgreSQL dentro do próprio navegador. Usa exatamente o mesmo esquema, as mesmas regras de segurança e os mesmos dados reais migrados que o Supabase. O primeiro arranque demora alguns segundos.

- As alterações (faturas, fotografias, conferências, importações) ficam guardadas nesse navegador e não chegam ao Supabase.
- O botão **Repor dados originais** volta ao ponto de partida.
- Convém usar um separador de cada vez.

O modo local nunca entra no build de produção.

---

## Publicar: passo a passo

### 1. Criar o projeto Supabase

1. Em [supabase.com](https://supabase.com), criar um projeto (região UE, por exemplo Frankfurt).
2. Em **SQL Editor**, executar por esta ordem o conteúdo de:
   1. `supabase/01_schema.sql` (tabelas, funções, triggers)
   2. `supabase/02_policies.sql` (RLS, bucket privado `faturas`, políticas de Storage)
   3. `supabase/03_seed_legacy.sql` (dados reais migrados; termina com uma verificação automática)
   4. `supabase/05_faturas_por_pagar.sql` (faturas por pagar e pagamentos agrupados)
   5. `supabase/06_entradas_transferencias.sql` (entradas do extrato e transferências da receção)
   6. `supabase/07_encargos_pessoal.sql` (TSU e IRS mensais, para o custo com pessoal em Resultados)
   7. Opcional: `supabase/04_verificacao.sql` (só leitura, mostra os totais)

   Os scripts podem ser executados mais do que uma vez sem duplicar dados.
3. **Database → Publications → supabase_realtime**: confirmar que as tabelas da aplicação estão incluídas (o `01_schema.sql` já as adiciona). Isto mantém vários dispositivos sincronizados em tempo real.
4. **Authentication → URL Configuration**:
   - *Site URL*: o endereço Netlify (por exemplo `https://faturaclaro.netlify.app`)
   - *Redirect URLs*: `https://faturaclaro.netlify.app/nova-password`
5. **Authentication → Providers → Email**: recomendado desativar "Allow new users to sign up" e criar contas apenas por convite.

### 2. Criar a primeira administradora

1. **Authentication → Users → Add user** (ou *Invite user*) com o email da administradora.
2. No SQL Editor, dar-lhe o papel de administradora:

   ```sql
   update public.profiles set role = 'admin' where email = 'email@da-administradora.pt';
   ```

3. As restantes contas criam-se na própria aplicação, em **Utilizadores → Criar utilizador**. Há duas formas: enviar um convite por email (a pessoa define a palavra-passe em `/nova-password`) ou definir logo a palavra-passe. O papel (Receção ou Administradora) fica atribuído no momento.

### 3. Publicar no Netlify

1. **Add new site → Import an existing project** e escolher este repositório. O `netlify.toml` já define o build (`npm run build`), a pasta `dist`, o Node 22 e o redirecionamento das rotas para `index.html`.
2. **Site configuration → Environment variables**:

   | Variável | Valor (Supabase → Project Settings → API) |
   | --- | --- |
   | `VITE_SUPABASE_URL` | Project URL |
   | `VITE_SUPABASE_ANON_KEY` | chave **anon / publishable** |
   | `SUPABASE_SERVICE_ROLE_KEY` | chave **service_role** (só para a função que cria contas) |
| `ANTHROPIC_API_KEY` | opcional: chave da [Anthropic](https://console.anthropic.com) para ler automaticamente as faturas na Receção e responder na página Perguntar |

   ⚠️ As variáveis que começam por `VITE_` ficam visíveis no navegador: nunca lá pôr chaves secretas. A `SUPABASE_SERVICE_ROLE_KEY` não tem esse prefixo e só é lida pela função do servidor `netlify/functions/criar-utilizador.mjs`, que confirma que quem pede é administradora antes de criar a conta. Se quiseres, marca-a como *secret* no Netlify.

   A `ANTHROPIC_API_KEY` também é secreta e só é lida pela função `netlify/functions/ler-fatura.mjs`. Quando a Receção junta uma foto ou PDF, a função lê fornecedor, NIF, data, nº do documento, total e IVA, e preenche os campos que ainda estão vazios; a pessoa confirma antes de enviar. O original guardado não é alterado. Cada leitura custa poucos cêntimos. Sem esta chave, a página funciona como antes e os campos escrevem-se à mão. No modo local a leitura não está disponível.

   A mesma chave liga a página **Perguntar** (só para a administradora): perguntas em linguagem normal ("temos a fatura X?", "quanto fizemos em numerário em setembro?") respondidas pela função `netlify/functions/perguntar.mjs`. O Claude só pode consultar (nunca alterar) e as consultas são feitas com o login de quem pergunta, por isso as permissões do Supabase aplicam-se. Cada pergunta custa à volta de 5 a 12 cêntimos na conta da Anthropic.
3. Fazer deploy. Entrar com a conta de administradora e abrir **Configuração** para confirmar que a validação está toda verde.

---

## Desenvolvimento local

```bash
cp .env.example .env      # preencher com o URL e a chave anon do Supabase
npm install
npm run dev               # http://localhost:5173
```

Sem `.env`, `npm run local` arranca o modo local descrito acima.

### Testes

```bash
npm test                  # regras financeiras, conferência, importações, migração (vitest)
npm run test:sql          # esquema, RLS, funções e seed num PostgreSQL temporário
```

`npm run test:sql` precisa de PostgreSQL (`initdb`, `pg_ctl`, `psql`) instalado e não pode correr como root. Aplica os scripts duas vezes para provar que são idempotentes e testa as permissões de cada papel.

### Regenerar o seed

Se o `legacy/index.html` mudar:

```bash
npm run seed:build        # reescreve supabase/03_seed_legacy.sql e src/data/legacyExpected.json
```

---

## Estrutura

```
legacy/index.html          HTML antigo (V36), fonte dos dados migrados, com botão de exportação
supabase/                  SQL para o SQL Editor (01 esquema, 02 políticas, 03 seed, 04 verificação)
supabase/test/             testes SQL locais
scripts/                   geração do seed e testes SQL
src/lib/                   lógica pura e testada (dinheiro, finanças, conferência, importações)
src/data/                  ligação ao Supabase, carregamento paginado, tempo real, ficheiros
src/pages/                 páginas da aplicação
src/components/            componentes reutilizáveis
tests/                     testes vitest
docs/AUDITORIA_E_PLANO.md  auditoria inicial e plano
```

---

## O que ainda falta ou merece atenção

- **Excel real da caixa**: o ficheiro Excel original e o `PROJECT_BRIEF.md` não estavam no repositório. O importador foi testado com ficheiros construídos no mesmo formato que o HTML antigo lia (uma folha por dia, linhas "Fecho 7h/15h/23h"). Convém experimentar com o ficheiro real; a pré-visualização mostra o que muda antes de gravar e cada importação pode ser anulada.
- **Biblioteca `xlsx` 0.18.5**: tem um aviso de segurança conhecido (ficheiros maliciosos). Só é carregada quando se importa um Excel e só pela administradora. A versão corrigida só existe no CDN da SheetJS, que não estava acessível durante o desenvolvimento.
- **Classificações por rever**: 9 movimentos de salários e os movimentos Endesa / Chalet do Lago devem ser confirmados na página **Editar categorias**.
- **Fotos HEIC** (iPhone): são guardadas e descarregáveis, mas o navegador não mostra pré-visualização.
