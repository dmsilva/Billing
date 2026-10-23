// Carrega o pdf.js só quando é preciso ler um extrato em PDF (mantém a aplicação leve).
// Devolve, por página, os pedaços de texto com a posição: [{ str, x, y, w }].
export async function pdfTextItems(data, pdfjs) {
  if (!pdfjs) {
    pdfjs = await import('pdfjs-dist')
    const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  }
  const task = pdfjs.getDocument({ data: new Uint8Array(data), isEvalSupported: false, verbosity: 0 })
  const doc = await task.promise
  const pages = []
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    const content = await page.getTextContent()
    pages.push(content.items.filter(it => 'str' in it).map(it => ({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width })))
  }
  await task.destroy()
  return pages
}
