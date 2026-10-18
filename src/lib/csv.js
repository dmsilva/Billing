// Exportação CSV compatível com o Excel português (separador ";" e BOM UTF-8).
export function toCsv(header, rows) {
  const cell = v => `"${String(v ?? '').replaceAll('"', '""')}"`
  return '﻿' + [header, ...rows].map(r => r.map(cell).join(';')).join('\n')
}

export const decimalPt = v => (v === null || v === undefined || v === '' ? '' : Number(v).toFixed(2).replace('.', ','))

export function downloadText(text, name, type = 'text/csv;charset=utf-8') {
  const blob = new Blob([text], { type })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
