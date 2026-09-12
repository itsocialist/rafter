#!/usr/bin/env node

/**
 * Rafter — AI Dev Service Manager
 * CLI Entry Point
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { registerCommand } from './commands/register.js';
import { startCommand } from './commands/start.js';
import { stopCommand } from './commands/stop.js';
import { statusCommand } from './commands/status.js';
import { portsCommand } from './commands/ports.js';
import { killPortCommand } from './commands/kill-port.js';
import { scanCommand } from './commands/scan.js';
import { deploymentsCommand } from './commands/deployments.js';
import { findCommand } from './commands/find.js';
import { gcCommand } from './commands/gc.js';
import { daemonCommand } from './commands/daemon.js';
import { doctorCommand } from './commands/doctor.js';
import { configureCommand } from './commands/configure.js';
import { unregisterCommand } from './commands/unregister.js';
import { openUrl } from './open-url.js';

const program = new Command();

program
  .name('rafter')
  .description(chalk.dim('Rafter — AI Dev Service Manager'))
  .version('1.0.0');

// P0: Core commands
program
  .command('register')
  .description('Register current directory as a Rafter project')
  .option('-p, --port <port>', 'Pin a specific port')
  .option('-n, --name <name>', 'Override project name')
  .option('-t, --tags <tags>', 'Comma-separated tags')
  .option('--start-cmd <cmd>', 'Override start command')
  .option('--docker', 'Register as a Docker-managed project')
  .option('--url <url>', 'Register as a remote app with this URL (no local process)')
  .action(registerCommand);

program
  .command('start [name]')
  .description('Start a dev server (by name or "." for current directory)')
  .option('--no-open', 'Don\'t open browser')
  .action(startCommand);

program
  .command('stop [name]')
  .description('Stop a dev server')
  .option('-a, --all', 'Stop all running servers')
  .action(stopCommand);

program
  .command('status')
  .description('Show all registered projects and their status')
  .option('-r, --running', 'Show only running services')
  .option('--json', 'Emit machine-readable status')
  .option('-v, --verbose', 'Show ownership and project paths')
  .action(statusCommand);

program
  .command('ports')
  .description('Display port allocation map')
  .action(portsCommand);

program
  .command('doctor')
  .description('Audit names, paths, ports, and live process ownership')
  .option('--json', 'Emit a machine-readable diagnostic report')
  .action(doctorCommand);

program
  .command('configure [name]')
  .description('Show or update a service name, port, command, or health check')
  .option('-n, --name <name>', 'Set the canonical service name')
  .option('-p, --port <port>', 'Set the assigned port')
  .option('--start-cmd <cmd>', 'Set the start command')
  .option('--health-check <url-or-path>', 'Set a health URL/path; pass an empty string to clear')
  .action(configureCommand);

program
  .command('unregister <name>')
  .description('Remove a registry entry without deleting project files')
  .option('-f, --force', 'Allow a running service to become unmanaged')
  .action(unregisterCommand);

program
  .command('kill-port <port>')
  .description('Kill whatever process is on a given port')
  .option('-f, --force', 'Use SIGKILL if graceful termination times out')
  .action(killPortCommand);

// P1: Extended commands
program
  .command('scan [directory]')
  .description('Bulk register all projects in a directory')
  .option('--dry-run', 'Preview without registering')
  .action(scanCommand);

program
  .command('deployments')
  .description('List all deployment URLs')
  .action(deploymentsCommand);

program
  .command('find <query>')
  .description('Fuzzy search projects by name')
  .action(findCommand);

program
  .command('gc')
  .description('Inspect unmanaged listeners (never kills them)')
  .action(gcCommand);

program
  .command('daemon <action>')
  .description('Manage the Rafter daemon (start|stop|restart|status|logs)')
  .action(daemonCommand);

program
  .command('dashboard')
  .description('Open Mission Control dashboard in browser')
  .action(async () => {
    const { getConfig } = await import('../core/registry.js');
    const { checkPort } = await import('../core/ports.js');
    const config = getConfig();
    const port = config.dashboardPort || 9000;
    const portStatus = checkPort(port);
    if (!portStatus.inUse) {
      console.log(chalk.yellow('\n  ⚠ Dashboard is not running.'));
      console.log(chalk.dim('  ℹ Start daemon first: ') + chalk.cyan('rafter daemon start') + '\n');
      return;
    }
    console.log(chalk.dim(`\n  Opening Mission Control at `) + chalk.cyan(`http://localhost:${port}`) + '\n');
    openUrl(`http://localhost:${port}`);
  });

program.parseAsync().catch(error => {
  console.error(chalk.red(`\n  ✗ ${error.message}\n`));
  process.exitCode = 1;
});
