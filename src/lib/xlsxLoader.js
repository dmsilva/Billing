// Carrega o SheetJS só quando é preciso ler um Excel (mantém a aplicação leve).
export async function readWorkbook(file) {
  const XLSX = await import('xlsx')
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true })
  return wb.SheetNames.map(name => ({ name, matrix: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', raw: true }) }))
}
