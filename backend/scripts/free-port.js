const { execSync } = require('child_process');

function freePortWindows(port) {
  const ps = `$c = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue; if ($c) { $c | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } }`;
  try {
    execSync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${ps}"`, { stdio: 'ignore' });
  } catch {
    // Ignore if PowerShell command cannot run.
  }
}

function freePortUnix(port) {
  try {
    const output = execSync(`lsof -ti tcp:${port}`, { encoding: 'utf8' });
    const pids = String(output || '')
      .split(/\r?\n/)
      .map((v) => v.trim())
      .filter((v) => /^\d+$/.test(v));
    for (const pid of pids) {
      try {
        process.kill(Number(pid), 'SIGKILL');
      } catch {
        // Ignore stale pids or permission errors.
      }
    }
  } catch {
    // No listeners found.
  }
}

const arg = process.argv[2] || '4680';
const port = Number(arg);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  process.exit(0);
}

if (process.platform === 'win32') {
  freePortWindows(port);
} else {
  freePortUnix(port);
}
