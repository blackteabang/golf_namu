// 설치 가능 조건을 맞추는 최소 서비스 워커.
// HTML/JS/CSS는 네트워크를 그대로 쓰고, Firebase 요청은 건드리지 않는다.
var VERSION = '20261121a';
var CACHE = 'golf-namu-' + VERSION;

self.addEventListener('install', function () {
    self.skipWaiting();
});

self.addEventListener('activate', function (event) {
    event.waitUntil(
        caches.keys().then(function (keys) {
            return Promise.all(keys.map(function (key) {
                if (key !== CACHE) return caches.delete(key);
                return null;
            }));
        }).then(function () {
            return self.clients.claim();
        })
    );
});

self.addEventListener('fetch', function (event) {
    var request = event.request;
    if (!request || request.method !== 'GET') return;
    var url;
    try {
        url = new URL(request.url);
    } catch (error) {
        return;
    }
    var host = url.hostname || '';
    if (host.indexOf('firebase') !== -1 || host.indexOf('googleapis.com') !== -1 || host.indexOf('gstatic.com') !== -1) return;
    if (host !== self.location.hostname) return;
    event.respondWith(fetch(request));
});
