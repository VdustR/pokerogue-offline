import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { _electron as electron } from "playwright-core";

const distDirectory = path.resolve(process.argv[2] ?? "");
if (!process.argv[2]) {
  throw new Error("Usage: node e2e/electron-e2e.mjs <dist-directory> [packaged-executable]");
}

const build = JSON.parse(await readFile(path.join(distDirectory, "offline-build.json"), "utf8"));
const mainPath = path.resolve("desktop/main.mjs");
const executablePath = process.argv[3] ? path.resolve(process.argv[3]) : undefined;
const canvasTimeout = Number.parseInt(process.env.POKEROGUE_E2E_CANVAS_TIMEOUT ?? "120000", 10);
const userDataArgs = process.env.POKEROGUE_E2E_USER_DATA_DIR
  ? [`--user-data-dir=${path.resolve(process.env.POKEROGUE_E2E_USER_DATA_DIR)}`]
  : [];
const systemLocaleArgs = process.env.POKEROGUE_E2E_SYSTEM_LOCALE
  ? [`--lang=${process.env.POKEROGUE_E2E_SYSTEM_LOCALE}`]
  : [];
const expectedLanguage = process.env.POKEROGUE_E2E_EXPECTED_LANGUAGE;
const softwareGlArgs = process.env.POKEROGUE_E2E_SOFTWARE_GL === "1"
  ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
  : [];
const app = await electron.launch({
  args: [
    "--enable-logging=stderr",
    ...softwareGlArgs,
    ...userDataArgs,
    ...systemLocaleArgs,
    ...(executablePath ? [] : [mainPath]),
  ],
  executablePath,
  env: {
    ...process.env,
    ELECTRON_ENABLE_LOGGING: "1",
    ...(executablePath ? {} : { POKEROGUE_GAME_DIR: distDirectory }),
  },
  timeout: 120_000,
});
const processErrors = [];
const processLifecycle = [];
app.process().stderr?.on("data", chunk => processErrors.push(String(chunk)));
app.process().once("exit", (code, signal) => {
  processLifecycle.push({ code, event: "exit", signal });
});
app.once("close", () => processLifecycle.push({ event: "application-close" }));
const windowLifecycle = [];
let window;

try {
  window = await app.firstWindow({ timeout: 120_000 });
  window.once("close", () => windowLifecycle.push({ event: "page-close" }));
  window.once("crash", () => windowLifecycle.push({ event: "page-crash" }));
  const pageErrors = [];
  const consoleErrors = [];
  const localResourceErrors = [];
  const failedRequests = [];
  window.on("pageerror", error => pageErrors.push(String(error)));
  window.on("console", message => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  window.on("response", response => {
    const url = new URL(response.url());
    const isOptionalLocaleFallback = url.pathname.startsWith("/locales/") && url.pathname.endsWith(".json");
    if (url.protocol === "pokerogue:" && response.status() >= 400 && !isOptionalLocaleFallback) {
      localResourceErrors.push(`${response.status()} ${response.url()}`);
    }
  });
  window.on("requestfailed", request => {
    failedRequests.push(`${request.failure()?.errorText ?? "failed"} ${request.url()}`);
  });

  try {
    await window.locator("canvas").waitFor({ state: "visible", timeout: canvasTimeout });
  } catch (error) {
    const diagnostic = await window.evaluate(async () => {
      const moduleUrl = document.querySelector("script[type=module]")?.src;
      let resourceProbe;
      try {
        const response = await fetch(moduleUrl);
        resourceProbe = { length: (await response.text()).length, status: response.status };
      } catch (probeError) {
        resourceProbe = String(probeError);
      }
      return {
        bodyText: document.body?.innerText.slice(0, 500),
        canvasCount: document.querySelectorAll("canvas").length,
        readyState: document.readyState,
        resourceProbe,
        resources: performance.getEntriesByType("resource").slice(0, 30).map(entry => ({
          duration: Math.round(entry.duration),
          initiatorType: entry.initiatorType,
          name: entry.name,
          transferSize: entry.transferSize,
        })),
        scripts: [...document.scripts].map(script => ({ src: script.src, type: script.type })),
        title: document.title,
        url: location.href,
      };
    });
    throw new Error(
      `Electron canvas did not start: ${JSON.stringify({ diagnostic, pageErrors, consoleErrors, localResourceErrors, failedRequests, processErrors })}`,
      { cause: error },
    );
  }
  await window.waitForTimeout(3_000);

  const initialState = await window.evaluate(async variant => {
    const probeKey = `pokerogue-electron-e2e-${variant}`;
    localStorage.setItem(probeKey, "persisted");
    let networkBlocked = false;
    try {
      await fetch("https://example.com/pokerogue-network-probe", { cache: "no-store" });
    } catch {
      networkBlocked = true;
    }
    return {
      canvasCount: document.querySelectorAll("canvas").length,
      detectedLanguage: localStorage.getItem("pokerogueOfflineLang"),
      networkBlocked,
      navigatorLanguages: navigator.languages,
      nodeGlobalExposed: typeof globalThis.process !== "undefined" || typeof globalThis.require !== "undefined",
      origin: location.origin,
      probeKey,
    };
  }, build.variant);

  await window.reload({ waitUntil: "domcontentloaded", timeout: 120_000 });
  await window.locator("canvas").waitFor({ state: "visible", timeout: 120_000 });
  const persisted = await window.evaluate(probeKey => localStorage.getItem(probeKey), initialState.probeKey);

  if (
    initialState.canvasCount === 0
    || !initialState.networkBlocked
    || initialState.nodeGlobalExposed
    || initialState.origin !== "pokerogue://game"
    || (expectedLanguage && initialState.detectedLanguage !== expectedLanguage)
    || persisted !== "persisted"
    || pageErrors.length > 0
    || localResourceErrors.length > 0
    || failedRequests.some(request => request.includes("pokerogue://") && !request.startsWith("net::ERR_ABORTED "))
    || processErrors.some(output => /(?:TypeError|Error):/.test(output))
  ) {
    throw new Error(
      `Electron E2E failed: ${JSON.stringify({ initialState, persisted, pageErrors, consoleErrors, localResourceErrors, failedRequests, processErrors })}`,
    );
  }

  console.log(
    `Electron E2E passed for ${build.variant}: language=${initialState.detectedLanguage}, local save persisted, and network was blocked.`,
  );
} catch (error) {
  let windowDiagnostic = { closed: !window || window.isClosed() };
  if (window && !window.isClosed()) {
    windowDiagnostic = await window.evaluate(() => ({
      canvasCount: document.querySelectorAll("canvas").length,
      closed: false,
      readyState: document.readyState,
      title: document.title,
      url: location.href,
    })).catch(diagnosticError => ({
      closed: window.isClosed(),
      diagnosticError: String(diagnosticError),
    }));
  }
  throw new Error(
    `Electron E2E terminated unexpectedly: ${JSON.stringify({ processLifecycle, processErrors, windowLifecycle, windowDiagnostic })}`,
    { cause: error },
  );
} finally {
  if (app.process().exitCode === null) {
    await app.close();
  }
}
