import { describe, expect, it } from 'vitest'
import { deBase64, paraBase64 } from '../src/lib/ficheiros.js'

describe('ficheiros do histórico', () => {
  it('guarda e recupera ficheiros binários em base64', () => {
    const bytes = new Uint8Array(100000).map((_, i) => (i * 7) % 256)
    expect(deBase64(paraBase64(bytes))).toEqual(bytes)
    expect(paraBase64(new TextEncoder().encode('%PDF-').buffer)).toBe('JVBERi0=')
  })
})
