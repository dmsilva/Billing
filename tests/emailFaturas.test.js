import { describe, expect, it } from 'vitest'
import { base64ToBytes, buildAppsScript, gmailQuery, rowToFile, senderName } from '../src/lib/emailFaturas.js'

describe('faturas do email', () => {
  it('nome do remetente', () => {
    expect(senderName('CUR Gás Natural <no-reply@fe.curgasnatural.pt>')).toBe('CUR Gás Natural')
    expect(senderName('"apoio.endesa" <apoio.endesa@endesa.pt>')).toBe('apoio.endesa')
    expect(senderName('bruno@carris.pt')).toBe('bruno@carris.pt')
    expect(senderName(null)).toBe('')
  })

  it('base64 volta a ser o ficheiro original', () => {
    expect([...base64ToBytes('JVBERi0=')]).toEqual([37, 80, 68, 70, 45])
  })

  it('a linha da fila vira um ficheiro ligado à fila', async () => {
    const f = rowToFile({ id: 7, nome_ficheiro: 'FT1.pdf', mime: 'application/pdf', conteudo_b64: 'JVBERi0=', remetente: 'CUR <a@b.pt>', assunto: 'Fatura' })
    expect(f.name).toBe('FT1.pdf')
    expect(f.type).toBe('application/pdf')
    expect(f.size).toBe(5)
    expect(f.emailFatura).toEqual({ id: 7, remetente: 'CUR', assunto: 'Fatura' })
  })

  it('pesquisa no Gmail exclui o que já foi enviado', () => {
    const q = gmailQuery(30)
    expect(q).toContain('has:attachment')
    expect(q).toContain('-label:"Fatura Chalet"')
    expect(q).toContain('newer_than:30d')
    expect(q).toMatch(/fatura/)
  })

  it('o programa do Gmail leva o endereço e as chaves e é JavaScript válido', () => {
    const code = buildAppsScript({ supabaseUrl: 'https://abc.supabase.co/', anonKey: 'pub', chave: 'segredo"x' })
    expect(code).toContain('"https://abc.supabase.co"')
    expect(code).toContain('"segredo\\"x"')
    expect(code).toContain('/rest/v1/rpc/receber_fatura_email')
    // eslint-disable-next-line no-new-func
    expect(() => new Function(code)).not.toThrow()
  })
})
