// checkpoints.mjs — move between workshop checkpoints without ever losing work:
//   lab step 2        start act 2b (checkpoint 2)
//   lab bonus search  start a bonus track
//   lab verify 2      run only that checkpoint's tests
//   lab solve 2       restore its reference solution
//
// Design rule: an attendee mid-exercise must NEVER lose code to a checkpoint
// switch, and must never have to understand git to recover. So:
//   * uncommitted work is committed onto a `workshop-wip-<stamp>` branch, and
//     the branch name is printed loudly;
//   * an existing `workshop-step-N` branch is renamed, not reset;
//   * `solve` copies your attempt into .workshop-backups/ before overwriting it.
// Nothing here deletes anything.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { FRONTEND, LAB, REPO_ROOT, c, die, git, gitOk, run } from './util.mjs';

/** Per checkpoint: the files its exercise lives in, its tag, its page and its specs. */
export const CHECKPOINTS = {
  1: {
    files: ['frontend/src/app/demos/pose/litert-setup.ts'],
    tag: 'step-1-start',
    route: '/pose/still',
    specs: ['litert-setup.spec.ts'],
  },
  2: {
    files: ['frontend/src/app/demos/pose/live-loop.ts'],
    tag: 'step-2-start',
    route: '/pose?fixture=1',
    specs: ['live-loop.spec.ts'],
  },
  3: {
    files: ['frontend/src/app/benchmark/race-summary.ts'],
    tag: 'step-3-start',
    route: '/benchmark?fixture=1',
    specs: ['race-summary.spec.ts'],
  },
  'bonus-search': {
    files: ['frontend/src/app/demos/search/embedding-setup.ts'],
    tag: 'bonus-search-start',
    route: '/search',
    specs: ['embedding-setup.spec.ts'],
  },
  'bonus-ocr': {
    files: [
      'frontend/src/app/demos/smartform/ocr-layout.ts',
      'frontend/src/app/demos/smartform/prompt-api.ts',
    ],
    tag: 'bonus-ocr-start',
    route: '/smartform?fixture=1',
    specs: ['ocr-layout.spec.ts', 'prompt-api.spec.ts'],
  },
};

/** "1", "step-1", "bonus-search", "search" (with bonus) → a CHECKPOINTS key. */
export function checkpointId(arg, { bonus = false } = {}) {
  const raw = String(arg ?? '')
    .trim()
    .toLowerCase()
    .replace(/^(step|verify|solve)-/, '');
  const id = bonus && !raw.startsWith('bonus-') ? `bonus-${raw}` : raw;
  if (!(id in CHECKPOINTS)) {
    die(`unknown checkpoint '${arg ?? ''}'. Use 1, 2, 3, bonus-search or bonus-ocr.`);
  }
  return id;
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function printBanner(id) {
  const cp = CHECKPOINTS[id];
  const branch = git(['branch', '--show-current']);
  console.log(`\n${c.bold(`▸ Checkpoint ${id} ready`)} on branch ${c.cyan(branch)}`);
  console.log('  Files to edit:');
  for (const f of cp.files) console.log(`    ${f}`);
  console.log(`  Watch it work:    ${c.cyan(`http://localhost:4200${cp.route}`)}`);
  console.log(`  Check your work:  ${c.cyan(`${LAB} verify ${id}`)}`);
  console.log(`  Stuck?            ${c.cyan(`${LAB} solve ${id}`)}`);
}

/**
 * The checkpoint tags are re-cut when the workshop changes, and a plain
 * `git fetch` / `git pull` never moves a tag you already have. When GitHub is
 * reachable and has a different tag, take it; offline, use the local one.
 */
function refreshTag(tag) {
  const r = run('git', ['ls-remote', '--tags', 'origin', `refs/tags/${tag}`], {
    timeout: 10_000,
    env: { GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: 'ssh -o ConnectTimeout=5 -o BatchMode=yes' },
  });
  const remote = r.status === 0 ? r.stdout.trim().split(/\s+/)[0] : '';
  if (!remote) return;
  const local = run('git', ['rev-parse', '-q', '--verify', `refs/tags/${tag}`]).stdout.trim();
  if (
    remote !== local &&
    gitOk(['fetch', '-q', '--force', 'origin', `refs/tags/${tag}:refs/tags/${tag}`])
  ) {
    console.log(`  ${c.green('✓')} Checkpoint ${tag} updated from origin`);
  }
}

function parkUncommitted(when) {
  if (!git(['status', '--porcelain'])) return;
  const wip = `workshop-wip-${when}`;
  console.log(c.amber('! You have uncommitted changes. Saving them first.'));
  git(['checkout', '-q', '-b', wip]);
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'workshop: work in progress, parked automatically']);
  console.log(`  ${c.green('✓')} Saved on branch ${c.bold(wip)}`);
  console.log(c.dim(`    Get it back any time with: git checkout ${wip}`));
}

export function step(id) {
  const cp = CHECKPOINTS[id];
  refreshTag(cp.tag);
  if (!gitOk(['rev-parse', '-q', '--verify', `refs/tags/${cp.tag}`])) {
    die(`tag '${cp.tag}' not found. Fetch the checkpoints: git fetch --tags --force`);
  }
  // A tag that predates this checkpoint's exercise would check out a tree
  // without the files above. Refuse BEFORE touching anything.
  for (const f of cp.files) {
    if (!gitOk(['cat-file', '-e', `${cp.tag}:${f}`])) {
      die(
        `your '${cp.tag}' tag is outdated (it has no ${f}).\n       The checkpoints were updated. Fetch them, then run this again:\n         git fetch --tags --force`,
      );
    }
  }

  const when = stamp();
  parkUncommitted(when);

  const branch = `workshop-step-${id}`;
  if (gitOk(['show-ref', '-q', '--verify', `refs/heads/${branch}`])) {
    git(['branch', '-m', branch, `${branch}-prev-${when}`]);
    console.log(`  ${c.green('✓')} Previous attempt kept as ${c.bold(`${branch}-prev-${when}`)}`);
  }
  git(['checkout', '-q', '-b', branch, cp.tag]);

  // Let the checkpoint describe itself: its own CLI names its own files.
  const own = path.join(REPO_ROOT, 'scripts', 'lab.mjs');
  if (existsSync(own) && run(process.execPath, [own, 'banner', id], { inherit: true }).status === 0)
    return;
  printBanner(id);
}

export function solve(id) {
  const cp = CHECKPOINTS[id];
  // origin/main first: a local `main` only moves when you pull, while the
  // remote-tracking ref is what the checkpoints were cut from.
  const ref = ['origin/main', 'main'].find((r) => gitOk(['rev-parse', '-q', '--verify', r]));
  if (!ref) die("no 'main' or 'origin/main' to take the solution from. Run: git fetch origin");

  const backup = path.join('.workshop-backups', stamp());
  for (const f of cp.files) {
    const src = path.join(REPO_ROOT, f);
    if (existsSync(src)) {
      const dest = path.join(REPO_ROOT, backup, f);
      mkdirSync(path.dirname(dest), { recursive: true });
      copyFileSync(src, dest);
    }
  }
  git(['checkout', ref, '--', ...cp.files]);
  console.log(`\n${c.bold(`▸ Checkpoint ${id} solution restored`)} (from ${ref})`);
  console.log(
    `  ${c.green('✓')} Your attempt was copied to ${c.bold(backup.split(path.sep).join('/'))}`,
  );
  console.log(`  Confirm it passes: ${c.cyan(`${LAB} verify ${id}`)}`);
}

export function verify(id) {
  const includes = CHECKPOINTS[id].specs.map((s) => `--include=**/${s}`);
  return (
    run('npx', ['ng', 'test', '--no-watch', ...includes], { cwd: FRONTEND, inherit: true })
      .status ?? 1
  );
}
