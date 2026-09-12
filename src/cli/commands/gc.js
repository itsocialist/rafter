/**
 * rafter gc — Inspect development listeners not assigned to Rafter projects.
 */

import chalk from 'chalk';
import { getAllProjects } from '../../core/registry.js';
import { findOrphans } from '../../core/process.js';
import { printHeader, success, warn, info, fmtPort } from '../ui.js';

export async function gcCommand() {
  printHeader();
  console.log();

  info('Scanning for orphan dev processes...');

  const projects = getAllProjects();
  const orphans = findOrphans(projects);

  if (orphans.length === 0) {
    success('No unmanaged development listeners found.');
    console.log();
    return;
  }

  console.log();
  warn(`Found ${orphans.length} unmanaged listener${orphans.length > 1 ? 's' : ''}:`);
  console.log();

  for (const o of orphans) {
    console.log(
      `  ${chalk.dim('PID')} ${chalk.white(String(o.pid))}  ` +
      `${chalk.dim('port')} ${fmtPort(o.port)}  ` +
      `${chalk.dim('(')}${chalk.white(o.process)}${chalk.dim(')')}` +
      (o.cwd ? `  ${chalk.dim(o.cwd)}` : '')
    );
  }

  console.log();
  info(`Nothing was killed. Inspect ownership, then use ${chalk.cyan('rafter kill-port <port>')} explicitly.`);
  console.log();
}
