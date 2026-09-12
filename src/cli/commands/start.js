/** rafter start [name] — safely start or open a registered service. */

import chalk from 'chalk';
import { resolveProject } from '../../core/registry.js';
import { getServerStatus, startServer } from '../../core/process.js';
import { printHeader, success, warn, error, info, fmtPort, statusDot } from '../ui.js';
import { openUrl } from '../open-url.js';

async function waitForState(project, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  let status = await getServerStatus(project);
  while (!status.running && status.state === 'starting' && Date.now() < deadline) {
    await new Promise(resolvePromise => setTimeout(resolvePromise, 250));
    status = await getServerStatus(project);
  }
  return status;
}

export async function startCommand(name, options) {
  printHeader();
  const resolved = resolveProject(name || '.', { cwd: process.cwd() });
  const project = resolved.project;
  if (!project) {
    console.log();
    if (resolved.matches.length > 1) {
      error(`Project reference ${chalk.white.bold(name)} is ambiguous: ${resolved.matches.map(item => item.name).join(', ')}`);
    } else {
      error(name && name !== '.' ? `Project ${chalk.white.bold(name)} not found.` : `No Rafter project registered in ${chalk.white(process.cwd())}`);
    }
    info(`Run ${chalk.cyan('rafter find <query>')} to search, or ${chalk.cyan('rafter register')} in the project directory.`);
    console.log();
    return;
  }

  const runtime = project.runtime || 'process';
  console.log();
  if (runtime === 'remote') {
    if (!project.devUrl) {
      warn(`${chalk.white.bold(project.name)} is a remote app with no URL configured.`);
    } else {
      const status = await getServerStatus(project);
      console.log(`  ${statusDot(status.running)} ${chalk.dim(status.state)}  ${chalk.cyan(project.devUrl)}`);
      if (options.open !== false) openUrl(project.devUrl);
    }
    console.log();
    return;
  }

  info(`Starting ${chalk.white.bold(project.name)}${project.port ? ` on port ${fmtPort(project.port)}` : ''}...`);
  try {
    const result = await startServer(project);
    if (result.state === 'already-running') {
      warn(`${chalk.white.bold(project.name)} is already running (PID ${result.pid}).`);
      console.log();
      return;
    }

    if (runtime === 'docker') {
      success(`${chalk.white.bold(project.name)} was handed to Docker.`);
      console.log(`  ${chalk.dim('Cmd')}   ${chalk.white(project.startCmd)}`);
      console.log();
      return;
    }

    // Reload the project so status sees persisted process identity.
    const current = resolveProject(project.name, { allowPartial: false }).project;
    const status = await waitForState(current);
    console.log();
    if (status.running) {
      success(`${chalk.white.bold(project.name)} is listening`);
      console.log(`  ${statusDot(true)} ${chalk.dim('URL')}   ${chalk.cyan(`http://localhost:${project.port}`)}`);
      console.log(`  ${chalk.dim('  PID')}   ${chalk.dim(String(status.pid || result.pid))}`);
      console.log(`  ${chalk.dim('  Owner')} ${chalk.dim(status.ownership || 'managed')}`);
      if (options.open !== false) openUrl(`http://localhost:${project.port}`);
    } else {
      warn(`${chalk.white.bold(project.name)} started as PID ${result.pid}, but is not listening yet (${status.state}).`);
      info(`Log: ${chalk.dim(result.logPath)}`);
    }
  } catch (startError) {
    error(`Failed to start ${chalk.white.bold(project.name)}: ${startError.message}`);
  }
  console.log();
}
