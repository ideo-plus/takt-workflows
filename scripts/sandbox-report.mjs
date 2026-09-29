export function formatReportDetail(value) {
  return String(value)
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, (character) => `\\x${character.codePointAt(0).toString(16).padStart(2, '0')}`)
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|');
}

export function formatReportCheck(check) {
  const status = check.ok ? 'ok' : '**NG**';
  return `| ${status} | ${check.group} | ${formatReportDetail(check.name)} | ${formatReportDetail(check.detail)} |`;
}
