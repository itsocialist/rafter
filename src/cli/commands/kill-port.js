/**
 * rafter kill-port <port> — Kill whatever is on a port
 */

import chalk from 'chalk';
import { checkPort, killPort } from '../../core/ports.js';
import { printHeader, success, warn, info, fmtPort } from '../ui.js';

/**
 * @param {string} portStr
 */
export async function killPortCommand(portStr, options) {
  printHeader();
  console.log();

  const port = parseInt(portStr, 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    warn(`Invalid port: ${portStr}`);
    return;
  }

  const status = checkPort(port);
  if (!status.inUse) {
    info(`Nothing is listening on port ${fmtPort(port)}.`);
    console.log();
    return;
  }

  info(`Port ${fmtPort(port)} is used by ${chalk.white(status.process)} (PID ${status.pid})`);

  const result = await killPort(port, { force: options.force });
  if (result.killed > 0 && result.remaining === 0) {
    success(`Killed process on port ${fmtPort(port)}.`);
  } else if (result.killed > 0) {
    warn(`Sent a termination signal, but ${result.remaining} listener${result.remaining === 1 ? '' : 's'} remain.`);
  } else {
    warn(`The process did not exit. Retry with ${chalk.cyan(`rafter kill-port ${port} --force`)} if you own it.`);
  }
  console.log();
}
