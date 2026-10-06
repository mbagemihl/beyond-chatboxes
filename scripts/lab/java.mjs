// java.mjs — find a Java that can run the backend (21 or newer), and fetch a
// portable Temurin 21 runtime into .tools/jre when there is none.
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { IS_WIN, REPO_ROOT, c, die, download, extract, rel, run, sha256File } from './util.mjs';

export const MIN_JAVA = 21;
const JAVA_EXE = IS_WIN ? 'java.exe' : 'java';
export const TOOLS_JRE = path.join(REPO_ROOT, '.tools', 'jre');

/** The feature release in `java -version` output, e.g. 21 or 25 (1 for "1.8"). */
export function parseJavaMajor(versionOutput) {
  const m = /version "(\d+)/.exec(versionOutput);
  return m ? Number(m[1]) : null;
}

/** The major version of a java binary, or null if it doesn't run. */
export function javaMajor(javaBin) {
  if (!javaBin || !existsSync(javaBin)) return null;
  const r = run(javaBin, ['-version'], { timeout: 10_000 });
  return r.status === 0 ? parseJavaMajor(`${r.stderr}\n${r.stdout}`) : null;
}

function javaInHome(home) {
  return home ? path.join(home, 'bin', JAVA_EXE) : null;
}

function onPath() {
  const r = run(IS_WIN ? 'where' : 'which', ['java']);
  return r.status === 0
    ? r.stdout
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
}

/** The portable JRE's java: macOS archives nest it under Contents/Home. */
export function toolsJava(jreDir = TOOLS_JRE) {
  for (const candidate of [
    path.join(jreDir, 'bin', JAVA_EXE),
    path.join(jreDir, 'Contents', 'Home', 'bin', 'java'),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function subdirs(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => path.join(dir, d.name))
      .sort()
      .reverse(); // newest version folder first
  } catch {
    return [];
  }
}

/** Where JDK installers put Java on Windows, newest first within each vendor. */
function windowsInstallDirs() {
  const roots = [
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs'),
  ].filter(Boolean);
  const vendors = [
    'Eclipse Adoptium',
    'Microsoft',
    'Java',
    'Zulu',
    'Amazon Corretto',
    'BellSoft',
    'OpenJDK',
  ];
  return roots.flatMap((root) =>
    vendors.flatMap((v) => subdirs(path.join(root, v)).map(javaInHome)),
  );
}

function candidates() {
  const onlyTools = Boolean(process.env.FIND_JAVA_ONLY_TOOLS);
  const list = [];
  if (!onlyTools) {
    list.push(process.env.JAVA, javaInHome(process.env.JAVA_HOME), ...onPath());
  }
  list.push(toolsJava());
  if (!onlyTools) {
    const sdkman = path.join(os.homedir(), '.sdkman', 'candidates', 'java');
    list.push(...subdirs(sdkman).map(javaInHome));
    if (process.platform === 'darwin' && existsSync('/usr/libexec/java_home')) {
      const r = run('/usr/libexec/java_home', ['-v', `${MIN_JAVA}+`]);
      if (r.status === 0) list.push(javaInHome(r.stdout.trim()));
    }
    if (IS_WIN) list.push(...windowsInstallDirs());
  }
  return list.filter(Boolean);
}

/**
 * The first java of version 21 or newer: an explicit JAVA, JAVA_HOME, PATH,
 * the portable .tools/jre, SDKMAN, macOS java_home, the Windows install
 * folders. FIND_JAVA_ONLY_TOOLS=1 looks at .tools/jre only (to test the
 * "no Java installed" path on a machine that has one).
 */
export function findJava() {
  for (const bin of candidates()) {
    const major = javaMajor(bin);
    if (major !== null && major >= MIN_JAVA) {
      return { bin, major, portable: bin.startsWith(TOOLS_JRE) };
    }
  }
  return null;
}

// --- the portable JRE ---------------------------------------------------------
// Eclipse Temurin JRE 21, pinned to one release with a sha256 per platform.
// Update the pin from
//   https://api.adoptium.net/v3/assets/latest/21/hotspot?image_type=jre&os=<mac|linux|windows>&architecture=<x64|aarch64>
const JRE_RELEASE = 'jdk-21.0.12.1+1';
const JRE_BASE =
  'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.12.1%2B1';
export const JRES = {
  'mac-aarch64': {
    file: 'OpenJDK21U-jre_aarch64_mac_hotspot_21.0.12.1_1.tar.gz',
    sha: 'dec50fc6f9fcd4fe3ae8cabf5a5fa68f6afc48841f7698e468e9aa5d54beed84',
  },
  'mac-x64': {
    file: 'OpenJDK21U-jre_x64_mac_hotspot_21.0.12.1_1.tar.gz',
    sha: '6717ec641fd9ce0bb209ca083ee23b42202ac68cb6fcc5753496e0e4a0f41989',
  },
  'linux-aarch64': {
    file: 'OpenJDK21U-jre_aarch64_linux_hotspot_21.0.12.1_1.tar.gz',
    sha: '14be1f35ebdbd1f6e8d57eb911a3ffb74d6d9aa255abc5daf2b1302002cf2cf2',
  },
  'linux-x64': {
    file: 'OpenJDK21U-jre_x64_linux_hotspot_21.0.12.1_1.tar.gz',
    sha: '2413149700df0f7d440500a84a8f764c535f21e5a5e87d38328b64eec2c5b500',
  },
  'win-aarch64': {
    file: 'OpenJDK21U-jre_aarch64_windows_hotspot_21.0.12.1_1.zip',
    sha: 'e82cc17e0bf89a25b0b0ed106d072f2ea420587d0a6870534b71b1dce3ae28c3',
  },
  'win-x64': {
    file: 'OpenJDK21U-jre_x64_windows_hotspot_21.0.12.1_1.zip',
    sha: 'd35f31e712f0fcf6ac5a093edc90204fbff22f720ba3950bd09d331d5e621636',
  },
};

/** This machine's key in JRES, e.g. "mac-aarch64" or "win-x64"; null if unsupported. */
export function hostPlatform(platform = process.platform, arch = process.arch) {
  const os_ = { darwin: 'mac', linux: 'linux', win32: 'win' }[platform];
  const cpu = { arm64: 'aarch64', x64: 'x64' }[arch];
  return os_ && cpu ? `${os_}-${cpu}` : null;
}

/**
 * Download and unpack the pinned JRE for `platform` (default: this machine)
 * into `dir` (default: .tools/jre). Idempotent: a stamp records which archive
 * the folder came from. Preparing a USB stick for other machines:
 *   lab jre --platform win-x64 --dir E:\jre-win-x64
 */
export async function fetchJre({ platform, dir } = {}) {
  const key = platform ?? hostPlatform();
  const entry = key && JRES[key];
  if (!entry) {
    die(
      `no portable JRE for ${key ?? `${process.platform}/${process.arch}`} (known: ${Object.keys(JRES).join(', ')}). Install any JDK 21 or newer instead.`,
    );
  }
  const jreDir = path.resolve(dir ?? TOOLS_JRE);
  const parent = path.dirname(jreDir);
  console.log(`==> Portable Java runtime: Temurin ${JRE_RELEASE} (${entry.file})`);

  const stamp = path.join(jreDir, `.from-${entry.sha}`);
  if (existsSync(stamp)) {
    console.log(`  • already present in ${rel(jreDir)}, skipping`);
    return;
  }

  mkdirSync(parent, { recursive: true });
  const archive = path.join(parent, entry.file);
  if (!existsSync(archive) || (await sha256File(archive)) !== entry.sha) {
    console.log('  • downloading (~45 MB)…');
    await download(`${JRE_BASE}/${entry.file}`, archive);
  }
  const actual = await sha256File(archive);
  if (actual !== entry.sha) {
    rmSync(archive, { force: true });
    die(`checksum mismatch for ${entry.file}\n    expected: ${entry.sha}\n    actual:   ${actual}`);
  }
  console.log(`  ${c.green('✓')} checksum verified`);

  // Unpack into a fresh folder, then move it into place, so an interrupted run
  // never leaves a half-extracted runtime behind.
  const tmp = mkdtempSync(path.join(parent, 'jre-'));
  extract(archive, tmp, 1);
  rmSync(jreDir, { recursive: true, force: true });
  renameSync(tmp, jreDir);
  writeFileSync(stamp, '');
  rmSync(archive, { force: true });

  if (key === hostPlatform()) {
    const bin = toolsJava(jreDir);
    const r = bin ? run(bin, ['-version']) : null;
    console.log(`  ${c.green('✓')} ${(r?.stderr || '').split(/\r?\n/)[0]}`);
    console.log(`    at ${rel(bin ?? jreDir)} (lab backend finds it automatically)`);
  } else {
    console.log(`  ${c.green('✓')} unpacked for ${key} into ${jreDir}`);
  }
}
