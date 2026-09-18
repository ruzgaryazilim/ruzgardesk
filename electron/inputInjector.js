// Native OS input injection for the host machine.
//
// Spawns a persistent PowerShell process that compiles a tiny C# helper using the
// Win32 SendInput API, then streams newline-delimited commands to it over stdin.
// Multi-monitor aware: coordinates are mapped onto the currently selected screen's
// rectangle and normalized across the whole virtual desktop (ABSOLUTE|VIRTUALDESK),
// so the viewer can switch between screens and still click accurately.
//
// Line protocol (coordinates are 0..1 fractions of the *active* screen):
//   SCREEN <left> <top> <width> <height>   set active screen rect (physical pixels)
//   M <x> <y>              move cursor
//   D <L|R|M> <x> <y>      mouse button down (moves first)
//   U <L|R|M> <x> <y>      mouse button up
//   C <L|R|M> <x> <y>      full click (down + up)
//   W <delta> <x> <y>      wheel scroll (+up / -down)
//   K <vk> <1|0>           virtual key down(1)/up(0)
//   T <codepoint>          type a Unicode character (down + up)

const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { execFileSync, spawn } = require('child_process');

const SERVICE_NAME = 'RuzgarDeskSecureInput';
const PIPE_PATH = '\\\\.\\pipe\\RuzgarDeskSecureInput';

function fileHash(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function serviceExists(scExe) {
  try {
    execFileSync(scExe, ['query', SERVICE_NAME], { windowsHide: true, stdio: 'ignore' });
    return true;
  } catch (e) {
    return false;
  }
}

function waitForServiceStop(scExe) {
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const output = execFileSync(scExe, ['query', SERVICE_NAME], {
        encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore']
      });
      if (/STATE\s*:\s*1\s+STOPPED/i.test(output)) return;
    } catch (e) { return; }
    // Synchronous and short; used only while upgrading the local service binary.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  }
}

const CSHARP = `
using System;
using System.Globalization;
using System.Runtime.InteropServices;

public static class RD {
  [StructLayout(LayoutKind.Sequential)]
  public struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)]
  public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Explicit)]
  public struct INPUTUNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)]
  public struct INPUT { public uint type; public INPUTUNION u; }

  [DllImport("user32.dll", SetLastError=true)]
  public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);
  [DllImport("user32.dll")]
  public static extern int GetSystemMetrics(int nIndex);

  const uint INPUT_MOUSE = 0;
  const uint INPUT_KEYBOARD = 1;
  const uint MOUSEEVENTF_MOVE = 0x0001;
  const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
  const uint MOUSEEVENTF_LEFTUP = 0x0004;
  const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
  const uint MOUSEEVENTF_RIGHTUP = 0x0010;
  const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
  const uint MOUSEEVENTF_MIDDLEUP = 0x0040;
  const uint MOUSEEVENTF_WHEEL = 0x0800;
  const uint MOUSEEVENTF_ABSOLUTE = 0x8000;
  const uint MOUSEEVENTF_VIRTUALDESK = 0x4000;
  const uint KEYEVENTF_EXTENDEDKEY = 0x0001;
  const uint KEYEVENTF_KEYUP = 0x0002;
  const uint KEYEVENTF_UNICODE = 0x0004;

  const int SM_XVIRTUALSCREEN = 76;
  const int SM_YVIRTUALSCREEN = 77;
  const int SM_CXVIRTUALSCREEN = 78;
  const int SM_CYVIRTUALSCREEN = 79;

  static readonly CultureInfo INV = CultureInfo.InvariantCulture;
  static readonly int SIZE = Marshal.SizeOf(typeof(INPUT));

  // Active screen rectangle (physical pixels). Defaults to the primary screen.
  static double aL = 0, aT = 0, aW = 0, aH = 0;

  static RD() {
    aW = GetSystemMetrics(0); // SM_CXSCREEN
    aH = GetSystemMetrics(1); // SM_CYSCREEN
  }

  public static void SetScreen(double l, double t, double w, double h) {
    if (w > 0 && h > 0) { aL = l; aT = t; aW = w; aH = h; }
  }

  // Map a 0..1 fraction of the active screen to 0..65535 across the virtual desktop.
  // A NaN/invalid fraction cast to a Win32 int becomes an enormous out-of-range
  // value (e.g. int.MinValue), which SendInput turns into the cursor snapping to
  // a corner and appearing "stuck" to whoever is physically at the host. The
  // JS side already filters these out, but guard here too in case anything
  // ever slips through.
  static void MapAbs(double fx, double fy, out int nx, out int ny) {
    if (double.IsNaN(fx) || double.IsInfinity(fx)) fx = 0.5;
    if (double.IsNaN(fy) || double.IsInfinity(fy)) fy = 0.5;
    fx = Math.Max(0.0, Math.Min(1.0, fx));
    fy = Math.Max(0.0, Math.Min(1.0, fy));

    double vx = GetSystemMetrics(SM_XVIRTUALSCREEN);
    double vy = GetSystemMetrics(SM_YVIRTUALSCREEN);
    double vw = GetSystemMetrics(SM_CXVIRTUALSCREEN);
    double vh = GetSystemMetrics(SM_CYVIRTUALSCREEN);
    if (vw <= 0) vw = aW;
    if (vh <= 0) vh = aH;
    double px = aL + fx * aW;
    double py = aT + fy * aH;
    int rx = (int)Math.Round((px - vx) / vw * 65535.0);
    int ry = (int)Math.Round((py - vy) / vh * 65535.0);
    nx = Math.Max(0, Math.Min(65535, rx));
    ny = Math.Max(0, Math.Min(65535, ry));
  }

  static void Move(double fx, double fy, ref INPUT inp) {
    int nx, ny; MapAbs(fx, fy, out nx, out ny);
    inp.type = INPUT_MOUSE;
    inp.u.mi.dx = nx;
    inp.u.mi.dy = ny;
    inp.u.mi.dwFlags = MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK;
  }

  public static void MoveOnly(double fx, double fy) {
    INPUT[] a = new INPUT[1];
    Move(fx, fy, ref a[0]);
    SendInput(1, a, SIZE);
  }

  public static void Button(uint flag, double fx, double fy) {
    INPUT[] a = new INPUT[2];
    Move(fx, fy, ref a[0]);
    a[1].type = INPUT_MOUSE;
    a[1].u.mi.dwFlags = flag;
    SendInput(2, a, SIZE);
  }

  public static void Wheel(int delta, double fx, double fy) {
    INPUT[] a = new INPUT[2];
    Move(fx, fy, ref a[0]);
    a[1].type = INPUT_MOUSE;
    a[1].u.mi.mouseData = (uint)delta;
    a[1].u.mi.dwFlags = MOUSEEVENTF_WHEEL;
    SendInput(2, a, SIZE);
  }

  static bool IsExtended(ushort vk) {
    switch (vk) {
      case 0x21: case 0x22: case 0x23: case 0x24:
      case 0x25: case 0x26: case 0x27: case 0x28:
      case 0x2D: case 0x2E:
      case 0x5B: case 0x5C:
      case 0x6F:
      case 0xA3: case 0xA5:
        return true;
    }
    return false;
  }

  public static void Key(ushort vk, bool down) {
    INPUT[] a = new INPUT[1];
    a[0].type = INPUT_KEYBOARD;
    a[0].u.ki.wVk = vk;
    uint flags = 0;
    if (IsExtended(vk)) flags |= KEYEVENTF_EXTENDEDKEY;
    if (!down) flags |= KEYEVENTF_KEYUP;
    a[0].u.ki.dwFlags = flags;
    SendInput(1, a, SIZE);
  }

  public static void TypeUnit(ushort unit, bool up) {
    INPUT[] a = new INPUT[1];
    a[0].type = INPUT_KEYBOARD;
    a[0].u.ki.wVk = 0;
    a[0].u.ki.wScan = unit;
    a[0].u.ki.dwFlags = KEYEVENTF_UNICODE | (up ? KEYEVENTF_KEYUP : 0);
    SendInput(1, a, SIZE);
  }

  public static void TypeCodepoint(int cp) {
    if (cp <= 0xFFFF) {
      TypeUnit((ushort)cp, false);
      TypeUnit((ushort)cp, true);
    } else {
      cp -= 0x10000;
      ushort hi = (ushort)(0xD800 + (cp >> 10));
      ushort lo = (ushort)(0xDC00 + (cp & 0x3FF));
      TypeUnit(hi, false); TypeUnit(lo, false);
      TypeUnit(hi, true);  TypeUnit(lo, true);
    }
  }

  static uint DownFlag(string b) {
    if (b == "R") return MOUSEEVENTF_RIGHTDOWN;
    if (b == "M") return MOUSEEVENTF_MIDDLEDOWN;
    return MOUSEEVENTF_LEFTDOWN;
  }
  static uint UpFlag(string b) {
    if (b == "R") return MOUSEEVENTF_RIGHTUP;
    if (b == "M") return MOUSEEVENTF_MIDDLEUP;
    return MOUSEEVENTF_LEFTUP;
  }

  public static void Dispatch(string line) {
    try {
      if (string.IsNullOrWhiteSpace(line)) return;
      string[] p = line.Split(' ');
      double fx, fy;
      switch (p[0]) {
        case "SCREEN":
          SetScreen(double.Parse(p[1], INV), double.Parse(p[2], INV), double.Parse(p[3], INV), double.Parse(p[4], INV));
          break;
        case "M":
          MoveOnly(double.Parse(p[1], INV), double.Parse(p[2], INV));
          break;
        case "D":
          Button(DownFlag(p[1]), double.Parse(p[2], INV), double.Parse(p[3], INV));
          break;
        case "U":
          Button(UpFlag(p[1]), double.Parse(p[2], INV), double.Parse(p[3], INV));
          break;
        case "C":
          fx = double.Parse(p[2], INV); fy = double.Parse(p[3], INV);
          Button(DownFlag(p[1]), fx, fy); Button(UpFlag(p[1]), fx, fy);
          break;
        case "W":
          Wheel(int.Parse(p[1], INV), double.Parse(p[2], INV), double.Parse(p[3], INV));
          break;
        case "K":
          Key(ushort.Parse(p[1], INV), p[2] == "1");
          break;
        case "T":
          TypeCodepoint(int.Parse(p[1], INV));
          break;
      }
    } catch { /* ignore malformed command */ }
  }
}
`;

const PS_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
${CSHARP}
'@ -Language CSharp
[Console]::Out.WriteLine('RD_READY')
while (($line = [Console]::In.ReadLine()) -ne $null) {
  [RD]::Dispatch($line)
}
`;

class InputInjector {
  constructor(options = {}) {
    this.ps = null;
    this.ready = false;
    this.queue = [];
    this.secureHelperPath = options.secureHelperPath || '';
    this.log = options.logger || console.log;
    this.securePipe = null;
    this.secureReady = false;
    this.secureRetry = null;
    this.latestScreenLine = null;
    this.stopping = false;
  }

  start() {
    this.stopping = false;
    if (process.platform === 'darwin') {
      this._startDarwinHelper();
      return;
    }
    if (process.platform === 'win32') {
      this._ensureSecureService();
      this._connectSecurePipe();
      this._startFallback();
    }
  }

  _startDarwinHelper() {
    if (this.ps) return;
    const candidates = [
      path.join(process.resourcesPath || '', 'macInputHelper'),
      path.join(__dirname, 'macInputHelper'),
      path.join(process.resourcesPath || '', 'macInputAgent.swift'),
      path.join(__dirname, 'macInputAgent.swift')
    ];
    let target = null;
    let isSwiftScript = false;
    for (const c of candidates) {
      if (fs.existsSync(c)) {
        target = c;
        isSwiftScript = c.endsWith('.swift');
        break;
      }
    }

    if (!target) {
      this.log('[injector][WARN] macOS input helper not found in candidates');
      return;
    }

    try {
      if (isSwiftScript) {
        this.ps = spawn('swift', [target], { stdio: ['pipe', 'pipe', 'pipe'] });
      } else {
        this.ps = spawn(target, [], { stdio: ['pipe', 'pipe', 'pipe'] });
      }

      this.ps.stdout.on('data', (d) => {
        if (d.toString().includes('RD_READY')) {
          this.ready = true;
          for (const line of this.queue) this._write(line);
          this.queue = [];
          this.log('[injector] macOS native input helper ready');
        }
      });
      this.ps.stderr.on('data', (d) => this.log('[injector][mac-err] ' + d.toString().trim()));
      this.ps.on('exit', (code) => {
        this.log(`[injector] macOS helper exited (${code})`);
        this.ps = null;
        this.ready = false;
        if (!this.stopping) setTimeout(() => this._startDarwinHelper(), 1500);
      });
    } catch (err) {
      this.log('[injector] failed to start macOS helper: ' + err.message);
    }
  }

  _startFallback() {
    if (this.ps) return;
    const encoded = Buffer.from(PS_SCRIPT, 'utf16le').toString('base64');
    try {
      this.ps = spawn('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-EncodedCommand', encoded
      ], { windowsHide: true });

      this.ps.stdout.on('data', (d) => {
        if (d.toString().includes('RD_READY')) {
          this.ready = true;
          for (const line of this.queue) this._write(line);
          this.queue = [];
          console.log('[injector] native input helper ready');
        }
      });
      this.ps.stderr.on('data', (d) => console.error('[injector]', d.toString().trim()));
      this.ps.on('exit', (code) => {
        console.warn(`[injector] helper exited (${code}), restarting soon`);
        this.ps = null;
        this.ready = false;
        if (!this.stopping) setTimeout(() => this._startFallback(), 1000);
      });
    } catch (e) {
      console.error('[injector] failed to start PowerShell helper:', e.message);
    }
  }

  _ensureSecureService() {
    if (process.platform !== 'win32' || !this.secureHelperPath || !fs.existsSync(this.secureHelperPath)) return;
    const windowsRoot = process.env.SystemRoot || 'C:\\Windows';
    const scExe = path.join(windowsRoot, 'System32', 'sc.exe');
    const programData = process.env.ProgramData || path.join(os.homedir(), 'AppData', 'Local');
    const helperDir = path.join(programData, 'RuzgarDesk');
    const installedHelper = path.join(helperDir, 'RuzgarDeskSecureInput.exe');
    const exists = serviceExists(scExe);
    let needsCopy = true;
    try { needsCopy = fileHash(this.secureHelperPath) !== fileHash(installedHelper); } catch (e) {}

    try {
      fs.mkdirSync(helperDir, { recursive: true });
      if (exists && needsCopy) {
        try { execFileSync(scExe, ['stop', SERVICE_NAME], { windowsHide: true, stdio: 'ignore' }); } catch (e) {}
        waitForServiceStop(scExe);
      }
      if (needsCopy) fs.copyFileSync(this.secureHelperPath, installedHelper);

      const quotedHelper = `"${installedHelper}"`;
      if (!exists) {
        execFileSync(scExe, [
          'create', SERVICE_NAME, 'binPath=', quotedHelper, 'start=', 'auto', 'obj=', 'LocalSystem',
          'DisplayName=', 'RuzgarDesk Secure Input'
        ], { windowsHide: true, stdio: 'ignore' });
      } else {
        execFileSync(scExe, [
          'config', SERVICE_NAME, 'binPath=', quotedHelper, 'start=', 'auto', 'obj=', 'LocalSystem'
        ], { windowsHide: true, stdio: 'ignore' });
      }
      try {
        execFileSync(scExe, ['description', SERVICE_NAME, 'RuzgarDesk yönetici pencereleri için güvenli giriş hizmeti'], {
          windowsHide: true, stdio: 'ignore'
        });
        execFileSync(scExe, ['failure', SERVICE_NAME, 'reset=', '86400', 'actions=', 'restart/3000/restart/3000'], {
          windowsHide: true, stdio: 'ignore'
        });
      } catch (e) {}
      try { execFileSync(scExe, ['start', SERVICE_NAME], { windowsHide: true, stdio: 'ignore' }); } catch (e) {}
      this.log('[injector] secure SYSTEM input service ensured');
    } catch (e) {
      this.log('[injector][WARN] secure input service unavailable: ' + e.message);
    }
  }

  _connectSecurePipe() {
    if (process.platform !== 'win32' || this.stopping || this.securePipe) return;
    const pipe = net.createConnection(PIPE_PATH);
    this.securePipe = pipe;
    pipe.setNoDelay(true);
    pipe.once('connect', () => {
      this.secureReady = true;
      this.log('[injector] connected to secure SYSTEM input agent');
      if (this.latestScreenLine) pipe.write(this.latestScreenLine + '\n');
    });
    const disconnected = () => {
      if (this.securePipe !== pipe) return;
      this.securePipe = null;
      this.secureReady = false;
      if (!this.stopping && !this.secureRetry) {
        this.secureRetry = setTimeout(() => {
          this.secureRetry = null;
          this._connectSecurePipe();
        }, 1000);
      }
    };
    pipe.once('error', disconnected);
    pipe.once('close', disconnected);
  }

  _write(line) {
    if (this.ps && this.ps.stdin.writable) {
      this.ps.stdin.write(line + '\n');
    }
  }

  send(line) {
    if (line.startsWith('SCREEN ')) this.latestScreenLine = line;
    if (this.secureReady && this.securePipe && this.securePipe.writable) {
      this.securePipe.write(line + '\n');
      return;
    }
    if (this.ready) this._write(line);
    else this.queue.push(line);
  }

  stop() {
    this.stopping = true;
    if (this.secureRetry) { clearTimeout(this.secureRetry); this.secureRetry = null; }
    if (this.securePipe) {
      try { this.securePipe.end(); } catch (e) {}
      try { this.securePipe.destroy(); } catch (e) {}
      this.securePipe = null;
      this.secureReady = false;
    }
    if (this.ps) {
      try { this.ps.stdin.end(); } catch (e) {}
      try { this.ps.kill(); } catch (e) {}
      this.ps = null;
      this.ready = false;
    }
  }
}

module.exports = { InputInjector };
