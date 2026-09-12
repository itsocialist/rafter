/** rafter stop [name] — stop only services whose ownership can be established. */

import chalk from 'chalk';
import { getAllProjects, resolveProject } from '../../core/registry.js';
import { stopServer } from '../../core/process.js';
import { printHeader, success, warn, error, info, fmtPort } from '../ui.js';

function report(project, result) {
  if (result.stopped) {
    success(`Stopped ${chalk.white.bold(project.name)}${project.port ? ` (port ${fmtPort(project.port)})` : ''}`);
  } else if (result.reason === 'port-conflict') {
    const owner = result.status?.owner;
    error(`Refused to stop ${chalk.white.bold(project.name)}: port ${project.port} belongs to ${owner?.process || 'another process'} (PID ${owner?.pid || 'unknown'}).`);
  } else if (result.reason === 'remote') {
    info(`${chalk.white.bold(project.name)} is remote; there is no local process to stop.`);
  } else if (result.reason === 'not-running') {
    warn(`${chalk.white.bold(project.name)} is not running.`);
  } else {
    warn(`${chalk.white.bold(project.name)} did not exit after SIGTERM. Use ${chalk.cyan(`rafter kill-port ${project.port} --force`)} only after checking ownership.`);
  }
}

export async function stopCommand(name, options) {
  printHeader();
  console.log();

  if (options.all) {
    let stopped = 0;
    for (const project of getAllProjects()) {
      const result = await stopServer(project);
      if (result.stopped) {
        report(project, result);
        stopped++;
      } else if (result.reason === 'port-conflict') {
        report(project, result);
      }
    }
    if (!stopped) info('No owned Rafter services were running.');
    else success(`Stopped ${stopped} owned service${stopped === 1 ? '' : 's'}.`);
    console.log();
    return;
  }

  if (!name) {
    error('Specify a project name or use --all.');
    console.log();
    return;
  }

  const resolved = resolveProject(name, { cwd: process.cwd() });
  if (!resolved.project) {
    if (resolved.matches.length > 1) error(`Project reference is ambiguous: ${resolved.matches.map(item => item.name).join(', ')}`);
    else error(`Project ${chalk.white.bold(name)} not found.`);
    console.log();
    return;
  }

  report(resolved.project, await stopServer(resolved.project));
  console.log();
}
