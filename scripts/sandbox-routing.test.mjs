import assert from 'node:assert/strict';
import test from 'node:test';
import { checkStepRouting, expectedPrimary, nextFallback } from './sandbox-routing.mjs';

const RUNTIME = {
  provider: {
    defaults: { profile: 't2' },
    profiles: {
      't0-test-code': { provider: 'opencode', model: 'ollama/glm-5.3-flash:cloud' },
      fable: { provider: 'claude', model: 'claude-fable-5-1' },
      t1: { provider: 'codex', model: 'gpt-5.6-sol' },
      t2: { provider: 'codex', model: 'gpt-6-astra' },
      't3-plan': { provider: 'codex', model: 'gpt-6-astra' },
    },
    targets: {
      steps: {
        'development-core/plan': { profile: 't3-plan' },
        'development-core/write_tests': { ladder: ['t0-test-code', 't1', 't2'] },
        'development-core/replan': { profile: 'fable' },
      },
    },
  },
};

const CONFIG = {
  rate_limit_fallback: {
    switch_chain: [
      { provider: 'claude', model: 'claude-opus-5-5' },
      { provider: 'codex', model: 'gpt-5.6-sol' },
    ],
  },
};

const start = (workflow, step, iteration, provider, model) => ({
  type: 'step_start',
  workflow,
  step,
  iteration,
  provider,
  model,
});
const complete = (workflow, step, iteration, status) => ({
  type: 'step_complete',
  workflow,
  step,
  iteration,
  status,
});

test('expectedPrimary resolves the step target ladder', () => {
  const expected = expectedPrimary(RUNTIME, 'development-core/write_tests');
  assert.deepEqual(expected, {
    names: ['t0-test-code', 't1', 't2'],
    models: ['opencode/ollama/glm-5.3-flash:cloud', 'codex/gpt-5.6-sol', 'codex/gpt-6-astra'],
  });
});

test('expectedPrimary falls back to the default profile', () => {
  const expected = expectedPrimary(RUNTIME, 'development-core/review');
  assert.deepEqual(expected, { names: ['t2'], models: ['codex/gpt-6-astra'] });
});

test('nextFallback skips the current and already-tried entries in chain order', () => {
  const chain = CONFIG.rate_limit_fallback.switch_chain;
  const first = nextFallback(CONFIG, []);
  assert.deepEqual(first, chain[0]);
  const second = nextFallback(CONFIG, [chain[0]]);
  assert.deepEqual(second, chain[1]);
  const exhausted = nextFallback(CONFIG, chain);
  assert.equal(exhausted, undefined);
});

test('nextFallback allows nothing without a switch chain', () => {
  assert.equal(nextFallback({}, []), undefined);
  assert.equal(nextFallback({ rate_limit_fallback: {} }, []), undefined);
});

test('a primary start matching the runtime assignment passes', () => {
  const events = [start('development-core', 'plan', 1, 'codex', 'gpt-6-astra'), complete('development-core', 'plan', 1, 'done')];
  const checks = checkStepRouting(events, RUNTIME, CONFIG);
  assert.deepEqual(
    checks.map((check) => ({ step: check.step, ok: check.ok })),
    [{ step: 'development-core/plan', ok: true }],
  );
});

test('a step with a profile target rejects a start of another assignment', () => {
  const events = [start('development-core', 'replan', 1, 'codex', 'gpt-6-astra')];
  const checks = checkStepRouting(events, RUNTIME, CONFIG);
  assert.equal(checks.length, 1);
  assert.equal(checks[0].ok, false);
  assert.match(checks[0].detail, /claude\/claude-fable-5-1/);
});

test('a rate-limited step re-run through the configured switch chain passes', () => {
  const events = [
    start('development-core', 'replan', 4, 'claude', 'claude-fable-5-1'),
    complete('development-core', 'replan', 4, 'rate_limited'),
    start('development-core', 'replan', 4, 'claude', 'claude-opus-5-5'),
    complete('development-core', 'replan', 4, 'rate_limited'),
    start('development-core', 'replan', 4, 'codex', 'gpt-5.6-sol'),
    complete('development-core', 'replan', 4, 'done'),
  ];
  const checks = checkStepRouting(events, RUNTIME, CONFIG);
  assert.deepEqual(
    checks.map((check) => check.ok),
    [true, true, true],
  );
});

test('a start of an unconfigured model without a preceding rate limit fails', () => {
  const events = [start('development-core', 'review', 1, 'claude', 'claude-opus-5-5')];
  const checks = checkStepRouting(events, RUNTIME, CONFIG);
  assert.equal(checks.length, 1);
  assert.equal(checks[0].ok, false);
  assert.match(checks[0].detail, /expected/);
});

test('a later rate limit does not excuse an invalid primary start', () => {
  const events = [
    start('development-core', 'review', 1, 'claude', 'claude-opus-5-5'),
    complete('development-core', 'review', 1, 'rate_limited'),
  ];
  const checks = checkStepRouting(events, RUNTIME, CONFIG);
  assert.equal(checks[0].ok, false);
});

test('a fallback start of an entry outside the switch chain fails', () => {
  const events = [
    start('development-core', 'review', 1, 'codex', 'gpt-6-astra'),
    complete('development-core', 'review', 1, 'rate_limited'),
    start('development-core', 'review', 1, 'claude', 'claude-fable-5-1'),
  ];
  const checks = checkStepRouting(events, RUNTIME, CONFIG);
  assert.equal(checks[0].ok, true);
  assert.equal(checks[1].ok, false);
});

test('a fallback entry already tried in the same step run fails', () => {
  const events = [
    start('development-core', 'review', 1, 'claude', 'claude-opus-5-5'),
    complete('development-core', 'review', 1, 'rate_limited'),
    start('development-core', 'review', 1, 'claude', 'claude-opus-5-5'),
  ];
  const checks = checkStepRouting(events, RUNTIME, CONFIG);
  assert.equal(checks[1].ok, false);
});

test('a chain order skip fails', () => {
  const events = [
    start('development-core', 'review', 1, 'codex', 'gpt-6-astra'),
    complete('development-core', 'review', 1, 'rate_limited'),
    start('development-core', 'review', 1, 'codex', 'gpt-5.6-sol'),
  ];
  const checks = checkStepRouting(events, RUNTIME, CONFIG);
  assert.equal(checks[1].ok, false);
});

test('a fallback is not applied across a different iteration', () => {
  const events = [
    start('development-core', 'review', 1, 'codex', 'gpt-6-astra'),
    complete('development-core', 'review', 1, 'rate_limited'),
    start('development-core', 'review', 2, 'claude', 'claude-opus-5-5'),
  ];
  const checks = checkStepRouting(events, RUNTIME, CONFIG);
  assert.equal(checks[1].ok, false);
});
