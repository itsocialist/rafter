/** Process lifecycle and ownership-aware service status. */

import { execFileSync, spawn } from 'child_process';
import {
  appendFileSync,
  closeSync,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readSync,
} from 'fs';
import { isAbsolute, join, relative, resolve } from 'path';
import { request as httpRequest } from 'http';
import { request as httpsRequest } from 'https';
import { checkPort, getListeningPorts, getProcessInfo, terminatePid } from './ports.js';
import { getConfig, updateProject, PATHS } from './registry.js';

const DEV_PROCESS_NAMES = new Set([
  'node', 'python', 'python3', 'ruby', 'uvicorn', 'gunicorn', 'deno', 'bun',
  'next-server', 'vite', 'cargo', 'go',
]);

export class PortConflictError extends Error {
  constructor(project, status) {
    const owner = status.owner ? `${status.owner.process} (PID ${status.owner.pid})` : 'another process';
    super(`Port ${project.port} is occupied by ${owner}; Rafter did not stop it.`);
    this.name = 'PortConflictError';
    this.status = status;
  }
}

function run(command, args, options = {}) {
  try {
    return execFileSync(command, args, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 10000,
      ...options,
    }).trim();
  } catch {
    return '';
  }
}

function isWithin(childPath, parentPath) {
  if (!childPath || !parentPath) return false;
  const child = resolve(childPath);
  const parent = resolve(parentPath);
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/** Exported for tests and diagnostics. */
export function classifyOwnership(project, listenerInfo, trackedInfo) {
  const tracked = project.process;
  if (tracked?.pid && listenerInfo.pid === tracked.pid) return 'managed';
  if (tracked?.pgid && listenerInfo.pgid && listenerInfo.pgid === tracked.pgid) return 'managed';
  if (trackedInfo?.pgid && listenerInfo.pgid && listenerInfo.pgid === trackedInfo.pgid) return 'managed';
  if (listenerInfo.cwd && isWithin(listenerInfo.cwd, project.path)) return 'path';
  return 'conflict';
}

function memoryLabel(rssKb) {
  if (!Number.isFinite(rssKb)) return '—';
  const mb = rssKb / 1024;
  return mb >= 1 ? `${Math.round(mb)}MB` : '<1MB';
}

function processAlive(pid) {
  if (!Number.isInteger(Number(pid)) || Number(pid) < 1) return false;
  try { process.kill(Number(pid), 0); return true; } catch { return false; }
}

function healthUrl(project) {
  if (!project.healthCheck) return undefined;
  try {
    return new URL(project.healthCheck).toString();
  } catch {
    const path = String(project.healthCheck).startsWith('/') ? project.healthCheck : `/${project.healthCheck}`;
    return `http://127.0.0.1:${project.port}${path}`;
  }
}

async function checkHttp(url, timeoutMs = 3000) {
  let parsed;
  try { parsed = new URL(url); } catch { return { healthy: false, error: 'invalid health URL' }; }
  if (!['http:', 'https:'].includes(parsed.protocol)) return { healthy: false, error: 'unsupported health protocol' };
  const request = parsed.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise(resolvePromise => {
    const req = request(parsed, { method: 'GET', timeout: timeoutMs }, response => {
      response.resume();
      resolvePromise({ healthy: response.statusCode >= 200 && response.statusCode < 500, statusCode: response.statusCode });
    });
    req.once('error', error => resolvePromise({ healthy: false, error: error.code || error.message }));
    req.once('timeout', () => {
      req.destroy();
      resolvePromise({ healthy: false, error: 'timeout' });
    });
    req.end();
  });
}

export async function getRemoteStatus(project) {
  if (!project.devUrl) return { running: false, state: 'invalid', health: 'unknown', reason: 'missing URL' };
  const result = await checkHttp(project.healthCheck || project.devUrl);
  return {
    running: result.healthy,
    state: result.healthy ? 'online' : 'offline',
    health: result.healthy ? 'healthy' : 'unreachable',
    ...(result.statusCode ? { statusCode: result.statusCode } : {}),
    ...(result.error ? { reason: result.error } : {}),
  };
}

export function getDockerStatus(project) {
  const ids = run('docker', ['compose', 'ps', '--status', 'running', '--quiet'], { cwd: project.path });
  if (ids) return { running: true, state: 'running', health: 'unknown', ownership: 'managed' };
  if (project.name) {
    const fallback = run('docker', ['ps', '-q', '--filter', `name=${project.name}`]);
    if (fallback) return { running: true, state: 'running', health: 'unknown', ownership: 'matched' };
  }
  return { running: false, state: 'stopped', health: 'unknown' };
}

export async function getServerStatus(project) {
  const runtime = project.runtime || 'process';
  if (runtime === 'docker') return getDockerStatus(project);
  if (runtime === 'remote') return getRemoteStatus(project);

  if (!project.port) return { running: false, state: 'invalid', health: 'unknown', reason: 'missing port' };
  const portStatus = checkPort(project.port);
  const trackedInfo = project.process?.pid ? getProcessInfo(project.process.pid) : undefined;

  if (!portStatus.inUse) {
    const trackedAlive = project.process?.pid && processAlive(project.process.pid);
    const recentlyStarted = project.process?.startedAt && Date.now() - Date.parse(project.process.startedAt) < 15000;
    if (trackedAlive && recentlyStarted) {
      return {
        running: false,
        state: 'starting',
        health: 'starting',
        pid: project.process.pid,
        ownership: 'managed',
        command: trackedInfo?.command || project.process.command,
      };
    }
    return {
      running: false,
      state: trackedAlive ? 'no-listener' : 'stopped',
      health: 'unknown',
      ...(trackedAlive ? { pid: project.process.pid, ownership: 'managed' } : {}),
    };
  }

  const candidates = portStatus.listeners.map(listener => {
    const info = getProcessInfo(listener.pid) || listener;
    return { ...listener, ...info, ownership: classifyOwnership(project, info, trackedInfo) };
  });
  const owner = candidates.find(candidate => candidate.ownership !== 'conflict') || candidates[0];
  if (owner.ownership === 'conflict') {
    return {
      running: false,
      state: 'conflict',
      health: 'unknown',
      portInUse: true,
      pid: owner.pid,
      mem: memoryLabel(owner.rssKb),
      ownership: 'conflict',
      owner: { pid: owner.pid, process: owner.process, command: owner.command, cwd: owner.cwd },
    };
  }

  let health = 'listening';
  let healthStatus;
  const url = healthUrl(project);
  if (url) {
    healthStatus = await checkHttp(url);
    health = healthStatus.healthy ? 'healthy' : 'unhealthy';
  }
  return {
    running: true,
    state: health === 'unhealthy' ? 'unhealthy' : 'running',
    health,
    portInUse: true,
    pid: owner.pid,
    pgid: owner.pgid,
    mem: memoryLabel(owner.rssKb),
    ownership: owner.ownership,
    command: owner.command,
    cwd: owner.cwd,
    ...(healthStatus?.statusCode ? { statusCode: healthStatus.statusCode } : {}),
  };
}

function safeLogName(name) {
  const readable = name.replace(/[^a-zA-Z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '') || 'service';
  return `${readable.slice(0, 64)}-${Buffer.from(name).toString('hex').slice(0, 8)}.log`;
}

export function getServiceLogPath(project) {
  return join(PATHS.rafterDir, 'logs', safeLogName(project.name));
}

function cleanTerminalOutput(value) {
  return value
    // OSC sequences (often used for terminal titles and hyperlinks).
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
    // CSI color/cursor sequences. The dashboard renders plain text only.
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\r(?!\n)/g, '\n')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1a\x1c-\x1f\x7f]/g, '');
}

/** Read a bounded tail from the log file assigned to this registered project. */
export function readServiceLog(project, { maxBytes = 64 * 1024 } = {}) {
  const requestedBytes = Number(maxBytes);
  const limit = Math.min(256 * 1024, Math.max(1024, Number.isFinite(requestedBytes) ? requestedBytes : 64 * 1024));
  const logPath = getServiceLogPath(project);
  if (!existsSync(logPath)) {
    return { content: '', available: false, bytes: 0, truncated: false, updatedAt: null };
  }

  let fd;
  try {
    fd = openSync(logPath, 'r');
    const stat = fstatSync(fd);
    const length = Math.min(stat.size, limit);
    const offset = Math.max(0, stat.size - length);
    const buffer = Buffer.alloc(length);
    const bytesRead = length ? readSync(fd, buffer, 0, length, offset) : 0;
    let content = buffer.subarray(0, bytesRead).toString('utf8');
    if (offset > 0) content = content.replace(/^[^\n]*(?:\n|$)/, '');
    return {
      content: cleanTerminalOutput(content),
      available: true,
      bytes: stat.size,
      truncated: offset > 0,
      updatedAt: stat.mtime.toISOString(),
    };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function markLogRun(logPath, command) {
  const timestamp = new Date().toISOString();
  appendFileSync(logPath, `\n[rafter] ${timestamp} starting: ${command}\n`, { encoding: 'utf8', mode: 0o600 });
}

function withPortArguments(project) {
  const command = project.startCmd.trim();
  const port = String(project.port);
  if (project.type === 'next' || project.type === 'vite' || project.type === 'svelte' || project.type === 'astro') {
    return command.startsWith('npm ') || command.startsWith('pnpm ') || command.startsWith('yarn ')
      ? `${command} -- --port ${port}`
      : `${command} --port ${port}`;
  }
  if (/\buvicorn\b/.test(command) || /^flask\s/.test(command)) return `${command} --port ${port}`;
  if (/manage\.py\s+runserver\b/.test(command)) return `${command} 127.0.0.1:${port}`;
  return command;
}

async function spawnDetached(command, args, { cwd, env, logPath, shell = false }) {
  const logFd = openSync(logPath, 'a', 0o600);
  try {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ['ignore', logFd, logFd],
      detached: true,
      shell,
    });
    await new Promise((resolvePromise, reject) => {
      child.once('spawn', resolvePromise);
      child.once('error', reject);
    });
    child.unref();
    return child;
  } finally {
    closeSync(logFd);
  }
}

export async function startDockerServer(project) {
  if (!existsSync(project.path)) throw new Error(`Project path does not exist: ${project.path}`);
  mkdirSync(join(PATHS.rafterDir, 'logs'), { recursive: true, mode: 0o700 });
  const logPath = getServiceLogPath(project);
  const custom = project.startCmd && project.startCmd !== 'docker compose up -d';
  markLogRun(logPath, custom ? project.startCmd : 'docker compose up -d');
  const child = custom
    ? await spawnDetached('/bin/sh', ['-lc', project.startCmd], { cwd: project.path, env: process.env, logPath })
    : await spawnDetached('docker', ['compose', 'up', '-d'], { cwd: project.path, env: process.env, logPath });
  const startedAt = new Date().toISOString();
  updateProject(project.name, { lastStarted: startedAt });
  return { pid: child.pid, port: project.port || null, state: 'starting' };
}

export function stopDockerServer(project) {
  try {
    execFileSync('docker', ['compose', 'down'], { cwd: project.path, stdio: 'ignore', timeout: 30000 });
    return true;
  } catch {
    return false;
  }
}

export async function startServer(project) {
  const runtime = project.runtime || 'process';
  if (runtime === 'docker') return startDockerServer(project);
  if (runtime === 'remote') {
    const startedAt = new Date().toISOString();
    updateProject(project.name, { lastStarted: startedAt });
    return { pid: null, port: null, state: 'remote' };
  }
  if (!existsSync(project.path)) throw new Error(`Project path does not exist: ${project.path}`);

  const current = await getServerStatus(project);
  if (current.running) return { pid: current.pid, port: project.port, state: 'already-running' };
  if (current.portInUse) throw new PortConflictError(project, current);

  const env = { ...process.env, ...(project.env || {}), PORT: String(project.port) };
  const command = withPortArguments(project);
  const logDir = join(PATHS.rafterDir, 'logs');
  mkdirSync(logDir, { recursive: true, mode: 0o700 });
  const logPath = getServiceLogPath(project);
  markLogRun(logPath, command);
  const child = await spawnDetached('/bin/sh', ['-lc', command], { cwd: project.path, env, logPath });
  const startedAt = new Date().toISOString();
  updateProject(project.name, {
    lastStarted: startedAt,
    process: { pid: child.pid, pgid: child.pid, command, startedAt },
  });
  return { pid: child.pid, port: project.port, state: 'starting', logPath };
}

async function terminateGroup(pgid, { force = false, timeoutMs = 2000 } = {}) {
  if (!Number.isInteger(Number(pgid)) || Number(pgid) < 2 || Number(pgid) === process.pid) return false;
  const numericPgid = Number(pgid);
  try { process.kill(-numericPgid, 'SIGTERM'); } catch { return false; }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise(resolvePromise => setTimeout(resolvePromise, 50));
    try { process.kill(-numericPgid, 0); } catch { return true; }
  }
  if (!force) return false;
  try { process.kill(-numericPgid, 'SIGKILL'); return true; } catch { return false; }
}

export async function stopServer(project, { force = false } = {}) {
  const runtime = project.runtime || 'process';
  if (runtime === 'remote') return { stopped: false, reason: 'remote' };
  if (runtime === 'docker') return { stopped: stopDockerServer(project), reason: 'docker' };

  const status = await getServerStatus(project);
  if (status.state === 'conflict') return { stopped: false, reason: 'port-conflict', status };
  if (!status.running && status.state !== 'starting' && status.state !== 'no-listener') {
    if (project.process) updateProject(project.name, { process: undefined });
    return { stopped: false, reason: 'not-running', status };
  }

  let stopped = false;
  if (project.process?.pgid && status.ownership === 'managed') {
    stopped = await terminateGroup(project.process.pgid, { force });
  }
  if (!stopped && status.pid) stopped = await terminatePid(status.pid, { force });
  if (stopped || !processAlive(project.process?.pid)) updateProject(project.name, { process: undefined });
  return { stopped, reason: stopped ? 'stopped' : 'still-running', status };
}

export async function stopAll(projects, options) {
  const results = [];
  for (const project of projects) results.push({ project, ...(await stopServer(project, options)) });
  return results;
}

/**
 * Observational discovery only. These listeners are not safe to kill merely
 * because they are not in the registry.
 */
export function findOrphans(registeredProjects) {
  const assignedPorts = new Set(registeredProjects.map(project => project.port).filter(Boolean));
  assignedPorts.add(getConfig().dashboardPort);
  const seen = new Set();
  return getListeningPorts().flatMap(listener => {
    const key = `${listener.pid}:${listener.port}`;
    if (seen.has(key) || assignedPorts.has(listener.port)) return [];
    seen.add(key);
    const info = getProcessInfo(listener.pid) || listener;
    const executable = (info.command || listener.process || '').split(/[ /]/).pop()?.toLowerCase();
    const processName = listener.process.toLowerCase();
    if (!DEV_PROCESS_NAMES.has(processName) && ![...DEV_PROCESS_NAMES].some(name => executable?.includes(name))) return [];
    return [{ ...listener, command: info.command, cwd: info.cwd, ownership: 'unmanaged' }];
  });
}

export function findStaleManagedProcesses(registeredProjects) {
  return registeredProjects.filter(project => project.process?.pid && !processAlive(project.process.pid));
}
