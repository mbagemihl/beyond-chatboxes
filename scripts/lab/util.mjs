// util.mjs — the cross-platform plumbing for the `lab` CLI: running commands,
// coloured output, checksums, downloads, archives and port checks. Everything
// here works the same on Windows (PowerShell/cmd), macOS and Linux, with only
// Node's standard library: no bash, make, curl, shasum or lsof.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import { connect } from 'node:net';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

export const IS_WIN = process.platform === 'win32';
export const REPO_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const FRONTEND = path.join(REPO_ROOT, 'frontend');
export const PUBLIC_DIR = path.join(FRONTEND, 'public');

/** How the user starts this CLI on their system, for hints we print. */
export const LAB = IS_WIN ? '.\\lab' : './lab';

const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : String(s));
export const c = {
  green: paint(32),
  red: paint(31),
  amber: paint(33),
  cyan: paint(36),
  bold: paint(1),
  dim: paint(2),
};

/** A failure meant for the person at the keyboard; main() prints it and exits 1. */
export class LabError extends Error {}

export function die(message) {
  throw new LabError(message);
}

/** A path relative to the repo, with forward slashes, for messages. */
export function rel(p) {
  return path.relative(REPO_ROOT, p).split(path.sep).join('/');
}

// npm and npx are .cmd shims on Windows, and gradlew is a .bat: Node only runs
// those through a shell there.
const SHIMS = new Set(['npm', 'npx']);
const needsShell = (cmd) => IS_WIN && (SHIMS.has(cmd) || /\.(bat|cmd)$/i.test(cmd));

function quoteForCmd(arg) {
  return /[\s"&|<>^]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg;
}

/**
 * Run a command to completion. `inherit: true` streams its output to the
 * terminal (long-running tools); otherwise stdout/stderr are captured. Returns
 * { status, stdout, stderr }; `status` is null when the program is missing.
 */
export function run(cmd, args = [], opts = {}) {
  const { cwd = REPO_ROOT, env, inherit = false, timeout } = opts;
  const useShell = needsShell(cmd);
  const command = useShell ? [cmd, ...args].map(quoteForCmd).join(' ') : cmd;
  const r = spawnSync(command, useShell ? [] : args, {
    cwd,
    env: env ? { ...process.env, ...env } : process.env,
    stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    shell: useShell,
    timeout,
    windowsHide: true,
  });
  return {
    status: r.error ? null : r.status,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    error: r.error,
  };
}

/** Run git in the repo; returns trimmed stdout, or throws with git's message. */
export function git(args, opts = {}) {
  const r = run('git', args, opts);
  if (r.status !== 0) {
    die(`git ${args.join(' ')} failed: ${(r.stderr || r.stdout || r.error?.message || '').trim()}`);
  }
  return r.stdout.trim();
}

/** True when git exits 0 (for questions like "does this ref exist?"). */
export function gitOk(args, opts = {}) {
  return run('git', args, opts).status === 0;
}

export function sizeOf(p) {
  try {
    const s = statSync(p);
    return s.isFile() ? s.size : 0;
  } catch {
    return 0;
  }
}

export function humanSize(bytes) {
  if (bytes >= 1048576) return `${Math.floor(bytes / 1048576)} MB`;
  if (bytes >= 1024) return `${Math.floor(bytes / 1024)} kB`;
  return `${bytes} B`;
}

export async function sha256File(p) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(p), hash);
  return hash.digest('hex');
}

/** Download `url` to `dest` via a temp file, so an interrupted run leaves nothing half-written. */
export async function download(url, dest) {
  mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.download`;
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) {
    die(`download failed (${res.status} ${res.statusText}): ${url}`);
  }
  await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
  renameSync(tmp, dest);
}

/**
 * Make sure `dest` exists with the expected sha256: skip when it is already
 * there and verified, otherwise download and verify. Returns false (after
 * printing why) instead of throwing, so callers can fall back.
 */
export async function fetchVerify(url, dest, sha) {
  if (existsSync(dest) && (await sha256File(dest)) === sha) {
    console.log(`  • ${path.basename(dest)} already present and verified, skipping`);
    return true;
  }
  console.log(`  • downloading ${path.basename(dest)}…`);
  try {
    await download(url, dest);
  } catch (err) {
    console.error(`  ${c.amber('!')} ${err.message}`);
    return false;
  }
  const actual = await sha256File(dest);
  if (actual !== sha) {
    rmSync(dest, { force: true });
    console.error(`  ${c.red('✗')} checksum mismatch for ${path.basename(dest)}`);
    console.error(`    expected: ${sha}`);
    console.error(`    actual:   ${actual}`);
    return false;
  }
  console.log(`  ${c.green('✓')} checksum verified`);
  return true;
}

/**
 * Unpack a .tar.gz or .zip with the system `tar`. macOS and Windows 10+ ship
 * bsdtar, which reads both; Linux has GNU tar, which reads .tar.gz (the only
 * archives we unpack there).
 */
export function extract(archive, destDir, stripComponents = 0) {
  mkdirSync(destDir, { recursive: true });
  const args = ['-xf', archive, '-C', destDir];
  if (stripComponents > 0) args.push(`--strip-components=${stripComponents}`);
  const r = run('tar', args);
  if (r.status !== 0) {
    die(
      `could not unpack ${path.basename(archive)}: ${(r.stderr || r.error?.message || '').trim()}`,
    );
  }
}

function accepts(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    const done = (busy) => {
      socket.destroy();
      resolve(busy);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

/**
 * True when something listens on `port` on this machine. Both loopback
 * addresses are tried: `ng serve` and other Node servers often bind only the
 * IPv6 one (::1), which a 127.0.0.1-only check would miss.
 */
export async function portBusy(port, timeoutMs = 1000) {
  const results = await Promise.all([
    accepts('127.0.0.1', port, timeoutMs),
    accepts('::1', port, timeoutMs),
  ]);
  return results.some(Boolean);
}

/** True when the workshop backend answers its health check on `port`. */
export async function backendUp(port) {
  try {
    const res = await fetch(`http://localhost:${port}/api/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok && (await res.text()).includes('"UP"');
  } catch {
    return false;
  }
}

/** R-7 percentile, the same method as frontend/src/app/benchmark/stats.ts. */
export function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return NaN;
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
}
