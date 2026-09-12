/** rafter unregister — remove a registry entry without deleting project files. */

import chalk from 'chalk';
import { resolveProject, unregisterProject } from '../../core/registry.js';
import { getServerStatus } from '../../core/process.js';
import { printHeader, success, warn, error, info } from '../ui.js';

export async function unregisterCommand(reference, options) {
  printHeader();
  console.log();
  const resolved = resolveProject(reference, { cwd: process.cwd() });
  if (!resolved.project) {
    error(resolved.matches.length > 1
      ? `Project reference is ambiguous: ${resolved.matches.map(item => item.name).join(', ')}`
      : `Project ${chalk.white.bold(reference)} not found.`);
    console.log();
    return;
  }
  const project = resolved.project;
  const status = await getServerStatus(project);
  if ((status.running || status.state === 'starting') && !options.force) {
    warn(`${chalk.white.bold(project.name)} is running. Stop it first or pass --force to leave it running unmanaged.`);
    console.log();
    return;
  }
  unregisterProject(project.name);
  success(`Unregistered ${chalk.white.bold(project.name)}. No project files were deleted.`);
  info(`The local ${chalk.cyan('.rafter.json')} was retained for future re-registration.`);
  console.log();
}
