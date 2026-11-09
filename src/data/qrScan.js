// Procura o código QR AT numa foto ou num PDF de fatura, no próprio navegador (não gasta créditos).
// Usa o leitor do navegador quando existe (Chrome, Edge) e o jsQR nos outros.
import { fileType } from '../lib/invoiceReading'
import { firstQrAT } from '../lib/qrAT'

const MAX_PDF_PAGES = 3

let jsQRPromise
const loadJsQR = () => (jsQRPromise ||= import('jsqr').then(m => m.default))

async function decodeCanvas(canvas) {
  if ('BarcodeDetector' in window) {
    try {
      const found = await new window.BarcodeDetector({ formats: ['qr_code'] }).detect(canvas)
      if (found.length) return found.map(c => c.rawValue)
    } catch { /* passa ao jsQR */ }
  }
  const jsQR = await loadJsQR()
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const hit = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })
  return hit?.data ? [hit.data] : []
}

function toCanvas(source, width, height, maxSide) {
  const scale = Math.min(1, maxSide / Math.max(width, height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(width * scale)
  canvas.height = Math.round(height * scale)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
  return canvas
}

async function scanImage(file) {
  const bmp = await createImageBitmap(file)
  try {
    // Primeiro reduzida (rápido); depois maior, para QR pequenos em fotos grandes.
    for (const side of [1600, 2800]) {
      const q = firstQrAT(await decodeCanvas(toCanvas(bmp, bmp.width, bmp.height, side)))
      if (q || Math.max(bmp.width, bmp.height) <= side) return q
    }
    return null
  } finally {
    bmp.close?.()
  }
}

async function scanPdf(file) {
  const pdfjs = await import('pdfjs-dist')
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false, verbosity: 0 })
  try {
    const doc = await task.promise
    // O QR costuma estar na primeira ou na última página.
    const pages = [...new Set([1, doc.numPages, 2].filter(p => p >= 1 && p <= doc.numPages))].slice(0, MAX_PDF_PAGES)
    for (const n of pages) {
      const page = await doc.getPage(n)
      const viewport = page.getViewport({ scale: 3 })
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(viewport.width)
      canvas.height = Math.round(viewport.height)
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvasContext: ctx, canvas, viewport }).promise
      const q = firstQrAT(await decodeCanvas(canvas))
      if (q) return q
    }
    return null
  } finally {
    await task.destroy()
  }
}

// Devolve os campos do QR AT (ver parseQrAT) ou null se não houver ou não for possível ler.
export async function scanInvoiceQr(file) {
  const type = fileType(file)
  try {
    if (type === 'application/pdf') return await scanPdf(file)
    if (type.startsWith('image/') && !/heic|heif/.test(type)) return await scanImage(file)
  } catch (err) {
    console.warn('QR da fatura: não foi possível ler', err)
  }
  return null
}
