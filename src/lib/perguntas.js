// Perguntas em linguagem natural sobre os dados ("temos a fatura X?", "quanto fizemos em numerário
// em setembro?"). O Claude não vê a base de dados: pede consultas através das ferramentas abaixo e a
// função do Netlify executa-as com o login de quem pergunta (as permissões RLS aplicam-se). Só leitura.
import { sumBy } from './money.js'
import { monthOf } from './dates.js'
import { accountingRows, bankToRow, invoiceToRow, monthResult, yearResults } from './finance.js'

// Tabelas que o assistente pode consultar, com os nomes que lhe mostramos e as colunas permitidas.
export const TABELAS = {
  faturas: {
    tabela: 'invoices', data: 'data',
    colunas: ['id', 'data', 'fornecedor', 'documento', 'descricao', 'categoria_id', 'imovel_id', 'pagamento', 'valor', 'iva', 'iva_estado', 'estado', 'origem', 'bank_transaction_id', 'payment_id', 'liquidada_em', 'enviado_por', 'observacoes', 'motivo_rejeicao', 'created_at'],
    descricao: 'Faturas e recibos. pagamento: CGD | Numerário | Por pagar. estado: Por validar | Validada | Rejeitada. bank_transaction_id liga ao movimento CGD que a pagou.',
  },
  ficheiros_faturas: {
    tabela: 'invoice_files', data: 'created_at',
    colunas: ['id', 'invoice_id', 'nome_ficheiro', 'mime', 'created_at'],
    descricao: 'Fotos/PDF anexados a cada fatura (invoice_id).',
  },
  movimentos_cgd: {
    tabela: 'bank_transactions', data: 'data_mov',
    colunas: ['id', 'data_mov', 'data_valor', 'descricao', 'valor', 'saldo', 'categoria_id', 'imovel_id', 'notas', 'origem'],
    descricao: 'Saídas da conta CGD (valor positivo = dinheiro que saiu). A descrição é o texto do extrato.',
  },
  entradas_banco: {
    tabela: 'bank_credits', data: 'data_mov',
    colunas: ['id', 'data_mov', 'data_valor', 'descricao', 'valor', 'saldo', 'tipo', 'conta_como_entrada', 'imovel_id', 'notas'],
    descricao: 'Entradas na conta CGD. tipo: Expedia, Stripe, Booking, Airbnb, Transferência, TPA / Multibanco, Depósito, Outra.',
  },
  caixa_diaria: {
    tabela: 'cash_closes', data: 'data',
    colunas: ['id', 'data', 'turno', 'dinheiro', 'cv', 'mb', 'city_mb', 'registos'],
    descricao: 'Fechos da caixa diária por turno (7h, 15h, 23h). dinheiro = numerário recebido; cv e mb = cartões; city_mb = taxa turística paga em MB.',
  },
  conferencias_caixa: {
    tabela: 'cash_checks', data: 'conferido_em',
    colunas: ['id', 'cash_close_id', 'tipo', 'valor_esperado', 'valor_real', 'diferenca', 'nota', 'conferido_em'],
    descricao: 'Conferência de cada fecho (tipo cv, mb ou dinheiro): valor esperado, contado e diferença.',
  },
  transferencias: {
    tabela: 'transferencias', data: 'data',
    colunas: ['id', 'data', 'valor', 'ordenante', 'descricao', 'imovel_id', 'quarto', 'reserva', 'notas', 'alocada_em'],
    descricao: 'Transferências de hóspedes publicadas para a receção, com quarto e reserva quando já alocadas.',
  },
  pagamentos_faturas: {
    tabela: 'invoice_payments', data: 'data',
    colunas: ['id', 'data', 'meio', 'valor', 'fornecedor', 'referencia', 'observacoes', 'bank_transaction_id'],
    descricao: 'Pagamentos que liquidaram faturas "Por pagar" (uma ou várias de cada vez).',
  },
  produtos: {
    tabela: 'invoice_lines', data: 'data',
    colunas: ['id', 'invoice_id', 'produto', 'artigo', 'unidade', 'quantidade', 'valor', 'tipo', 'fornecedor', 'data', 'observacao'],
    descricao: 'Linhas de produtos das faturas/talões. artigo = produto genérico sem marca (Manteiga, Leite, Detergente da loiça…), para somar o gasto por produto; tipo = categoria larga (Pequeno-almoço, Limpeza, Bebidas…). A data pode faltar: usar a da fatura (invoice_id).',
  },
  categorias: {
    tabela: 'categories', data: null,
    colunas: ['id', 'nome', 'conta_como_despesa', 'ativo'],
    descricao: 'Categorias de despesa. conta_como_despesa=false fica fora dos totais (ex.: Transferência — empresa).',
  },
  imoveis: {
    tabela: 'properties', data: null,
    colunas: ['id', 'nome', 'ativo'],
    descricao: 'Imóveis (Chalet D\'Ávila, Chalet do Lago…).',
  },
  encargos_pessoal: {
    tabela: 'encargos_pessoal', data: null,
    colunas: ['id', 'mes', 'tsu', 'irs', 'notas'],
    descricao: 'TSU e IRS pagos em cada mês (AAAA-MM) dentro dos "Gastos do mês". Não somam às despesas.',
  },
}

const OPS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contem', 'vazio', 'preenchido']
export const MAX_LINHAS = 100
export const MAX_LINHAS_SOMA = 20000
const PAGE = 1000

export const SYSTEM_PROMPT = `És o assistente da FaturaClaro, a app de gestão financeira do Chalet D'Ávila e do Chalet do Lago (alojamento local em Portugal). Respondes a perguntas sobre os dados reais da app, em português europeu, de forma simples e direta, para quem não é contabilista.

Nunca inventes números: usa sempre as ferramentas para consultar os dados antes de responder, e responde só com o que elas devolvem. Se os dados não chegarem para responder, diz o que falta. Não podes alterar dados: só consultar.

Regras do negócio (seguem as da app):
- Despesas = saídas CGD cujas categorias contam como despesa + faturas pagas em numerário (não rejeitadas). As faturas pagas por CGD são só o documento de um movimento do extrato: nunca as somes outra vez às saídas CGD.
- Faturas "Por pagar" ficam fora dos totais até serem liquidadas. Faturas "Rejeitada" nunca contam.
- Faturado (receita) = caixa diária (dinheiro + cv + mb + city_mb) + entradas no banco que contam como entrada, exceto os tipos "TPA / Multibanco" (é o dinheiro dos cartões da caixa a chegar ao banco) e "Depósito" (é numerário da caixa depositado). Para faturado, despesas e lucro usa a ferramenta resultados, que já aplica estas regras.
- "Quanto fizemos em numerário" refere-se normalmente ao dinheiro recebido na caixa diária (coluna dinheiro de caixa_diaria). "Gastámos em numerário" refere-se às faturas com pagamento Numerário. Se a pergunta for ambígua, responde à leitura mais provável e diz qual escolheste.
- POS VENDAS no extrato é o MB da caixa diária a chegar ao banco: não somar ao faturado.
- Categorias habituais no extrato: GDL CUR = gás; TRF Lisboagás = reembolso de gás (não é receita); "Gastos do mês" = pagamento à contabilidade (inclui IRS e TSU mensais); PROC RECLAM = devoluções à Booking.
- As datas estão em AAAA-MM-DD. Um mês inteiro filtra-se com data >= AAAA-MM-01 e data < primeiro dia do mês seguinte. Se o ano não for dito, assume o ano corrente (ou o mais recente com dados).

Como procurar:
- Para encontrar uma fatura por número, fornecedor ou descrição usa o operador "contem" (não distingue maiúsculas). O número pode estar escrito de formas diferentes (ex.: "FT 2026/123", "FT2026-123"): se não encontrares à primeira, tenta só a parte numérica e procura também no extrato CGD.
- Para somas e totais usa o campo somar (e agrupar_por quando quiseres por mês, fornecedor, etc.) em vez de somar tu as linhas.
- categoria_id e imovel_id aparecem já com o nome ao lado (categoria, imovel). Para filtrar por categoria, consulta primeiro a tabela categorias para saber o id.

Resposta:
- Começa pela resposta (sim/não, ou o valor), depois os detalhes que interessam.
- Valores em euros no formato português: 1 234,56 €. Datas como 18/09/2026.
- Para listas curtas usa tópicos ou uma tabela markdown simples. Não mostres mais de 15 linhas: diz quantas há no total.
- Quando falares de uma fatura concreta, inclui a ligação [fatura nº <id>](/faturas/<id>), para se poder abrir.
- Não fales de tabelas, colunas, SQL nem ferramentas: fala de faturas, extrato, caixa, entradas.`

const filtroSchema = {
  type: 'object',
  properties: {
    coluna: { type: 'string' },
    op: { type: 'string', enum: OPS, description: 'contem = texto contém (sem distinguir maiúsculas); vazio/preenchido não usam valor.' },
    valor: { type: ['string', 'number', 'boolean', 'null'] },
  },
  required: ['coluna', 'op'],
  additionalProperties: false,
}

export const TOOLS = [
  {
    name: 'consultar',
    description: `Consulta uma tabela da FaturaClaro (só leitura). Devolve o número de linhas encontradas, as primeiras linhas e, se pedido, somas (no total e por grupo).\nTabelas:\n${Object.entries(TABELAS).map(([k, t]) => `- ${k}: ${t.descricao} Colunas: ${t.colunas.join(', ')}.`).join('\n')}`,
    input_schema: {
      type: 'object',
      properties: {
        tabela: { type: 'string', enum: Object.keys(TABELAS) },
        filtros: { type: 'array', items: filtroSchema, description: 'Todos os filtros têm de se verificar (E).' },
        colunas: { type: 'array', items: { type: 'string' }, description: 'Colunas a devolver nas linhas. Omitir = todas.' },
        ordenar_por: { type: 'string' },
        descendente: { type: 'boolean' },
        limite: { type: 'integer', description: `Linhas a devolver (máx. ${MAX_LINHAS}). 0 = só contagem/somas.` },
        somar: { type: 'array', items: { type: 'string' }, description: 'Colunas numéricas a somar sobre todas as linhas encontradas.' },
        agrupar_por: { type: 'string', description: 'Coluna para agrupar as somas, ou "mes" para agrupar por mês da data principal.' },
      },
      required: ['tabela'],
      additionalProperties: false,
    },
  },
  {
    name: 'resultados',
    description: 'Faturado, despesas e lucro com as regras da app (as mesmas da página Resultados). Com mes devolve o detalhe desse mês; sem mes devolve o ano mês a mês, os totais dos meses completos e os meses com prejuízo.',
    input_schema: {
      type: 'object',
      properties: {
        ano: { type: 'integer' },
        mes: { type: 'integer', description: '1 a 12 (opcional).' },
      },
      required: ['ano'],
      additionalProperties: false,
    },
  },
]

// ---------- Validação ----------

export function validarConsulta(input) {
  const def = TABELAS[input?.tabela]
  if (!def) return { error: `Tabela desconhecida: ${input?.tabela}` }
  const ok = c => def.colunas.includes(c)
  const filtros = Array.isArray(input.filtros) ? input.filtros : []
  for (const f of filtros) {
    if (!ok(f?.coluna)) return { error: `Coluna desconhecida em ${input.tabela}: ${f?.coluna}` }
    if (!OPS.includes(f.op)) return { error: `Operador desconhecido: ${f.op}` }
    if (!['vazio', 'preenchido'].includes(f.op) && (f.valor === undefined || f.valor === null || f.valor === '')) return { error: `Falta o valor do filtro em ${f.coluna}.` }
  }
  const colunas = Array.isArray(input.colunas) && input.colunas.length ? input.colunas : def.colunas
  const bad = [...colunas, ...(input.somar || []), input.ordenar_por].filter(c => c && !ok(c))
  if (bad.length) return { error: `Colunas desconhecidas em ${input.tabela}: ${bad.join(', ')}` }
  const agrupar = input.agrupar_por || null
  if (agrupar && agrupar !== 'mes' && !ok(agrupar)) return { error: `Não é possível agrupar por ${agrupar}.` }
  if (agrupar === 'mes' && !def.data) return { error: `A tabela ${input.tabela} não tem data para agrupar por mês.` }
  const limite = Math.max(0, Math.min(MAX_LINHAS, Number.isInteger(input.limite) ? input.limite : 30))
  return {
    value: {
      def, filtros, colunas, limite,
      somar: input.somar || [],
      agrupar,
      ordenar: input.ordenar_por || def.data || 'id',
      descendente: input.descendente ?? Boolean(!input.ordenar_por && def.data),
    },
  }
}

// O valor de "contem" vai para um ilike: os caracteres especiais do padrão ficam literais.
const likeEscape = s => String(s).replace(/[\\%_]/g, m => `\\${m}`)

function aplicarFiltros(q, filtros) {
  for (const f of filtros) {
    if (f.op === 'contem') q = q.ilike(f.coluna, `%${likeEscape(f.valor)}%`)
    else if (f.op === 'vazio') q = q.is(f.coluna, null)
    else if (f.op === 'preenchido') q = q.not(f.coluna, 'is', null)
    else q = q[f.op](f.coluna, f.valor)
  }
  return q
}

// ---------- Execução ----------

// Acrescenta o nome da categoria e do imóvel ao lado dos ids.
function comNomes(rows, nomes) {
  return rows.map(r => {
    const out = { ...r }
    if ('categoria_id' in r) out.categoria = nomes.categorias.get(r.categoria_id) ?? null
    if ('imovel_id' in r) out.imovel = nomes.imoveis.get(r.imovel_id) ?? null
    return out
  })
}

async function lerNomes(supabase) {
  const [c, p] = await Promise.all([
    supabase.from('categories').select('id, nome'),
    supabase.from('properties').select('id, nome'),
  ])
  return {
    categorias: new Map((c.data || []).map(x => [x.id, x.nome])),
    imoveis: new Map((p.data || []).map(x => [x.id, x.nome])),
  }
}

async function lerTudo(build) {
  const rows = []
  for (let from = 0; from < MAX_LINHAS_SOMA; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1)
    if (error) throw error
    rows.push(...data)
    if (data.length < PAGE) return { rows, cortado: false }
  }
  return { rows, cortado: true }
}

export async function consultar(supabase, input, nomes) {
  const { value: v, error } = validarConsulta(input)
  if (error) return { erro: error }
  const res = {}
  const base = (sel, opts) => aplicarFiltros(supabase.from(v.def.tabela).select(sel, opts), v.filtros)

  const lista = await base(v.colunas.join(', '), { count: 'exact' })
    .order(v.ordenar, { ascending: !v.descendente }).order('id', { ascending: true })
    .range(0, Math.max(0, v.limite - 1))
  if (lista.error) return { erro: lista.error.message }
  res.total_linhas = lista.count ?? lista.data.length
  if (v.limite > 0) {
    res.linhas = comNomes(lista.data, nomes || await lerNomes(supabase))
    if (res.total_linhas > res.linhas.length) res.nota = `Mostradas ${res.linhas.length} de ${res.total_linhas} linhas.`
  }

  if (v.somar.length || v.agrupar) {
    const grupoCol = v.agrupar === 'mes' ? v.def.data : v.agrupar
    const cols = [...new Set(['id', ...v.somar, ...(grupoCol ? [grupoCol] : [])])]
    let todas
    try {
      todas = await lerTudo(() => base(cols.join(', ')).order('id', { ascending: true }))
    } catch (e) { return { erro: e.message } }
    const somas = list => Object.fromEntries(v.somar.map(c => [c, sumBy(list, r => r[c])]))
    res.somas = somas(todas.rows)
    if (todas.cortado) res.aviso = `Somas feitas só sobre as primeiras ${MAX_LINHAS_SOMA} linhas.`
    if (grupoCol) {
      const nm = nomes || await lerNomes(supabase)
      const chave = r => {
        if (v.agrupar === 'mes') return monthOf(r[grupoCol]) || 'sem data'
        if (grupoCol === 'categoria_id') return nm.categorias.get(r.categoria_id) ?? 'Sem categoria'
        if (grupoCol === 'imovel_id') return nm.imoveis.get(r.imovel_id) ?? 'Sem imóvel'
        return r[grupoCol] ?? '(vazio)'
      }
      const g = new Map()
      for (const r of todas.rows) {
        const k = String(chave(r))
        if (!g.has(k)) g.set(k, [])
        g.get(k).push(r)
      }
      res.grupos = [...g].map(([k, list]) => ({ grupo: k, linhas: list.length, ...somas(list) }))
        .sort((a, b) => (v.agrupar === 'mes' ? a.grupo.localeCompare(b.grupo) : (b[v.somar[0]] ?? b.linhas) - (a[v.somar[0]] ?? a.linhas)))
        .slice(0, 60)
    }
  }
  return res
}

// Faturado, despesas e lucro do ano (ou de um mês) com as funções de src/lib/finance.js.
export async function resultados(supabase, input) {
  const ano = Number(input?.ano)
  const mes = input?.mes == null ? null : Number(input.mes)
  if (!Number.isInteger(ano) || ano < 2000 || ano > 2100) return { erro: 'Ano inválido.' }
  if (mes != null && !(Number.isInteger(mes) && mes >= 1 && mes <= 12)) return { erro: 'Mês inválido.' }
  const de = `${ano}-01-01`, ate = `${ano + 1}-01-01`
  const range = (t, col, sel = '*', optional = false) =>
    lerTudo(() => supabase.from(t).select(sel).gte(col, de).lt(col, ate).order('id', { ascending: true }))
      .then(r => r.rows).catch(e => { if (optional) return []; throw e })
  let closes, credits, bank, invoices, cats, props, encargos
  try {
    ;[closes, credits, bank, invoices, cats, props, encargos] = await Promise.all([
      range('cash_closes', 'data', 'id, data, dinheiro, cv, mb, city_mb'),
      range('bank_credits', 'data_mov', 'id, data_mov, valor, tipo, conta_como_entrada', true),
      range('bank_transactions', 'data_mov'),
      range('invoices', 'data'),
      supabase.from('categories').select('*').then(r => r.data || []),
      supabase.from('properties').select('*').then(r => r.data || []),
      supabase.from('encargos_pessoal').select('mes, tsu, irs').then(r => r.data || []),
    ])
  } catch (e) { return { erro: e.message } }
  const catsById = new Map(cats.map(c => [c.id, c]))
  const propsById = new Map(props.map(p => [p.id, p.nome]))
  const expenseRows = accountingRows(bank.map(t => bankToRow(t, catsById, propsById)), invoices.map(i => invoiceToRow(i, catsById, propsById)))
  const data = { closes, credits, expenseRows, encargos }
  if (mes) {
    const r = monthResult(`${ano}-${String(mes).padStart(2, '0')}`, data)
    return { ...r, nota: r.completo ? undefined : 'Mês incompleto: falta a caixa diária ou o extrato de saídas, o lucro não é fiável.' }
  }
  const y = yearResults(ano, data)
  return {
    ano,
    meses: y.comDados.map(m => ({ mes: m.month, faturado: m.faturado, despesas: m.despesas, resultado: m.resultado, salarios: m.salarios, completo: m.completo })),
    totais_meses_completos: { faturado: y.faturado, despesas: y.despesas, resultado: y.resultado, salarios: y.salarios, pessoal: y.pessoal, meses: y.completos.map(m => m.month) },
    meses_com_prejuizo: y.mesesComPrejuizo,
    meses_incompletos: y.incompletos.map(m => m.month),
  }
}

export async function correrFerramenta(supabase, name, input, cache = {}) {
  try {
    if (name === 'consultar') {
      cache.nomes ??= await lerNomes(supabase)
      return await consultar(supabase, input, cache.nomes)
    }
    if (name === 'resultados') return await resultados(supabase, input)
    return { erro: `Ferramenta desconhecida: ${name}` }
  } catch (e) {
    return { erro: e?.message || 'Falhou a consulta.' }
  }
}

// ---------- Histórico da conversa ----------

export const MAX_HISTORICO = 12
export const MAX_TEXTO = 4000

// Aceita só texto simples de utilizador/assistente; a última mensagem tem de ser a pergunta.
export function validarHistorico(mensagens) {
  if (!Array.isArray(mensagens) || !mensagens.length) return { error: 'Escreve uma pergunta.' }
  const lista = mensagens.slice(-MAX_HISTORICO)
  while (lista.length && lista[0].role !== 'user') lista.shift()
  const out = []
  for (const m of lista) {
    if (!['user', 'assistant'].includes(m?.role) || typeof m.content !== 'string' || !m.content.trim()) return { error: 'Pedido inválido.' }
    out.push({ role: m.role, content: m.content.slice(0, MAX_TEXTO) })
  }
  if (!out.length || out[out.length - 1].role !== 'user') return { error: 'Escreve uma pergunta.' }
  return { value: out }
}
