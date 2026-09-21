import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(
  new URL('./check-facet-budget.mjs', import.meta.url),
);

function runCheck(limit, filePaths) {
  return spawnSync(
    process.execPath,
    [scriptPath, String(limit), ...filePaths],
    { encoding: 'utf8' },
  );
}

function findSizeCell(stdout, label) {
  const row = stdout.split('\n').find((line) => line.startsWith(label));

  return row?.slice(label.length).trim();
}

test('returns 0 and prints every size and total below the limit', () => {
  const directory = mkdtempSync(join(tmpdir(), 'facet-budget-'));

  try {
    const firstPath = join(directory, 'a.bin');
    const secondPath = join(directory, 'b.bin');
    writeFileSync(firstPath, Buffer.alloc(11));
    writeFileSync(secondPath, Buffer.alloc(3));

    const result = runCheck(15, [firstPath, secondPath]);

    assert.equal(result.status, 0);
    assert.equal(findSizeCell(result.stdout, firstPath), '11');
    assert.equal(findSizeCell(result.stdout, secondPath), '3');
    assert.equal(findSizeCell(result.stdout, 'Total'), '14');
    assert.equal(result.stderr, '');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('returns 0 when the total equals the limit', () => {
  const directory = mkdtempSync(join(tmpdir(), 'facet-budget-'));

  try {
    const firstPath = join(directory, 'a.bin');
    const secondPath = join(directory, 'b.bin');
    writeFileSync(firstPath, Buffer.alloc(11));
    writeFileSync(secondPath, Buffer.alloc(5));

    const result = runCheck(16, [firstPath, secondPath]);

    assert.equal(result.status, 0);
    assert.equal(findSizeCell(result.stdout, firstPath), '11');
    assert.equal(findSizeCell(result.stdout, secondPath), '5');
    assert.equal(findSizeCell(result.stdout, 'Total'), '16');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('returns 1 after printing the table when the total exceeds the limit', () => {
  const directory = mkdtempSync(join(tmpdir(), 'facet-budget-'));

  try {
    const firstPath = join(directory, 'a.bin');
    const secondPath = join(directory, 'b.bin');
    writeFileSync(firstPath, Buffer.alloc(11));
    writeFileSync(secondPath, Buffer.alloc(5));

    const result = runCheck(15, [firstPath, secondPath]);

    assert.equal(result.status, 1);
    assert.equal(findSizeCell(result.stdout, firstPath), '11');
    assert.equal(findSizeCell(result.stdout, secondPath), '5');
    assert.equal(findSizeCell(result.stdout, 'Total'), '16');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('returns 2 with a clear error for a missing file', () => {
  const directory = mkdtempSync(join(tmpdir(), 'facet-budget-'));

  try {
    const missingPath = join(directory, 'missing.bin');

    const result = runCheck(100, [missingPath]);

    assert.equal(result.status, 2);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /Missing file/);
    assert.match(result.stderr, /missing\.bin/);
    assert.match(result.stderr, /ENOENT/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('does not print a partial table when one of the files is missing', () => {
  const directory = mkdtempSync(join(tmpdir(), 'facet-budget-'));

  try {
    const existingPath = join(directory, 'a.bin');
    const missingPath = join(directory, 'gone.bin');
    writeFileSync(existingPath, Buffer.alloc(11));

    const result = runCheck(100, [existingPath, missingPath]);

    assert.equal(result.status, 2);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /gone\.bin/);
    assert.match(result.stderr, /ENOENT/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('reports byte size rather than character count', () => {
  const directory = mkdtempSync(join(tmpdir(), 'facet-budget-'));

  try {
    const filePath = join(directory, 'multibyte.txt');
    const contents = 'あいうえお';
    writeFileSync(filePath, contents, 'utf8');
    assert.equal(Buffer.byteLength(contents, 'utf8'), 15);

    const result = runCheck(100, [filePath]);
    assert.equal(result.status, 0);
    assert.equal(findSizeCell(result.stdout, filePath), '15');
    assert.equal(findSizeCell(result.stdout, 'Total'), '15');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
