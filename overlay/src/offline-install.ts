import { isApp } from "#constants/app-constants";

type OfflineWorkerMessage = {
  type: "OFFLINE_STATUS" | "OFFLINE_PROGRESS" | "OFFLINE_COMPLETE" | "OFFLINE_ERROR";
  ready?: boolean;
  completed?: number;
  total?: number;
  completedBytes?: number;
  totalBytes?: number;
  revision?: string;
  message?: string;
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

function createInstaller(): {
  panel: HTMLDivElement;
  status: HTMLDivElement;
  progress: HTMLProgressElement;
  button: HTMLButtonElement;
} {
  const style = document.createElement("style");
  style.textContent = `
    #offline-installer {
      position: fixed;
      z-index: 2147483647;
      right: max(12px, env(safe-area-inset-right));
      bottom: max(12px, env(safe-area-inset-bottom));
      width: min(360px, calc(100vw - 24px));
      box-sizing: border-box;
      padding: 14px;
      border: 2px solid #ffffff;
      border-radius: 10px;
      background: rgba(20, 20, 24, 0.94);
      color: #ffffff;
      font: 16px/1.35 system-ui, sans-serif;
      box-shadow: 0 8px 30px rgba(0, 0, 0, 0.45);
    }
    #offline-installer[data-ready="true"] { width: auto; padding: 9px 12px; }
    #offline-installer strong { display: block; margin-bottom: 5px; }
    #offline-installer progress { width: 100%; margin: 10px 0; accent-color: #57c46c; }
    #offline-installer button {
      width: 100%;
      padding: 9px 12px;
      border: 0;
      border-radius: 6px;
      background: #da3838;
      color: #ffffff;
      font: inherit;
      font-weight: 700;
      cursor: pointer;
    }
    #offline-installer button:disabled { cursor: wait; opacity: 0.7; }
  `;
  document.head.append(style);

  const panel = document.createElement("div");
  panel.id = "offline-installer";
  panel.dataset.testid = "offline-installer";
  panel.innerHTML = `
    <strong>Offline game files</strong>
    <div data-testid="offline-status">Checking offline storage…</div>
    <progress data-testid="offline-progress" value="0" max="1" hidden></progress>
    <button data-testid="offline-download" type="button" hidden>Download for offline play</button>
  `;
  document.body.append(panel);

  return {
    panel,
    status: panel.querySelector<HTMLDivElement>("[data-testid='offline-status']")!,
    progress: panel.querySelector<HTMLProgressElement>("[data-testid='offline-progress']")!,
    button: panel.querySelector<HTMLButtonElement>("[data-testid='offline-download']")!,
  };
}

async function startOfflineInstaller(): Promise<void> {
  const ui = createInstaller();

  if (!("serviceWorker" in navigator)) {
    ui.status.textContent = "This browser does not support offline installation.";
    return;
  }

  let registration: ServiceWorkerRegistration;
  try {
    registration = await navigator.serviceWorker.register("./service-worker.js");
    await navigator.serviceWorker.ready;
  } catch (error) {
    ui.status.textContent = `Offline worker failed to start: ${String(error)}`;
    return;
  }

  const worker = registration.active ?? registration.waiting ?? registration.installing;
  if (!worker) {
    ui.status.textContent = "Offline worker is not available yet. Reload to retry.";
    return;
  }

  const requestDownload = async (): Promise<void> => {
    ui.button.disabled = true;
    ui.button.textContent = "Downloading…";
    ui.progress.hidden = false;
    if (navigator.storage?.persist) {
      await navigator.storage.persist();
    }
    worker.postMessage({ type: "CACHE_ALL" });
  };

  ui.button.addEventListener("click", requestDownload);
  navigator.serviceWorker.addEventListener("message", event => {
    const message = event.data as OfflineWorkerMessage;
    if (message.type === "OFFLINE_STATUS") {
      if (message.ready) {
        ui.panel.dataset.ready = "true";
        ui.status.textContent = `Offline ready · ${message.revision}`;
        ui.button.hidden = true;
        ui.progress.hidden = true;
      } else {
        ui.status.textContent = `Download ${formatBytes(message.totalBytes ?? 0)} once, then the game can cold-start without a network.`;
        ui.button.hidden = false;
      }
    } else if (message.type === "OFFLINE_PROGRESS") {
      const completed = message.completed ?? 0;
      const total = message.total ?? 1;
      ui.progress.value = completed;
      ui.progress.max = total;
      ui.status.textContent = `${completed.toLocaleString()} / ${total.toLocaleString()} files · ${formatBytes(message.completedBytes ?? 0)} / ${formatBytes(message.totalBytes ?? 0)}`;
    } else if (message.type === "OFFLINE_COMPLETE") {
      ui.panel.dataset.ready = "true";
      ui.status.textContent = `Offline ready · ${message.revision}`;
      ui.button.hidden = true;
      ui.progress.hidden = true;
    } else if (message.type === "OFFLINE_ERROR") {
      ui.status.textContent = `Download stopped: ${message.message ?? "unknown error"}`;
      ui.button.disabled = false;
      ui.button.hidden = false;
      ui.button.textContent = "Retry offline download";
    }
  });

  worker.postMessage({ type: "GET_STATUS" });
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
