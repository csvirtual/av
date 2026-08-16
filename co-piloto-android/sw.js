// Co-piloto Android — service worker mínimo, só pra instalabilidade
// (Chrome exige um SW com handler de fetch pra oferecer "Adicionar à tela
// inicial") e pra funcionar offline depois da primeira visita.
//
// De propósito NÃO é o background.js da extensão — não faz nada de
// lógica de negócio, não mexe em chrome.storage, não sabe nada sobre
// perfis/leads/IA. É só cache do "casco" do app (o próprio HTML, que já
// tem CSS/JS embutidos) pra abrir rápido e funcionar sem internet depois
// da primeira vez.
//
// Se build.js algum dia passar a versionar isso automaticamente, o nome
// do cache deve mudar a cada versão publicada (senão um deploy novo nunca
// substitui os arquivos already-cacheados em quem já instalou).
const CACHE_NAME = 'copiloto-android-v1';
const ARQUIVOS_PARA_CACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ARQUIVOS_PARA_CACHE))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((chaves) => Promise.all(
      chaves.filter((c) => c !== CACHE_NAME).map((c) => caches.delete(c))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Só GET, só da mesma origem — nunca intercepta as chamadas de IA
  // (Gemini/Claude, outra origem, sempre precisam ir pra rede de verdade,
  // nunca devem ser "respondidas" do cache) nem POST/PUT/etc.
  if(event.request.method !== 'GET') return;
  let url;
  try{ url = new URL(event.request.url); }catch(e){ return; }
  if(url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((doCache) => {
      if(doCache) return doCache;
      return fetch(event.request).then((daRede) => {
        const copia = daRede.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copia));
        return daRede;
      }).catch(() => caches.match('./index.html'));
    })
  );
});
