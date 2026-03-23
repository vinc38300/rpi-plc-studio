// sw.js — Service Worker RPi-PLC SCADA
// Cache les ressources statiques pour fonctionner hors-ligne

const CACHE  = 'rpi-plc-v1';
const STATIC = [
  '/scada',
  'https://cdnjs.cloudflare.com/ajax/libs/socket.io/4.6.1/socket.io.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js',
];

// Installation : mise en cache des ressources statiques
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => {
      // Ne pas bloquer l'install si une ressource échoue
      return Promise.allSettled(STATIC.map(url => c.add(url).catch(() => {})));
    })
  );
  self.skipWaiting();
});

// Activation : nettoyage des anciens caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch : stratégie réseau d'abord, cache en fallback
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Les appels API passent toujours par le réseau (pas de cache API)
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(
      fetch(e.request).catch(() =>
        new Response(JSON.stringify({ error: 'hors-ligne', ok: false }),
          { headers: { 'Content-Type': 'application/json' } })
      )
    );
    return;
  }

  // WebSocket : laisser passer
  if (e.request.headers.get('upgrade') === 'websocket') return;

  // Ressources statiques : réseau d'abord, puis cache
  e.respondWith(
    fetch(e.request)
      .then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(e.request).then(r =>
        r || new Response('<h1>Hors-ligne</h1><p>RPi-PLC non disponible.</p>',
          { headers: { 'Content-Type': 'text/html' } })
      ))
  );
});
