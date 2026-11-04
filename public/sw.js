// Service worker da Fatura Chalet: permite instalar a app no telemóvel.
// Páginas: vai sempre primeiro à rede (dados e versões novas); sem rede, mostra a última versão guardada.
// Ficheiros com hash em /assets/ e ícones: guardados em cache (nunca mudam de conteúdo).
// Nunca guarda pedidos ao Supabase nem às funções do Netlify.
const CACHE = 'fatura-chalet-v1'

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k)
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', event => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin || url.pathname.startsWith('/.netlify/')) return

  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await fetch(req)
        if (res.ok) (await caches.open(CACHE)).put('/index.html', res.clone())
        return res
      } catch {
        return (await caches.match('/index.html')) || Response.error()
      }
    })())
    return
  }

  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
    event.respondWith((async () => {
      const hit = await caches.match(req)
      if (hit) return hit
      const res = await fetch(req)
      if (res.ok) (await caches.open(CACHE)).put(req, res.clone())
      return res
    })())
  }
})
