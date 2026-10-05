import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const launcher = fileURLToPath(new URL('./run-takt.sh', import.meta.url));
const adapter = fileURLToPath(new URL('./takt-claude.sh', import.meta.url));
const CREDENTIALS = [
  'CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX',
  'ANTHROPIC_PROFILE', 'ANTHROPIC_FEDERATION_RULE_ID', 'ANTHROPIC_ORGANIZATION_ID', 'ANTHROPIC_WORKSPACE_ID',
  'CLAUDE_CODE_USE_ANTHROPIC_AWS', 'CLAUDE_CODE_USE_FOUNDRY', 'CLAUDE_CODE_USE_MANTLE',
  'ANTHROPIC_BASE_URL', 'ANTHROPIC_CUSTOM_HEADERS', 'ANTHROPIC_MODEL', 'ANTHROPIC_DEFAULT_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_DEFAULT_FABLE_MODEL', 'ANTHROPIC_SMALL_FAST_MODEL',
  'CLAUDE_CODE_SUBAGENT_MODEL', 'CLAUDE_CODE_SUBAGENT_MODEL_FORCE',
];
const CODEX_CREDENTIALS = ['OPENAI_API_KEY', 'CODEX_API_KEY', 'TAKT_OPENAI_API_KEY'];
const TAKT_CREDENTIALS = ['TAKT_ANTHROPIC_API_KEY'];
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
if (require('node:path').basename(process.argv[1]) === 'mise') {
  if (process.env.TEST_MISE_RECORD) require('node:fs').appendFileSync(process.env.TEST_MISE_RECORD,
    JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd() }) + '\\n');
  if (process.argv[2] === 'trust' && process.argv[3] === '--show') {
    console.log(process.env.TEST_MISE_TRUST === undefined ? process.cwd() + '/mise.toml: trusted' : process.env.TEST_MISE_TRUST);
    process.exit(Number(process.env.TEST_MISE_TRUST_EXIT || 0));
  }
}
if (process.argv[2] === '--version') {
  console.log(process.env.TEST_VERSION || (require('node:path').basename(process.argv[1]) === 'codex' ? 'codex-cli 0.134.0' : '2.1.280 (Claude Code)'));
  process.exit(Number(process.env.TEST_VERSION_EXIT || 0));
}
if (process.env.TEST_LAUNCH_RECORD) require('node:fs').writeFileSync(process.env.TEST_LAUNCH_RECORD, 'launched');
if (process.env.TEST_ADAPTER) {
  const key = process.env.TEST_ADAPTER === 'claude' ? 'TAKT_CLAUDE_CLI_PATH' : 'TAKT_CODEX_CLI_PATH';
  const env = { ...process.env };
  delete env.TEST_ADAPTER;
  const result = require('node:child_process').spawnSync(process.env[key], process.argv.slice(2), { env, stdio: 'inherit' });
  process.exit(result.status);
}
process.stdin.resume();
let input = '';
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  const keys = ['TAKT_CLAUDE_ACCOUNT_DIR', 'TAKT_CLAUDE_CLI_PATH', 'CLAUDE_CONFIG_DIR', 'TAKT_AGENT',
    'TAKT_CODEX_ACCOUNT_DIR', 'TAKT_CODEX_CLI_PATH', 'CODEX_HOME', 'TAKT_CONFIG_DIR',
    'TAKT_CLAUDE_REAL_CLI', 'TAKT_CODEX_REAL_CLI'];
  console.log(JSON.stringify({
    args: process.argv.slice(2), input, cwd: process.cwd(), executable: process.argv[1],
    env: Object.fromEntries(keys.map(key => [key, process.env[key]])),
    credentials: ${JSON.stringify(CREDENTIALS)}.filter(key => key in process.env),
    codexCredentials: ${JSON.stringify(CODEX_CREDENTIALS)}.filter(key => key in process.env),
    taktCredentials: ${JSON.stringify(TAKT_CREDENTIALS)}.filter(key => key in process.env)
  }));
  process.exitCode = Number(process.env.TEST_EXIT_CODE || 0);
});
`);
  chmodSync(cli, 0o755);
  return { root, cli, project, account, codex, env: {
    PATH: process.env.PATH,
    HOME: root,
    TAKT_REAL_CLI: cli,
    TAKT_CLAUDE_REAL_CLI: cli,
    TAKT_CODEX_REAL_CLI: cli,
    CLAUDE_CONFIG_DIR: join(root, 'inherited account'),
    CODEX_HOME: join(root, 'inherited codex account'),
    ...Object.fromEntries([...CREDENTIALS, ...CODEX_CREDENTIALS, ...TAKT_CREDENTIALS].map(key => [key, 'test-only'])),
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
  assert.equal(got.env.TAKT_CLAUDE_REAL_CLI, f.cli);
  assert.equal(got.env.TAKT_CODEX_REAL_CLI, f.cli);
  assert.deepEqual(got.codexCredentials, []);
  assert.deepEqual(got.taktCredentials, []);
});

test('installed launcher uses adjacent adapters and overrides inherited TAKT_CONFIG_DIR', t => {
  const f = fixture(t);
  const installer = fileURLToPath(new URL('./use-lang.sh', import.meta.url));
  const installed = spawnSync('sh', [installer, 'ja', f.project, '--launchers-only'], { encoding: 'utf8' });
  assert.equal(installed.status, 0, installed.stderr);
  const bin = join(f.project, '.takt/bin');
  const result = spawnSync(join(bin, 'run-takt.sh'), ['--claude-account', f.account, '--codex-account', f.codex, 'list'], {
    cwd: f.project, env: { ...f.env, TAKT_CONFIG_DIR: join(f.root, 'inherited home') }, encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const got = JSON.parse(result.stdout);
  assert.equal(got.env.TAKT_CLAUDE_CLI_PATH, join(bin, 'takt-claude.sh'));
  assert.equal(got.env.TAKT_CODEX_CLI_PATH, join(bin, 'takt-codex.sh'));
  assert.equal(got.env.TAKT_CONFIG_DIR, join(f.project, '.takt/home'));
  assert.equal(got.cwd, f.project);
});

test('PATH CLI resolution reaches both adapters and reports the same paths and accounts', t => {
  const f = fixture(t);
  const bin = join(f.project, 'cli bin');
  mkdirSync(bin);
  for (const name of ['claude', 'codex']) copyFileSync(f.cli, join(bin, name));
  const { TAKT_CLAUDE_REAL_CLI, TAKT_CODEX_REAL_CLI, ...env } = f.env;
  for (const provider of ['claude', 'codex']) {
    const result = spawnSync('sh', [launcher, '--claude-account', f.account, '--codex-account', f.codex, 'prompt'], {
      cwd: f.project, env: { ...env, PATH: `cli bin:${env.PATH}`, TEST_ADAPTER: provider }, input: 'input', encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    const got = JSON.parse(result.stdout);
    assert.equal(got.env.TAKT_CLAUDE_REAL_CLI, join(bin, 'claude'));
    assert.equal(got.env.TAKT_CODEX_REAL_CLI, join(bin, 'codex'));
    assert.equal(got.env.TAKT_AGENT, '1');
    assert.equal(got.executable, join(bin, provider));
    assert.equal(got.env[provider === 'claude' ? 'CLAUDE_CONFIG_DIR' : 'CODEX_HOME'], provider === 'claude' ? f.account : f.codex);
    assert.equal(got.input, 'input');
    if (provider === 'claude') assert.deepEqual(got.credentials, []);
    for (const value of [f.account, f.codex, join(bin, 'claude'), join(bin, 'codex'), '2.1.280', 'codex-cli 0.134.0', join(f.project, '.takt/home')]) {
      assert.ok(result.stderr.includes(value), result.stderr);
    }
  }
});

test('missing Claude or Codex on PATH never starts TAKT', t => {
  const f = fixture(t);
  const bin = join(f.root, 'isolated-bin');
  mkdirSync(bin);
  for (const name of ['dirname', 'basename', 'awk']) {
    const path = spawnSync('sh', ['-c', `command -v ${name}`], { encoding: 'utf8' }).stdout.trim();
    symlinkSync(path, join(bin, name));
  }
  const { TAKT_CLAUDE_REAL_CLI, TAKT_CODEX_REAL_CLI, ...env } = f.env;
  const record = join(f.root, 'launch-record');
  for (const missing of ['claude', 'codex']) {
    const present = missing === 'claude' ? 'codex' : 'claude';
    writeFileSync(join(bin, present), '#!/bin/sh\necho "2.1.280 (Claude Code)"\n', { mode: 0o755 });
    const result = spawnSync('/bin/sh', [launcher, '--claude-account', f.account, '--codex-account', f.codex], {
      cwd: f.project, env: { ...env, PATH: bin, TEST_LAUNCH_RECORD: record }, encoding: 'utf8',
    });
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, '');
    assert.equal(existsSync(record), false);
    assert.ok(result.stderr.includes(missing));
    rmSync(join(bin, present));
  }
});

test('Claude version minimum uses numeric comparison and rejects invalid or failed version output', t => {
  const f = fixture(t);
  const record = join(f.root, 'launch-record');
  for (const [version, versionExit, accepted] of [
    ['2.1.279 (Claude Code)', '0', false], ['2.0.999', '0', false], ['1.99.999', '0', false],
    ['2.1.280 (Claude Code)', '0', true], ['2.1.1000', '0', true], ['2.2.0', '0', true], ['3.0.0', '0', true],
    ['not a version', '0', false], ['2.1.280', '1', false],
  ]) {
    rmSync(record, { force: true });
    const result = spawnSync('sh', [launcher, '--claude-account', f.account, '--codex-account', f.codex], {
      cwd: f.project, env: { ...f.env, TEST_VERSION: version, TEST_VERSION_EXIT: versionExit, TEST_LAUNCH_RECORD: record }, encoding: 'utf8',
    });
    assert.equal(result.status === 0, accepted, `${version}: ${result.stderr}`);
    assert.equal(existsSync(record), accepted);
  }
});

test('explicit real CLI overrides are validated and version acquisition failures stop TAKT', t => {
  const f = fixture(t);
  const invalid = join(f.root, 'not executable');
  writeFileSync(invalid, '#!/bin/sh\necho 2.1.280\n', { mode: 0o644 });
  const empty = join(f.root, 'empty-version');
  writeFileSync(empty, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const failed = join(f.root, 'failed-version');
  writeFileSync(failed, '#!/bin/sh\necho 2.1.280\nexit 1\n', { mode: 0o755 });
  const record = join(f.root, 'launch-record');
  for (const key of ['TAKT_CLAUDE_REAL_CLI', 'TAKT_CODEX_REAL_CLI']) {
    for (const path of [join(f.root, 'missing-cli'), invalid, f.root, empty, failed]) {
      const result = spawnSync('sh', [launcher, '--claude-account', f.account, '--codex-account', f.codex], {
        cwd: f.project, env: { ...f.env, [key]: path, TEST_LAUNCH_RECORD: record }, encoding: 'utf8',
      });
      assert.notEqual(result.status, 0, path);
      assert.equal(existsSync(record), false, path);
      assert.equal(result.stdout, '', path);
    }
  }
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
  const record = join(f.root, 'mise-record');
  const result = spawnSync('sh', [launcher, '--claude-account', f.account, '--codex-account', f.codex, '--pipeline'], {
    cwd: f.project, env: { ...env, PATH: `${bin}:${env.PATH}`, TEST_EXIT_CODE: '5', TEST_MISE_RECORD: record }, encoding: 'utf8',
  });
  assert.equal(result.status, 5, result.stderr);
  const got = JSON.parse(result.stdout);
  assert.deepEqual(got.args, ['exec', '--', 'takt', '--pipeline']);
  assert.deepEqual(got.taktCredentials, []);
  assert.deepEqual(readFileSync(record, 'utf8').trim().split('\n').map(line => JSON.parse(line)), [
    { args: ['trust', '--show'], cwd: f.project },
    { args: ['exec', '--', 'takt', '--pipeline'], cwd: f.project },
  ]);
});

test('without mise, a project that pins tools with mise stops instead of running an unpinned takt', t => {
  const f = fixture(t);
  const bin = join(f.root, 'bin');
  mkdirSync(bin);
  copyFileSync(f.cli, join(bin, 'takt'));
  chmodSync(join(bin, 'takt'), 0o755);
  const { TAKT_REAL_CLI, ...env } = f.env;
  const path = `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`;
  const launchRecord = join(f.root, 'launch-record');
  for (const config of ['mise.toml', '.mise.toml', '.config/mise/config.toml']) {
    mkdirSync(dirname(join(f.project, config)), { recursive: true });
    writeFileSync(join(f.project, config), '[tools]\n');
    const result = spawnSync('sh', [launcher, '--claude-account', f.account, '--codex-account', f.codex, '--pipeline'], {
      cwd: f.project, env: { ...env, PATH: path, TEST_LAUNCH_RECORD: launchRecord }, encoding: 'utf8',
    });
    assert.notEqual(result.status, 0, result.stderr);
    assert.ok(result.stderr.includes(config), result.stderr);
    assert.equal(result.stdout, '');
    assert.equal(existsSync(launchRecord), false);
    rmSync(join(f.project, config));
  }
});

test('without mise and without a mise configuration, the takt on PATH runs', t => {
  const f = fixture(t);
  const bin = join(f.root, 'bin');
  mkdirSync(bin);
  copyFileSync(f.cli, join(bin, 'takt'));
  chmodSync(join(bin, 'takt'), 0o755);
  const { TAKT_REAL_CLI, ...env } = f.env;
  const result = spawnSync('sh', [launcher, '--claude-account', f.account, '--codex-account', f.codex, '--pipeline'], {
    cwd: f.project, env: { ...env, PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`, TEST_EXIT_CODE: '4' }, encoding: 'utf8',
  });
  assert.equal(result.status, 4, result.stderr);
  const got = JSON.parse(result.stdout);
  assert.equal(got.executable, join(bin, 'takt'));
  assert.deepEqual(got.args, ['--pipeline']);
});

test('usage names the path the launcher was invoked by', t => {
  const f = fixture(t);
  const result = spawnSync('sh', [launcher], { cwd: f.project, env: f.env, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.ok(result.stderr.includes(`usage: ${launcher} `), result.stderr);
});

test('untrusted or unconfirmed mise configuration stops without trusting or launching TAKT', t => {
  const f = fixture(t);
  const bin = join(f.root, 'bin');
  mkdirSync(bin);
  for (const name of ['mise', 'takt']) copyFileSync(f.cli, join(bin, name));
  const { TAKT_REAL_CLI, ...env } = f.env;
  const record = join(f.root, 'mise-record');
  const launchRecord = join(f.root, 'launch-record');
  for (const [output, exit] of [
    [`${f.project}/mise.toml: untrusted`, '0'],
    [`${f.root}/mise.toml: trusted\n${f.project}/mise.toml: untrusted`, '0'],
    ['', '0'],
    [`${f.project}/mise.toml: trusted`, '1'],
  ]) {
    rmSync(record, { force: true });
    const result = spawnSync('sh', [launcher, '--claude-account', f.account, '--codex-account', f.codex, '--pipeline'], {
      cwd: f.project, env: { ...env, PATH: `${bin}:${env.PATH}`, TEST_MISE_TRUST: output,
        TEST_MISE_TRUST_EXIT: exit, TEST_MISE_RECORD: record, TEST_LAUNCH_RECORD: launchRecord }, encoding: 'utf8',
    });
    assert.notEqual(result.status, 0, result.stderr);
    assert.ok(result.stderr.includes('mise trust'), result.stderr);
    assert.equal(result.stdout, '');
    assert.equal(existsSync(launchRecord), false);
    assert.deepEqual(readFileSync(record, 'utf8').trim().split('\n').map(line => JSON.parse(line)), [
      { args: ['trust', '--show'], cwd: f.project },
    ]);
  }
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
