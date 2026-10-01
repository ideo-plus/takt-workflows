import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const launcher = fileURLToPath(new URL('./run-takt.sh', import.meta.url));
const adapter = fileURLToPath(new URL('./takt-claude.sh', import.meta.url));
const CREDENTIALS = ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'];

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'takt-claude-')));
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
  const keys = ['TAKT_CLAUDE_ACCOUNT_DIR', 'TAKT_CLAUDE_CLI_PATH', 'CLAUDE_CONFIG_DIR', 'TAKT_AGENT'];
  console.log(JSON.stringify({
    args: process.argv.slice(2), input, cwd: process.cwd(),
    env: Object.fromEntries(keys.map(key => [key, process.env[key]])),
    credentials: ${JSON.stringify(CREDENTIALS)}.filter(key => key in process.env)
  }));
  process.exitCode = Number(process.env.TEST_EXIT_CODE || 0);
});
`);
  chmodSync(cli, 0o755);
  return { project, account, env: {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TAKT_REAL_CLI: cli,
    TAKT_CLAUDE_REAL_CLI: cli,
    CLAUDE_CONFIG_DIR: join(root, 'inherited account'),
    ...Object.fromEntries(CREDENTIALS.map(key => [key, 'test-only'])),
  } };
}

test('launcher selects the account, preserving arguments, stdin and exit status', t => {
  const f = fixture(t);
  const args = ['--pipeline', '--task', 'literal $(not-a-command) `text` with spaces'];
  const result = spawnSync('sh', [launcher, '--claude-account', f.account, ...args], {
    cwd: f.project, env: { ...f.env, TEST_EXIT_CODE: '17' }, input: 'task\ninput', encoding: 'utf8',
  });
  assert.equal(result.status, 17, result.stderr);
  const got = JSON.parse(result.stdout);
  assert.deepEqual(got.args, args);
  assert.equal(got.input, 'task\ninput');
  assert.equal(got.cwd, f.project);
  assert.equal(got.env.TAKT_CLAUDE_ACCOUNT_DIR, f.account);
  assert.equal(got.env.TAKT_CLAUDE_CLI_PATH, adapter);
});

test('launcher resolves a relative account path', t => {
  const f = fixture(t);
  const result = spawnSync('sh', [launcher, '--claude-account', '../account with spaces', 'resume'], {
    cwd: f.project, env: f.env, encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const got = JSON.parse(result.stdout);
  assert.deepEqual(got.args, ['resume']);
  assert.equal(got.env.TAKT_CLAUDE_ACCOUNT_DIR, f.account);
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

test('missing or invalid account selection never launches the real CLI', t => {
  const f = fixture(t);
  const cases = [
    [launcher, [], f.env],
    [launcher, ['--wrong-option', f.account], f.env],
    [launcher, ['--claude-account', join(f.project, 'missing')], f.env],
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
