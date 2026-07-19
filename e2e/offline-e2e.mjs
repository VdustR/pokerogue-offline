import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
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

function getRequestPath(url) {
  const pathname = decodeURIComponent(new URL(url, "http://localhost").pathname);
  const relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
  const resolvedPath = path.resolve(distDirectory, relativePath);
  if (!resolvedPath.startsWith(`${distDirectory}${path.sep}`) && resolvedPath !== distDirectory) {
    throw new Error("Request escaped the distribution directory");
  }
  return resolvedPath;
}

const server = createServer(async (request, response) => {
  try {
    const filePath = getRequestPath(request.url ?? "/");
    const fileStat = await stat(filePath);
    const contentType = mimeTypes.get(path.extname(filePath).toLowerCase()) ?? "application/octet-stream";
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
      createReadStream(filePath, { start, end }).pipe(response);
    } else {
      response.setHeader("Content-Length", fileStat.size);
      createReadStream(filePath).pipe(response);
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

const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext();
const page = await context.newPage();
const pageErrors = [];
page.on("pageerror", error => pageErrors.push(String(error)));

try {
  await page.goto(origin, { waitUntil: "domcontentloaded", timeout: 120_000 });
  const downloadButton = page.getByTestId("offline-download");
  try {
    await page.waitForFunction(
      () => {
        const status = document.querySelector("[data-testid='offline-status']");
        return status && status.textContent !== "Checking offline storage…";
      },
      undefined,
      { timeout: 120_000 },
    );
    await downloadButton.waitFor({ state: "visible", timeout: 5_000 });
  } catch (error) {
    const debugState = await page.evaluate(() => ({
      documentState: document.readyState,
      panel: document.querySelector("[data-testid='offline-installer']")?.outerHTML,
      serviceWorkerController: Boolean(navigator.serviceWorker?.controller),
    }));
    throw new Error(
      `Offline installer did not become ready: ${String(error)}; state=${JSON.stringify(debugState)}; pageErrors=${pageErrors.join(" | ")}`,
    );
  }
  await downloadButton.click();
  await page.locator("[data-testid='offline-installer'][data-ready='true']").waitFor({
    state: "visible",
    timeout: 1_200_000,
  });

  const readyCaches = await page.evaluate(async () => {
    const names = await caches.keys();
    return names.filter(name => name.startsWith("pokerogue-offline-"));
  });
  if (readyCaches.length !== 1) {
    throw new Error(`Expected one ready offline cache, found ${readyCaches.length}`);
  }

  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.locator("canvas").waitFor({ state: "visible", timeout: 120_000 });
  await page.locator("[data-testid='offline-installer'][data-ready='true']").waitFor({
    state: "visible",
    timeout: 120_000,
  });
  await page.waitForTimeout(5_000);

  const state = await page.evaluate(() => ({
    controlled: Boolean(navigator.serviceWorker.controller),
    canvasCount: document.querySelectorAll("canvas").length,
    readyText: document.querySelector("[data-testid='offline-status']")?.textContent,
  }));
  if (!state.controlled || state.canvasCount === 0 || !state.readyText?.startsWith("Offline ready")) {
    throw new Error(`Offline cold-start assertion failed: ${JSON.stringify(state)}`);
  }
  if (pageErrors.length > 0) {
    throw new Error(`Browser page errors: ${pageErrors.join(" | ")}`);
  }

  console.log(`Offline E2E passed: ${state.readyText}`);
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
