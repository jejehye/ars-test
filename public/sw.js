/**
 * 오프라인 캐시.
 *
 * Vite 가 에셋 파일명에 해시를 붙이므로 목록을 미리 박아둘 수 없다.
 * 대신 한 번 받아온 것을 캐시에 넣어두고(stale-while-revalidate),
 * 네트워크가 없을 때 캐시로 답한다. 테스트 현장에서 전파가 약해도 앱이 뜬다.
 */
const CACHE = 'ars-test-v1';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', './index.html'])));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  // 페이지 이동은 항상 index.html 로 답해 새로고침해도 앱이 뜨게 한다.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          caches.open(CACHE).then((c) => c.put('./index.html', res.clone()));
          return res;
        })
        .catch(() => caches.match('./index.html').then((r) => r ?? Response.error())),
    );
    return;
  }

  e.respondWith(
    caches.match(req).then((hit) => {
      const network = fetch(req)
        .then((res) => {
          if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
          return res;
        })
        .catch(() => hit ?? Response.error());
      return hit ?? network;
    }),
  );
});
