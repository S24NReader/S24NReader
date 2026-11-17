/* =========================================================
   S24NReader — عامل الخدمة (Service Worker)
   يجعل التطبيق قابلاً للتثبيت ويفتح دون اتصال.
   لا يتدخل في: خوادم الجلب والتلخيص، Firebase (البيانات والدخول)، الصور.
   عند تعديل هذا الملف: غيّر VER ليُستبدل الكاش القديم.
   ========================================================= */
const VER = 'v1';
const SHELL = 's24r-shell-' + VER;   // صفحة التطبيق وملفاته
const LIBS = 's24r-libs-' + VER;     // مكتبات Firebase والخطوط (ثابتة لا تتغير)
// يجب أن يطابق رقم الإصدار ما في index.html (const v = '10.12.2' في boot)
const FB = 'https://www.gstatic.com/firebasejs/10.12.2/';
const LIB_FILES = [FB + 'firebase-app-compat.js', FB + 'firebase-auth-compat.js', FB + 'firebase-database-compat.js',
  'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&display=swap'];
const SHELL_FILES = ['./', './manifest.json', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(SHELL);
    // ملف واحد فاشل لا يُفشل التثبيت كله
    await Promise.all(SHELL_FILES.map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => {})));
    // مكتبات Firebase تُحفظ من البداية، لأن الصفحة الأولى تحمّلها قبل أن يعمل عامل الخدمة
    const l = await caches.open(LIBS);
    await Promise.all(LIB_FILES.map(async u => {
      if (await l.match(u)) return;
      const req = new Request(u, { mode: u.includes('fonts.googleapis') ? 'cors' : 'no-cors' });
      try { const res = await fetch(req); if (res.ok || res.type === 'opaque') await l.put(req, res); } catch {}
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keep = [SHELL, LIBS];
    for (const k of await caches.keys()) if (k.startsWith('s24r-') && !keep.includes(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

// مكتبات Firebase بإصدار ثابت في الرابط، والخطوط
const isLib = u =>
  (u.hostname === 'www.gstatic.com' && u.pathname.startsWith('/firebasejs/')) ||
  u.hostname === 'fonts.googleapis.com' || u.hostname === 'fonts.gstatic.com';

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);

  // 1) فتح التطبيق: من الشبكة أولاً (لتصل التحديثات فوراً)، والكاش عند انقطاع الاتصال
  if (req.mode === 'navigate' && u.origin === location.origin) {
    e.respondWith(pageFirst(req));
    return;
  }
  // 2) ملفات التطبيق الأخرى (الأيقونات والتعريف): من الكاش فوراً، مع تحديثه في الخلفية
  if (u.origin === location.origin) {
    if (u.pathname.endsWith('/sw.js')) return;
    e.respondWith(cacheThenUpdate(req, SHELL));
    return;
  }
  // 3) المكتبات والخطوط
  if (isLib(u)) { e.respondWith(cacheThenUpdate(req, LIBS, u.hostname === 'www.gstatic.com')); return; }
  // 4) كل ما عدا ذلك يمر إلى الشبكة كما هو
});

async function pageFirst(req) {
  const c = await caches.open(SHELL);
  try {
    // no-cache: يتحقق من الخادم في كل فتح، فيصل الملف الجديد بعد رفعه مباشرة
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 6000);
    const res = await fetch(req.url, { cache: 'no-cache', signal: ctl.signal, credentials: 'same-origin' });
    clearTimeout(t);
    if (res.ok) { c.put('./', res.clone()); return res; }
    const old = await c.match('./'); return old || res;
  } catch (err) {
    const old = await c.match('./');
    if (old) return old;
    return new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><body dir="rtl" style="font-family:sans-serif;padding:40px;text-align:center;color:#333"><h2>لا يوجد اتصال بالإنترنت</h2><p>افتح التطبيق مرة واحدة وأنت متصل ليُحفظ على هذا الجهاز.</p></body>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
}

// fixed = true: ملف بإصدار ثابت (مكتبات Firebase)، فلا حاجة لتحديثه ما دام في الكاش
async function cacheThenUpdate(req, name, fixed) {
  const c = await caches.open(name);
  const hit = await c.match(req, { ignoreSearch: name === SHELL });
  if (hit && fixed) return hit;
  const net = fetch(req).then(res => { if (res.ok || res.type === 'opaque') c.put(req, res.clone()); return res; }).catch(() => null);
  if (hit) { net.catch(() => {}); return hit; }
  const res = await net;
  return res || new Response('', { status: 504 });
}
