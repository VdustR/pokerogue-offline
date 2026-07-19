const LEGACY_CACHE_PREFIX = "pokerogue-offline-";
const METADATA_CACHE_PREFIX = "pokerogue-offline-meta-";
const CONTENT_CACHE = "pokerogue-offline-content-v2";
const CURRENT_REVISION = "__OFFLINE_REVISION__";
const CURRENT_METADATA_CACHE = `${METADATA_CACHE_PREFIX}${CURRENT_REVISION}`;
const READY_MARKER = new URL("./__offline_ready__", self.registration.scope).href;
const MANIFEST_MARKER = new URL("./__offline_manifest__", self.registration.scope).href;
const CONTENT_KEY_PREFIX = new URL("./__offline_content__/", self.registration.scope).href;
const MANIFEST_URL = new URL("./offline-manifest.json", self.registration.scope).href;
const CACHE_BATCH_SIZE = 12;

let cacheAllPromise;
let readyVersionPromise;

self.addEventListener("install", event => {
  self.skipWaiting();
  event.waitUntil(Promise.resolve());
});

self.addEventListener("activate", event => {
  event.waitUntil(self.clients.claim());
});

function assertManifest(manifest, expectedRevision) {
  if (
    manifest?.manifestVersion !== 2
    || manifest.revision !== expectedRevision
    || !Array.isArray(manifest.files)
    || !Number.isSafeInteger(manifest.totalBytes)
    || manifest.totalBytes < 0
  ) {
    throw new Error("Offline manifest format or revision is invalid");
  }

  const paths = new Set();
  let totalBytes = 0;
  for (const file of manifest.files) {
    if (
      typeof file?.path !== "string"
      || !file.path.startsWith("./")
      || paths.has(file.path)
      || !Number.isSafeInteger(file.size)
      || file.size < 0
      || !/^[a-f0-9]{64}$/.test(file.sha256)
    ) {
      throw new Error(`Offline manifest file entry is invalid: ${String(file?.path)}`);
    }
    paths.add(file.path);
    totalBytes += file.size;
  }
  if (totalBytes !== manifest.totalBytes) {
    throw new Error("Offline manifest byte total is invalid");
  }
  return manifest;
}

async function readJson(cache, request) {
  const response = await cache.match(request);
  return response ? response.json() : undefined;
}

async function getManifest() {
  const metadataCache = await caches.open(CURRENT_METADATA_CACHE);
  try {
    const response = await fetch(MANIFEST_URL, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Offline manifest request failed (${response.status})`);
    }
    const manifest = assertManifest(await response.json(), CURRENT_REVISION);
    await metadataCache.put(
      MANIFEST_MARKER,
      new Response(JSON.stringify(manifest), { headers: { "Content-Type": "application/json" } }),
    );
    return manifest;
  } catch (networkError) {
    const cachedManifest = await readJson(metadataCache, MANIFEST_MARKER);
    if (cachedManifest) {
      return assertManifest(cachedManifest, CURRENT_REVISION);
    }
    throw networkError;
  }
}

async function loadMetadataVersion(cacheName) {
  const cache = await caches.open(cacheName);
  const ready = await readJson(cache, READY_MARKER);
  const manifest = await readJson(cache, MANIFEST_MARKER);
  if (!ready || !manifest) {
    return;
  }
  return {
    type: "metadata",
    cacheName,
    completedAt: ready.completedAt ?? "",
    manifest: assertManifest(manifest, cacheName.slice(METADATA_CACHE_PREFIX.length)),
    filesByPath: new Map(manifest.files.map(file => [file.path, file])),
  };
}

async function loadLegacyVersion(cacheName) {
  const cache = await caches.open(cacheName);
  const ready = await readJson(cache, READY_MARKER);
  if (!ready) {
    return;
  }
  return { type: "legacy", cacheName, completedAt: ready.completedAt ?? "", cache };
}

async function findReadyVersion() {
  const current = await loadMetadataVersion(CURRENT_METADATA_CACHE);
  if (current) {
    return current;
  }

  const cacheNames = await caches.keys();
  const versions = [];
  for (const cacheName of cacheNames) {
    if (cacheName.startsWith(METADATA_CACHE_PREFIX) && cacheName !== CURRENT_METADATA_CACHE) {
      const version = await loadMetadataVersion(cacheName);
      if (version) {
        versions.push(version);
      }
    } else if (
      cacheName.startsWith(LEGACY_CACHE_PREFIX)
      && !cacheName.startsWith(METADATA_CACHE_PREFIX)
      && cacheName !== CONTENT_CACHE
    ) {
      const version = await loadLegacyVersion(cacheName);
      if (version) {
        versions.push(version);
      }
    }
  }
  versions.sort((left, right) => right.completedAt.localeCompare(left.completedAt));
  return versions[0];
}

async function getReadyVersion() {
  readyVersionPromise ??= findReadyVersion();
  const version = await readyVersionPromise;
  if (!version) {
    readyVersionPromise = undefined;
  }
  return version;
}

async function notifyAll(message) {
  const clients = await self.clients.matchAll({ includeUncontrolled: true, type: "window" });
  for (const client of clients) {
    client.postMessage(message);
  }
}

function contentKey(sha256) {
  return `${CONTENT_KEY_PREFIX}${sha256}`;
}

async function sha256Hex(response) {
  const digest = await crypto.subtle.digest("SHA-256", await response.arrayBuffer());
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

async function removeSupersededData(manifest) {
  for (const cacheName of await caches.keys()) {
    const isOldMetadata = cacheName.startsWith(METADATA_CACHE_PREFIX) && cacheName !== CURRENT_METADATA_CACHE;
    const isLegacy =
      cacheName.startsWith(LEGACY_CACHE_PREFIX)
      && !cacheName.startsWith(METADATA_CACHE_PREFIX)
      && cacheName !== CONTENT_CACHE;
    if (isOldMetadata || isLegacy) {
      await caches.delete(cacheName);
    }
  }

  const requiredHashes = new Set(manifest.files.map(file => file.sha256));
  const contentCache = await caches.open(CONTENT_CACHE);
  for (const request of await contentCache.keys()) {
    const hash = request.url.startsWith(CONTENT_KEY_PREFIX) ? request.url.slice(CONTENT_KEY_PREFIX.length) : "";
    if (!requiredHashes.has(hash)) {
      await contentCache.delete(request);
    }
  }
}

async function cacheAll() {
  const existingCurrent = await loadMetadataVersion(CURRENT_METADATA_CACHE);
  if (existingCurrent) {
    await notifyAll({ type: "OFFLINE_COMPLETE", revision: CURRENT_REVISION });
    return;
  }

  const manifest = await getManifest();
  const contentCache = await caches.open(CONTENT_CACHE);
  const metadataCache = await caches.open(CURRENT_METADATA_CACHE);
  let completed = 0;
  let completedBytes = 0;

  for (let offset = 0; offset < manifest.files.length; offset += CACHE_BATCH_SIZE) {
    const batch = manifest.files.slice(offset, offset + CACHE_BATCH_SIZE);
    await Promise.all(
      batch.map(async file => {
        const key = contentKey(file.sha256);
        if (!(await contentCache.match(key))) {
          const url = new URL(file.path, self.registration.scope).href;
          const response = await fetch(url, {
            cache: "no-store",
            headers: { "X-Pokerogue-Offline-Cache": "1" },
          });
          if (!response.ok) {
            throw new Error(`${file.path} failed (${response.status})`);
          }
          const actualSha256 = await sha256Hex(response.clone());
          if (actualSha256 !== file.sha256) {
            throw new Error(`${file.path} failed integrity verification`);
          }
          await contentCache.put(key, response);
        }
        completed += 1;
        completedBytes += file.size;
      }),
    );
    await notifyAll({
      type: "OFFLINE_PROGRESS",
      completed,
      total: manifest.files.length,
      completedBytes,
      totalBytes: manifest.totalBytes,
    });
  }

  await metadataCache.put(
    READY_MARKER,
    new Response(JSON.stringify({ revision: CURRENT_REVISION, completedAt: new Date().toISOString() }), {
      headers: { "Content-Type": "application/json" },
    }),
  );
  await removeSupersededData(manifest);
  readyVersionPromise = undefined;
  await notifyAll({ type: "OFFLINE_COMPLETE", revision: CURRENT_REVISION });
}

function ensureCacheAll() {
  if (!cacheAllPromise) {
    cacheAllPromise = cacheAll()
      .catch(async error => {
        await notifyAll({ type: "OFFLINE_ERROR", message: String(error) });
      })
      .finally(() => {
        cacheAllPromise = undefined;
      });
  }
  return cacheAllPromise;
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
        await notifyAll({
          type: "OFFLINE_STATUS",
          ready: Boolean(await loadMetadataVersion(CURRENT_METADATA_CACHE)),
          fallbackReady: Boolean(await getReadyVersion()),
          revision: CURRENT_REVISION,
          total: manifest.files.length,
          totalBytes: manifest.totalBytes,
        });
      })(),
    );
  } else if (event.data?.type === "CACHE_ALL") {
    event.waitUntil(ensureCacheAll());
  }
});

function requestManifestPath(request) {
  if (request.mode === "navigate") {
    return "./index.html";
  }
  const requestUrl = new URL(request.url);
  const scopeUrl = new URL(self.registration.scope);
  if (!requestUrl.pathname.startsWith(scopeUrl.pathname)) {
    return;
  }
  return `./${decodeURIComponent(requestUrl.pathname.slice(scopeUrl.pathname.length))}`;
}

async function matchReadyVersion(version, request) {
  if (!version) {
    return;
  }
  if (version.type === "legacy") {
    const lookupRequest = request.mode === "navigate" ? new URL("./index.html", self.registration.scope).href : request;
    return version.cache.match(lookupRequest, { ignoreSearch: true });
  }

  const path = requestManifestPath(request);
  const file = version.filesByPath.get(path);
  if (!file) {
    return;
  }
  const contentCache = await caches.open(CONTENT_CACHE);
  return contentCache.match(contentKey(file.sha256));
}

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    (async () => {
      const cached = await matchReadyVersion(await getReadyVersion(), event.request);
      return cached ?? fetch(event.request);
    })(),
  );
});
