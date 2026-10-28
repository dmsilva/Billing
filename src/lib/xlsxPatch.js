// Altera valores de células num .xlsx diretamente no XML, mantendo tudo o resto do ficheiro
// (estilos, células unidas, tabelas, formatação condicional) exatamente como estava.
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'

export function colLetra(n) {
  let s = ''
  for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}

const colNum = letras => [...letras].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0)
const escapar = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function caminhoDaFolha(files, nome) {
  const wb = strFromU8(files['xl/workbook.xml'])
  const rels = strFromU8(files['xl/_rels/workbook.xml.rels'])
  const sheet = [...wb.matchAll(/<sheet\b[^>]*>/g)].map(m => m[0]).find(t => t.includes(`name="${escapar(nome)}"`))
  const rid = sheet?.match(/r:id="([^"]+)"/)?.[1]
  const rel = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map(m => m[0]).find(t => t.includes(`Id="${rid}"`))
  const alvo = rel?.match(/Target="([^"]+)"/)?.[1]
  if (!alvo) throw new Error(`Folha "${nome}" não encontrada no ficheiro.`)
  return alvo.startsWith('/') ? alvo.slice(1) : `xl/${alvo}`
}

function novaCelula(ref, estilo, valor) {
  const s = estilo ? ` s="${estilo}"` : ''
  if (valor === null || valor === undefined || valor === '') return `<c r="${ref}"${s}/>`
  if (typeof valor === 'number') return `<c r="${ref}"${s}><v>${valor}</v></c>`
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${escapar(valor)}</t></is></c>`
}

function alterarLinha(linhaXml, linha, coluna, valor) {
  const ref = `${colLetra(coluna)}${linha}`
  const re = new RegExp(`<c r="${ref}"(?:\\s[^>]*)?(?:/>|>[\\s\\S]*?</c>)`)
  const atual = linhaXml.match(re)
  if (atual) return linhaXml.replace(re, novaCelula(ref, atual[0].match(/\bs="(\d+)"/)?.[1], valor))
  // Célula nova: inserir por ordem de coluna.
  const cels = [...linhaXml.matchAll(/<c r="([A-Z]+)\d+"/g)]
  const depois = cels.find(m => colNum(m[1]) > coluna)
  const nova = novaCelula(ref, null, valor)
  if (depois) return linhaXml.slice(0, depois.index) + nova + linhaXml.slice(depois.index)
  return linhaXml.endsWith('/>') ? linhaXml.replace(/\/>$/, `>${nova}</row>`) : linhaXml.replace(/<\/row>$/, `${nova}</row>`)
}

export function alterarCelulas(buffer, nomeFolha, alteracoes) {
  const files = unzipSync(new Uint8Array(buffer))
  const caminho = caminhoDaFolha(files, nomeFolha)
  let xml = strFromU8(files[caminho])
  for (const { linha, coluna, valor } of alteracoes) {
    const reLinha = new RegExp(`<row r="${linha}"(?:\\s[^>]*)?(?:/>|>[\\s\\S]*?</row>)`)
    const atual = xml.match(reLinha)
    if (atual) { xml = xml.replace(reLinha, alterarLinha(atual[0], linha, coluna, valor)); continue }
    // Linha nova: inserir por ordem.
    const nova = `<row r="${linha}">${novaCelula(`${colLetra(coluna)}${linha}`, null, valor)}</row>`
    const seguinte = [...xml.matchAll(/<row r="(\d+)"/g)].find(m => Number(m[1]) > linha)
    xml = seguinte ? xml.slice(0, seguinte.index) + nova + xml.slice(seguinte.index) : xml.replace('</sheetData>', `${nova}</sheetData>`).replace('<sheetData/>', `<sheetData>${nova}</sheetData>`)
  }
  files[caminho] = strToU8(xml)
  return zipSync(files)
}
