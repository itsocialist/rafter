/**
 * rafter daemon <action> — Manage the Rafter daemon (rafterd)
 */

import { spawn } from 'child_process';
import { closeSync, existsSync, readFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import chalk from 'chalk';
import { PATHS, getConfig } from '../../core/registry.js';
import { checkPort } from '../../core/ports.js';
import { printHeader, success, warn, error, info, fmtPort } from '../ui.js';

const PID_FILE = join(PATHS.rafterDir, 'daemon.pid');
const LOG_FILE = join(PATHS.rafterDir, 'logs', 'daemon.log');

/**
 * Get the daemon PID if running.
 * @returns {number|null}
 */
function getDaemonPid() {
  if (!existsSync(PID_FILE)) return null;
  try {
    const raw = readFileSync(PID_FILE, 'utf-8').trim();
    const pid = raw.startsWith('{') ? Number(JSON.parse(raw).pid) : Number(raw);
    if (!Number.isInteger(pid) || pid < 2) throw new Error('invalid PID');
    const port = getConfig().dashboardPort || 9000;
    const listener = checkPort(port);
    if (!listener.listeners.some(item => item.pid === pid)) throw new Error('PID does not own the dashboard port');
    return pid;
  } catch {
    // Process not running, clean up stale PID file
    try { unlinkSync(PID_FILE); } catch {}
    return null;
  }
}

/**
 * @param {string} action
 */
export async function daemonCommand(action) {
  printHeader();
  console.log();

  switch (action) {
    case 'start': return startDaemon();
    case 'stop': return stopDaemon();
    case 'restart': {
      const stopped = await stopDaemon();
      if (!stopped) {
        error('Restart aborted because the existing daemon did not exit.');
        console.log();
        return;
      }
      await new Promise(r => setTimeout(r, 1000));
      return startDaemon();
    }
    case 'status': return daemonStatus();
    case 'logs': return daemonLogs();
    default:
      error(`Unknown daemon action: ${action}`);
      info(`Usage: ${chalk.cyan('rafter daemon <start|stop|restart|status|logs>')}`);
      console.log();
  }
}

async function startDaemon() {
  const pid = getDaemonPid();
  if (pid) {
    warn(`Rafter daemon is already running (PID ${pid})`);
    console.log();
    return;
  }

  const config = getConfig();
  const port = config.dashboardPort || 9000;

  // Find the daemon server.js path
  const serverPath = new URL('../../../src/daemon/server.js', import.meta.url).pathname;

  info('Starting Rafter daemon...');

  // Spawn detached daemon with output going to log file
  const { openSync } = await import('fs');
  const logFd = openSync(LOG_FILE, 'a');
  let child;
  try {
    child = spawn(process.execPath, [serverPath], {
      detached: true,
      stdio: ['ignore', logFd, logFd],
      env: { ...process.env },
    });
  } finally {
    closeSync(logFd);
  }

  child.unref();

  // Wait a moment for the daemon to write its PID file
  await new Promise(r => setTimeout(r, 1500));

  const newPid = getDaemonPid();
  if (newPid) {
    console.log();
    success('Rafter daemon started');
    console.log(`  ${chalk.dim('PID')}        ${chalk.white(String(newPid))}`);
    console.log(`  ${chalk.dim('Dashboard')}  ${chalk.cyan(`http://localhost:${port}`)}`);
    console.log(`  ${chalk.dim('Logs')}       ${chalk.dim(LOG_FILE)}`);
  } else {
    error('Daemon failed to start. Check logs:');
    info(chalk.dim(LOG_FILE));
  }
  console.log();
}

async function stopDaemon() {
  const pid = getDaemonPid();
  if (!pid) {
    info('Rafter daemon is not running.');
    console.log();
    return true;
  }

  try {
    process.kill(pid, 'SIGTERM');
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 50));
      try { process.kill(pid, 0); } catch {
        try { unlinkSync(PID_FILE); } catch {}
        success(`Rafter daemon stopped (PID ${pid})`);
        console.log();
        return true;
      }
    }
    warn(`Daemon received SIGTERM but PID ${pid} is still present.`);
  } catch {
    error(`Could not stop daemon (PID ${pid}). Try: ${chalk.cyan(`kill -9 ${pid}`)}`);
  }
  console.log();
  return false;
}

async function daemonStatus() {
  const pid = getDaemonPid();
  if (!pid) {
    info('Rafter daemon is ' + chalk.red('not running'));
    info(`Start with: ${chalk.cyan('rafter daemon start')}`);
    console.log();
    return;
  }

  const config = getConfig();
  const port = config.dashboardPort || 9000;

  // Try to fetch daemon health from API
  try {
    const res = await fetch(`http://localhost:${port}/api/daemon`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (Number(data.pid) !== pid) throw new Error('PID mismatch');
    success('Rafter daemon is ' + chalk.green('healthy'));
    console.log(`  ${chalk.dim('PID')}        ${chalk.white(String(pid))}`);
    console.log(`  ${chalk.dim('Uptime')}     ${chalk.white(data.uptime)}`);
    console.log(`  ${chalk.dim('Dashboard')}  ${chalk.cyan(`http://localhost:${port}`)}`);
    console.log(`  ${chalk.dim('Clients')}    ${chalk.white(String(data.clients))}`);
  } catch {
    warn('Daemon PID exists but API is not responding.');
    info(`Try: ${chalk.cyan('rafter daemon restart')}`);
  }
  console.log();
}

function daemonLogs() {
  if (!existsSync(LOG_FILE)) {
    info('No daemon logs found.');
    console.log();
    return;
  }

  info(`Daemon log: ${chalk.dim(LOG_FILE)}`);
  console.log();

  try {
    const lines = readFileSync(LOG_FILE, 'utf-8').split(/\r?\n/).slice(-31).join('\n');
    console.log(chalk.dim(lines));
  } catch {
    warn('Could not read daemon logs.');
  }
}
