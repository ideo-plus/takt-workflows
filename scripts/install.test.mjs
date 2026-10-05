import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

test('tarball installer forwards launchers-only and literal paths while preserving ref selection and cleanup', t => {
  const root = mkdtempSync(join(tmpdir(), 'install-launchers-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bundle = join(root, 'bundle');
  mkdirSync(join(bundle, 'scripts'), { recursive: true });
  for (const name of ['use-lang.sh', 'run-takt.sh', 'takt-claude.sh', 'takt-codex.sh']) {
    copyFileSync(new URL(`./${name}`, import.meta.url), join(bundle, 'scripts', name));
    chmodSync(join(bundle, 'scripts', name), 0o755);
  }
  const archive = join(root, 'bundle.tgz');
  const packed = spawnSync('tar', ['-czf', archive, '-C', root, 'bundle'], { encoding: 'utf8' });
  assert.equal(packed.status, 0, packed.stderr);
  const bin = join(root, 'bin');
  const temp = join(root, 'downloads');
  mkdirSync(bin);
  mkdirSync(temp);
  const record = join(root, 'download.json');
  writeFileSync(join(bin, 'curl'), `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
const output = args[args.indexOf('-o') + 1];
fs.writeFileSync(process.env.TEST_DOWNLOAD_RECORD, JSON.stringify({ args, output }));
fs.copyFileSync(process.env.TEST_ARCHIVE, output);
`, { mode: 0o755 });
  const installer = fileURLToPath(new URL('./install.sh', import.meta.url));
  for (const options of [[], ['--ref', 'selected-ref'], ['--ref=selected-ref']]) {
    const project = join(root, `project "quoted" $(touch injected) ${options.length}`);
    mkdirSync(project, { recursive: true });
    const result = spawnSync('sh', [installer, 'ja', project, '--launchers-only', ...options], {
      cwd: root, env: { PATH: `${bin}:${process.env.PATH}`, HOME: root, TMPDIR: temp,
        TAKT_WORKFLOWS_REF: 'environment-ref', TEST_ARCHIVE: archive, TEST_DOWNLOAD_RECORD: record }, encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    const files = readdirSync(project, { recursive: true }).filter(file => statSync(join(project, file)).isFile()).sort();
    assert.deepEqual(files, ['.takt/.gitignore', '.takt/bin/run-takt.sh', '.takt/bin/takt-claude.sh', '.takt/bin/takt-codex.sh']);
    for (const name of ['run-takt.sh', 'takt-claude.sh', 'takt-codex.sh']) {
      assert.equal(readFileSync(join(project, '.takt/bin', name), 'utf8'), readFileSync(join(bundle, 'scripts', name), 'utf8'));
      assert.equal(statSync(join(project, '.takt/bin', name)).mode & 0o111, 0o111);
    }
    const download = JSON.parse(readFileSync(record, 'utf8'));
    assert.equal(download.args[1], `https://codeload.github.com/ideo-plus/takt-workflows/tar.gz/${options.length ? 'selected-ref' : 'environment-ref'}`);
    assert.equal(existsSync(download.output), false);
    assert.equal(existsSync(join(root, 'injected')), false);
  }
});
