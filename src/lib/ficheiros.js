// Descarregar ficheiros gerados no navegador e guardá-los em texto (base64) no histórico.
export function descarregar(conteudo, nome, type) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([conteudo], { type }))
  a.download = nome
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

export function paraBase64(dados) {
  const bytes = dados instanceof Uint8Array ? dados : new Uint8Array(dados)
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

export const deBase64 = b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0))

export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export const dataHora = iso => new Date(iso).toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
