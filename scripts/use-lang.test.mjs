import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
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

const launchers = ['run-takt.sh', 'takt-claude.sh', 'takt-codex.sh'];

function projectFixture(t) {
  const project = mkdtempSync(join(tmpdir(), 'use-lang-'));
  t.after(() => rmSync(project, { recursive: true, force: true }));
  return project;
}

function assertLaunchers(project) {
  for (const name of launchers) {
    const installed = join(project, '.takt/bin', name);
    assert.equal(readFileSync(installed, 'utf8'), readFileSync(new URL(`./${name}`, import.meta.url), 'utf8'));
    assert.equal(statSync(installed).mode & 0o111, 0o111);
  }
}

test('normal installation replaces executable launchers and preserves unbundled files on re-install', t => {
  const project = projectFixture(t);
  assert.equal(install(project).status, 0);
  assertLaunchers(project);
  for (const name of launchers) {
    writeFileSync(join(project, '.takt/bin', name), 'old version');
    chmodSync(join(project, '.takt/bin', name), 0o644);
  }
  writeFileSync(join(project, '.takt/bin/custom.sh'), 'custom launcher');
  assert.equal(install(project).status, 0);
  assertLaunchers(project);
  assert.equal(readFileSync(join(project, '.takt/bin/custom.sh'), 'utf8'), 'custom launcher');
});

test('normal and no-config installation allow all three launchers in new and existing gitignore files', t => {
  for (const existing of [null, '*\n!.gitignore', '*\n!.gitignore\n!bin/\n!bin/**']) {
    for (const noConfig of [false, true]) {
      const project = projectFixture(t);
      assert.equal(spawnSync('git', ['-C', project, 'init', '-q']).status, 0);
      if (existing) {
        mkdirSync(join(project, '.takt'));
        writeFileSync(join(project, '.takt/.gitignore'), existing);
      }
      const result = spawnSync('sh', [scriptPath, 'ja', project, ...(noConfig ? ['--no-config'] : [])], { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      assertLaunchers(project);
      const dryRun = spawnSync('git', ['-C', project, '-c', 'core.excludesFile=/dev/null', 'add', '-A', '--dry-run'], { encoding: 'utf8' });
      assert.equal(dryRun.status, 0, dryRun.stderr);
      for (const name of launchers) assert.ok(dryRun.stdout.includes(`.takt/bin/${name}`), dryRun.stdout);
      if (noConfig) {
        for (const file of ['.takt/runtime.yaml', '.takt/config.yaml', '.claude/settings.json']) {
          assert.equal(readdirSync(project, { recursive: true }).includes(file), false);
        }
        assert.doesNotMatch(readFileSync(join(project, '.takt/.gitignore'), 'utf8'), /!runtime.yaml|!tools\//);
      }
    }
  }
});

test('launchers-only installation creates only launchers and gitignore permissions', t => {
  const project = projectFixture(t);
  const result = spawnSync('sh', [scriptPath, '--launchers-only', 'ja', project], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assertLaunchers(project);
  const files = readdirSync(project, { recursive: true }).filter(file => statSync(join(project, file)).isFile()).sort();
  assert.deepEqual(files, ['.takt/.gitignore', ...launchers.map(name => `.takt/bin/${name}`)].sort());
  const gitignore = readFileSync(join(project, '.takt/.gitignore'), 'utf8');
  assert.match(gitignore, /^!bin\/$/m);
  assert.match(gitignore, /^!bin\/\*\*$/m);
  assert.doesNotMatch(gitignore, /!tools|!workflows|!runtime|!config/);
});

test('launchers-only installation preserves existing bundles, tools, settings and installation record', t => {
  const project = projectFixture(t);
  assert.equal(install(project).status, 0);
  const before = new Map(readdirSync(project, { recursive: true })
    .filter(file => statSync(join(project, file)).isFile() && !file.startsWith('.takt/bin/'))
    .map(file => [file, { contents: readFileSync(join(project, file)), mtime: statSync(join(project, file)).mtimeMs }]));
  for (const name of launchers) writeFileSync(join(project, '.takt/bin', name), 'old');
  const result = spawnSync('sh', [scriptPath, 'ja', project, '--launchers-only'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assertLaunchers(project);
  for (const [file, expected] of before) {
    assert.deepEqual(readFileSync(join(project, file)), expected.contents, file);
    assert.equal(statSync(join(project, file)).mtimeMs, expected.mtime, file);
  }
});

test('launchers-only appends just bin permissions to an existing gitignore and is idempotent', t => {
  const project = projectFixture(t);
  mkdirSync(join(project, '.takt'));
  const original = '*\n!.gitignore\n!custom/';
  writeFileSync(join(project, '.takt/.gitignore'), original);
  const args = [scriptPath, 'en', project, '--launchers-only'];
  assert.equal(spawnSync('sh', args).status, 0);
  const updated = readFileSync(join(project, '.takt/.gitignore'), 'utf8');
  assert.ok(updated.startsWith(`${original}\n`));
  assert.deepEqual(updated.slice(original.length).trim().split('\n').filter(Boolean), ['!bin/', '!bin/**']);
  assert.equal(spawnSync('sh', args).status, 0);
  assert.equal(readFileSync(join(project, '.takt/.gitignore'), 'utf8'), updated);
});

function gitDryRun(project) {
  const result = spawnSync('git', ['-C', project, '-c', 'core.excludesFile=/dev/null',
    'add', '-A', '--dry-run'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return new Set(result.stdout.split('\n').filter(line => line.startsWith("add '")).map(line => line.slice(5, -1)));
}

function assertTrackedInstallation(project, lang) {
  const tracked = gitDryRun(project);
  const source = fileURLToPath(new URL(`../${lang}/`, import.meta.url));
  for (const dir of ['workflows', 'steps', 'facets']) {
    const files = readdirSync(join(source, dir), { recursive: true })
      .filter(file => statSync(join(source, dir, file)).isFile());
    assert.ok(files.length > 0, dir);
    for (const file of files) assert.ok(tracked.has(`.takt/${dir}/${file}`), `not tracked: .takt/${dir}/${file}`);
  }
  const tools = readdirSync(join(project, '.takt/tools'), { recursive: true })
    .filter(file => statSync(join(project, '.takt/tools', file)).isFile());
  assert.ok(tools.length > 0);
  for (const file of [...launchers.map(name => `bin/${name}`), ...tools.map(name => `tools/${name}`),
    'runtime.yaml', 'config.yaml', '.takt-workflows', '.gitignore']) {
    assert.ok(tracked.has(`.takt/${file}`), `not tracked: .takt/${file}`);
  }
  assert.deepEqual(claudeSettings(project).permissions.deny, EXPECTED_DENY);
}

for (const lang of ['en', 'ja']) {
  for (const mode of ['--launchers-only', '--no-config']) {
    test(`${lang}: ${mode} followed by normal installation tracks the complete bundle`, t => {
      const project = projectFixture(t);
      assert.equal(spawnSync('git', ['-C', project, 'init', '-q']).status, 0);
      const args = [scriptPath, lang, project];
      const first = spawnSync('sh', [...args, mode], { encoding: 'utf8' });
      assert.equal(first.status, 0, first.stderr);
      const minimal = readFileSync(join(project, '.takt/.gitignore'), 'utf8');
      for (const file of ['.takt/runtime.yaml', '.takt/config.yaml', '.claude/settings.json']) {
        assert.equal(existsSync(join(project, file)), false, file);
      }
      assert.deepEqual([...gitDryRun(project)].sort(), ['.takt/.gitignore',
        ...launchers.map(name => `.takt/bin/${name}`)].sort());
      if (mode === '--launchers-only') {
        assert.deepEqual(readdirSync(join(project, '.takt')).sort(), ['.gitignore', 'bin']);
      } else {
        assert.equal(existsSync(join(project, '.takt/.takt-workflows')), true);
        assert.ok(readdirSync(join(project, '.takt/workflows')).length > 0);
      }
      // Repeating the limited mode must preserve its permissions and configuration suppression.
      assert.equal(spawnSync('sh', [...args, mode]).status, 0);
      assert.equal(readFileSync(join(project, '.takt/.gitignore'), 'utf8'), minimal);
      for (const file of ['.takt/runtime.yaml', '.takt/config.yaml', '.claude/settings.json']) {
        assert.equal(existsSync(join(project, file)), false, file);
      }
      const normal = spawnSync('sh', args, { encoding: 'utf8' });
      assert.equal(normal.status, 0, normal.stderr);
      assertTrackedInstallation(project, lang);
    });
  }
}

test('normal installation supplements missing permissions without replacing existing content or widening exclusions', t => {
  for (const existing of [null, '*\n!.gitignore\n# project-specific comment\n!custom/']) {
    const project = projectFixture(t);
    assert.equal(spawnSync('git', ['-C', project, 'init', '-q']).status, 0);
    if (existing !== null) {
      mkdirSync(join(project, '.takt'));
      writeFileSync(join(project, '.takt/.gitignore'), existing);
    }
    assert.equal(install(project).status, 0);
    assertTrackedInstallation(project, 'en');
    const complete = readFileSync(join(project, '.takt/.gitignore'), 'utf8');
    if (existing !== null) assert.ok(complete.startsWith(`${existing}\n`));
    const settings = readFileSync(join(project, '.claude/settings.json'));
    const runtime = readFileSync(join(project, '.takt/runtime.yaml'));
    const config = readFileSync(join(project, '.takt/config.yaml'));
    assert.equal(install(project).status, 0);
    assert.equal(readFileSync(join(project, '.takt/.gitignore'), 'utf8'), complete);
    for (const [file, expected] of [['.claude/settings.json', settings], ['.takt/runtime.yaml', runtime], ['.takt/config.yaml', config]]) {
      assert.deepEqual(readFileSync(join(project, file)), expected, file);
    }
    // A missing permission is repaired on the same project, without duplicating the others.
    writeFileSync(join(project, '.takt/.gitignore'), complete.replace('!steps/**\n', ''));
    assert.equal(install(project).status, 0);
    assertTrackedInstallation(project, 'en');
    const repaired = readFileSync(join(project, '.takt/.gitignore'), 'utf8').split('\n').filter(Boolean);
    assert.deepEqual(repaired.sort(), complete.split('\n').filter(Boolean).sort());
    for (const file of ['home/private', 'facets/unknown/private', 'tools/ddd-lint/rust-extractor/target/build']) {
      mkdirSync(join(project, '.takt', file, '..'), { recursive: true });
      writeFileSync(join(project, '.takt', file), 'excluded');
      const ignored = spawnSync('git', ['-C', project, '-c', 'core.excludesFile=/dev/null',
        'check-ignore', '--', `.takt/${file}`], { encoding: 'utf8' });
      assert.equal(ignored.status, 0, file);
      assert.equal(ignored.stdout.trim(), `.takt/${file}`);
      assert.equal(gitDryRun(project).has(`.takt/${file}`), false, file);
    }
  }
});
