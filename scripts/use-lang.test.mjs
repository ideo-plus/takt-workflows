import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(new URL('./use-lang.sh', import.meta.url));

const EXPECTED_DENY = [
  'Read(./.takt/tools/**)',
  'Read(./.takt/facets/**)',
  'Read(./.takt/workflows/**)',
  'Read(./.takt/steps/**)',
];

function install(project) {
  return spawnSync('sh', [scriptPath, 'en', project], { encoding: 'utf8' });
}

function claudeSettings(project) {
  return JSON.parse(readFileSync(join(project, '.claude', 'settings.json'), 'utf8'));
}

test('the installer denies Claude reads of the bundle files only, never the run reports or gate logs', (t) => {
  const project = mkdtempSync(join(tmpdir(), 'use-lang-'));
  t.after(() => rmSync(project, { recursive: true, force: true }));

  assert.equal(install(project).status, 0);
  const deny = claudeSettings(project).permissions.deny;

  assert.deepEqual(deny, EXPECTED_DENY);
  for (const rule of deny) {
    assert.doesNotMatch(rule, /\.takt\/(runs|quality-gates)\b|\.takt\/\*\*|\.takt\)/);
  }
});

test('the installer keeps existing Claude settings and adds nothing on a re-install', (t) => {
  const project = mkdtempSync(join(tmpdir(), 'use-lang-'));
  t.after(() => rmSync(project, { recursive: true, force: true }));
  mkdirSync(join(project, '.claude'));
  writeFileSync(
    join(project, '.claude', 'settings.json'),
    JSON.stringify({ model: 'x', permissions: { allow: ['Bash(npm test)'], deny: ['Read(./.env)'] } }),
  );

  assert.equal(install(project).status, 0);
  assert.equal(install(project).status, 0);
  const settings = claudeSettings(project);

  assert.equal(settings.model, 'x');
  assert.deepEqual(settings.permissions.allow, ['Bash(npm test)']);
  assert.deepEqual(settings.permissions.deny, ['Read(./.env)', ...EXPECTED_DENY]);
});
