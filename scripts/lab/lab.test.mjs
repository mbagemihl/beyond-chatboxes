// Unit tests for the lab CLI's pure parts. Run: node --test scripts/lab/lab.test.mjs
// (no dependencies; Node's built-in test runner).
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { test } from 'node:test';
import { parseArgs } from '../lab.mjs';
import { CHECKPOINTS, checkpointId } from './checkpoints.mjs';
import { JRES, hostPlatform, parseJavaMajor } from './java.mjs';
import { LabError, percentile, portBusy } from './util.mjs';

test('parseArgs: command, positionals and --flags', () => {
  assert.deepEqual(parseArgs(['backend', '--port', '9099']), {
    command: 'backend',
    args: [],
    flags: { port: '9099' },
  });
  assert.deepEqual(parseArgs(['jre', '--platform=win-x64']), {
    command: 'jre',
    args: [],
    flags: { platform: 'win-x64' },
  });
  assert.equal(parseArgs([]).command, 'help');
});

test('parseArgs: make-style names still work', () => {
  assert.deepEqual(parseArgs(['step-1']), { command: 'step', args: ['1'], flags: {} });
  assert.deepEqual(parseArgs(['verify-bonus-search']), {
    command: 'verify',
    args: ['bonus-search'],
    flags: {},
  });
  assert.deepEqual(parseArgs(['bonus-ocr']), { command: 'bonus', args: ['ocr'], flags: {} });
});

test('checkpointId: numbers, bonus names and the bonus shorthand', () => {
  assert.equal(checkpointId('2'), '2');
  assert.equal(checkpointId('bonus-search'), 'bonus-search');
  assert.equal(checkpointId('search', { bonus: true }), 'bonus-search');
  assert.equal(checkpointId('step-3'), '3');
  assert.throws(() => checkpointId('7'), LabError);
});

test('every checkpoint names its tag, files and specs', () => {
  for (const [id, cp] of Object.entries(CHECKPOINTS)) {
    assert.ok(cp.tag.endsWith('-start'), id);
    assert.ok(cp.files.length > 0 && cp.specs.length > 0, id);
    assert.ok(
      cp.files.every((f) => f.startsWith('frontend/src/') && !f.includes('\\')),
      id,
    );
  }
});

test('parseJavaMajor reads every vendor format', () => {
  assert.equal(parseJavaMajor('openjdk version "21.0.2" 2024-01-16'), 21);
  assert.equal(parseJavaMajor('java version "25.0.3" 2026-04-21 LTS'), 25);
  assert.equal(parseJavaMajor('openjdk version "1.8.0_402"'), 1);
  assert.equal(parseJavaMajor('no java here'), null);
});

test('hostPlatform maps OS and CPU to a pinned JRE', () => {
  assert.equal(hostPlatform('win32', 'x64'), 'win-x64');
  assert.equal(hostPlatform('win32', 'arm64'), 'win-aarch64');
  assert.equal(hostPlatform('darwin', 'arm64'), 'mac-aarch64');
  assert.equal(hostPlatform('linux', 'x64'), 'linux-x64');
  assert.equal(hostPlatform('freebsd', 'x64'), null);
  for (const key of [
    'win-x64',
    'win-aarch64',
    'mac-aarch64',
    'mac-x64',
    'linux-x64',
    'linux-aarch64',
  ]) {
    assert.match(JRES[key].sha, /^[0-9a-f]{64}$/, key);
  }
  assert.ok(JRES['win-x64'].file.endsWith('.zip'));
});

test('portBusy sees a listening port, and a free one as free', async () => {
  const server = createServer().listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const { port } = server.address();
  assert.equal(await portBusy(port), true);
  await new Promise((r) => server.close(r));
  assert.equal(await portBusy(port), false);
});

test('portBusy sees a server bound only to IPv6 loopback (like ng serve)', async (t) => {
  const server = createServer();
  const listening = await new Promise((resolve) => {
    server.once('error', () => resolve(false));
    server.listen(0, '::1', () => resolve(true));
  });
  if (!listening) return t.skip('no IPv6 loopback on this machine');
  const { port } = server.address();
  assert.equal(await portBusy(port), true);
  await new Promise((r) => server.close(r));
});

test('percentile matches the benchmark page (R-7)', () => {
  assert.equal(percentile([1, 2, 3, 4], 50), 2.5);
  assert.equal(percentile([10], 95), 10);
  assert.ok(Number.isNaN(percentile([], 50)));
});
