import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const launcher = fileURLToPath(new URL('./run-takt.sh', import.meta.url));
const adapter = fileURLToPath(new URL('./takt-claude.sh', import.meta.url));
const CREDENTIALS = ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'];
const CODEX_CREDENTIALS = ['OPENAI_API_KEY', 'CODEX_API_KEY', 'TAKT_OPENAI_API_KEY'];
const codexAdapter = fileURLToPath(new URL('./takt-codex.sh', import.meta.url));

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'takt-claude-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, 'project with spaces');
  const account = join(root, 'account with spaces');
  const codex = join(root, 'codex account with spaces');
  mkdirSync(project);
  mkdirSync(account);
  mkdirSync(codex);
  const cli = join(root, 'fake-cli');
  writeFileSync(cli, `#!/usr/bin/env node
process.stdin.resume();
let input = '';
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  const keys = ['TAKT_CLAUDE_ACCOUNT_DIR', 'TAKT_CLAUDE_CLI_PATH', 'CLAUDE_CONFIG_DIR', 'TAKT_AGENT',
    'TAKT_CODEX_ACCOUNT_DIR', 'TAKT_CODEX_CLI_PATH', 'CODEX_HOME', 'TAKT_CONFIG_DIR'];
  console.log(JSON.stringify({
    args: process.argv.slice(2), input, cwd: process.cwd(),
    env: Object.fromEntries(keys.map(key => [key, process.env[key]])),
    credentials: ${JSON.stringify(CREDENTIALS)}.filter(key => key in process.env),
    codexCredentials: ${JSON.stringify(CODEX_CREDENTIALS)}.filter(key => key in process.env)
  }));
  process.exitCode = Number(process.env.TEST_EXIT_CODE || 0);
});
`);
  chmodSync(cli, 0o755);
  return { root, cli, project, account, codex, env: {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TAKT_REAL_CLI: cli,
    TAKT_CLAUDE_REAL_CLI: cli,
    CLAUDE_CONFIG_DIR: join(root, 'inherited account'),
    CODEX_HOME: join(root, 'inherited codex account'),
    ...Object.fromEntries([...CREDENTIALS, ...CODEX_CREDENTIALS].map(key => [key, 'test-only'])),
  } };
}

test('launcher selects both accounts, preserving arguments, stdin and exit status', t => {
  const f = fixture(t);
  const args = ['--pipeline', '--task', 'literal $(not-a-command) `text` with spaces'];
  const result = spawnSync('sh', [launcher, '--claude-account', f.account, '--codex-account', f.codex, ...args], {
    cwd: f.project, env: { ...f.env, TEST_EXIT_CODE: '17' }, input: 'task\ninput', encoding: 'utf8',
  });
  assert.equal(result.status, 17, result.stderr);
  const got = JSON.parse(result.stdout);
  assert.deepEqual(got.args, args);
  assert.equal(got.input, 'task\ninput');
  assert.equal(got.cwd, f.project);
  assert.equal(got.env.TAKT_CLAUDE_ACCOUNT_DIR, f.account);
  assert.equal(got.env.TAKT_CLAUDE_CLI_PATH, adapter);
  assert.equal(got.env.TAKT_CODEX_ACCOUNT_DIR, f.codex);
  assert.equal(got.env.TAKT_CODEX_CLI_PATH, codexAdapter);
  assert.equal(got.env.CODEX_HOME, f.codex);
  assert.equal(got.env.TAKT_CONFIG_DIR, join(f.project, '.takt/home'));
  assert.deepEqual(got.codexCredentials, []);
});

test('launcher accepts the two accounts in either order', t => {
  const f = fixture(t);
  const result = spawnSync('sh', [launcher, '--codex-account', f.codex, '--claude-account', f.account, 'list'], {
    cwd: f.project, env: f.env, encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const got = JSON.parse(result.stdout);
  assert.deepEqual(got.args, ['list']);
  assert.equal(got.env.TAKT_CLAUDE_ACCOUNT_DIR, f.account);
  assert.equal(got.env.TAKT_CODEX_ACCOUNT_DIR, f.codex);
});

test('launcher resolves a relative account path', t => {
  const f = fixture(t);
  const result = spawnSync('sh', [launcher, '--claude-account', '../account with spaces', '--codex-account', '../codex account with spaces', 'resume'], {
    cwd: f.project, env: f.env, encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const got = JSON.parse(result.stdout);
  assert.deepEqual(got.args, ['resume']);
  assert.equal(got.env.TAKT_CLAUDE_ACCOUNT_DIR, f.account);
  assert.equal(got.env.TAKT_CODEX_ACCOUNT_DIR, f.codex);
});

test('adapter overrides the inherited account and credentials without changing CLI arguments', t => {
  const f = fixture(t);
  const args = ['--print', '--output-format', 'stream-json', 'prompt with spaces'];
  const result = spawnSync('sh', [adapter, ...args], {
    cwd: f.project, env: { ...f.env, TAKT_CLAUDE_ACCOUNT_DIR: f.account, TEST_EXIT_CODE: '9' },
    input: 'SDK prompt\n', encoding: 'utf8',
  });
  assert.equal(result.status, 9, result.stderr);
  const got = JSON.parse(result.stdout);
  assert.deepEqual(got.args, args);
  assert.equal(got.input, 'SDK prompt\n');
  assert.equal(got.env.CLAUDE_CONFIG_DIR, f.account);
  assert.equal(got.env.TAKT_AGENT, '1');
  assert.deepEqual(got.credentials, []);
});

test('launcher runs takt through mise exec when mise is available, so the project pin applies', t => {
  const f = fixture(t);
  const bin = join(f.root, 'bin');
  mkdirSync(bin);
  copyFileSync(f.cli, join(bin, 'mise'));
  chmodSync(join(bin, 'mise'), 0o755);
  const { TAKT_REAL_CLI, ...env } = f.env;
  const result = spawnSync('sh', [launcher, '--claude-account', f.account, '--codex-account', f.codex, '--pipeline'], {
    cwd: f.project, env: { ...env, PATH: `${bin}:${env.PATH}`, TEST_EXIT_CODE: '5' }, encoding: 'utf8',
  });
  assert.equal(result.status, 5, result.stderr);
  const got = JSON.parse(result.stdout);
  assert.deepEqual(got.args, ['exec', '--', 'takt', '--pipeline']);
});

test('missing or invalid account selection never launches the real CLI', t => {
  const f = fixture(t);
  const cases = [
    [launcher, [], f.env],
    [launcher, ['--wrong-option', f.account], f.env],
    [launcher, ['--claude-account', join(f.project, 'missing'), '--codex-account', f.codex], f.env],
    [launcher, ['--claude-account', f.account], f.env],
    [launcher, ['--codex-account', f.codex], f.env],
    [launcher, ['--claude-account', f.account, '--codex-account', join(f.project, 'missing')], f.env],
    [adapter, [], f.env],
    [adapter, [], { ...f.env, TAKT_CLAUDE_ACCOUNT_DIR: join(f.project, 'missing') }],
  ];
  for (const [script, args, env] of cases) {
    const result = spawnSync('sh', [script, ...args], { cwd: f.project, env, encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, '');
    assert.notEqual(result.stderr, '');
  }
});
