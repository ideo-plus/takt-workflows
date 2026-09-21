import { statSync } from 'node:fs';

function parseArguments(args) {
  const [rawLimit, ...filePaths] = args;
  const limit = Number(rawLimit);

  if (!Number.isSafeInteger(limit) || limit < 0) {
    throw new Error(`Invalid byte limit: ${rawLimit ?? '(missing)'}`);
  }

  if (filePaths.length === 0) {
    throw new Error('At least one file path is required.');
  }

  return { limit, filePaths };
}

function measureFiles(filePaths) {
  return filePaths.map((filePath) => {
    let stats;

    try {
      stats = statSync(filePath);
    } catch (error) {
      const code = error.code;

      if (code === 'ENOENT') {
        throw new Error(`Missing file: ${filePath} (${code})`);
      }

      throw new Error(`Unable to inspect file: ${filePath} (${code})`);
    }

    if (!stats.isFile()) {
      throw new Error(`Not a regular file: ${filePath}`);
    }

    return { filePath, size: stats.size };
  });
}

function formatTable(entries, total) {
  const rows = [
    ['File', 'Bytes'],
    ...entries.map(({ filePath, size }) => [filePath, String(size)]),
    ['Total', String(total)],
  ];
  const fileColumnWidth = Math.max(...rows.map(([label]) => label.length));

  return rows
    .map(([label, size]) => `${label.padEnd(fileColumnWidth)}  ${size}`)
    .join('\n');
}

function main(args) {
  try {
    const { limit, filePaths } = parseArguments(args);
    const entries = measureFiles(filePaths);
    const total = entries.reduce((sum, { size }) => sum + size, 0);

    process.stdout.write(`${formatTable(entries, total)}\n`);
    process.exitCode = total <= limit ? 0 : 1;
  } catch (error) {
    process.stderr.write(`Error: ${error.message}\n`);
    process.exitCode = 2;
  }
}

main(process.argv.slice(2));
