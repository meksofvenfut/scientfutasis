const CACHE_NAME = 'egitim-portal-v1';
const urlsToCache = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/manifest.json',
  '/icon-192x192.png',
  '/icon-512x512.png'
];

// Uygulama yüklendiğinde önbelleğe alma
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Önbellek açıldı');
        return cache.addAll(urlsToCache);
      })
  );
});

// Ağ isteklerini yakalama ve önbellekteki yanıtları kullanma
self.addEventListener('fetch', event => {
  // API isteklerini önbelleğe almayı engelle
  if (event.request.url.includes('/api/')) {
    return;
  }
  
  // POST isteklerini önbelleğe almayı engelle
  if (event.request.method !== 'GET') {
    return;
  }
  
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Önbellekte varsa, önbellekteki yanıtı döndür
        if (response) {
          return response;
        }
        
        // Yoksa ağdan iste ve önbelleğe ekle
        return fetch(event.request)
          .then(response => {
            // Geçersiz yanıt veya değiştirilmiş bir istek ise, sadece yanıtı döndür
            if (!response || response.status !== 200 || response.type !== 'basic') {
              return response;
            }
            
            // Vary: * içeren yanıtları önbelleğe almayı engelle
            const varyHeader = response.headers.get('Vary');
            if (varyHeader && varyHeader.includes('*')) {
              return response;
            }
            
            try {
              // Yanıtın bir kopyasını önbelleğe ekle
              const responseToCache = response.clone();
              
              caches.open(CACHE_NAME)
                .then(cache => {
                  cache.put(event.request, responseToCache);
                })
                .catch(err => {
                  console.warn('Önbelleğe alma hatası:', err);
                });
            } catch (error) {
              console.warn('Önbelleğe alma sırasında hata:', error);
            }
              
            return response;
          });
      })
  );
});

// Eski önbellekleri temizleme
self.addEventListener('activate', event => {
  const cacheWhitelist = [CACHE_NAME];
  
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            // Eski önbelleği sil
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
}); 