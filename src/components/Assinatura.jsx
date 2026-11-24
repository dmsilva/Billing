import { useEffect, useRef, useState } from 'react'

// Converte uma imagem (ficheiro) ou um desenho num PNG pequeno com fundo transparente: { src, ratio }.
// Os píxeis quase brancos passam a transparentes (para uma foto de uma assinatura em papel).
function paraPng(fonte, w, h) {
  const escala = Math.min(1, 600 / w)
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w * escala)); c.height = Math.max(1, Math.round(h * escala))
  const ctx = c.getContext('2d')
  ctx.drawImage(fonte, 0, 0, c.width, c.height)
  const img = ctx.getImageData(0, 0, c.width, c.height)
  const d = img.data
  let minX = c.width, minY = c.height, maxX = -1, maxY = -1
  for (let i = 0; i < d.length; i += 4) {
    const claro = d[i] > 200 && d[i + 1] > 200 && d[i + 2] > 200
    if (claro) d[i + 3] = 0
    if (d[i + 3] > 30) {
      const p = i / 4, x = p % c.width, y = Math.floor(p / c.width)
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y
    }
  }
  if (maxX < 0) return null
  ctx.putImageData(img, 0, 0)
  // Corta as margens vazias.
  const m = 4
  const x0 = Math.max(0, minX - m), y0 = Math.max(0, minY - m)
  const cw = Math.min(c.width, maxX + m) - x0, ch = Math.min(c.height, maxY + m) - y0
  const out = document.createElement('canvas')
  out.width = cw; out.height = ch
  out.getContext('2d').drawImage(c, x0, y0, cw, ch, 0, 0, cw, ch)
  return { src: out.toDataURL('image/png'), ratio: cw / ch }
}

export function lerImagemAssinatura(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => { URL.revokeObjectURL(url); const r = paraPng(img, img.naturalWidth, img.naturalHeight); r ? resolve(r) : reject(new Error('A imagem parece vazia.')) }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Não consegui abrir essa imagem (usa PNG ou JPG).')) }
    img.src = url
  })
}

function Desenhar({ onFeito, onCancelar }) {
  const ref = useRef(null)
  const [vazio, setVazio] = useState(true)
  useEffect(() => {
    const c = ref.current
    const ctx = c.getContext('2d')
    ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#1b2a6b'
    let a = null
    const pos = e => { const r = c.getBoundingClientRect(); return [(e.clientX - r.left) * (c.width / r.width), (e.clientY - r.top) * (c.height / r.height)] }
    const down = e => { a = pos(e); c.setPointerCapture(e.pointerId) }
    const move = e => { if (!a) return; const b = pos(e); ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.stroke(); a = b; setVazio(false) }
    const up = () => { a = null }
    c.addEventListener('pointerdown', down); c.addEventListener('pointermove', move); c.addEventListener('pointerup', up); c.addEventListener('pointerleave', up)
    return () => { c.removeEventListener('pointerdown', down); c.removeEventListener('pointermove', move); c.removeEventListener('pointerup', up); c.removeEventListener('pointerleave', up) }
  }, [])
  const limpar = () => { const c = ref.current; c.getContext('2d').clearRect(0, 0, c.width, c.height); setVazio(true) }
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <canvas ref={ref} width={600} height={200} style={{ width: '100%', maxWidth: 420, height: 140, background: '#fff', border: '1px dashed #999', borderRadius: 6, touchAction: 'none', cursor: 'crosshair' }} />
      <div className="actions">
        <button className="primary small" disabled={vazio} onClick={() => onFeito(paraPng(ref.current, ref.current.width, ref.current.height))}>Guardar assinatura</button>
        <button className="secondary small" onClick={limpar}>Limpar</button>
        <button className="link-btn small" onClick={onCancelar}>Cancelar</button>
      </div>
    </div>
  )
}

// Assinatura de uma pessoa: enviar imagem ou desenhar com o rato/trackpad/dedo.
export function AssinaturaEditor({ valor, onChange, onErro }) {
  const [desenhar, setDesenhar] = useState(false)
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <div className="actions" style={{ alignItems: 'center' }}>
        <span>Assinatura</span>
        {valor?.src ? <img src={valor.src} alt="Assinatura" style={{ height: 40, maxWidth: 180, background: '#fff', border: '1px solid #ddd', borderRadius: 4, padding: 2 }} /> : <span className="muted small">sem assinatura</span>}
        <label className="file-button small"><input type="file" accept="image/png,image/jpeg,image/webp" onChange={async e => {
          const f = e.target.files[0]; e.target.value = ''
          if (!f) return
          try { onChange(await lerImagemAssinatura(f)) } catch (err) { onErro(err.message) }
        }} />Enviar imagem</label>
        <button className="secondary small" onClick={() => setDesenhar(true)}>Desenhar</button>
        {valor?.src && <button className="link-btn small" onClick={() => onChange(null)}>Tirar</button>}
      </div>
      {desenhar && <Desenhar onFeito={a => { if (a) onChange(a); setDesenhar(false) }} onCancelar={() => setDesenhar(false)} />}
    </div>
  )
}
