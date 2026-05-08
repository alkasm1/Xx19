const cacheName = "alm-book-v1";

const filesToCache = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./jszip.min.js",
  "./pdf.min.js",
  "./pdf.worker.min.js",
  "./jspdf.umd.min.js",
  "./docx.min.js",
  "./alm_vm.js",
  "./alm_programs.js",
  "./script.js"
];

// install: حفظ الملفات في الكاش (بدون إيقاف العملية إذا فشل ملف)
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(cacheName)
      .then((cache) => {
        // استخدام Promise.allSettled لتجنب فشل العملية كاملة إذا فشل ملف واحد
        return Promise.allSettled(
          filesToCache.map(url => 
            cache.add(url).catch(err => {
              console.warn(`فشل تحميل ${url}:`, err);
              // لا نرفع الخطأ - نستمر بالملفات الأخرى
            })
          )
        );
      })
      .then(() => {
        console.log("Service Worker: تم تثبيت الكاش");
      })
      .catch(err => {
        console.warn("خطأ في تثبيت Service Worker:", err);
      })
  );
  self.skipWaiting();
});

// activate: مسح الكاش القديم
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== cacheName)
            .map((key) => {
              console.log("حذف كاش قديم:", key);
              return caches.delete(key);
            })
        )
      )
      .catch(err => {
        console.warn("خطأ في تنشيط Service Worker:", err);
      })
  );
  self.clients.claim();
});

// fetch: استراتيجية "الكاش أولاً، ثم الشبكة"
self.addEventListener("fetch", (event) => {
  // تجاهل الطلبات غير GET
  if (event.request.method !== "GET") {
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        // إذا وجد الملف في الكاش، أرسله
        if (response) {
          return response;
        }

        // وإلا، حاول جلبه من الشبكة
        return fetch(event.request)
          .then((networkResponse) => {
            // تحقق من صحة الاستجابة
            if (!networkResponse || networkResponse.status !== 200 || networkResponse.type === "error") {
              return networkResponse;
            }

            // حفظ الملف الجديد في الكاش
            const responseToCache = networkResponse.clone();
            caches.open(cacheName)
              .then((cache) => {
                cache.put(event.request, responseToCache);
              })
              .catch(err => {
                console.warn("فشل حفظ الملف في الكاش:", err);
              });

            return networkResponse;
          })
          .catch((err) => {
            // إذا فشل الطلب من الشبكة، حاول استخدام ملف من الكاش
            console.warn("فشل جلب الملف من الشبكة، محاولة من الكاش:", event.request.url, err);
            
            // للصور والأصوات، يمكنك إرجاع صورة بديلة
            if (event.request.destination === "image") {
              // يمكنك إنشاء صورة بديلة هنا إذا لزم الأمر
            }

            // إرجاع استجابة 503 (Service Unavailable)
            return new Response("Offline", {
              status: 503,
              statusText: "Service Unavailable",
              headers: new Headers({
                "Content-Type": "text/plain"
              })
            });
          });
      })
      .catch(err => {
        console.error("خطأ في معالج fetch:", err);
        return new Response("Error", {
          status: 500,
          statusText: "Internal Server Error"
        });
      })
  );
});
