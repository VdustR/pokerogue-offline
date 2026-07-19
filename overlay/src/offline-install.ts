import { isApp } from "#constants/app-constants";

type OfflineWorkerMessage = {
  type: "OFFLINE_STATUS" | "OFFLINE_PROGRESS" | "OFFLINE_COMPLETE" | "OFFLINE_ERROR";
  ready?: boolean;
  fallbackReady?: boolean;
  completed?: number;
  total?: number;
  completedBytes?: number;
  totalBytes?: number;
  revision?: string;
  message?: string;
};

type StandaloneNavigator = Navigator & { standalone?: boolean };

type OfflineIndicator = {
  panel: HTMLDivElement;
  status: HTMLDivElement;
  progress: HTMLDivElement;
  progressTrack: HTMLDivElement;
  show: (duration?: number) => void;
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 ** 2) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function isInstalledPwa(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches
    || window.matchMedia("(display-mode: fullscreen)").matches
    || window.matchMedia("(display-mode: minimal-ui)").matches
    || (navigator as StandaloneNavigator).standalone === true
  );
}

function createIndicator(): OfflineIndicator {
  const style = document.createElement("style");
  style.textContent = `
    #offline-installer {
      position: fixed;
      z-index: 1000;
      top: max(10px, env(safe-area-inset-top));
      left: 50%;
      width: min(420px, calc(100vw - 24px));
      box-sizing: border-box;
      padding: 8px 12px;
      border-radius: 10px;
      background: rgba(18, 20, 24, 0.94);
      color: #ffffff;
      font: 600 13px/1.35 system-ui, sans-serif;
      text-align: center;
      pointer-events: none;
      opacity: 0;
      transform: translate(-50%, -8px);
      transition: opacity 180ms ease-out, transform 180ms ease-out;
    }
    #offline-installer[data-visible="true"] {
      opacity: 1;
      transform: translate(-50%, 0);
    }
    #offline-progress-track {
      position: fixed;
      z-index: 999;
      right: 0;
      bottom: 0;
      left: 0;
      height: max(3px, env(safe-area-inset-bottom));
      background: rgba(255, 255, 255, 0.18);
      pointer-events: none;
      opacity: 0;
      transition: opacity 180ms ease-out;
    }
    #offline-progress-track[data-visible="true"] { opacity: 1; }
    #offline-progress {
      width: 0;
      height: 100%;
      background: #57c46c;
      transform-origin: left;
      transition: width 180ms ease-out;
    }
    @media (prefers-reduced-motion: reduce) {
      #offline-installer,
      #offline-progress-track,
      #offline-progress { transition: none; }
    }
  `;
  document.head.append(style);

  const panel = document.createElement("div");
  panel.id = "offline-installer";
  panel.dataset.testid = "offline-installer";
  panel.dataset.completed = "0";
  panel.setAttribute("role", "status");
  panel.setAttribute("aria-live", "polite");
  panel.innerHTML = '<div data-testid="offline-status">Preparing offline update…</div>';

  const progressTrack = document.createElement("div");
  progressTrack.id = "offline-progress-track";
  progressTrack.setAttribute("aria-hidden", "true");
  progressTrack.innerHTML = '<div id="offline-progress" data-testid="offline-progress"></div>';
  document.body.append(panel, progressTrack);

  let hideTimer: number | undefined;
  const show = (duration = 0): void => {
    window.clearTimeout(hideTimer);
    panel.dataset.visible = "true";
    if (duration > 0) {
      hideTimer = window.setTimeout(() => {
        panel.dataset.visible = "false";
      }, duration);
    }
  };

  return {
    panel,
    status: panel.querySelector<HTMLDivElement>("[data-testid='offline-status']")!,
    progress: progressTrack.querySelector<HTMLDivElement>("[data-testid='offline-progress']")!,
    progressTrack,
    show,
  };
}

function showReady(ui: OfflineIndicator, revision?: string): void {
  ui.panel.dataset.ready = "true";
  ui.status.textContent = `Offline ready · ${revision}`;
  ui.progress.style.width = "100%";
  ui.progressTrack.dataset.visible = "false";
  ui.show(4_000);
}

function showProgress(ui: OfflineIndicator, message: OfflineWorkerMessage): void {
  const completed = message.completed ?? 0;
  const total = Math.max(message.total ?? 1, 1);
  ui.panel.dataset.completed = String(completed);
  ui.progress.style.width = `${Math.min((completed / total) * 100, 100)}%`;
  ui.status.textContent = `Offline update ${completed.toLocaleString()} / ${total.toLocaleString()} · ${formatBytes(message.completedBytes ?? 0)} / ${formatBytes(message.totalBytes ?? 0)}`;
  ui.progressTrack.dataset.visible = "true";
}

function handleStatus(ui: OfflineIndicator, message: OfflineWorkerMessage, requestCache: () => Promise<void>): void {
  if (message.ready) {
    showReady(ui, message.revision);
    return;
  }

  ui.status.textContent = message.fallbackReady
    ? `Updating offline files in the background · ${formatBytes(message.totalBytes ?? 0)}`
    : `Preparing ${formatBytes(message.totalBytes ?? 0)} for offline play`;
  ui.progressTrack.dataset.visible = "true";
  ui.show(5_000);
  requestCache().catch(error => console.error("Offline cache request failed:", error));
}

function handleError(ui: OfflineIndicator, scheduleRetry: () => void): void {
  ui.status.textContent = navigator.onLine
    ? "Offline update paused. Retrying automatically…"
    : "Offline update paused. It will resume when the network returns.";
  ui.progressTrack.dataset.visible = "false";
  ui.show(8_000);
  if (navigator.onLine) {
    scheduleRetry();
  }
}

async function startOfflineInstaller(): Promise<void> {
  if (!isInstalledPwa()) {
    return;
  }

  const ui = createIndicator();
  ui.show();
  if (!("serviceWorker" in navigator)) {
    ui.status.textContent = "Offline mode is unavailable in this browser.";
    ui.show(8_000);
    return;
  }

  let registration: ServiceWorkerRegistration;
  try {
    registration = await navigator.serviceWorker.register("./service-worker.js");
    await registration.update().catch(() => undefined);
    registration = await navigator.serviceWorker.ready;
  } catch (error) {
    ui.status.textContent = `Offline update paused: ${String(error)}`;
    ui.show(8_000);
    return;
  }

  let retryTimer: number | undefined;
  const getWorker = (): ServiceWorker | undefined =>
    registration.active ?? registration.waiting ?? registration.installing ?? undefined;
  const requestCache = async (): Promise<void> => {
    window.clearTimeout(retryTimer);
    if (!navigator.onLine) {
      return;
    }
    if (navigator.storage?.persist) {
      await navigator.storage.persist().catch(() => false);
    }
    getWorker()?.postMessage({ type: "CACHE_ALL" });
  };
  const requestStatus = (): void => {
    getWorker()?.postMessage({ type: "GET_STATUS" });
  };
  const scheduleRetry = (): void => {
    retryTimer = window.setTimeout(() => {
      requestCache().catch(error => console.error("Offline cache retry failed:", error));
    }, 15_000);
  };

  const handleWorkerMessage = (message: OfflineWorkerMessage): void => {
    switch (message.type) {
      case "OFFLINE_STATUS":
        handleStatus(ui, message, requestCache);
        break;
      case "OFFLINE_PROGRESS":
        showProgress(ui, message);
        break;
      case "OFFLINE_COMPLETE":
        showReady(ui, message.revision);
        break;
      case "OFFLINE_ERROR":
        handleError(ui, scheduleRetry);
        break;
    }
  };

  navigator.serviceWorker.addEventListener("message", event => {
    handleWorkerMessage(event.data as OfflineWorkerMessage);
  });

  navigator.serviceWorker.addEventListener("controllerchange", requestStatus);
  window.addEventListener("online", () => {
    requestStatus();
    requestCache().catch(error => console.error("Offline cache resume failed:", error));
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      registration.update().catch(() => undefined);
      requestStatus();
    }
  });

  requestStatus();
}

if (isApp) {
  const start = (): void => {
    startOfflineInstaller().catch(error => console.error("Offline installer failed:", error));
  };
  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
}
