import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const verify = fileURLToPath(new URL('./sandbox-verify.sh', import.meta.url));

// Only the argument handling is exercised here; a run needs takt, a provider and minutes of time.
function run(t, args) {
  const root = mkdtempSync(join(tmpdir(), 'takt-sandbox-verify-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return spawnSync('sh', [verify, ...args], { encoding: 'utf8', env: { ...process.env, TMPDIR: root } });
}

test('--help prints the configuration overrides and exits 0', (t) => {
  const result = run(t, ['--help']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /--runtime FILE/);
  assert.match(result.stdout, /--config FILE/);
});

test('--runtime with a missing file is a usage error', (t) => {
  const result = run(t, ['--runtime', '/nonexistent/runtime.yaml']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /no such file: \/nonexistent\/runtime\.yaml/);
});

test('--config with a missing file is a usage error', (t) => {
  const result = run(t, ['--config', '/nonexistent/config.yaml']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /no such file: \/nonexistent\/config\.yaml/);
});

test('an unknown argument is a usage error', (t) => {
  const result = run(t, ['--nope']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /unknown argument: --nope/);
});

test('a mode other than real or mock is a usage error', (t) => {
  const result = run(t, ['--mode', 'fast']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /--mode must be real or mock/);
});
