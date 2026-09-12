/**
 * rafter status — Show all registered projects with running status
 */

import chalk from 'chalk';
import { getAllProjects } from '../../core/registry.js';
import { getServerStatus } from '../../core/process.js';
import { printHeader, statusDot, fmtPort, fmtMem, fmtPid, pad, info } from '../ui.js';

/**
 * @param {Object} options
 */
export async function statusCommand(options) {
  const projects = getAllProjects();

  if (projects.length === 0) {
    if (options.json) {
      console.log('[]');
      return;
    }
    console.log();
    info('No projects registered yet.');
    info(`Run ${chalk.cyan('rafter register')} in a project directory or ${chalk.cyan('rafter scan ~/workspace')}`);
    console.log();
    return;
  }

  // Get status for all projects (async to support remote HTTP checks)
  const statuses = await Promise.all(projects.map(async p => {
    const s = await getServerStatus(p);
    return { ...p, ...s };
  }));

  // Filter to running only if requested
  const filtered = options.running
    ? statuses.filter(s => s.running)
    : statuses;

  if (options.json) {
    console.log(JSON.stringify(filtered.map(({ env, ...safe }) => safe), null, 2));
    return;
  }

  printHeader();

  if (filtered.length === 0) {
    console.log();
    info(options.running ? 'No services currently running.' : 'No registered projects.');
    console.log();
    return;
  }

  // Sort: running first, then alphabetical
  filtered.sort((a, b) => {
    if (a.running && !b.running) return -1;
    if (!a.running && b.running) return 1;
    return a.name.localeCompare(b.name);
  });

  // Print table header
  console.log();
  console.log(
    chalk.dim('  ') +
    pad(chalk.dim('SERVICE'), 34) +
    pad(chalk.dim('PORT'), 14) +
    pad(chalk.dim('STATE'), 14) +
    pad(chalk.dim('PID'), 10) +
    chalk.dim('MEM')
  );
  console.log(chalk.dim(`  ${'─'.repeat(70)}`));

  // Print each project
  for (const s of filtered) {
    const runtime = s.runtime || 'process';

    let portDisplay, statusDisplay, pidDisplay, memDisplay;

    if (runtime === 'remote') {
      portDisplay = chalk.dim('remote');
      statusDisplay = s.running ? chalk.green(s.state || 'online') : chalk.red(s.state || 'offline');
      pidDisplay = chalk.dim('—');
      memDisplay = chalk.dim('—');
    } else if (runtime === 'docker') {
      portDisplay = s.port ? `docker :${s.port}` : chalk.dim('docker');
      statusDisplay = s.running ? chalk.green(s.state || 'running') : chalk.dim(s.state || 'stopped');
      pidDisplay = chalk.dim('—');
      memDisplay = chalk.dim('—');
    } else {
      portDisplay = fmtPort(s.port);
      statusDisplay = s.state === 'conflict'
        ? chalk.yellow('conflict')
        : s.running ? chalk.green(s.state || 'running') : chalk.dim(s.state || 'stopped');
      pidDisplay = fmtPid(s.pid);
      memDisplay = fmtMem(s.mem);
    }

    console.log(
      '  ' +
      statusDot(s.running) + ' ' +
      pad(chalk.white(s.name), 32) +
      pad(portDisplay, 14) +
      pad(statusDisplay, 14) +
      pad(pidDisplay, 10) +
      memDisplay
    );

    // Show devUrl for remote apps
    if (runtime === 'remote' && s.devUrl) {
      console.log(`       ${chalk.dim('→ dev:')}  ${chalk.cyan(s.devUrl)}`);
    }

    // Show prod URL for any app that has one
    const prodUrl = s.deployments?.production || s.deployments?.prod;
    if (prodUrl) {
      console.log(`       ${chalk.dim('→ prod:')} ${chalk.cyan(prodUrl)}`);
    }
    if (options.verbose) {
      console.log(`       ${chalk.dim('path:')}   ${chalk.dim(s.path)}`);
      if (s.ownership) console.log(`       ${chalk.dim('owner:')}  ${chalk.dim(s.ownership)}${s.cwd ? ` · ${s.cwd}` : ''}`);
      if (s.state === 'conflict' && s.owner) {
        console.log(`       ${chalk.yellow('port owned by:')} ${s.owner.process || 'unknown'} PID ${s.owner.pid || 'unknown'}${s.owner.cwd ? ` · ${s.owner.cwd}` : ''}`);
      }
    }
  }

  // Summary
  const running = statuses.filter(s => s.running).length;
  const conflicts = statuses.filter(s => s.state === 'conflict').length;
  const stopped = statuses.length - running - conflicts;
  console.log();
  console.log(
    chalk.dim('  ') +
    chalk.green(`${running} running`) +
    (conflicts ? chalk.dim(' · ') + chalk.yellow(`${conflicts} conflict${conflicts === 1 ? '' : 's'}`) : '') +
    chalk.dim(' · ') +
    chalk.dim(`${stopped} stopped`) +
    chalk.dim(' · ') +
    chalk.white(`${statuses.length} registered`)
  );
  console.log();
}
