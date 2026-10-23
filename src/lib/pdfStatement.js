// Leitura do extrato CGD em PDF. O texto de cada página chega como palavras com posição
// (x, y, largura); aqui reconstroem-se as linhas e as colunas e devolve-se a mesma tabela
// que um Excel/CSV daria, para seguir pelo mesmo parseBankStatement.
// Tudo corre no navegador: o extrato não é enviado para nenhum serviço.

const norm = v => String(v ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[.:]$/, '')

const AMOUNT = /^[-+]?\d{1,3}(?:[.\s ]\d{3})*,\d{2}-?$|^[-+]?\d+,\d{2}-?$|^[-+]?\d{1,3}(?:,\d{3})*\.\d{2}$/
const DATE = /^(\d{4}-\d{2}-\d{2}|\d{1,2}[-/.]\d{1,2}(?:[-/.]\d{2,4})?)$/
const FULL_DATE = /(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})|(\d{4})-(\d{2})-(\d{2})/g

const HEADER = {
  debito: ['debito', 'debitos', 'saida', 'saidas', 'levantamentos'],
  credito: ['credito', 'creditos', 'entrada', 'entradas', 'depositos'],
  montante: ['montante', 'valor', 'importancia'],
  saldo: ['saldo'],
  descricao: ['descricao', 'descritivo', 'movimento', 'designacao'],
}

// Divide cada pedaço de texto em palavras, com a posição aproximada de cada uma.
export function toWords(items) {
  const words = []
  for (const it of items) {
    const str = String(it.str || '')
    if (!str.trim()) continue
    const len = str.length || 1
    const re = /\S+/g
    let m
    while ((m = re.exec(str))) {
      const x = it.x + (it.w * m.index) / len
      words.push({ s: m[0], x, w: (it.w * m[0].length) / len, y: it.y })
    }
  }
  return words
}

// Agrupa palavras com a mesma altura na página (de cima para baixo, da esquerda para a direita).
export function toLines(words, tolerance = 2.5) {
  const sorted = [...words].sort((a, b) => b.y - a.y || a.x - b.x)
  const lines = []
  for (const w of sorted) {
    const line = lines.find(l => Math.abs(l.y - w.y) <= tolerance)
    if (line) line.words.push(w)
    else lines.push({ y: w.y, words: [w] })
  }
  for (const l of lines) l.words.sort((a, b) => a.x - b.x)
  return lines.sort((a, b) => b.y - a.y)
}

// Junta "1 830,55" (milhares separados por espaço) numa só palavra.
function joinAmounts(words) {
  const out = []
  for (const w of words) {
    const prev = out.at(-1)
    if (prev && /^\d{1,3}$/.test(prev.s) && /^\d{3}(?:[.\s]\d{3})*,\d{2}-?$/.test(w.s) && w.x - (prev.x + prev.w) < 6) {
      out[out.length - 1] = { ...prev, s: `${prev.s}${w.s}`, w: w.x + w.w - prev.x }
    } else out.push(w)
  }
  return out
}

const center = w => w.x + w.w / 2

function findHeader(line) {
  const cols = {}
  // Colunas de valores: a ocorrência mais à direita ("Data Valor" também tem a palavra "Valor").
  for (const w of line.words) {
    const n = norm(w.s)
    for (const [k, names] of Object.entries(HEADER)) {
      if (names.includes(n) && (cols[k] === undefined || k !== 'descricao')) cols[k] = { x: w.x, c: center(w), r: w.x + w.w }
    }
  }
  if (cols.montante && cols.descricao && cols.montante.x < cols.descricao.x) delete cols.montante
  const ok = cols.saldo && ((cols.debito && cols.credito) || cols.montante)
  return ok ? cols : null
}

// Ano do extrato, para datas que aparecem só como dia e mês (ex.: 03.10).
function statementYear(lines) {
  const found = []
  for (const l of lines) {
    const text = l.words.map(w => w.s).join(' ')
    for (const m of text.matchAll(FULL_DATE)) found.push(m[3] ? `${m[3]}-${m[2].padStart(2, '0')}` : `${m[4]}-${m[5]}`)
  }
  return found.sort().at(-1) || null
}

function isoDate(s, latest) {
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})(?:[-/.](\d{2,4}))?$/)
  if (!m) return null
  const d = m[1].padStart(2, '0')
  const mo = m[2].padStart(2, '0')
  if (Number(mo) < 1 || Number(mo) > 12 || Number(d) < 1 || Number(d) > 31) return null
  let y = m[3]
  if (y && y.length === 2) y = `20${y}`
  if (!y) {
    if (!latest) return null
    const [ly, lm] = latest.split('-').map(Number)
    y = String(Number(mo) > lm ? ly - 1 : ly)
  }
  return `${y}-${mo}-${d}`
}

// Valor "45,02-" (sinal no fim, comum nos extratos) passa a "-45,02".
const moneyText = s => (s.endsWith('-') ? `-${s.slice(0, -1)}` : s)

// pages: [[{ str, x, y, w }]] → tabela com cabeçalho igual ao do Excel do Caixadirecta.
export function statementMatrix(pages) {
  const pageLines = pages.map(items => toLines(toWords(items)).map(l => ({ ...l, words: joinAmounts(l.words) })))
  const latest = statementYear(pageLines.flat())
  let cols = null
  const rows = []
  let last = null
  for (const lines of pageLines) {
    for (const line of lines) {
      const h = findHeader(line)
      if (h) { cols = h; last = null; continue }
      if (!cols) continue
      const words = line.words
      const dates = []
      let i = 0
      // Data em falta aparece como "-" (a CGD deixa a data de movimento assim no PDF).
      while (i < words.length && i < 2 && /^[-–]$/.test(words[i].s)) i++
      while (i < words.length && dates.length < 2 && DATE.test(words[i].s) && isoDate(words[i].s, latest)) dates.push(isoDate(words[i++].s, latest))
      const rest = words.slice(i)
      const amounts = rest.filter(w => AMOUNT.test(w.s) && w.x > (cols.descricao?.x ?? 0) + 40)
      const text = rest.filter(w => !amounts.includes(w)).map(w => w.s).join(' ').trim()
      if (dates.length && amounts.length) {
        const row = { data_mov: dates[0], data_valor: dates[1] || dates[0], descricao: text, debito: '', credito: '', montante: '', saldo: '' }
        for (const a of amounts) {
          const options = ['debito', 'credito', 'montante', 'saldo'].filter(k => cols[k])
          const key = options.sort((p, q) => Math.abs(cols[p].r - (a.x + a.w)) - Math.abs(cols[q].r - (a.x + a.w)))[0]
          row[key] = moneyText(a.s)
        }
        if (row.debito || row.credito || row.montante) {
          rows.push(row)
          last = { row, y: line.y }
        } else last = null
      } else if (last && text && !amounts.length && last.y - line.y < 14 && (!cols.descricao || words[0].x >= cols.descricao.x - 8)) {
        // Descrição que continua na linha seguinte.
        last.row.descricao = `${last.row.descricao} ${text}`.trim()
        last.y = line.y
      } else {
        last = null
      }
    }
  }
  const useMontante = cols && cols.montante && !(cols.debito && cols.credito)
  const header = useMontante ? ['Data mov.', 'Data valor', 'Descrição', 'Montante', 'Saldo'] : ['Data mov.', 'Data valor', 'Descrição', 'Débito', 'Crédito', 'Saldo']
  return [header, ...rows.map(r => (useMontante
    ? [r.data_mov, r.data_valor, r.descricao, r.montante, r.saldo]
    : [r.data_mov, r.data_valor, r.descricao, r.debito, r.credito, r.saldo]))]
}

// Confirma a leitura pelos saldos: cada saldo deve ser o anterior − débito + crédito.
// Serve para extratos por ordem cronológica ou do mais recente para o mais antigo.
// Devolve { verificadas, erradas } (erradas = 0 quer dizer que a leitura bate certo).
export function checkBalances(matrix, parseMoney) {
  const [header, ...rows] = matrix
  const idx = name => header.indexOf(name)
  const moves = rows.map(r => {
    const saldo = parseMoney(r[idx('Saldo')])
    const delta = idx('Montante') >= 0 ? parseMoney(r[idx('Montante')]) || 0 : (parseMoney(r[idx('Crédito')]) || 0) - Math.abs(parseMoney(r[idx('Débito')]) || 0)
    return { saldo, delta: Math.round(delta * 100) }
  }).filter(m => m.saldo != null)
  const count = list => {
    let bad = 0
    for (let i = 1; i < list.length; i++) if (Math.round((list[i].saldo - list[i - 1].saldo) * 100) !== list[i].delta) bad++
    return bad
  }
  return { verificadas: Math.max(moves.length - 1, 0), erradas: Math.min(count(moves), count([...moves].reverse())) }
}
