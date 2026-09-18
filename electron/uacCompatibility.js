// Makes Windows UAC prompts visible to the existing Electron screen capture.
//
// Windows normally shows elevation prompts on the isolated Winlogon desktop,
// which desktopCapturer cannot see. While an accepted remote-control session is
// active, this module asks Windows to show those prompts on the interactive
// desktop instead. The original policy is restored at session end. A detached
// watchdog and a recovery file restore it if the Electron process crashes.

const fs = require('fs');
const path = require('path');
const { execFileSync, spawn } = require('child_process');

const REG_PATH = 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System';
const REG_VALUE = 'PromptOnSecureDesktop';
const WINDOWS_ROOT = process.env.SystemRoot || 'C:\\Windows';
const REG_EXE = path.join(WINDOWS_ROOT, 'System32', 'reg.exe');
const POWERSHELL_EXE = path.join(WINDOWS_ROOT, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

function safeUnlink(filePath) {
  try { fs.unlinkSync(filePath); } catch (e) {
    if (e && e.code !== 'ENOENT') throw e;
  }
}

function readPolicy() {
  try {
    const output = execFileSync(REG_EXE, ['query', REG_PATH, '/v', REG_VALUE], {
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore']
    });
    const match = output.match(/PromptOnSecureDesktop\s+REG_DWORD\s+0x([0-9a-f]+)/i);
    if (!match) return { present: false, value: null };
    return { present: true, value: parseInt(match[1], 16) >>> 0 };
  } catch (e) {
    return { present: false, value: null };
  }
}

function writePolicy(value) {
  execFileSync(REG_EXE, [
    'add', REG_PATH, '/v', REG_VALUE, '/t', 'REG_DWORD', '/d', String(value >>> 0), '/f'
  ], { windowsHide: true, stdio: 'ignore' });
}

function restorePolicy(state) {
  if (!state || typeof state.present !== 'boolean') throw new Error('Invalid UAC recovery state');
  if (state.present) {
    if (!Number.isInteger(state.value) || state.value < 0 || state.value > 0xffffffff) {
      throw new Error('Invalid UAC recovery value');
    }
    writePolicy(state.value);
    return;
  }

  try {
    execFileSync(REG_EXE, ['delete', REG_PATH, '/v', REG_VALUE, '/f'], {
      windowsHide: true,
      stdio: 'ignore'
    });
  } catch (e) {
    // The value being absent is the desired restored state.
  }
}

function readRecoveryFile(recoveryPath) {
  const parsed = JSON.parse(fs.readFileSync(recoveryPath, 'utf8'));
  return {
    present: parsed.present === true,
    value: parsed.present === true ? Number(parsed.value) : null
  };
}

class UacCompatibility {
  constructor(userDataPath, logger = () => {}, operations = {}) {
    this.recoveryPath = path.join(userDataPath, 'uac-policy-recovery.json');
    this.log = logger;
    this.readPolicy = operations.readPolicy || readPolicy;
    this.writePolicy = operations.writePolicy || writePolicy;
    this.restorePolicy = operations.restorePolicy || restorePolicy;
    this.active = false;
    this.originalPolicy = null;
    this.watchdog = null;
  }

  // Recover a policy left behind by an abrupt shutdown or machine restart.
  recoverIfNeeded() {
    if (process.platform !== 'win32' || !fs.existsSync(this.recoveryPath)) return;
    try {
      const state = readRecoveryFile(this.recoveryPath);
      this.restorePolicy(state);
      safeUnlink(this.recoveryPath);
      this.log('[uac] recovered secure-desktop policy after an interrupted session');
    } catch (e) {
      this.log('[uac][ERROR] policy recovery failed: ' + e.message);
    }
  }

  enableForRemoteSession() {
    if (process.platform !== 'win32') return { ok: false, supported: false };
    if (this.active) return { ok: true, active: true };

    const original = this.readPolicy();
    try {
      fs.writeFileSync(this.recoveryPath, JSON.stringify(original), { encoding: 'utf8', mode: 0o600 });
      this.writePolicy(0);
    } catch (e) {
      try { safeUnlink(this.recoveryPath); } catch (_) {}
      this.log('[uac][ERROR] could not enable interactive UAC prompts: ' + e.message);
      return { ok: false, error: e.message };
    }

    this.originalPolicy = original;
    this.active = true;
    this.startWatchdog();
    this.log('[uac] administrator prompts enabled for the active remote session');
    return { ok: true, active: true };
  }

  disableForRemoteSession() {
    if (process.platform !== 'win32') return { ok: true, active: false };
    if (!this.active) return { ok: true, active: false };

    try {
      this.restorePolicy(this.originalPolicy);
      safeUnlink(this.recoveryPath);
      this.stopWatchdog();
      this.active = false;
      this.originalPolicy = null;
      this.log('[uac] original secure-desktop policy restored');
      return { ok: true, active: false };
    } catch (e) {
      this.log('[uac][ERROR] could not restore secure-desktop policy: ' + e.message);
      return { ok: false, error: e.message };
    }
  }

  startWatchdog() {
    this.stopWatchdog();
    const script = [
      "$ErrorActionPreference = 'SilentlyContinue'",
      '$parentProcessId = [int]$env:RUZGAR_DESK_PARENT_PID',
      '$recoveryFile = $env:RUZGAR_DESK_UAC_RECOVERY',
      'Wait-Process -Id $parentProcessId',
      'if (Test-Path -LiteralPath $recoveryFile) {',
      '  try {',
      '    $state = Get-Content -Raw -LiteralPath $recoveryFile | ConvertFrom-Json',
      "    $regPath = 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System'",
      "    if ($state.present -eq $true) { Set-ItemProperty -Path $regPath -Name 'PromptOnSecureDesktop' -Type DWord -Value ([uint32]$state.value) -Force }",
      "    else { Remove-ItemProperty -Path $regPath -Name 'PromptOnSecureDesktop' -Force }",
      '    Remove-Item -LiteralPath $recoveryFile -Force',
      '  } catch {}',
      '}'
    ].join('\r\n');
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    const childEnv = Object.assign({}, process.env, {
      RUZGAR_DESK_PARENT_PID: String(process.pid),
      RUZGAR_DESK_UAC_RECOVERY: this.recoveryPath
    });

    try {
      this.watchdog = spawn(POWERSHELL_EXE, [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded
      ], { detached: true, stdio: 'ignore', windowsHide: true, env: childEnv });
      this.watchdog.unref();
    } catch (e) {
      this.watchdog = null;
      this.log('[uac][WARN] recovery watchdog could not start: ' + e.message);
    }
  }

  stopWatchdog() {
    if (!this.watchdog) return;
    try { this.watchdog.kill(); } catch (e) {}
    this.watchdog = null;
  }
}

module.exports = { UacCompatibility };
