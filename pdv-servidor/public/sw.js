// Service worker do PWA — cuida SÓ do "casco" do app (HTML/CSS/JS/ícones),
// nunca de dados. Isto é um sistema multi-terminal com estado ao vivo
// (WebSocket, estoque/caixa compartilhados entre terminais) — um cache
// desatualizado aqui poderia mostrar número errado ou rodar código velho
// contra um contrato de API que já mudou depois de um deploy. Por isso:
//
// - Nunca intercepta nada sob /api/ (dados ao vivo, sempre direto à rede
//   — ver a checagem logo no início do listener de 'fetch').
// - O casco em si usa network-first (não cache-first): tenta a rede de
//   verdade primeiro, sempre que possível — assim, qualquer deploy novo
//   já é servido na próxima vez que o terminal estiver online, nunca
//   mascarado por um cache antigo. Só cai pro cache guardado quando a
//   rede falha de vez (offline de verdade, ou uma instabilidade rápida da
//   rede local) — o suficiente pra funcionar como app instalável sem
//   virar um risco de servir código desatualizado.
const CACHE_NAME = 'pdv-shell-v1';
const SHELL_URLS = ['/', '/manifest.json'];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_URLS).catch(() => {}))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached || caches.match('/')))
  );
});
