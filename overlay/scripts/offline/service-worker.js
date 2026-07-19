const CACHE_PREFIX = "pokerogue-offline-";
const CURRENT_REVISION = "__OFFLINE_REVISION__";
const CURRENT_CACHE = `${CACHE_PREFIX}${CURRENT_REVISION}`;
const READY_MARKER = new URL("./__offline_ready__", self.registration.scope).href;
const MANIFEST_URL = new URL("./offline-manifest.json", self.registration.scope).href;

self.addEventListener("install", event => {
  self.skipWaiting();
  event.waitUntil(Promise.resolve());
});

self.addEventListener("activate", event => {
  event.waitUntil(self.clients.claim());
});

async function getManifest() {
  const response = await fetch(MANIFEST_URL, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Offline manifest request failed (${response.status})`);
  }
  return response.json();
}

async function isReady(cacheName) {
  const cache = await caches.open(cacheName);
  return Boolean(await cache.match(READY_MARKER));
}

async function findReadyCache() {
  if (await isReady(CURRENT_CACHE)) {
    return caches.open(CURRENT_CACHE);
  }
  const names = (await caches.keys()).filter(name => name.startsWith(CACHE_PREFIX)).reverse();
  for (const name of names) {
    if (await isReady(name)) {
      return caches.open(name);
    }
  }
  return;
}

async function notify(clientId, message) {
  const client = await self.clients.get(clientId);
  client?.postMessage(message);
}

async function cacheAll(clientId) {
  try {
    const manifest = await getManifest();
    const cache = await caches.open(CURRENT_CACHE);
    let completed = 0;
    let completedBytes = 0;

    for (let offset = 0; offset < manifest.files.length; offset += 12) {
      const batch = manifest.files.slice(offset, offset + 12);
      await Promise.all(
        batch.map(async file => {
          const url = new URL(file.path, self.registration.scope).href;
          const response = await fetch(url, { cache: "no-store" });
          if (!response.ok) {
            throw new Error(`${file.path} failed (${response.status})`);
          }
          await cache.put(url, response);
          completed += 1;
          completedBytes += file.size;
        }),
      );
      await notify(clientId, {
        type: "OFFLINE_PROGRESS",
        completed,
        total: manifest.files.length,
        completedBytes,
        totalBytes: manifest.totalBytes,
      });
    }

    await cache.put(READY_MARKER, new Response(JSON.stringify({ revision: CURRENT_REVISION })));
    for (const name of await caches.keys()) {
      if (name.startsWith(CACHE_PREFIX) && name !== CURRENT_CACHE) {
        await caches.delete(name);
      }
    }
    await notify(clientId, { type: "OFFLINE_COMPLETE", revision: CURRENT_REVISION });
  } catch (error) {
    await notify(clientId, { type: "OFFLINE_ERROR", message: String(error) });
  }
}

self.addEventListener("message", event => {
  if (event.data?.type === "GET_STATUS") {
    event.waitUntil(
      (async () => {
        let manifest;
        try {
          manifest = await getManifest();
        } catch {
          manifest = { files: [], totalBytes: 0 };
        }
        await notify(event.source.id, {
          type: "OFFLINE_STATUS",
          ready: await isReady(CURRENT_CACHE),
          revision: CURRENT_REVISION,
          total: manifest.files.length,
          totalBytes: manifest.totalBytes,
        });
      })(),
    );
  } else if (event.data?.type === "CACHE_ALL") {
    event.waitUntil(cacheAll(event.source.id));
  }
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    (async () => {
      if (event.request.mode === "navigate") {
        const readyCache = await findReadyCache();
        const cachedIndex = await readyCache?.match(new URL("./index.html", self.registration.scope).href);
        if (cachedIndex) {
          return cachedIndex;
        }
      }

      const cached = await caches.match(event.request, { ignoreSearch: true });
      if (cached) {
        return cached;
      }

      return fetch(event.request);
    })(),
  );
});
