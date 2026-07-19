import { createReadStream } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright-core";

const distDirectory = path.resolve(process.argv[2] ?? "");
if (!process.argv[2]) {
  throw new Error("Usage: node e2e/offline-e2e.mjs <dist-directory>");
}

const mimeTypes = new Map([
  [".css", "text/css"],
  [".html", "text/html"],
  [".js", "text/javascript"],
  [".json", "application/json"],
  [".m4a", "audio/mp4"],
  [".mp3", "audio/mpeg"],
  [".mp4", "video/mp4"],
  [".png", "image/png"],
  [".ttf", "font/ttf"],
  [".wav", "audio/wav"],
  [".webmanifest", "application/manifest+json"],
]);

const offlineCacheRequestCounts = new Map();

function getRequestPath(url) {
  const pathname = decodeURIComponent(new URL(url, "http://localhost").pathname);
  const relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
  const resolvedPath = path.resolve(distDirectory, relativePath);
  if (!resolvedPath.startsWith(`${distDirectory}${path.sep}`) && resolvedPath !== distDirectory) {
    throw new Error("Request escaped the distribution directory");
  }
  return { relativePath, resolvedPath };
}

const server = createServer(async (request, response) => {
  try {
    const { relativePath, resolvedPath } = getRequestPath(request.url ?? "/");
    if (request.headers["x-pokerogue-offline-cache"] === "1") {
      offlineCacheRequestCounts.set(relativePath, (offlineCacheRequestCounts.get(relativePath) ?? 0) + 1);
    }

    const fileStat = await stat(resolvedPath);
    const contentType = mimeTypes.get(path.extname(resolvedPath).toLowerCase()) ?? "application/octet-stream";
    const range = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/);

    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Type", contentType);
    if (range) {
      const start = Number(range[1]);
      const end = range[2] ? Number(range[2]) : fileStat.size - 1;
      response.writeHead(206, {
        "Accept-Ranges": "bytes",
        "Content-Length": end - start + 1,
        "Content-Range": `bytes ${start}-${end}/${fileStat.size}`,
      });
      createReadStream(resolvedPath, { start, end }).pipe(response);
    } else {
      response.setHeader("Content-Length", fileStat.size);
      createReadStream(resolvedPath).pipe(response);
    }
  } catch {
    response.writeHead(404).end("Not found");
  }
});

await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string") {
  throw new Error("Static server did not expose a TCP port");
}
const origin = `http://127.0.0.1:${address.port}`;
const manifest = JSON.parse(await readFile(path.join(distDirectory, "offline-manifest.json"), "utf8"));
if (manifest.manifestVersion !== 2 || manifest.files.some(file => !/^[a-f0-9]{64}$/.test(file.sha256))) {
  throw new Error("Offline manifest must contain a SHA-256 digest for every file");
}

function installStandaloneEmulation(context) {
  return context.addInitScript(() => {
    const nativeMatchMedia = window.matchMedia.bind(window);
    window.matchMedia = query => {
      if (!query.includes("display-mode:")) {
        return nativeMatchMedia(query);
      }
      const matches = query.includes("display-mode: standalone");
      return {
        matches,
        media: query,
        onchange: null,
        addListener() {},
        removeListener() {},
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent() {
          return false;
        },
      };
    };
    Object.defineProperty(navigator, "standalone", { configurable: true, value: true });
  });
}

async function verifyRegularWebDoesNotInstallOfflineData() {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({ locale: "en-US" });
  await context.addInitScript(() => {
    try {
      localStorage.setItem("prLang", "th");
    } catch {
      // The script also runs in the initial opaque document.
    }
  });
  const page = await context.newPage();
  try {
    await page.goto(origin, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.waitForFunction(() => localStorage.getItem("pokerogueOfflineLang") !== null, undefined, {
      timeout: 120_000,
    });
    await page.waitForTimeout(1_500);

    const state = await page.evaluate(async () => ({
      installerPresent: Boolean(document.querySelector("[data-testid='offline-installer']")),
      registrations: (await navigator.serviceWorker.getRegistrations()).length,
      offlineCaches: (await caches.keys()).filter(name => name.startsWith("pokerogue-offline-")),
      legacyLanguage: localStorage.getItem("prLang"),
      offlineLanguage: localStorage.getItem("pokerogueOfflineLang"),
    }));
    if (
      state.installerPresent
      || state.registrations !== 0
      || state.offlineCaches.length > 0
      || state.legacyLanguage !== "th"
      || state.offlineLanguage === "th"
    ) {
      throw new Error(`Regular web isolation assertion failed: ${JSON.stringify(state)}`);
    }
  } finally {
    await browser.close();
  }
}

async function openStandaloneContext(userDataDirectory) {
  const context = await chromium.launchPersistentContext(userDataDirectory, {
    channel: "chrome",
    headless: true,
    locale: "en-US",
  });
  await installStandaloneEmulation(context);
  for (const existingPage of context.pages()) {
    await existingPage.close();
  }
  return context;
}

async function verifyResumableInstalledPwa() {
  const userDataDirectory = await mkdtemp(path.join(os.tmpdir(), "pokerogue-offline-e2e-"));
  let context;
  try {
    context = await openStandaloneContext(userDataDirectory);
    let page = await context.newPage();
    await page.goto(origin, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.waitForFunction(
      () => Number(document.querySelector("[data-testid='offline-installer']")?.getAttribute("data-completed")) >= 24,
      undefined,
      { timeout: 120_000 },
    );
    await context.close();
    context = undefined;

    const cachedBeforeRestart = [...offlineCacheRequestCounts.entries()].filter(([, count]) => count === 1);
    if (cachedBeforeRestart.length === 0) {
      throw new Error("The interrupted install did not cache any probe files");
    }
    const [probePath] = cachedBeforeRestart[0];

    context = await openStandaloneContext(userDataDirectory);
    page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", error => pageErrors.push(String(error)));
    await page.goto(origin, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.locator("[data-testid='offline-installer'][data-ready='true']").waitFor({
      state: "attached",
      timeout: 1_200_000,
    });

    if (offlineCacheRequestCounts.get(probePath) !== 1) {
      throw new Error(`Interrupted install re-fetched completed file: ${probePath}`);
    }

    const readyState = await page.evaluate(async () => {
      const cacheNames = await caches.keys();
      return {
        contentCaches: cacheNames.filter(name => name === "pokerogue-offline-content-v2"),
        metadataCaches: cacheNames.filter(name => name.startsWith("pokerogue-offline-meta-")),
        readyText: document.querySelector("[data-testid='offline-status']")?.textContent,
      };
    });
    if (
      readyState.contentCaches.length !== 1
      || readyState.metadataCaches.length !== 1
      || !readyState.readyText?.startsWith("Offline ready")
    ) {
      throw new Error(`Installed PWA cache assertion failed: ${JSON.stringify(readyState)}`);
    }

    const preflightState = await page.evaluate(async () => {
      const metadataCacheName = (await caches.keys()).find(name => name.startsWith("pokerogue-offline-meta-"));
      const metadataCache = metadataCacheName ? await caches.open(metadataCacheName) : undefined;
      const manifestResponse = await metadataCache?.match(new URL("./__offline_manifest__", location.href));
      const cachedManifest = await manifestResponse?.json();
      const indexFile = cachedManifest?.files.find(file => file.path === "./index.html");
      const contentCache = await caches.open("pokerogue-offline-content-v2");
      const cachedIndex = indexFile
        ? await contentCache.match(new URL(`./__offline_content__/${indexFile.sha256}`, location.href))
        : undefined;
      return {
        controlled: Boolean(navigator.serviceWorker.controller),
        indexHash: indexFile?.sha256,
        cachedIndex: Boolean(cachedIndex),
      };
    });
    if (!preflightState.controlled || !preflightState.indexHash || !preflightState.cachedIndex) {
      throw new Error(`Offline preflight assertion failed: ${JSON.stringify(preflightState)}`);
    }

    await context.setOffline(true);
    let reloadError;
    try {
      await page.reload({ waitUntil: "domcontentloaded", timeout: 120_000 });
    } catch (error) {
      reloadError = String(error);
      await page.waitForLoadState("domcontentloaded", { timeout: 30_000 }).catch(() => undefined);
    }
    try {
      await page.locator("canvas").waitFor({ state: "visible", timeout: 120_000 });
    } catch (error) {
      throw new Error(`Offline canvas did not recover: ${String(error)}; reload=${reloadError ?? "none"}`);
    }
    await page.locator("[data-testid='offline-installer'][data-ready='true']").waitFor({
      state: "attached",
      timeout: 120_000,
    });
    await page.waitForTimeout(5_000);

    const offlineState = await page.evaluate(() => ({
      controlled: Boolean(navigator.serviceWorker.controller),
      canvasCount: document.querySelectorAll("canvas").length,
      readyText: document.querySelector("[data-testid='offline-status']")?.textContent,
    }));
    if (
      !offlineState.controlled
      || offlineState.canvasCount === 0
      || !offlineState.readyText?.startsWith("Offline ready")
    ) {
      throw new Error(`Offline cold-start assertion failed: ${JSON.stringify(offlineState)}`);
    }
    if (pageErrors.length > 0) {
      throw new Error(`Browser page errors: ${pageErrors.join(" | ")}`);
    }

    console.log(`Offline E2E passed: ${offlineState.readyText}; resumed without re-fetching ${probePath}`);
  } finally {
    await context?.close();
    await rm(userDataDirectory, { recursive: true, force: true });
  }
}

try {
  await verifyRegularWebDoesNotInstallOfflineData();
  await verifyResumableInstalledPwa();
} finally {
  await new Promise(resolve => server.close(resolve));
}
