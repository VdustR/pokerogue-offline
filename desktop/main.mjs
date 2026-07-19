import { app, BrowserWindow, Menu, protocol, session } from "electron";
import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

const APP_SCHEME = "pokerogue";
const APP_HOST = "game";
const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const MIME_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".html", "text/html; charset=utf-8"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".m4a", "audio/mp4"],
  [".mp3", "audio/mpeg"],
  [".mp4", "video/mp4"],
  [".ogg", "audio/ogg"],
  [".otf", "font/otf"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".ttf", "font/ttf"],
  [".wav", "audio/wav"],
  [".webm", "video/webm"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

if (!app.isPackaged && process.env.POKEROGUE_REMOTE_DEBUGGING_PORT) {
  app.commandLine.appendSwitch("remote-debugging-port", process.env.POKEROGUE_REMOTE_DEBUGGING_PORT);
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      corsEnabled: true,
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      codeCache: true,
    },
  },
]);

function getGameDirectory() {
  if (!app.isPackaged && process.env.POKEROGUE_GAME_DIR) {
    return path.resolve(process.env.POKEROGUE_GAME_DIR);
  }
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "game");
  }
  return path.join(moduleDirectory, "game");
}

function resolveGamePath(requestUrl) {
  const url = new URL(requestUrl);
  if (url.host !== APP_HOST) {
    return undefined;
  }

  const pathname = decodeURIComponent(url.pathname);
  const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const gameDirectory = getGameDirectory();
  const resolvedPath = path.resolve(gameDirectory, relativePath);
  if (resolvedPath !== gameDirectory && !resolvedPath.startsWith(`${gameDirectory}${path.sep}`)) {
    return undefined;
  }
  return resolvedPath;
}

function configureOfflineSession() {
  const appSession = session.defaultSession;
  appSession.setPermissionCheckHandler(() => false);
  appSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  appSession.webRequest.onBeforeRequest(
    { urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"] },
    (_details, callback) => callback({ cancel: true }),
  );
}

function parseRange(rangeHeader, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader ?? "");
  if (!match || (!match[1] && !match[2])) return undefined;

  let start;
  let end;
  if (!match[1]) {
    const suffixLength = Number.parseInt(match[2], 10);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return undefined;
    start = Math.max(size - suffixLength, 0);
    end = size - 1;
  } else {
    start = Number.parseInt(match[1], 10);
    end = match[2] ? Number.parseInt(match[2], 10) : size - 1;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= size || end < start) {
    return undefined;
  }
  return { start, end: Math.min(end, size - 1) };
}

function serveGameFile(request, resolvedPath) {
  if (!new Set(["GET", "HEAD"]).has(request.method)) {
    return new Response("Method not allowed", { status: 405 });
  }

  const fileStat = statSync(resolvedPath);
  const rangeHeader = request.headers.get("range");
  const range = rangeHeader ? parseRange(rangeHeader, fileStat.size) : undefined;
  if (rangeHeader && !range) {
    return new Response(null, {
      headers: { "Content-Range": `bytes */${fileStat.size}` },
      status: 416,
    });
  }

  const start = range?.start ?? 0;
  const end = range?.end ?? fileStat.size - 1;
  const headers = {
    "Accept-Ranges": "bytes",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
    "Content-Length": String(Math.max(end - start + 1, 0)),
    "Content-Type": MIME_TYPES.get(path.extname(resolvedPath).toLowerCase()) ?? "application/octet-stream",
  };
  if (range) headers["Content-Range"] = `bytes ${start}-${end}/${fileStat.size}`;

  const body = request.method === "HEAD" || fileStat.size === 0
    ? null
    : Readable.toWeb(createReadStream(resolvedPath, { start, end }));
  const response = new Response(body, {
    headers,
    status: range ? 206 : 200,
  });
  return response;
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 960,
    minHeight: 540,
    backgroundColor: "#000000",
    show: false,
    autoHideMenuBar: true,
    title: app.getName(),
    webPreferences: {
      allowRunningInsecureContent: false,
      contextIsolation: true,
      devTools: !app.isPackaged,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", event => {
    const target = new URL(event.url);
    if (target.protocol !== `${APP_SCHEME}:` || target.host !== APP_HOST) {
      event.preventDefault();
    }
  });
  window.webContents.on("before-input-event", (event, input) => {
    if (input.type === "keyDown" && input.key === "F11") {
      window.setFullScreen(!window.isFullScreen());
      event.preventDefault();
    }
  });
  window.once("ready-to-show", () => window.show());
  void window.loadURL(`${APP_SCHEME}://${APP_HOST}/index.html`);
  return window;
}

void app.whenReady().then(() => {
  const gameDirectory = getGameDirectory();
  if (!existsSync(path.join(gameDirectory, "index.html"))) {
    throw new Error(`Packaged game is missing index.html: ${gameDirectory}`);
  }

  session.defaultSession.protocol.handle(APP_SCHEME, request => {
    const resolvedPath = resolveGamePath(request.url);
    if (!resolvedPath || !existsSync(resolvedPath)) {
      return new Response("Not found", { status: 404 });
    }

    try {
      return serveGameFile(request, resolvedPath);
    } catch (error) {
      console.error(`Failed to serve ${resolvedPath}`, error);
      return new Response("Failed to read packaged game resource", {
        status: 500,
      });
    }
  });

  configureOfflineSession();
  Menu.setApplicationMenu(null);
  createWindow();
}).catch(error => {
  console.error(error);
  app.exit(1);
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
