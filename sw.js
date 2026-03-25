// ============================================================
//  Poker Box Tracker — Service Worker  v2
//  • Caches the app shell for offline use
//  • Generates icon-192.png and icon-512.png dynamically
//    so the PWA install prompt fires even without static files
//  • Google Sheet syncs always go to network
// ============================================================

const CACHE_NAME = 'poker-box-v2';

// Core assets to pre-cache (icons are generated on demand, not listed here)
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=DM+Mono:wght@400;500&family=DM+Sans:wght@300;400;500&display=swap'
];

// ── Icon generator (OffscreenCanvas) ────────────────────────
async function makeIcon(size) {
  try {
    const c   = new OffscreenCanvas(size, size);
    const ctx = c.getContext('2d');
    const r   = size * 0.18; // corner radius

    // Rounded-rect background
    ctx.fillStyle = '#0a1a0f';
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.lineTo(size - r, 0);
    ctx.quadraticCurveTo(size, 0, size, r);
    ctx.lineTo(size, size - r);
    ctx.quadraticCurveTo(size, size, size - r, size);
    ctx.lineTo(r, size);
    ctx.quadraticCurveTo(0, size, 0, size - r);
    ctx.lineTo(0, r);
    ctx.quadraticCurveTo(0, 0, r, 0);
    ctx.closePath();
    ctx.fill();

    // Subtle felt texture overlay
    ctx.fillStyle = 'rgba(255,255,255,0.015)';
    for (let y = 0; y < size; y += 4) {
      ctx.fillRect(0, y, size, 2);
    }

    // Gold spade centred, slightly above middle
    ctx.fillStyle = '#c8a84b';
    ctx.font      = `bold ${Math.round(size * 0.54)}px serif`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('♠', size / 2, size * 0.46);

    // Thin gold border
    ctx.strokeStyle = 'rgba(200,168,75,0.35)';
    ctx.lineWidth   = Math.max(2, size * 0.025);
    ctx.beginPath();
    ctx.moveTo(r, 1);
    ctx.lineTo(size - r, 1);
    ctx.quadraticCurveTo(size - 1, 1, size - 1, r);
    ctx.lineTo(size - 1, size - r);
    ctx.quadraticCurveTo(size - 1, size - 1, size - r, size - 1);
    ctx.lineTo(r, size - 1);
    ctx.quadraticCurveTo(1, size - 1, 1, size - r);
    ctx.lineTo(1, r);
    ctx.quadraticCurveTo(1, 1, r, 1);
    ctx.closePath();
    ctx.stroke();

    const blob = await c.convertToBlob({ type: 'image/png' });
    return new Response(blob, {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=604800' // 1 week
      }
    });
  } catch (err) {
    // OffscreenCanvas not supported — return a minimal 1×1 transparent PNG
    const MIN_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQAABjE+ibYAAAAASUVORK5CYII=';
    const bin = atob(MIN_PNG);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    return new Response(buf.buffer, {
      status: 200,
      headers: { 'Content-Type': 'image/png' }
    });
  }
}

// ── Install — cache core assets ──────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

// ── Activate — clean old caches ──────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── Fetch ────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const url = event.request.url;

  // 1. Generate icons on the fly — never need static files
  if (url.endsWith('/icon-192.png') || url.endsWith('icon-192.png')) {
    event.respondWith(makeIcon(192));
    return;
  }
  if (url.endsWith('/icon-512.png') || url.endsWith('icon-512.png')) {
    event.respondWith(makeIcon(512));
    return;
  }

  // 2. Always network for Google Apps Script (sync) calls
  if (url.includes('script.google.com') || url.includes('googleapis.com')) {
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(
          JSON.stringify({ success: false, error: 'Offline — sync unavailable' }),
          { headers: { 'Content-Type': 'application/json' } }
        )
      )
    );
    return;
  }

  // 3. Cache-first for everything else (app shell)
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (event.request.method === 'GET' && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});
