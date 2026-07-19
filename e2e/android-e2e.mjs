import { execFileSync } from "node:child_process";
import process from "node:process";

const [serial, packageName] = process.argv.slice(2);
if (!serial || !packageName) {
  throw new Error("Usage: node e2e/android-e2e.mjs <adb-serial> <package-name>");
}

function adb(...args) {
  return execFileSync("adb", ["-s", serial, ...args], { encoding: "utf8" }).trim();
}

function wait(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function connectCdp(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  let nextId = 1;
  const pending = new Map();
  const eventWaiters = new Map();
  const eventListeners = new Map();
  socket.addEventListener("message", message => {
    const payload = JSON.parse(message.data);
    if (payload.id) {
      const request = pending.get(payload.id);
      if (!request) return;
      pending.delete(payload.id);
      if (payload.error) request.reject(new Error(`${request.method}: ${payload.error.message}`));
      else request.resolve(payload.result);
      return;
    }

    for (const listener of eventListeners.get(payload.method) ?? []) listener(payload.params);
    const waiters = eventWaiters.get(payload.method);
    if (waiters?.length) waiters.shift()(payload.params);
  });

  return {
    close: () => socket.close(),
    on(method, listener) {
      const listeners = eventListeners.get(method) ?? [];
      listeners.push(listener);
      eventListeners.set(method, listeners);
    },
    send(method, params = {}) {
      const id = nextId;
      nextId += 1;
      return new Promise((resolve, reject) => {
        pending.set(id, { method, resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    waitForEvent(method, timeout = 120_000) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${method}`)), timeout);
        const waiters = eventWaiters.get(method) ?? [];
        waiters.push(params => {
          clearTimeout(timer);
          resolve(params);
        });
        eventWaiters.set(method, waiters);
      });
    },
  };
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", {
    awaitPromise: true,
    expression,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  }
  return result.result.value;
}

async function waitForCanvas(cdp) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const visible = await evaluate(cdp, `(() => {
        const canvas = document.querySelector("canvas");
        if (!canvas) return false;
        const style = getComputedStyle(canvas);
        return style.visibility !== "hidden" && style.display !== "none" && canvas.getBoundingClientRect().width > 0;
      })()`);
      if (visible) return;
    } catch {
      // A reload briefly destroys the JavaScript execution context.
    }
    await wait(1_000);
  }
  throw new Error("Android canvas did not become visible within 120 seconds");
}

adb("shell", "am", "force-stop", packageName);
adb("shell", "am", "start", "-W", "-n", `${packageName}/dev.vdustr.pokerogue.offline.MainActivity`);

let processId;
for (let attempt = 0; attempt < 60 && !processId; attempt += 1) {
  try {
    processId = adb("shell", "pidof", packageName);
  } catch {
    processId = undefined;
  }
  if (!processId) await wait(1_000);
}
if (!processId) {
  throw new Error(`Android app did not start: ${packageName}`);
}

const port = adb("forward", "tcp:0", `localabstract:webview_devtools_remote_${processId}`);
let cdp;
try {
  const endpoint = `http://127.0.0.1:${port}`;
  let target;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(`${endpoint}/json`);
      const targets = await response.json();
      target = targets.find(candidate => candidate.url.startsWith("https://appassets.androidplatform.net"));
      if (target?.webSocketDebuggerUrl) break;
    } catch {
      // The WebView DevTools socket is created after the first page starts loading.
    }
    await wait(1_000);
  }
  if (!target?.webSocketDebuggerUrl) {
    throw new Error("No offline Android WebView target was exposed within 120 seconds");
  }

  cdp = await connectCdp(target.webSocketDebuggerUrl);
  const pageErrors = [];
  cdp.on("Runtime.exceptionThrown", ({ exceptionDetails }) => {
    pageErrors.push(exceptionDetails.exception?.description ?? exceptionDetails.text);
  });
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  await waitForCanvas(cdp);
  await wait(3_000);

  const initialState = await evaluate(cdp, `(async () => {
    localStorage.setItem("pokerogue-android-e2e", "persisted");
    let networkBlocked = false;
    try {
      const response = await fetch("https://example.com/pokerogue-network-probe", { cache: "no-store" });
      networkBlocked = response.status === 403;
    } catch {
      networkBlocked = true;
    }
    return {
      canvasCount: document.querySelectorAll("canvas").length,
      networkBlocked,
      origin: location.origin,
    };
  })()`);

  const loaded = cdp.waitForEvent("Page.loadEventFired");
  await cdp.send("Page.reload", { ignoreCache: true });
  await loaded;
  await waitForCanvas(cdp);
  const persisted = await evaluate(cdp, `localStorage.getItem("pokerogue-android-e2e")`);
  const permissions = adb("shell", "dumpsys", "package", packageName);

  if (
    initialState.canvasCount === 0
    || !initialState.networkBlocked
    || initialState.origin !== "https://appassets.androidplatform.net"
    || persisted !== "persisted"
    || permissions.includes("android.permission.INTERNET")
    || pageErrors.length > 0
  ) {
    throw new Error(
      `Android E2E failed: ${JSON.stringify({ initialState, persisted, pageErrors })}`,
    );
  }

  console.log(`Android E2E passed for ${packageName}: local save persisted and network was blocked.`);
} finally {
  cdp?.close();
  adb("forward", "--remove", `tcp:${port}`);
}
