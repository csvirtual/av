// Cache básico para permitir instalar como app e abrir mesmo sem internet.
const CACHE_NAME = 'win11-web-v36';
const ASSETS = [
  './',
  './index.html',
  './main.js',
  './manifest.json',
  './styles/tokens.css',
  './styles/base.css',
  './styles/motion.css',
  './styles/screens.css',
  './styles/components.css',
  './styles/windows.css',
  './styles/apps.css',
  './core/state/database.js',
  './core/state/kv-store.js',
  './core/icons.js',
  './core/state/filesystem.js',
  './core/services/auth.js',
  './core/services/crypto.js',
  './core/services/accounts.js',
  './core/services/sounds.js',
  './core/window-manager/window-manager.js',
  './core/window-manager/snap-zones.js',
  './core/window-manager/task-switcher.js',
  './core/motion/motion.js',
  './apps/explorer.js',
  './apps/notepad.js',
  './apps/photos.js',
  './apps/word.js',
  './apps/sheet.js',
  './apps/video-player.js',
  './apps/audio-player.js',
  './apps/presentation.js',
  './apps/settings.js',
  './apps/browser.js',
  './apps/calculator.js',
  './apps/clock.js',
  './apps/terminal.js',
  './apps/task-manager.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  // Só participa (cache-first / atualiza em segundo plano) de pedidos do
  // nosso próprio domínio. Hoje o app não faz fetch cross-origin nenhum
  // (o proxy do Navegador é same-origin, os vendor libs são
  // self-hosted) — mas sem essa checagem, se algum dia um fetch
  // cross-origin aparecesse, uma resposta comprometida de outro domínio
  // ficaria guardada neste cache e seria reservida depois pra qualquer
  // outra página do app (cache poisoning). Pedidos cross-origin passam
  // direto pra rede, sem passar pelo cache.
  if (new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetchPromise = fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
