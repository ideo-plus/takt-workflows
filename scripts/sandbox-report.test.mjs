import assert from 'node:assert/strict';
import test from 'node:test';
import { checkStepRouting } from './sandbox-routing.mjs';
import { formatReportCheck, formatReportDetail } from './sandbox-report.mjs';

const runtimeFor = (model) => ({
  provider: {
    profiles: { primary: { provider: 'opencode', model } },
    targets: { steps: { 'development-core/replan': { profile: 'primary' } } },
  },
});

const start = (provider, model) => ({
  type: 'step_start',
  workflow: 'development-core',
  step: 'replan',
  iteration: 4,
  provider,
  model,
});

const complete = (status) => ({
  type: 'step_complete',
  workflow: 'development-core',
  step: 'replan',
  iteration: 4,
  status,
});

test('formats C0 and C1 controls as visible escapes', () => {
  const codePoints = [...Array.from({ length: 0x20 }, (_, index) => index), ...Array.from({ length: 0x21 }, (_, index) => 0x7f + index)];
  const controls = String.fromCodePoint(...codePoints);
  const expected = codePoints.map((codePoint) => `\\\\x${codePoint.toString(16).padStart(2, '0')}`).join('');

  assert.equal(formatReportDetail(controls), expected);
  assert.doesNotMatch(formatReportDetail(controls), /[\u0000-\u001f\u007f-\u009f]/);
});

test('keeps markdown pipe escaping', () => {
  assert.equal(formatReportDetail('actual | expected'), 'actual \\| expected');
});

test('escapes markdown pipes after existing backslashes', () => {
  for (const backslashes of [1, 2, 3]) {
    const value = `actual ${'\\'.repeat(backslashes)}| expected`;
    const formatted = formatReportDetail(value);
    const preceding = formatted.match(/(\\+)\|/)?.[1];

    assert.equal(preceding?.length, 2 * backslashes + 1);
  }
});

test('formats event-derived check names and details as safe table cells', () => {
  const event = {
    type: 'step_start',
    workflow: 'workflow\u001b]52;c;YQ==\u0007',
    step: String.raw`step\|name`,
    iteration: 4,
    provider: 'opencode',
    model: 'expected',
  };
  const runtime = {
    provider: {
      defaults: { profile: 'primary' },
      profiles: { primary: { provider: 'opencode', model: 'expected' } },
    },
  };
  const [routing] = checkStepRouting([event], runtime, {});
  const name = `${event.workflow}/${event.step} (#${event.iteration})`;
  const row = formatReportCheck({ ...routing, group: 'routing', name });

  assert.equal(routing.ok, true);
  assert.equal(
    row,
    String.raw`| ok | routing | workflow\\x1b]52;c;YQ==\\x07/step\\\|name (#4) | opencode/expected expected opencode/expected |`,
  );
  assert.doesNotMatch(row, /[\u0000-\u001f\u007f-\u009f]/);
});

test('a primary route containing terminal controls still matches and displays safely', () => {
  const model = 'model\u001b]52;c;YQ==\u0007';
  const [check] = checkStepRouting([start('opencode', model)], runtimeFor(model), {});

  assert.equal(check.ok, true);
  assert.equal(
    formatReportDetail(check.detail),
    'opencode/model\\\\x1b]52;c;YQ==\\\\x07 expected opencode/model\\\\x1b]52;c;YQ==\\\\x07',
  );
});

test('a literal escape sequence in the primary route remains ordinary text', () => {
  const model = String.raw`model\u001b]52;c;YQ==\u0007`;
  const [check] = checkStepRouting([start('opencode', model)], runtimeFor(model), {});

  assert.equal(check.ok, true);
  assert.equal(
    formatReportDetail(check.detail),
    String.raw`opencode/model\\u001b]52;c;YQ==\\u0007 expected opencode/model\\u001b]52;c;YQ==\\u0007`,
  );
});

test('a fallback route containing terminal controls still matches and displays safely', () => {
  const model = 'fallback\u001b]52;c;YQ==\u0007';
  const events = [start('opencode', 'primary'), complete('rate_limited'), start('opencode', model)];
  const checks = checkStepRouting(events, runtimeFor('primary'), {
    rate_limit_fallback: { switch_chain: [{ provider: 'opencode', model }] },
  });

  assert.deepEqual(checks.map((check) => check.ok), [true, true]);
  assert.equal(
    formatReportDetail(checks[1].detail),
    'opencode/fallback\\\\x1b]52;c;YQ==\\\\x07 expected opencode/fallback\\\\x1b]52;c;YQ==\\\\x07',
  );
});

test('a literal escape sequence in the fallback route remains ordinary text', () => {
  const model = String.raw`fallback\u001b]52;c;YQ==\u0007`;
  const events = [start('opencode', 'primary'), complete('rate_limited'), start('opencode', model)];
  const checks = checkStepRouting(events, runtimeFor('primary'), {
    rate_limit_fallback: { switch_chain: [{ provider: 'opencode', model }] },
  });

  assert.deepEqual(checks.map((check) => check.ok), [true, true]);
  assert.equal(
    formatReportDetail(checks[1].detail),
    String.raw`opencode/fallback\\u001b]52;c;YQ==\\u0007 expected opencode/fallback\\u001b]52;c;YQ==\\u0007`,
  );
});

test('an event route mismatch remains a failure and displays terminal controls safely', () => {
  const model = 'unexpected\u001b]52;c;YQ==\u0007';
  const [check] = checkStepRouting([start('opencode', model)], runtimeFor('expected'), {});
  const detail = formatReportDetail(check.detail);

  assert.equal(check.ok, false);
  assert.equal(detail, 'opencode/unexpected\\\\x1b]52;c;YQ==\\\\x07 expected opencode/expected');
  assert.doesNotMatch(detail, /[\u0000-\u001f\u007f-\u009f]/);
});

test('a literal escape sequence in a mismatching event remains ordinary text', () => {
  const model = String.raw`unexpected\u001b]52;c;YQ==\u0007`;
  const [check] = checkStepRouting([start('opencode', model)], runtimeFor('expected'), {});

  assert.equal(check.ok, false);
  assert.equal(
    formatReportDetail(check.detail),
    String.raw`opencode/unexpected\\u001b]52;c;YQ==\\u0007 expected opencode/expected`,
  );
});
