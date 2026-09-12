/**
 * Rafter — Shared UI utilities for CLI output formatting.
 */

import chalk from 'chalk';

/** Rafter brand header */
export function printHeader() {
  console.log();
  console.log(chalk.dim('  ⌂ ') + chalk.white.bold('RAFTER') + chalk.dim(' — AI Dev Service Manager'));
  console.log(chalk.dim('  ───────────────────────────────────────'));
}

/** Section divider */
export function printDivider() {
  console.log(chalk.dim('  ───────────────────────────────────────────────────────'));
}

/**
 * Format a status dot.
 * @param {boolean} running
 * @returns {string}
 */
export function statusDot(running) {
  return running ? chalk.green('●') : chalk.dim('○');
}

/**
 * Format a port number.
 * @param {number} port
 * @returns {string}
 */
export function fmtPort(port) {
  return chalk.cyan(String(port));
}

/**
 * Format memory usage.
 * @param {string} mem
 * @returns {string}
 */
export function fmtMem(mem) {
  if (!mem || mem === '—') return chalk.dim('—');
  return chalk.yellow(mem);
}

/**
 * Format a PID.
 * @param {number | undefined} pid
 * @returns {string}
 */
export function fmtPid(pid) {
  if (!pid) return chalk.dim('—');
  return chalk.dim(String(pid));
}

/**
 * Pad a string to a fixed width.
 * @param {string} str
 * @param {number} width
 * @returns {string}
 */
export function pad(str, width) {
  // Strip ANSI codes for length calculation
  const stripped = str.replace(/\x1b\[[0-9;]*m/g, '');
  const padding = Math.max(0, width - stripped.length);
  return str + ' '.repeat(padding);
}

/**
 * Right-pad with dots for alignment.
 */
export function padRight(str, width) {
  const stripped = str.replace(/\x1b\[[0-9;]*m/g, '');
  const padding = Math.max(0, width - stripped.length);
  return str + ' '.repeat(padding);
}

/**
 * Print a success message.
 * @param {string} msg
 */
export function success(msg) {
  console.log(chalk.green('  ✓ ') + msg);
}

/**
 * Print a warning message.
 * @param {string} msg
 */
export function warn(msg) {
  console.log(chalk.yellow('  ⚠ ') + msg);
}

/**
 * Print an error message.
 * @param {string} msg
 */
export function error(msg) {
  console.log(chalk.red('  ✗ ') + msg);
}

/**
 * Print an info message.
 * @param {string} msg
 */
export function info(msg) {
  console.log(chalk.dim('  ℹ ') + msg);
}

/**
 * Framework type badge.
 * @param {string} type
 * @param {string} [framework]
 * @returns {string}
 */
export function typeBadge(type, framework) {
  const label = framework || type || 'unknown';
  switch (type) {
    case 'next':    return chalk.bgBlack.white(` ${label} `);
    case 'vite':    return chalk.bgMagenta.white(` ${label} `);
    case 'svelte':  return chalk.bgRed.white(` ${label} `);
    case 'astro':   return chalk.bgMagenta.white(` ${label} `);
    case 'python':  return chalk.bgBlue.white(` ${label} `);
    case 'express': return chalk.bgGreen.white(` ${label} `);
    case 'mcp':     return chalk.bgCyan.black(` ${label} `);
    case 'go':      return chalk.bgCyan.black(` ${label} `);
    case 'rust':    return chalk.bgYellow.black(` ${label} `);
    case 'ruby':    return chalk.bgRed.white(` ${label} `);
    case 'docker':  return chalk.bgBlue.white(` ${label} `);
    case 'remote':  return chalk.bgMagenta.white(` ${label} `);
    default:        return chalk.bgGray.white(` ${label} `);
  }
}

/**
 * Runtime tag (small inline indicator).
 * @param {'process' | 'docker' | 'remote'} runtime
 * @returns {string}
 */
export function runtimeTag(runtime) {
  switch (runtime) {
    case 'docker': return chalk.blue('[docker]');
    case 'remote': return chalk.magenta('[remote]');
    default:       return '';
  }
}
