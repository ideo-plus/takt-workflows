import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const adapter = fileURLToPath(new URL('./takt-codex.sh', import.meta.url));
const CODEX_CREDENTIALS = [
  'OPENAI_API_KEY', 'CODEX_API_KEY', 'OPENAI_BASE_URL', 'CODEX_ACCESS_TOKEN',
  'OPENAI_IDENTITY_TOKEN_FILE', 'OPENAI_FEDERATION_RULE_ID',
];

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'takt-codex-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, 'project with spaces');
  const account = join(root, 'account with spaces');
  mkdirSync(project);
  mkdirSync(account);
  const cli = join(root, 'fake-cli');
  writeFileSync(cli, `#!/usr/bin/env node
process.stdin.resume();
let input = '';
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  const keys = ['TAKT_CODEX_ACCOUNT_DIR', 'TAKT_CODEX_CLI_PATH', 'CODEX_HOME', 'TAKT_CONFIG_DIR', 'TAKT_AGENT'];
  console.log(JSON.stringify({
    args: process.argv.slice(2), input, cwd: process.cwd(),
    env: Object.fromEntries(keys.map(key => [key, process.env[key]])),
    apiKeys: [...${JSON.stringify(CODEX_CREDENTIALS)}, 'TAKT_OPENAI_API_KEY'].filter(key => key in process.env)
  }));
  process.exitCode = Number(process.env.TEST_EXIT_CODE || 0);
});
`);
  chmodSync(cli, 0o755);
  return { root, cli, project, account, env: {
    PATH: process.env.PATH,
    HOME: root,
    TAKT_CODEX_REAL_CLI: cli,
    CODEX_HOME: join(root, 'inherited account'),
    TAKT_CONFIG_DIR: join(root, 'inherited config'),
    ...Object.fromEntries(CODEX_CREDENTIALS.map(key => [key, 'test-only'])),
    TAKT_OPENAI_API_KEY: 'test-only',
  } };
}

test('adapter overrides inherited account and API credentials without changing SDK arguments', t => {
  const f = fixture(t);
  const args = ['exec', '--experimental-json', '--config', 'a="value with spaces"'];
  const result = spawnSync('sh', [adapter, ...args], {
    cwd: f.project, env: { ...f.env, TAKT_CODEX_ACCOUNT_DIR: f.account, TEST_EXIT_CODE: '9' },
    input: 'SDK prompt\n', encoding: 'utf8',
  });
  assert.equal(result.status, 9, result.stderr);
  const got = JSON.parse(result.stdout);
  assert.deepEqual(got.args, args);
  assert.equal(got.input, 'SDK prompt\n');
  assert.equal(got.env.CODEX_HOME, f.account);
  assert.equal(got.env.TAKT_AGENT, '1');
  assert.deepEqual(got.apiKeys, ['TAKT_OPENAI_API_KEY']);
});

test('missing or invalid account selection never launches the real CLI', t => {
  const f = fixture(t);
  const cases = [
    [],
    [join(f.project, 'missing')],
  ];
  for (const dir of cases) {
    const env = dir.length ? { ...f.env, TAKT_CODEX_ACCOUNT_DIR: dir[0] } : f.env;
    const result = spawnSync('sh', [adapter], { cwd: f.project, env, encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, '');
    assert.notEqual(result.stderr, '');
  }
});
