/** rafter configure — maintain canonical name, port, command, and health probe. */

import chalk from 'chalk';
import { getRegistry, registerProject, resolveProject, validatePort } from '../../core/registry.js';
import { checkPort } from '../../core/ports.js';
import { getServerStatus } from '../../core/process.js';
import { printHeader, success, error, info } from '../ui.js';

export async function configureCommand(reference, options) {
  printHeader();
  console.log();
  const resolved = resolveProject(reference || '.', { cwd: process.cwd() });
  if (!resolved.project) {
    error(resolved.matches.length > 1
      ? `Project reference is ambiguous: ${resolved.matches.map(item => item.name).join(', ')}`
      : 'Registered project not found.');
    console.log();
    return;
  }
  const project = resolved.project;
  const hasChanges = options.name || options.port || options.startCmd || options.healthCheck !== undefined;
  if (!hasChanges) {
    console.log(`  ${chalk.dim('Name')}          ${chalk.white(project.name)}`);
    console.log(`  ${chalk.dim('Aliases')}       ${chalk.dim(project.aliases?.join(', ') || '—')}`);
    console.log(`  ${chalk.dim('Path')}          ${chalk.dim(project.path)}`);
    console.log(`  ${chalk.dim('Port')}          ${project.port || '—'}`);
    console.log(`  ${chalk.dim('Start')}         ${project.startCmd || '—'}`);
    console.log(`  ${chalk.dim('Health check')}  ${project.healthCheck || '—'}`);
    console.log();
    return;
  }

  const next = { ...project };
  if (options.name) next.name = options.name;
  if (options.startCmd) next.startCmd = options.startCmd;
  if (options.healthCheck !== undefined) next.healthCheck = options.healthCheck || undefined;
  if (options.port) {
    const newPort = validatePort(options.port);
    if (newPort !== project.port) {
      const status = await getServerStatus(project);
      if (status.running || status.state === 'starting') {
        error(`Stop ${chalk.white.bold(project.name)} before changing its port.`);
        console.log();
        return;
      }
      const assigned = Object.values(getRegistry()).find(item => item.name !== project.name && item.port === newPort);
      if (assigned) throw new Error(`Port ${newPort} is assigned to ${assigned.name}.`);
      const live = checkPort(newPort);
      if (live.inUse) throw new Error(`Port ${newPort} is listening (${live.process}, PID ${live.pid}).`);
      next.port = newPort;
    }
  }

  const saved = registerProject(next);
  success(`Updated ${chalk.white.bold(saved.name)}.`);
  if (saved.name !== project.name) info(`Old name ${chalk.white(project.name)} remains a lookup alias.`);
  console.log();
}
