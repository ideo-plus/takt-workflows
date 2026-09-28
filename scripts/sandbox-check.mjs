#!/usr/bin/env node
// Helper for scripts/sandbox-verify.sh.
//
//   sandbox-check.mjs mockify --project DIR --scenario FILE
//     Rewrites every profile in DIR/.takt/runtime.yaml to the mock provider (model = profile
//     name, so routing stays observable) and writes a mock scenario whose judge answers select
//     the happy-path rule of every step.
//
//   sandbox-check.mjs verify --project DIR --mode real|mock --run-log FILE --exit-code N
//                            [--elapsed SECONDS] [--report FILE]
//     Checks the latest run in DIR/.takt/runs against DIR/.takt/runtime.yaml and prints a report.
//     Exits 0 when every check passes, 1 otherwise.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

// ---------------------------------------------------------------- arguments
const [command, ...rest] = process.argv.slice(2);
const opts = {};
for (let i = 0; i < rest.length; i += 2) {
  if (!rest[i].startsWith('--')) fail(`unexpected argument: ${rest[i]}`);
  opts[rest[i].slice(2)] = rest[i + 1];
}
function fail(message) {
  console.error(`sandbox-check: ${message}`);
  process.exit(2);
}

// ---------------------------------------------------------------- YAML via TAKT's own dependency
function isTaktPackage(pkg) {
  try {
    return JSON.parse(readFileSync(pkg, 'utf8')).name === 'takt';
  } catch {
    return false;
  }
}
function loadYamlModule() {
  // TAKT_PACKAGE_DIR wins; otherwise walk up from the takt executable (a symlink into the
  // package, or a shim in node_modules/.bin next to node_modules/takt), then try `npm root -g`.
  const candidates = [];
  if (process.env.TAKT_PACKAGE_DIR) candidates.push(join(process.env.TAKT_PACKAGE_DIR, 'package.json'));
  try {
    const bin = execFileSync('sh', ['-c', 'command -v takt'], { encoding: 'utf8' }).trim();
    for (let dir = dirname(realpathSync(bin)); dir !== dirname(dir); dir = dirname(dir)) {
      candidates.push(join(dir, 'package.json'), join(dir, 'takt', 'package.json'), join(dir, 'node_modules', 'takt', 'package.json'));
    }
  } catch {
    // fall through to npm root -g
  }
  try {
    candidates.push(join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), 'takt', 'package.json'));
  } catch {
    // no npm
  }
  const pkg = candidates.find((p) => existsSync(p) && isTaktPackage(p));
  if (!pkg) fail('could not locate the takt package to load its yaml module (set TAKT_PACKAGE_DIR)');
  // Resolve from the real path: package managers with isolated layouts (pnpm, mise) keep
  // dependencies next to the real package directory, not next to the symlink.
  return createRequire(realpathSync(pkg))('yaml');
}
const YAML = loadYamlModule();
const runtimePath = (project) => join(project, '.takt', 'runtime.yaml');

// ---------------------------------------------------------------- mockify
// Steps on the happy path and the 1-based rule each must select.
const HAPPY_PATH_RULES = {
  plan: 1,
  replan: 1,
  write_tests: 1,
  implement: 1,
  reimplement: 1,
  reimplement_final: 1,
  'ai-antipattern-review': 1,
  'architecture-review': 1,
  'frontend-review': 1,
  'backend-review': 1,
  'cqrs-es-review': 1,
  'security-review': 1,
  'testing-review': 1,
  'coding-review': 1,
  'review-adjudication': 2, // 修正対象なし / no findings to fix -> final-gate
  'final-gate': 1, // APPROVE -> COMPLETE
  'ddd-review': 1, // approved
};

function mockify() {
  const project = opts.project ?? fail('--project is required');
  const scenario = opts.scenario ?? fail('--scenario is required');
  const doc = YAML.parseDocument(readFileSync(runtimePath(project), 'utf8'));
  const profiles = doc.getIn(['provider', 'profiles']);
  if (!profiles || !profiles.items?.length) fail('runtime.yaml has no provider.profiles to mock');
  for (const pair of profiles.items) {
    const name = String(pair.key.value ?? pair.key);
    doc.setIn(['provider', 'profiles', name], doc.createNode({ provider: 'mock', model: name }, { flow: true }));
  }
  writeFileSync(runtimePath(project), String(doc));

  // The judge ("conductor") first tries structured output, then a tag of the form
  // [STEP-NAME:N]. One answer carrying the tag for every step works for any step.
  const tags = Object.entries(HAPPY_PATH_RULES).map(([step, n]) => `[${step.toUpperCase()}:${n}]`);
  const answer = `${tags.join(' ')} [JUDGE:1]`;
  const times = (n, entry) => Array.from({ length: n }, () => ({ ...entry }));
  const entries = [
    ...times(400, { persona: 'conductor', status: 'done', content: answer }),
    // The coder changes a file so the implement step has a diff and the companions run.
    ...times(20, {
      persona: 'coder',
      status: 'done',
      content: '[MOCK] coder output',
      file_writes: [{ path: 'src/mock-change.mjs', content: 'export const mockChange = true;\n' }],
    }),
    // Dynamic parallel selector: fixed reviewers only (empty pool selection is valid).
    ...times(20, {
      persona: 'dynamic-parallel-selector',
      status: 'done',
      content: 'no pool reviewers',
      structured_output: { selected_ids: [], rationale: 'mock sandbox run' },
    }),
    // Companion reviewers and moderator: no findings.
    ...['ai-antipattern-review-companion', 'testing-review-companion', 'review-companion-moderator'].flatMap((persona) =>
      times(20, { persona, status: 'done', content: 'no findings', structured_output: { findings: [], notes: 'mock sandbox run' } })),
  ];
  writeFileSync(scenario, JSON.stringify(entries, null, 2));
  console.log(`mock: ${profiles.items.length} profiles switched to the mock provider; scenario ${scenario}`);
}

// ---------------------------------------------------------------- verify
function latestRunLog(project) {
  const runsDir = join(project, '.takt', 'runs');
  if (!existsSync(runsDir)) return undefined;
  const runs = readdirSync(runsDir)
    .map((name) => join(runsDir, name))
    .filter((p) => statSync(p).isDirectory() && existsSync(join(p, 'logs')))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  for (const run of runs) {
    const logs = readdirSync(join(run, 'logs')).filter((f) => f.endsWith('.jsonl'));
    if (logs.length) return { run, file: join(run, 'logs', logs[0]) };
  }
  return undefined;
}

function readEvents(file) {
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

function verify() {
  const project = opts.project ?? fail('--project is required');
  const mode = opts.mode ?? fail('--mode is required');
  const exitCode = Number(opts['exit-code'] ?? fail('--exit-code is required'));
  const runLog = opts['run-log'] ? readFileSync(opts['run-log'], 'utf8') : '';
  const workflow = opts.workflow ?? 'flash-default';
  const checkCmd = opts['check-cmd'] ?? 'node --test';

  const runtime = YAML.parse(readFileSync(runtimePath(project), 'utf8'));
  const provider = runtime.provider ?? {};
  const profiles = provider.profiles ?? {};
  const stepTargets = provider.targets?.steps ?? {};
  const companionTargets = provider.targets?.companions ?? {};
  const describe = (name) => {
    const p = profiles[name];
    return p ? `${p.provider}/${p.model}` : `(undefined profile ${name})`;
  };
  const allowedFor = (assignment) => {
    const names = assignment?.ladder ?? (assignment?.profile ? [assignment.profile] : []);
    return { names, models: names.map(describe) };
  };
  const expectedForStep = (key) => {
    if (stepTargets[key]) return { source: key, ...allowedFor(stepTargets[key]) };
    return { source: 'defaults', ...allowedFor(provider.defaults) };
  };

  const checks = [];
  const add = (group, name, ok, detail) => checks.push({ group, name, ok, detail });

  // Completion.
  add('run', 'takt exit code 0', exitCode === 0, `exit ${exitCode}`);
  add('run', 'workflow completed', /Workflow completed/.test(runLog), (runLog.match(/Workflow (completed|failed)[^\n]*/) ?? ['no completion line'])[0]);

  const latest = latestRunLog(project);
  if (!latest) {
    add('run', 'run log present', false, 'no .takt/runs/*/logs/*.jsonl');
  } else {
    const events = readEvents(latest.file);

    // Step routing.
    const starts = events.filter((e) => e.type === 'step_start' && e.model);
    const visited = new Set();
    for (const e of starts) {
      const key = `${e.workflow}/${e.step}`;
      visited.add(key);
      const expected = expectedForStep(key);
      const actual = `${e.provider}/${e.model}`;
      add('routing', `${key} (#${e.iteration ?? '?'})`, expected.models.includes(actual),
        `${actual}  expected ${expected.models.join(' | ')} [${expected.source}: ${expected.names.join(' > ')}]`);
    }
    // Parallel sub-steps (the reviewers) log phase events instead of step_start.
    for (const e of events.filter((ev) => ev.type === 'phase_start' && ev.workflow && ev.step)) visited.add(`${e.workflow}/${e.step}`);
    const visitedSteps = new Set([...visited].map((key) => key.split('/').pop()));
    const requiredSteps = ['plan', 'write_tests', 'implement', 'review-adjudication', 'final-gate'];
    if (workflow.startsWith('ddd-')) requiredSteps.push('ddd-review');
    for (const step of requiredSteps) {
      const where = [...visited].filter((key) => key.endsWith(`/${step}`));
      add('path', `visited ${step}`, visitedSteps.has(step), where.join(', ') || 'not visited');
    }

    // Companions.
    const companionCalls = events.filter((e) => e.type === 'companion_call' && e.model);
    if (companionTargets && Object.keys(companionTargets).length > 0 && runtime.companion?.enabled) {
      add('companion', 'companion reviewers ran', companionCalls.length > 0, `${companionCalls.length} call(s)`);
    }
    for (const e of companionCalls) {
      const target = companionTargets[e.agent];
      const expected = target ? allowedFor(target).models : [];
      const actual = `${e.provider}/${e.model}`;
      add('companion', `${e.agent} on ${e.step}`, expected.includes(actual), `${actual}  expected ${expected.join(' | ') || '(no target)'}`);
    }
  }

  // Real mode: the produced code must work.
  if (mode === 'real') {
    const untracked = spawnSync('git', ['-C', project, 'ls-files', '--others', '--exclude-standard'], { encoding: 'utf8' }).stdout
      .split('\n').filter((f) => f && !f.startsWith('.takt/'));
    const tests = untracked.filter((f) => /\.test\.[cm]?[jt]s$/.test(f) || (/\.rs$/.test(f) && /test/.test(readFileSync(join(project, f), 'utf8'))));
    add('output', 'test files created', tests.length > 0, tests.join(', ') || 'none');
    const check = spawnSync('sh', ['-c', checkCmd], { cwd: project, encoding: 'utf8' });
    const out = `${check.stdout}\n${check.stderr}`;
    const summary = (out.match(/^ℹ (tests|pass|fail) \d+/gm) ?? out.match(/^test result: .*$/gm) ?? []).join(', ');
    add('output', `${checkCmd} passes`, check.status === 0, summary || `exit ${check.status}`);
    if (workflow.startsWith('ddd-')) {
      for (const file of ['.ddd.toml', 'docs/ddd/domain-model.yaml', 'docs/ddd/aggregate-mapping.yaml']) {
        add('ddd', `${file} written`, existsSync(join(project, file)), existsSync(join(project, file)) ? 'present' : 'missing');
      }
    }
  }

  // Report.
  const passed = checks.filter((c) => c.ok).length;
  const failed = checks.length - passed;
  const lines = [
    `# Sandbox verification: ${failed === 0 ? 'PASS' : 'FAIL'}`,
    '',
    `- mode: ${mode}`,
    `- workflow: ${workflow}`,
    `- project: ${project}`,
    ...(opts.elapsed ? [`- elapsed: ${Math.round(Number(opts.elapsed) / 60)} min`] : []),
    `- checks: ${passed} passed, ${failed} failed`,
    ...(latest ? [`- run: ${latest.run}`] : []),
    '',
    '| | group | check | detail |',
    '|---|---|---|---|',
    ...checks.map((c) => `| ${c.ok ? 'ok' : '**NG**'} | ${c.group} | ${c.name} | ${String(c.detail).replace(/\|/g, '\\|')} |`),
    '',
  ];
  const report = lines.join('\n');
  if (opts.report) writeFileSync(opts.report, report);
  console.log(report);
  process.exit(failed === 0 ? 0 : 1);
}

if (command === 'mockify') mockify();
else if (command === 'verify') verify();
else fail('usage: sandbox-check.mjs <mockify|verify> [options]');
