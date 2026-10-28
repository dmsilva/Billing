// Converte o texto das respostas do assistente (markdown simples) em blocos para mostrar no ecrã:
// parágrafos, listas, tabelas e, dentro do texto, **negrito** e ligações internas [texto](/caminho).
// Não interpreta HTML: tudo é mostrado como texto.

const isRow = l => /^\s*\|.*\|\s*$/.test(l)
const isSep = l => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l)
const cells = l => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim())
const bullet = l => l.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/)

export function parseBlocks(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n')
  const blocks = []
  let i = 0
  while (i < lines.length) {
    const l = lines[i]
    if (!l.trim()) { i++; continue }
    if (isRow(l) && isSep(lines[i + 1] || '')) {
      const head = cells(l)
      const rows = []
      i += 2
      while (i < lines.length && isRow(lines[i])) rows.push(cells(lines[i++]))
      blocks.push({ type: 'table', head, rows })
      continue
    }
    const h = l.match(/^\s*#{1,6}\s+(.*)$/)
    if (h) { blocks.push({ type: 'heading', text: h[1] }); i++; continue }
    if (bullet(l)) {
      const items = []
      while (i < lines.length && bullet(lines[i])) items.push(bullet(lines[i++])[1])
      blocks.push({ type: 'list', items })
      continue
    }
    const para = []
    while (i < lines.length && lines[i].trim() && !bullet(lines[i]) && !isRow(lines[i]) && !/^\s*#{1,6}\s/.test(lines[i])) para.push(lines[i++].trim())
    blocks.push({ type: 'paragraph', text: para.join('\n') })
  }
  return blocks
}

// Divide uma linha em pedaços: { text }, { bold }, { link, href }. Só ligações internas (começadas por /).
export function parseInline(text) {
  const out = []
  const re = /\*\*(.+?)\*\*|\[([^\]]+)\]\((\/[^)\s]*)\)/g
  let last = 0
  let m
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) })
    out.push(m[1] != null ? { bold: m[1] } : { link: m[2], href: m[3] })
    last = re.lastIndex
  }
  if (last < text.length) out.push({ text: text.slice(last) })
  return out
}
