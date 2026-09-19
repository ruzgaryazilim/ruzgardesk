// RüzgarDesk - Electron main process
// Elevation (admin), embedded signaling server, silent screen capture,
// native input injection, disk file transfer, and optional Cloudflare tunnel.

const { app, BrowserWindow, Tray, Menu, ipcMain, session, desktopCapturer, screen, nativeImage, shell, dialog, clipboard, systemPreferences } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync, spawn } = require('child_process');
const { autoUpdater } = require('electron-updater');

// Performance & GPU acceleration flags for low latency 60fps streaming
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('ignore-gpu-blocklist');

const { createSignalingServer } = require('../signaling');
const { InputInjector } = require('./inputInjector');
const { UacCompatibility } = require('./uacCompatibility');

app.setName('RuzgarDesk'); // stable userData path (%APPDATA%\RuzgarDesk or ~/Library/Application Support/RuzgarDesk)

const isDev = process.argv.includes('--dev') || !app.isPackaged;

let mainWindow = null;
let tray = null;
let embeddedUrl = null;
let embeddedPort = null;
let injector = null;
let uacCompatibility = null;
let tunnelProc = null;
let tunnelUrl = null;
let updateInstallTimer = null;
let updateCheckTimer = null;
let updateCheckPromise = null;
let updaterInitialized = false;
let updaterStatus = { state: 'idle', message: 'Güncelleme denetimi bekleniyor.' };

const UPDATE_URLS = [
  'https://api.ruzgaryazilim.com.tr/updates',
  'https://ruzgardesk-updates.iphanne.workers.dev/updates'
];

// ---------------------------------------------------------------------------
// Diagnostic log (userData/ruzgardesk.log) — helps troubleshoot the packaged app
// ---------------------------------------------------------------------------
let logStream = null;
function initLogStream() {
  try {
    const logPath = path.join(app.getPath('userData'), 'ruzgardesk.log');
    if (fs.existsSync(logPath)) {
      const stats = fs.statSync(logPath);
      if (stats.size > 5 * 1024 * 1024) {
        // Keep the last 100 KB to avoid uncontrolled log growth
        const tailSize = 100 * 1024;
        const buf = Buffer.alloc(tailSize);
        const fd = fs.openSync(logPath, 'r');
        const readBytes = fs.readSync(fd, buf, 0, tailSize, Math.max(0, stats.size - tailSize));
        fs.closeSync(fd);
        fs.writeFileSync(logPath, buf.subarray(0, readBytes));
      }
    }
    logStream = fs.createWriteStream(logPath, { flags: 'a' });
  } catch (e) {}
}

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.join(' ')}`;
  console.log(line);
  try {
    if (!logStream) initLogStream();
    if (logStream) logStream.write(line + '\n');
  } catch (e) {}
}

process.on('uncaughtException', (err) => {
  log('[main][FATAL] uncaughtException:', err && err.stack ? err.stack : String(err));
});

process.on('unhandledRejection', (reason) => {
  log('[main][WARN] unhandledRejection:', reason && reason.stack ? reason.stack : String(reason));
});

// ---------------------------------------------------------------------------
// Config (persisted in userData)
// ---------------------------------------------------------------------------
const configPath = () => path.join(app.getPath('userData'), 'config.json');

const defaultConfig = {
  serverUrl: '',        // empty => use embedded local server
  deskId: '',           // preferred/last Desk ID
  passcode: '',         // unattended access password
  unattended: false,    // auto-accept incoming requests that supply the passcode
  minimizeToTray: true
};

function loadConfig() {
  try {
    const raw = fs.readFileSync(configPath(), 'utf8');
    return Object.assign({}, defaultConfig, JSON.parse(raw));
  } catch (e) {
    return Object.assign({}, defaultConfig);
  }
}

function saveConfig(cfg) {
  try {
    fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2), 'utf8');
  } catch (e) {
    console.error('[config] save failed:', e.message);
  }
}

let config = defaultConfig;

// ---------------------------------------------------------------------------
// Administrator elevation
// ---------------------------------------------------------------------------
function isAdmin() {
  try {
    // "net session" only succeeds for elevated processes.
    execSync('net session', { stdio: 'ignore', windowsHide: true });
    return true;
  } catch (e) {
    return false;
  }
}

function relaunchElevated() {
  if (process.platform !== 'win32') return false;
  try {
    const exe = process.execPath;
    const psArgs = [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
      `Start-Process -FilePath "${exe}" -Verb RunAs`
    ];
    spawn('powershell.exe', psArgs, { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    app.isQuitting = true;
    setTimeout(() => app.quit(), 500);
    return true;
  } catch (e) {
    log('[elevation] relaunchElevated failed:', e.message);
    return false;
  }
}

// Relaunch the packaged app elevated (UAC prompt). Dev runs stay unelevated so
// the developer isn't fighting UAC on every `npm start`.
function ensureAdmin() {
  if (process.platform !== 'win32') return true;
  if (process.env.RUZGAR_SKIP_ELEVATION === '1') return true;
  if (isAdmin()) return true;
  if (isDev) {
    console.warn('[elevation] not elevated (dev mode) — remote control of admin windows will be limited');
    return true;
  }
  return relaunchElevated() ? false : true;
}

// Allow inbound LAN connections through Windows Firewall (best-effort; needs admin).
function ensureFirewallRule() {
  if (process.platform !== 'win32') return;
  const exe = process.execPath;
  const name = 'RuzgarDesk';
  try {
    const check = execSync(`netsh advfirewall firewall show rule name="${name}"`, { windowsHide: true }).toString();
    if (check.includes(name)) return; // already present
  } catch (e) { /* no rule yet */ }
  try {
    execSync(`netsh advfirewall firewall add rule name="${name}" dir=in action=allow program="${exe}" enable=yes profile=any`, { windowsHide: true, stdio: 'ignore' });
    log('[firewall] inbound rule added for RuzgarDesk');
  } catch (e) {
    log('[firewall] could not add rule: ' + e.message);
  }
}

// Auto-start elevated at logon via Task Scheduler (RunLevel Highest = no UAC
// prompt). This keeps an unattended host reachable: after a reboot the host
// comes back on its own, so a stuck remote can always be recovered by rebooting.
function ensureAutostart() {
  if (process.platform === 'darwin') {
    if (app.isPackaged && (!config || config.autostart !== false)) {
      try {
        app.setLoginItemSettings({ openAtLogin: true });
        log('[autostart] macOS login item enabled');
      } catch (e) {
        log('[autostart] macOS login item failed: ' + e.message);
      }
    }
    return;
  }
  if (process.platform !== 'win32' || !app.isPackaged) return;
  if (config && config.autostart === false) return;
  const exe = process.execPath;
  const ps =
    "$a = New-ScheduledTaskAction -Execute '" + exe + "'; " +
    "$t = New-ScheduledTaskTrigger -AtLogOn; " +
    "$s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable; " +
    "Register-ScheduledTask -TaskName 'RuzgarDeskAutostart' -Action $a -Trigger $t -Settings $s -RunLevel Highest -Force";
  try {
    execSync('powershell -NoProfile -ExecutionPolicy Bypass -Command "' + ps + '"', { windowsHide: true, stdio: 'ignore' });
    log('[autostart] logon task ensured (elevated, no UAC)');
  } catch (e) {
    log('[autostart] could not create task: ' + e.message);
  }
}

// ---------------------------------------------------------------------------
// Local network address (for LAN connections)
// ---------------------------------------------------------------------------
function getLocalIPv4() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return '127.0.0.1';
}

// ---------------------------------------------------------------------------
// Embedded signaling server
// ---------------------------------------------------------------------------
const PREFERRED_PORT = 7443; // stable LAN address; falls back to a random free port

function startEmbeddedServer() {
  return new Promise((resolve) => {
    const { server } = createSignalingServer();
    const onListening = () => {
      embeddedPort = server.address().port;
      embeddedUrl = `http://127.0.0.1:${embeddedPort}`;
      log(`[main] embedded signaling on ${embeddedUrl} (LAN: http://${getLocalIPv4()}:${embeddedPort})`);
      resolve();
    };
    server.once('error', (err) => {
      // Preferred port busy (e.g. a second instance / another app) — use a random one.
      log('[main] preferred port unavailable (' + err.code + '), using random port');
      server.listen(0, '0.0.0.0', onListening);
    });
    server.listen(PREFERRED_PORT, '0.0.0.0', onListening);
  });
}

// ---------------------------------------------------------------------------
// Cloudflare tunnel (share embedded server over the internet)
// ---------------------------------------------------------------------------
function cloudflaredPath() {
  const binName = process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';
  if (app.isPackaged) return path.join(process.resourcesPath, binName);
  return path.join(__dirname, '..', binName);
}

function startTunnel() {
  return new Promise((resolve, reject) => {
    if (tunnelUrl) return resolve(tunnelUrl);
    const bin = cloudflaredPath();
    const binName = process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';
    if (!fs.existsSync(bin)) return reject(new Error(`${binName} bulunamadı`));

    tunnelProc = spawn(bin, ['tunnel', '--url', `http://localhost:${embeddedPort}`], { windowsHide: true });
    const onData = (buf) => {
      const text = buf.toString();
      const m = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
      if (m && !tunnelUrl) {
        tunnelUrl = m[0];
        console.log('[tunnel] public url:', tunnelUrl);
        resolve(tunnelUrl);
      }
    };
    tunnelProc.stdout.on('data', onData);
    tunnelProc.stderr.on('data', onData);
    tunnelProc.on('exit', (code) => {
      console.warn('[tunnel] exited', code);
      tunnelProc = null;
      tunnelUrl = null;
    });
    setTimeout(() => { if (!tunnelUrl) reject(new Error('Tünel zaman aşımına uğradı')); }, 30000);
  });
}

function stopTunnel() {
  if (tunnelProc) { try { tunnelProc.kill(); } catch (e) {} tunnelProc = null; }
  tunnelUrl = null;
}

// ---------------------------------------------------------------------------
// Window + tray
// ---------------------------------------------------------------------------
function appIcon() {
  // public/ is packaged inside the asar; build/ is not — prefer the packaged copy.
  const candidates = [
    path.join(__dirname, '..', 'public', 'logo.png'),
    path.join(__dirname, '..', 'build', 'icon.png')
  ];
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return nativeImage.createFromPath(p); } catch (e) {}
  }
  return undefined;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 940,
    minHeight: 640,
    backgroundColor: '#0b0b14',
    icon: appIcon(),
    autoHideMenuBar: true,
    title: 'RüzgarDesk',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadURL(embeddedUrl);

  mainWindow.webContents.on('did-finish-load', () => {
    log('[window] UI loaded from', embeddedUrl);
    try { fs.writeFileSync(path.join(app.getPath('userData'), 'last-boot-ok.txt'), new Date().toISOString()); } catch (e) {}
  });
  mainWindow.webContents.on('did-fail-load', (e, code, desc) => log('[window] did-fail-load', code, desc));
  mainWindow.webContents.on('render-process-gone', (e, details) => {
    log('[window] render-process-gone', JSON.stringify(details));
    if (uacCompatibility) uacCompatibility.disableForRemoteSession();
  });
  mainWindow.webContents.on('console-message', (e, level, message) => {
    if (level >= 2) log('[renderer]', message); // warnings + errors
  });

  if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });

  mainWindow.on('close', (e) => {
    if (config.minimizeToTray && !app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  try {
    const icon = appIcon();
    tray = new Tray(icon || nativeImage.createEmpty());
    const menu = Menu.buildFromTemplate([
      { label: 'RüzgarDesk\'i Göster', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } } },
      { type: 'separator' },
      { label: 'Çıkış', click: () => { app.isQuitting = true; app.quit(); } }
    ]);
    tray.setToolTip('RüzgarDesk - Uzak Masaüstü');
    tray.setContextMenu(menu);
    tray.on('double-click', () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } });
  } catch (e) {
    console.error('[tray] failed:', e.message);
  }
}

function createAppMenu() {
  if (process.platform !== 'darwin') return;
  const template = [
    {
      label: app.name,
      submenu: [
        { role: 'about', label: 'RüzgarDesk Hakkında' },
        { type: 'separator' },
        { role: 'services', label: 'Hizmetler' },
        { type: 'separator' },
        { role: 'hide', label: 'RüzgarDesk\'i Gizle' },
        { role: 'hideOthers', label: 'Diğerlerini Gizle' },
        { role: 'unhide', label: 'Tümünü Göster' },
        { type: 'separator' },
        { role: 'quit', label: 'RüzgarDesk\'ten Çık' }
      ]
    },
    {
      label: 'Düzen',
      submenu: [
        { role: 'undo', label: 'Geri Al' },
        { role: 'redo', label: 'Yinele' },
        { type: 'separator' },
        { role: 'cut', label: 'Kes' },
        { role: 'copy', label: 'Kopyala' },
        { role: 'paste', label: 'Yapıştır' },
        { role: 'selectAll', label: 'Tümünü Seç' }
      ]
    },
    {
      label: 'Görünüm',
      submenu: [
        { role: 'reload', label: 'Yeniden Yükle' },
        { role: 'forceReload', label: 'Zorla Yeniden Yükle' },
        { role: 'toggleDevTools', label: 'Geliştirici Araçları' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Gerçek Boyut' },
        { role: 'zoomIn', label: 'Yakınlaştır' },
        { role: 'zoomOut', label: 'Uzaklaştır' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Tam Ekran' }
      ]
    },
    {
      label: 'Pencere',
      submenu: [
        { role: 'minimize', label: 'Simge Durumuna Küçült' },
        { role: 'zoom', label: 'Büyüt' },
        { role: 'close', label: 'Pencereyi Kapat' }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------------------------------------------------------------------------
// Silent screen capture (multi-monitor): auto-pick the selected screen, no dialog.
// ---------------------------------------------------------------------------
let selectedScreenIndex = 0;

// Order desktopCapturer screen sources to match Electron's display order so that
// "screen 1 / 2" is consistent between capture and input mapping.
async function orderedScreenSources() {
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
  const displays = screen.getAllDisplays();
  const ordered = [];
  displays.forEach((disp, i) => {
    const src = sources.find((s) => String(s.display_id) === String(disp.id));
    ordered.push({ source: src || sources[i] || sources[0], display: disp, index: i });
  });
  if (!ordered.length && sources.length) {
    sources.forEach((s, i) => ordered.push({ source: s, display: screen.getPrimaryDisplay(), index: i }));
  }
  return ordered;
}

// Tell the native injector which physical-pixel or point rectangle the active screen occupies.
function updateInjectorScreen(display) {
  if (!injector || !display) return;
  const b = display.bounds;
  if (process.platform === 'darwin') {
    // macOS CoreGraphics CGEvent uses points directly, matching display.bounds
    injector.send(`SCREEN ${Math.round(b.x)} ${Math.round(b.y)} ${Math.round(b.width)} ${Math.round(b.height)}`);
    return;
  }
  const sf = display.scaleFactor || 1;
  const l = Math.round(b.x * sf);
  const t = Math.round(b.y * sf);
  const w = Math.round(b.width * sf);
  const h = Math.round(b.height * sf);
  injector.send(`SCREEN ${l} ${t} ${w} ${h}`);
}

function setupDisplayCapture() {
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    orderedScreenSources().then((list) => {
      const pick = list[selectedScreenIndex] || list[0];
      if (!pick) return callback({});
      updateInjectorScreen(pick.display);
      callback({ video: pick.source, audio: 'loopback' });
    }).catch(() => callback({}));
  }, { useSystemPicker: false });
}

// ---------------------------------------------------------------------------
// File transfer to disk (streamed, keyed by transfer id)
// ---------------------------------------------------------------------------
const incomingFiles = new Map();
function downloadsDir() {
  const dir = path.join(app.getPath('downloads'), 'RuzgarDesk');
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
  return dir;
}
function safeName(name) {
  return String(name).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 200) || 'dosya';
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------
function registerIpc() {
  ipcMain.handle('bootstrap', () => ({
    embeddedUrl,
    embeddedPort,
    lanUrl: `http://${getLocalIPv4()}:${embeddedPort}`,
    localIp: getLocalIPv4(),
    config,
    isAdmin: isAdmin(),
    platform: process.platform,
    permissions: {
      screen: process.platform === 'darwin' ? systemPreferences.getMediaAccessStatus('screen') : 'granted',
      accessibility: process.platform === 'darwin' ? systemPreferences.isTrustedAccessibilityClient(false) : true
    },
    version: app.getVersion(),
    installationType: process.env.PORTABLE_EXECUTABLE_FILE ? 'Portable' : 'Kurulum',
    updaterStatus
  }));

  ipcMain.handle('check-permissions', () => {
    if (process.platform !== 'darwin') {
      return { screen: 'granted', accessibility: true, platform: process.platform };
    }
    return {
      screen: systemPreferences.getMediaAccessStatus('screen'),
      accessibility: systemPreferences.isTrustedAccessibilityClient(false),
      platform: 'darwin'
    };
  });

  ipcMain.handle('relaunch-elevated', () => relaunchElevated());

  ipcMain.handle('request-permissions', async (e, type) => {
    if (process.platform !== 'darwin') return { ok: true, active: true };
    if (type === 'accessibility') {
      const trusted = systemPreferences.isTrustedAccessibilityClient(true);
      if (!trusted) {
        shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');
      }
      return { ok: true, active: trusted };
    } else if (type === 'screen') {
      shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
      return { ok: true, active: systemPreferences.getMediaAccessStatus('screen') === 'granted' };
    }
    return { ok: false };
  });

  ipcMain.handle('check-for-updates', async (e) => {
    if (!mainWindow || e.sender !== mainWindow.webContents) return { ok: false, error: 'Untrusted update request' };
    return requestUpdateCheck(true);
  });

  ipcMain.handle('get-screen-source', async () => {
    const sources = await desktopCapturer.getSources({ types: ['screen'] });
    return sources.length ? sources[0].id : null;
  });

  // Multi-monitor: list screens and select which one is captured/controlled.
  ipcMain.handle('get-screens', async () => {
    const list = await orderedScreenSources();
    return {
      count: list.length,
      current: Math.min(selectedScreenIndex, Math.max(0, list.length - 1)),
      screens: list.map((x) => ({ index: x.index, label: `Ekran ${x.index + 1}`, primary: x.display.id === screen.getPrimaryDisplay().id }))
    };
  });

  ipcMain.handle('select-screen', async (e, index) => {
    const list = await orderedScreenSources();
    if (!list.length) return { ok: false, count: 0, current: 0 };
    selectedScreenIndex = Math.max(0, Math.min(index, list.length - 1));
    updateInjectorScreen(list[selectedScreenIndex].display);
    return { ok: true, count: list.length, current: selectedScreenIndex };
  });

  ipcMain.handle('save-config', (e, partial) => {
    config = Object.assign({}, config, partial || {});
    saveConfig(config);
    return config;
  });

  // Native input injection (host side)
  ipcMain.on('inject-input', (e, line) => {
    if (injector) injector.send(line);
  });

  // Text-only clipboard bridge. Authentication and direction are enforced by
  // the already accepted PeerJS session in the renderer; IPC is restricted to
  // this application's main window and payloads are capped at 1 MiB.
  ipcMain.handle('clipboard-read-text', (e) => {
    if (!mainWindow || e.sender !== mainWindow.webContents) return '';
    return clipboard.readText().slice(0, 1024 * 1024);
  });
  ipcMain.handle('clipboard-write-text', (e, text) => {
    if (!mainWindow || e.sender !== mainWindow.webContents) return false;
    clipboard.writeText(String(text || '').slice(0, 1024 * 1024));
    return true;
  });

  // UAC normally switches to Windows' isolated secure desktop, which Electron
  // cannot capture. Limit the compatibility policy change to an accepted host
  // session and restore the original value as soon as that session ends.
  ipcMain.handle('remote-session-active', (e, active) => {
    if (!mainWindow || e.sender !== mainWindow.webContents) {
      return { ok: false, error: 'Untrusted session request' };
    }
    isRemoteSessionActive = !!active;
    if (!active && pendingUpdateInfo) {
      log('[updater] remote session ended; proceeding with deferred update');
      const info = pendingUpdateInfo;
      pendingUpdateInfo = null;
      triggerDelayedInstall(info);
    }
    if (!uacCompatibility) return { ok: false, error: 'UAC compatibility is not initialized' };
    return active
      ? uacCompatibility.enableForRemoteSession()
      : uacCompatibility.disableForRemoteSession();
  });

  // Tunnel controls
  ipcMain.handle('start-tunnel', async () => {
    try { const url = await startTunnel(); return { ok: true, url }; }
    catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('stop-tunnel', () => { stopTunnel(); return { ok: true }; });

  // File transfer to disk
  ipcMain.handle('file-begin', (e, { id, name }) => {
    const dest = path.join(downloadsDir(), safeName(name));
    let finalPath = dest;
    let i = 1;
    while (fs.existsSync(finalPath)) {
      const ext = path.extname(dest);
      const base = dest.slice(0, dest.length - ext.length);
      finalPath = `${base} (${i++})${ext}`;
    }
    try {
      const stream = fs.createWriteStream(finalPath);
      incomingFiles.set(id, { stream, path: finalPath });
      return { ok: true, path: finalPath };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  ipcMain.on('file-chunk', (e, { id, chunk }) => {
    const f = incomingFiles.get(id);
    if (f) f.stream.write(Buffer.from(chunk));
  });
  ipcMain.handle('file-end', (e, { id }) => {
    const f = incomingFiles.get(id);
    if (f) {
      f.stream.end();
      incomingFiles.delete(id);
      return { ok: true, path: f.path };
    }
    return { ok: false };
  });

  ipcMain.handle('open-downloads', () => { shell.openPath(downloadsDir()); return true; });
  ipcMain.handle('open-path', (e, p) => { shell.showItemInFolder(p); return true; });

  // Pick files to send (native dialog)
  ipcMain.handle('pick-files', async () => {
    const res = await dialog.showOpenDialog(mainWindow, { properties: ['openFile', 'multiSelections'] });
    if (res.canceled) return [];
    return res.filePaths.map((p) => ({ path: p, name: path.basename(p), size: safeStatSize(p) }));
  });
  ipcMain.handle('read-file-chunk', (e, { path: p, offset, length }) => {
    const fd = fs.openSync(p, 'r');
    try {
      const buf = Buffer.alloc(length);
      const bytes = fs.readSync(fd, buf, 0, length, offset);
      return buf.subarray(0, bytes);
    } finally {
      fs.closeSync(fd);
    }
  });

  ipcMain.on('window-min', () => { if (mainWindow) mainWindow.minimize(); });
  ipcMain.on('window-hide', () => { if (mainWindow) mainWindow.hide(); });
  ipcMain.on('app-quit', () => { app.isQuitting = true; app.quit(); });
}

function safeStatSize(p) {
  try { return fs.statSync(p).size; } catch (e) { return 0; }
}

// ---------------------------------------------------------------------------
// Automatic updates
// ---------------------------------------------------------------------------
function publishUpdaterStatus(status) {
  updaterStatus = Object.assign({ at: new Date().toISOString() }, status);
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send('update-status', updaterStatus);
  }
}

async function requestUpdateCheck(manual = false) {
  if (!app.isPackaged) return { ok: false, error: 'Geliştirme modunda güncelleme kapalıdır.' };
  if (!updaterInitialized) return { ok: false, error: 'Güncelleyici henüz hazır değil.' };
  if (updateCheckPromise) return updateCheckPromise;

  updateCheckPromise = (async () => {
    let lastError = null;
    for (const updateUrl of UPDATE_URLS) {
      try {
        log('[updater] checking feed:', updateUrl, manual ? '(manual)' : '(automatic)');
        autoUpdater.setFeedURL({ provider: 'generic', url: updateUrl });
        const result = await autoUpdater.checkForUpdatesAndNotify({
          title: 'RüzgarDesk güncellemesi hazır',
          body: 'Sürüm {version} indirildi. RüzgarDesk otomatik olarak yeniden başlatılacak.'
        });
        return {
          ok: true,
          version: result && result.updateInfo ? result.updateInfo.version : app.getVersion(),
          source: updateUrl
        };
      } catch (err) {
        lastError = err;
        log('[updater][WARN] feed failed:', updateUrl, err.message);
      }
    }

    const message = lastError ? lastError.message : 'Güncelleme sunucusuna ulaşılamadı.';
    publishUpdaterStatus({ state: 'error', message: 'Güncelleme denetlenemedi: ' + message });
    return { ok: false, error: message };
  })();

  try { return await updateCheckPromise; }
  finally { updateCheckPromise = null; }
}

let isRemoteSessionActive = false;
let pendingUpdateInfo = null;

function launchRelaunchWatchdog() {
  if (process.platform !== 'win32') return;
  const exe = process.execPath;
  const ps = `Start-Sleep -Seconds 10; if (-not (Get-Process RuzgarDesk -ErrorAction SilentlyContinue)) { Start-Process -FilePath '${exe}' }`;
  try {
    spawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', ps], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    }).unref();
    log('[updater] post-install watchdog spawned');
  } catch (e) {
    log('[updater] could not spawn watchdog:', e.message);
  }
}

function triggerDelayedInstall(info) {
  if (updateInstallTimer) return;
  const version = info && info.version ? info.version : 'new';
  log('[updater] triggering install for version', version);
  publishUpdaterStatus({ state: 'installing', version, message: `v${version} kurulum için hazırlanıyor; RüzgarDesk yeniden başlayacak.` });
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-installing', { version, seconds: 8 });
  }
  updateInstallTimer = setTimeout(() => {
    log('[updater] invoking quitAndInstall with watchdog');
    launchRelaunchWatchdog();
    autoUpdater.quitAndInstall(true, true);
  }, 8000);
}

function setupAutoUpdater() {
  if (!app.isPackaged) {
    log('[updater] skipped outside packaged app');
    publishUpdaterStatus({ state: 'disabled', message: 'Geliştirme modunda güncelleme kapalı.' });
    return;
  }

  const isPortable = !!process.env.PORTABLE_EXECUTABLE_FILE ||
    !!process.env.PORTABLE_EXECUTABLE_DIR ||
    path.basename(process.execPath).toLowerCase().includes('portable');
  if (isPortable) {
    log('[updater] running as portable, automatic NSIS overwrite disabled');
    publishUpdaterStatus({ state: 'available', message: 'Yeni sürüm mevcut (taşınabilir sürüm web sitesinden indirilebilir).' });
    return;
  }

  autoUpdater.logger = {
    info: (msg) => log('[updater]', msg),
    warn: (msg) => log('[updater][WARN]', msg),
    error: (msg) => log('[updater][ERROR]', msg)
  };
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.autoRunAppAfterInstall = true;
  updaterInitialized = true;

  autoUpdater.on('checking-for-update', () => {
    publishUpdaterStatus({ state: 'checking', message: 'Yeni sürüm denetleniyor...' });
  });

  autoUpdater.on('update-available', (info) => {
    const version = info && info.version ? info.version : 'yeni';
    log('[updater] update available:', version);
    publishUpdaterStatus({ state: 'available', version, message: `v${version} indiriliyor...` });
  });
  autoUpdater.on('update-not-available', (info) => {
    const version = info && info.version ? info.version : app.getVersion();
    publishUpdaterStatus({ state: 'current', version, message: `Güncel sürüm kullanılıyor (v${app.getVersion()}).` });
  });
  autoUpdater.on('download-progress', (progress) => {
    const percent = progress && Number.isFinite(progress.percent) ? progress.percent.toFixed(1) : '?';
    log('[updater] download progress:', percent + '%');
    publishUpdaterStatus({ state: 'downloading', percent, message: `Güncelleme indiriliyor: %${percent}` });
  });
  autoUpdater.on('update-downloaded', (info) => {
    if (updateInstallTimer) return;
    const version = info && info.version ? info.version : 'new';
    log('[updater] downloaded version', version);
    if (isRemoteSessionActive) {
      log('[updater] remote session is currently active; postponing install until session ends');
      pendingUpdateInfo = info;
      publishUpdaterStatus({ state: 'installing', version, message: `v${version} hazır (oturum sonlandığında kurulacak).` });
      return;
    }
    triggerDelayedInstall(info);
  });
  autoUpdater.on('error', (err) => {
    log('[updater][ERROR]', err && err.stack ? err.stack : String(err));
  });

  requestUpdateCheck(false);
  updateCheckTimer = setInterval(() => requestUpdateCheck(false), 5 * 60 * 1000);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
  });

  app.whenReady().then(async () => {
    try {
      log('[boot] RüzgarDesk starting, packaged=' + app.isPackaged + ' admin=' + isAdmin());
      if (!ensureAdmin()) return; // relaunching elevated

      config = loadConfig();
      uacCompatibility = new UacCompatibility(app.getPath('userData'), log);
      uacCompatibility.recoverIfNeeded();
      ensureFirewallRule();
      ensureAutostart();

      const secureHelperPath = app.isPackaged
        ? path.join(process.resourcesPath, 'RuzgarDeskSecureInput.exe')
        : path.join(__dirname, '..', 'build', 'RuzgarDeskSecureInput.exe');
      injector = new InputInjector({ secureHelperPath, logger: log });
      injector.start();
      if (uacCompatibility && typeof uacCompatibility.setInjector === 'function') {
        uacCompatibility.setInjector(injector);
      }

      setupDisplayCapture();
      await startEmbeddedServer();
      registerIpc();
      createWindow();
      createTray();
      createAppMenu();
      log('[boot] ready');

      setupAutoUpdater();

      app.on('activate', () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        } else if (BrowserWindow.getAllWindows().length === 0) {
          createWindow();
        }
      });
    } catch (err) {
      log('[boot] FATAL', err && err.stack ? err.stack : String(err));
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform === 'darwin') return; // Keep running in Dock/menu on macOS
    if (process.platform !== 'win32') app.quit();
  });

  app.on('before-quit', () => {
    app.isQuitting = true;
    if (updateCheckTimer) { clearInterval(updateCheckTimer); updateCheckTimer = null; }
    if (uacCompatibility) uacCompatibility.disableForRemoteSession();
    if (injector) injector.stop();
    stopTunnel();
  });
}
