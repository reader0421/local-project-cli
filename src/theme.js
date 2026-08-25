const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
};

export function colorEnabled(environment = process.env, stream = process.stdout) {
  return Boolean(stream.isTTY) && !Object.hasOwn(environment, 'NO_COLOR') && environment.TERM !== 'dumb';
}

function paint(value, codes, enabled = colorEnabled()) {
  const text = String(value);
  if (!enabled) return text;
  return `${codes.join('')}${text}${ANSI.reset}`;
}

export function title(value, enabled) {
  return paint(value, [ANSI.bold, ANSI.cyan], enabled);
}

export function projectName(value, enabled) {
  return paint(value, [ANSI.bold, ANSI.white], enabled);
}

export function repositoryName(value, enabled) {
  return paint(value, [ANSI.cyan], enabled);
}

export function branch(value, enabled) {
  return paint(value, [ANSI.blue], enabled);
}

export function count(value, enabled) {
  return paint(value, [ANSI.bold, ANSI.yellow], enabled);
}

export function muted(value, enabled) {
  return paint(value, [ANSI.dim, ANSI.white], enabled);
}

export function action(value, enabled) {
  return paint(value, [ANSI.blue], enabled);
}

export function destructive(value, enabled) {
  return paint(value, [ANSI.red], enabled);
}

export function success(value, enabled) {
  return paint(value, [ANSI.green], enabled);
}

export function failure(value, enabled) {
  return paint(value, [ANSI.red], enabled);
}

export function status(value, gitStatus, enabled) {
  if (gitStatus.kind === 'error' || gitStatus.dirty) return paint(value, [ANSI.bold, ANSI.red], enabled);
  if (gitStatus.kind === 'non_git' || !gitStatus.upstream || gitStatus.ahead > 0) return paint(value, [ANSI.yellow], enabled);
  if (gitStatus.behind > 0 || gitStatus.detached || gitStatus.operation) return paint(value, [ANSI.magenta], enabled);
  return paint(value, [ANSI.green], enabled);
}

export function stripAnsi(value) {
  return String(value).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
}
