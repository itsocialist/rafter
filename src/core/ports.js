/** Port allocation and listener inspection without shell interpolation. */

import { execFileSync } from 'child_process';
import { getRegistry, validatePort } from './registry.js';

const PORT_RANGES = Object.freeze({
  next:    { min: 3100, max: 3199 },
  vite:    { min: 3200, max: 3299 },
  cra:     { min: 3200, max: 3299 },
  svelte:  { min: 3200, max: 3299 },
  astro:   { min: 3200, max: 3299 },
  python:  { min: 3300, max: 3399 },
  express: { min: 3400, max: 3499 },
  mcp:     { min: 3500, max: 3599 },
  go:      { min: 3600, max: 3699 },
  rust:    { min: 3600, max: 3699 },
  ruby:    { min: 3600, max: 3699 },
  unknown: { min: 3600, max: 3699 },
});

function run(command, args) {
  try {
    return execFileSync(command, args, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    }).trim();
  } catch {
    return '';
  }
}

/** Parse lsof field output (-Fpcn). Exported for deterministic tests. */
export function parseLsofFields(output) {
  const listeners = [];
  let pid;
  let command = 'unknown';
  for (const line of String(output || '').split(/\r?\n/)) {
    if (!line) continue;
    const field = line[0];
    const value = line.slice(1);
    if (field === 'p') {
      pid = Number(value);
      command = 'unknown';
    } else if (field === 'c') {
      command = value || 'unknown';
    } else if (field === 'n' && Number.isInteger(pid)) {
      const match = value.match(/:(\d+)(?:\s|$)/);
      if (match) listeners.push({
        pid,
        process: command,
        port: Number(match[1]),
        address: value,
      });
    }
  }
  return listeners;
}

export function getProcessInfo(pid) {
  if (!Number.isInteger(Number(pid)) || Number(pid) < 1) return undefined;
  const numericPid = Number(pid);
  const fields = run('ps', ['-p', String(numericPid), '-o', 'ppid=', '-o', 'pgid=', '-o', 'rss=', '-o', 'command=']);
  const cwdOutput = run('lsof', ['-a', '-p', String(numericPid), '-d', 'cwd', '-Fn']);
  const cwd = cwdOutput.split(/\r?\n/).find(line => line.startsWith('n'))?.slice(1);
  if (!fields) return cwd ? { pid: numericPid, cwd } : undefined;
  const match = fields.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+([\s\S]+)$/);
  if (!match) return { pid: numericPid, command: fields.trim(), ...(cwd ? { cwd } : {}) };

  return {
    pid: numericPid,
    ppid: Number(match[1]),
    pgid: Number(match[2]),
    rssKb: Number(match[3]),
    command: match[4].trim(),
    ...(cwd ? { cwd } : {}),
  };
}

export function checkPort(port) {
  const validPort = validatePort(port);
  const output = run('lsof', ['-nP', `-iTCP:${validPort}`, '-sTCP:LISTEN', '-Fpcn']);
  const listeners = parseLsofFields(output).filter(listener => listener.port === validPort);
  if (!listeners.length) return { inUse: false, listeners: [] };
  const primary = listeners[0];
  return {
    inUse: true,
    pid: primary.pid,
    process: primary.process,
    address: primary.address,
    listeners,
  };
}

export function getListeningPorts() {
  return parseLsofFields(run('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-Fpcn']));
}

/** Select the deterministic first unclaimed port. */
export function selectPort(projectName, projectType, unavailablePorts = new Set()) {
  const range = PORT_RANGES[projectType] || PORT_RANGES.unknown;
  const rangeSize = range.max - range.min + 1;
  const startOffset = simpleHash(projectName) % rangeSize;
  for (let index = 0; index < rangeSize; index++) {
    const port = range.min + ((startOffset + index) % rangeSize);
    if (!unavailablePorts.has(port)) return port;
  }
  if (projectType !== 'unknown') return selectPort(projectName, 'unknown', unavailablePorts);
  throw new Error('No available Rafter ports remain in the configured ranges.');
}

export function allocatePort(projectName, projectType, pinnedPort) {
  if (pinnedPort !== undefined && pinnedPort !== null) {
    const port = validatePort(pinnedPort);
    const assigned = Object.values(getRegistry()).find(project => project.port === port && project.name !== projectName);
    if (assigned) throw new Error(`Port ${port} is already assigned to ${assigned.name}.`);
    const live = checkPort(port);
    if (live.inUse) throw new Error(`Port ${port} is already listening (${live.process}, PID ${live.pid}).`);
    return port;
  }

  const unavailable = new Set(Object.values(getRegistry()).map(project => project.port).filter(Boolean));
  for (const listener of getListeningPorts()) unavailable.add(listener.port);
  return selectPort(projectName, projectType, unavailable);
}

export async function terminatePid(pid, { force = false, timeoutMs = 1500 } = {}) {
  const numericPid = Number(pid);
  if (!Number.isInteger(numericPid) || numericPid < 2 || numericPid === process.pid) return false;
  try {
    process.kill(numericPid, 'SIGTERM');
  } catch {
    return false;
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 50));
    try { process.kill(numericPid, 0); } catch { return true; }
  }

  if (!force) return false;
  try {
    process.kill(numericPid, 'SIGKILL');
    return true;
  } catch {
    return false;
  }
}

/** Explicit low-level operation. Service lifecycle should use stopServer. */
export async function killPort(port, { force = false, expectedPids } = {}) {
  const status = checkPort(port);
  if (!status.inUse) return { killed: 0, remaining: 0, refused: false };
  const allowed = expectedPids ? new Set([...expectedPids].map(Number)) : undefined;
  if (allowed && status.listeners.some(listener => !allowed.has(listener.pid))) {
    return { killed: 0, remaining: status.listeners.length, refused: true };
  }

  let killed = 0;
  for (const pid of new Set(status.listeners.map(listener => listener.pid))) {
    if (await terminatePid(pid, { force })) killed++;
  }
  return { killed, remaining: checkPort(port).listeners.length, refused: false };
}

export function getPortRange(type) {
  return PORT_RANGES[type] || PORT_RANGES.unknown;
}

export const ALL_PORT_RANGES = PORT_RANGES;

function simpleHash(str) {
  let hash = 0;
  for (let index = 0; index < str.length; index++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}
