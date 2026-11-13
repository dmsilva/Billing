import { PDFDocument } from 'pdf-lib'
import { zipPlan } from './zipFaturas.js'

// Todas as faturas escolhidas num só PDF, por ordem de data: os PDF entram com as suas páginas
// e cada foto passa a uma página A4. Fotos que o pdf-lib não lê (WEBP, HEIC) são convertidas
// para JPG pelo navegador (toJpeg); se não der, ficam de fora e são indicadas no fim.

const A4 = [595.28, 841.89]
const MARGIN = 24

export function kindOf(bytes, mime) {
  const b = bytes
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'pdf'
  if (b[0] === 0xff && b[1] === 0xd8) return 'jpg'
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png'
  if (mime === 'application/pdf') return 'pdf'
  return 'other'
}

async function toBytes(data) {
  if (data instanceof Uint8Array) return data
  return new Uint8Array(data instanceof ArrayBuffer ? data : await data.arrayBuffer())
}

async function addImage(out, bytes, kind) {
  const img = kind === 'png' ? await out.embedPng(bytes) : await out.embedJpg(bytes)
  const landscape = img.width > img.height
  const [w, h] = landscape ? [A4[1], A4[0]] : A4
  const scale = Math.min((w - 2 * MARGIN) / img.width, (h - 2 * MARGIN) / img.height, 1)
  const page = out.addPage([w, h])
  const dw = img.width * scale
  const dh = img.height * scale
  page.drawImage(img, { x: (w - dw) / 2, y: (h - dh) / 2, width: dw, height: dh })
}

// download(path) -> bytes/Blob; toJpeg(bytes, mime) -> bytes JPG (opcional, só no navegador).
export async function buildMergedPdf(rows, download, { onProgress, toJpeg } = {}) {
  const { entries, withoutFiles } = zipPlan(rows)
  const out = await PDFDocument.create()
  out.setTitle('Faturas')
  const failed = []
  let count = 0
  let done = 0
  for (const e of entries) {
    try {
      let bytes = await toBytes(await download(e.path))
      let kind = kindOf(bytes, e.mime)
      if (kind === 'other' && toJpeg) { bytes = await toBytes(await toJpeg(bytes, e.mime)); kind = kindOf(bytes) }
      if (kind === 'pdf') {
        const src = await PDFDocument.load(bytes, { ignoreEncryption: true })
        const pages = await out.copyPages(src, src.getPageIndices())
        pages.forEach(p => out.addPage(p))
      } else if (kind === 'jpg' || kind === 'png') {
        await addImage(out, bytes, kind)
      } else {
        throw new Error('formato não suportado')
      }
      count++
    } catch {
      failed.push(e)
    }
    onProgress?.(++done, entries.length)
  }
  return { pdf: count ? await out.save() : null, count, failed, withoutFiles }
}

// Conversão no navegador (WEBP/HEIC → JPG) através de um canvas.
export async function browserToJpeg(bytes, mime) {
  const bitmap = await createImageBitmap(new Blob([bytes], { type: mime || 'image/*' }))
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  canvas.getContext('2d').drawImage(bitmap, 0, 0)
  const blob = await new Promise((res, rej) => canvas.toBlob(b => (b ? res(b) : rej(new Error('conversão falhou'))), 'image/jpeg', 0.9))
  return new Uint8Array(await blob.arrayBuffer())
}
