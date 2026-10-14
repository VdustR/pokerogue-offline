const { app, BrowserWindow, protocol, ipcMain } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { once } = require('node:events');
const runDir = process.env.CONTRACT_RUN_DIR;
fs.mkdirSync(runDir, { recursive: true });
app.setPath('userData', path.join(runDir, 'user-data'));
protocol.registerSchemesAsPrivileged(['contract-file', 'contract-http'].map(scheme => ({ scheme, privileges: { supportFetchAPI: true } })));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const bounded = (promise, label) => Promise.race([promise, delay(15000).then(() => { throw new Error(`Timed out: ${label}`); })]);
const results = [];
const windows = [];
function window(webPreferences = {}) {
  const w = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, ...webPreferences } });
  windows.push(w);
  return w;
}
async function test(name, fn) {
  try { results.push({ name, ...await bounded(fn(), name) }); }
  catch (error) { results.push({ name, error: error.stack, pass: false }); }
}
app.whenReady().then(async () => {
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    if (req.url === '/sandbox') {
      res.setHeader('Content-Security-Policy', 'sandbox allow-scripts allow-popups');
      res.end(`<script>addEventListener('DOMContentLoaded', () => {
        const a = document.createElement('a'); a.href = '/popup'; document.body.appendChild(a);
        a.dispatchEvent(new MouseEvent('click', {ctrlKey:true,metaKey:true,bubbles:true,cancelable:true,view:window}));
      });</script>`);
    } else if (req.url === '/marker') { res.setHeader('Content-Type', 'text/plain'); res.end('fixture-marker'); }
    else { res.end('<title>fixture</title>'); }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}`;
  await test('top-level-sandbox-popup', async () => {
    const w = window();
    w.webContents.setWindowOpenHandler(() => ({ action: 'allow', overrideBrowserWindowOptions: { show: false } }));
    const created = once(w.webContents, 'did-create-window');
    await w.loadURL(`${url}/sandbox`);
    const [popup] = await created;
    windows.push(popup);
    if (popup.webContents.isLoading()) await once(popup.webContents, 'did-finish-load');
    const observed = await popup.webContents.executeJavaScript(`(() => {
      const result = { origin: String(self.origin) };
      try { localStorage.setItem('fixture', '1'); result.localStorage = 'allowed'; } catch (e) { result.localStorage = e.name; }
      try { document.cookie = 'fixture=1'; result.cookie = 'allowed'; } catch (e) { result.cookie = e.name; }
      return result;
    })()`);
    return { observed, pass: observed.origin === 'null' && observed.localStorage === 'SecurityError' && observed.cookie === 'SecurityError' };
  });
  await test('file-http-cross-origin-opaque', async () => {
    const marker = path.join(runDir, 'marker.txt'); fs.writeFileSync(marker, 'fixture-marker');
    protocol.registerFileProtocol('contract-file', (_req, cb) => cb({ path: marker }));
    protocol.registerHttpProtocol('contract-http', (_req, cb) => cb({ url: `${url}/marker` }));
    const w = window(); await w.loadURL(url);
    const observed = [];
    for (const scheme of ['contract-file', 'contract-http']) {
      observed.push(await w.webContents.executeJavaScript(`fetch('${scheme}://host/marker', { mode: 'no-cors' }).then(async r => ({ type: r.type, status: r.status, body: await r.text() }))`));
    }
    return { observed, pass: observed.every(r => r.type === 'opaque' && r.status === 0 && r.body === '') };
  });
  await test('webview-worker-node-inheritance', async () => {
    const w = window({ webviewTag: true, sandbox: false, nodeIntegration: false });
    await w.loadURL('about:blank');
    const src = 'data:text/html,' + encodeURIComponent(`<script>const wk = new Worker(URL.createObjectURL(new Blob(['postMessage(typeof require)'], {type:'text/javascript'})));wk.onmessage = e => console.log('CONTRACT_WORKER:' + e.data);</script>`);
    const observed = await w.webContents.executeJavaScript(`new Promise(resolve => {
      const guest = document.createElement('webview');
      guest.setAttribute('src', ${JSON.stringify(src)});
      guest.setAttribute('webpreferences', 'nodeIntegrationInWorker=yes');
      guest.addEventListener('console-message', e => { if (e.message.startsWith('CONTRACT_WORKER:')) resolve(e.message.slice('CONTRACT_WORKER:'.length)); });
      document.body.appendChild(guest);
    })`);
    return { observed, pass: observed === 'undefined' };
  });
  await test('preload-cache-principal-separation', async () => {
    const preload = path.join(runDir, 'preload.cjs');
    fs.writeFileSync(preload, `const {ipcRenderer} = require('electron');\nipcRenderer.send('contract-preload-ran');\n`);
    for (const host of ['127.0.0.1', 'localhost']) {
      const w = window({ preload });
      const ran = once(ipcMain, 'contract-preload-ran');
      await w.loadURL(`http://${host}:${port}/`); await ran;
      await delay(1000); w.destroy();
    }
    const key = crypto.createHash('sha256').update(`preload-${preload}`).digest('hex').toUpperCase();
    const dir = path.join(app.getPath('sessionData'), 'Code Cache', 'electron-preload');
    let observed = [];
    for (let i = 0; i < 30; i++) {
      observed = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.startsWith(key) && f.endsWith('.cache') && fs.statSync(path.join(dir, f)).size > 0) : [];
      if (observed.length >= 2) break;
      await delay(100);
    }
    return { observed, pass: observed.length === 2 };
  });
  const output = { electron: process.versions.electron, method: 'Native runtime; adapted upstream regression contracts; harmless loopback fixtures', results };
  fs.writeFileSync(path.join(runDir, 'results.json'), JSON.stringify(output, null, 2) + '\n');
  console.log(JSON.stringify(output));
  for (const w of windows) if (!w.isDestroyed()) w.destroy();
  server.close();
  app.exit(results.every(r => r.pass) ? 0 : 1);
}).catch(error => { console.error(error); app.exit(2); });
