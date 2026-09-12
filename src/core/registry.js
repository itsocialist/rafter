/**
 * Rafter project registry.
 *
 * Registry writes are atomic, project names and ports are validated, and an
 * environment override makes the storage layer testable without touching a
 * user's real ~/.rafter directory.
 */

import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import { basename, join, resolve } from 'path';
import { homedir } from 'os';

const RAFTER_DIR = resolve(process.env.RAFTER_HOME || join(homedir(), '.rafter'));
const REGISTRY_PATH = join(RAFTER_DIR, 'registry.json');
const CONFIG_PATH = join(RAFTER_DIR, 'config.json');
const LOCK_PATH = join(RAFTER_DIR, 'registry.lock');
const FORBIDDEN_NAMES = new Set(['__proto__', 'prototype', 'constructor']);

export const DEFAULT_CONFIG = Object.freeze({
  workspace: join(homedir(), 'workspace'),
  dashboardHost: '127.0.0.1',
  dashboardPort: 9000,
  autoOpen: true,
  logDir: join(RAFTER_DIR, 'logs'),
  // Historical auto-GC killed unrelated development processes. Discovery is
  // now observational, so keep the legacy setting disabled by default.
  autoGC: false,
  gcInterval: 3600,
  healthCheckInterval: 30,
});

/** @typedef {'process' | 'docker' | 'remote'} Runtime */

/**
 * @typedef {Object} RafterProject
 * @property {string} name
 * @property {string} path
 * @property {string} type
 * @property {Runtime} [runtime]
 * @property {number} [port]
 * @property {string} [startCmd]
 * @property {string} [buildCmd]
 * @property {string} [framework]
 * @property {string} [packageName]
 * @property {string[]} [aliases]
 * @property {string} [devUrl]
 * @property {Record<string, string>} [deployments]
 * @property {string[]} [tags]
 * @property {Record<string, string>} [env]
 * @property {string} [healthCheck]
 * @property {{pid?: number, pgid?: number, command?: string, startedAt?: string}} [process]
 * @property {string} registeredAt
 * @property {string} [lastStarted]
 */

export class RegistryError extends Error {
  constructor(message, cause) {
    super(message, { cause });
    this.name = 'RegistryError';
  }
}

export function ensureRafterDir() {
  mkdirSync(join(RAFTER_DIR, 'logs'), { recursive: true, mode: 0o700 });
  try { chmodSync(RAFTER_DIR, 0o700); } catch {}
  for (const path of [REGISTRY_PATH, CONFIG_PATH]) {
    if (existsSync(path)) try { chmodSync(path, 0o600); } catch {}
  }
}

function withRegistryLock(operation) {
  ensureRafterDir();
  const deadline = Date.now() + 3000;
  let fd;
  while (fd === undefined) {
    try {
      fd = openSync(LOCK_PATH, 'wx', 0o600);
      writeFileSync(fd, `${process.pid}\n`);
    } catch (error) {
      if (error.code !== 'EEXIST') throw new RegistryError('Cannot lock the project registry.', error);
      try {
        if (Date.now() - statSync(LOCK_PATH).mtimeMs > 30000) unlinkSync(LOCK_PATH);
      } catch {}
      if (Date.now() >= deadline) throw new RegistryError('Timed out waiting for another Rafter registry update.');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
  try {
    return operation();
  } finally {
    try { closeSync(fd); } catch {}
    try { unlinkSync(LOCK_PATH); } catch {}
  }
}

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch (error) {
    throw new RegistryError(`Cannot parse ${path}. Fix or restore the file before continuing.`, error);
  }
}

function writeJsonAtomic(path, value) {
  ensureRafterDir();
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    renameSync(tempPath, path);
    try { chmodSync(path, 0o600); } catch {}
  } catch (error) {
    try { unlinkSync(tempPath); } catch {}
    throw new RegistryError(`Cannot save ${path}.`, error);
  }
}

export function validatePort(port, { optional = false } = {}) {
  if ((port === undefined || port === null) && optional) return undefined;
  const parsed = typeof port === 'number' ? port : Number(port);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new RegistryError(`Invalid port "${port}"; expected an integer from 1 to 65535.`);
  }
  return parsed;
}

export function validateProjectName(name) {
  if (typeof name !== 'string') throw new RegistryError('Project name must be a string.');
  const normalized = name.trim();
  if (!normalized || normalized.length > 128 || /[\0-\x1f\x7f]/.test(normalized)) {
    throw new RegistryError('Project name must be 1-128 characters and contain no control characters.');
  }
  if (FORBIDDEN_NAMES.has(normalized)) throw new RegistryError(`Reserved project name: ${normalized}`);
  return normalized;
}

function stringArray(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(v => typeof v === 'string').map(v => v.trim()).filter(Boolean))];
}

function httpUrl(value, label) {
  if (value === undefined || value === null || value === '') return undefined;
  try {
    const url = new URL(String(value));
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported protocol');
    return url.toString();
  } catch {
    throw new RegistryError(`${label} must be an http:// or https:// URL.`);
  }
}

function deployments(value) {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw new RegistryError('Deployments must be an object of named URLs.');
  return Object.fromEntries(Object.entries(value).map(([name, url]) => [name, httpUrl(url, `Deployment ${name}`)]));
}

function normalizeHealthCheck(value) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || value.length > 2048) throw new RegistryError('Health check must be a URL or path string.');
  if (value.startsWith('/')) return value;
  return httpUrl(value, 'Health check');
}

function normalizeEnv(value) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) throw new RegistryError('Environment must be an object.');
  return Object.fromEntries(Object.entries(value).map(([key, envValue]) => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new RegistryError(`Invalid environment variable name: ${key}`);
    if (!['string', 'number', 'boolean'].includes(typeof envValue)) throw new RegistryError(`Environment value for ${key} must be scalar.`);
    return [key, String(envValue)];
  }));
}

/** @returns {RafterProject} */
export function normalizeProject(project) {
  if (!project || typeof project !== 'object' || Array.isArray(project)) {
    throw new RegistryError('Project record must be an object.');
  }

  const runtime = project.runtime || (project.type === 'docker' ? 'docker' : project.type === 'remote' ? 'remote' : 'process');
  if (!['process', 'docker', 'remote'].includes(runtime)) {
    throw new RegistryError(`Invalid runtime "${runtime}".`);
  }

  const name = validateProjectName(project.name);
  const projectPath = resolve(String(project.path || ''));
  if (!project.path || projectPath === resolve('/')) {
    throw new RegistryError(`Project ${name} has an invalid path.`);
  }

  const port = validatePort(project.port, { optional: runtime !== 'process' });
  if (runtime === 'process' && (!project.startCmd || typeof project.startCmd !== 'string')) {
    throw new RegistryError(`Project ${name} requires a start command.`);
  }

  const normalizedHealthCheck = normalizeHealthCheck(project.healthCheck);
  const normalizedEnv = normalizeEnv(project.env);
  const normalized = {
    ...project,
    name,
    path: projectPath,
    type: String(project.type || 'unknown'),
    runtime,
    ...(port ? { port } : {}),
    aliases: stringArray(project.aliases).filter(alias => alias !== name),
    tags: stringArray(project.tags),
    deployments: deployments(project.deployments),
    ...(project.devUrl ? { devUrl: httpUrl(project.devUrl, 'Remote URL') } : {}),
    ...(normalizedHealthCheck ? { healthCheck: normalizedHealthCheck } : {}),
    ...(normalizedEnv ? { env: normalizedEnv } : {}),
    registeredAt: project.registeredAt || new Date().toISOString(),
  };
  if (!normalizedHealthCheck) delete normalized.healthCheck;
  if (!normalizedEnv) delete normalized.env;
  return normalized;
}

/** @returns {Record<string, RafterProject>} */
export function getRegistry() {
  ensureRafterDir();
  const raw = readJson(REGISTRY_PATH, {});
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new RegistryError(`${REGISTRY_PATH} must contain a JSON object.`);
  }

  const registry = Object.create(null);
  for (const [key, value] of Object.entries(raw)) {
    if (FORBIDDEN_NAMES.has(key)) continue;
    const project = normalizeProject({ ...value, name: value?.name || key });
    registry[project.name] = project;
  }
  return registry;
}

export function saveRegistry(registry) {
  const validated = Object.create(null);
  for (const value of Object.values(registry || {})) {
    const project = normalizeProject(value);
    validated[project.name] = project;
  }
  withRegistryLock(() => writeJsonAtomic(REGISTRY_PATH, validated));
}

function writeLocalConfig(project) {
  if (!existsSync(project.path)) return;
  const localConfig = {
    name: project.name,
    type: project.type,
    runtime: project.runtime,
    ...(project.port ? { port: project.port } : {}),
    startCmd: project.startCmd || '',
    ...(project.packageName ? { packageName: project.packageName } : {}),
    ...(project.aliases?.length ? { aliases: project.aliases } : {}),
    ...(project.devUrl ? { devUrl: project.devUrl } : {}),
    ...(project.buildCmd ? { buildCmd: project.buildCmd } : {}),
    ...(Object.keys(project.deployments || {}).length ? { deployments: project.deployments } : {}),
    ...(project.tags?.length ? { tags: project.tags } : {}),
    ...(project.healthCheck ? { healthCheck: project.healthCheck } : {}),
  };
  writeJsonAtomic(join(project.path, '.rafter.json'), localConfig);
}

export function registerProject(input) {
  const project = normalizeProject(input);
  const merged = withRegistryLock(() => {
    const registry = getRegistry();
    const sameName = registry[project.name];
    const samePath = Object.values(registry).find(item => item.path === project.path);

    if (sameName && sameName.path !== project.path) {
      throw new RegistryError(`Project name "${project.name}" is already used by ${sameName.path}. Choose a unique name.`);
    }

    if (project.port) {
      const portOwner = Object.values(registry).find(item => item.port === project.port && item.path !== project.path);
      if (portOwner) {
        throw new RegistryError(`Port ${project.port} is already assigned to ${portOwner.name}.`);
      }
    }

    if (samePath && samePath.name !== project.name) {
      delete registry[samePath.name];
      project.aliases = [...new Set([...(project.aliases || []), samePath.name, ...(samePath.aliases || [])])]
        .filter(alias => alias !== project.name);
    }

    const previous = sameName || samePath;
    const next = normalizeProject({
      ...previous,
      ...project,
      registeredAt: previous?.registeredAt || project.registeredAt,
    });
    registry[next.name] = next;
    writeJsonAtomic(REGISTRY_PATH, registry);
    return next;
  });
  writeLocalConfig(merged);
  return merged;
}

export function unregisterProject(name) {
  return withRegistryLock(() => {
    const registry = getRegistry();
    const resolved = resolveProject(name, { registry, allowPartial: false });
    if (!resolved.project) return false;
    delete registry[resolved.project.name];
    writeJsonAtomic(REGISTRY_PATH, registry);
    return true;
  });
}

export function getProject(name) {
  return resolveProject(name, { allowPartial: false }).project;
}

export function getProjectByPath(dirPath) {
  const wanted = resolve(dirPath);
  return Object.values(getRegistry()).find(project => project.path === wanted);
}

/**
 * Resolve a project by canonical name, alias, directory basename, or a unique
 * case-insensitive prefix. Ambiguous lookups return their matches.
 */
export function resolveProject(reference, { registry = getRegistry(), cwd, allowPartial = true } = {}) {
  if ((!reference || reference === '.') && cwd) {
    const project = Object.values(registry).find(item => item.path === resolve(cwd));
    return { project, matches: project ? [project] : [] };
  }
  if (typeof reference !== 'string' || !reference.trim()) return { project: undefined, matches: [] };
  const query = reference.trim().toLowerCase();
  const projects = Object.values(registry);
  // Canonical names win over aliases and path-derived convenience names.
  const canonical = projects.filter(project => project.name.toLowerCase() === query);
  if (canonical.length === 1) return { project: canonical[0], matches: canonical };
  const aliases = projects.filter(project => project.aliases?.some(alias => alias.toLowerCase() === query));
  if (aliases.length === 1) return { project: aliases[0], matches: aliases };
  if (aliases.length > 1) return { project: undefined, matches: aliases };
  const directoryMatches = projects.filter(project => basename(project.path).toLowerCase() === query);
  if (directoryMatches.length === 1) return { project: directoryMatches[0], matches: directoryMatches };
  if (directoryMatches.length > 1 || !allowPartial) return { project: undefined, matches: directoryMatches };

  const partial = projects.filter(project => [project.name, ...(project.aliases || []), basename(project.path)]
    .some(value => value.toLowerCase().startsWith(query)));
  return { project: partial.length === 1 ? partial[0] : undefined, matches: partial };
}

export function updateProject(name, updates) {
  return withRegistryLock(() => {
    const registry = getRegistry();
    const current = registry[name];
    if (!current) return undefined;
    const updated = normalizeProject({ ...current, ...updates, name: current.name, path: current.path });
    registry[name] = updated;
    writeJsonAtomic(REGISTRY_PATH, registry);
    return updated;
  });
}

export function searchProjects(query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  return Object.values(getRegistry()).filter(project => [
    project.name,
    project.framework,
    project.packageName,
    project.path,
    ...(project.aliases || []),
    ...(project.tags || []),
  ].some(value => typeof value === 'string' && value.toLowerCase().includes(q)));
}

export function getProjectsByTag(tag) {
  return Object.values(getRegistry()).filter(project => project.tags?.includes(tag));
}

export function getAllProjects() {
  return Object.values(getRegistry());
}

export function getConfig() {
  ensureRafterDir();
  if (!existsSync(CONFIG_PATH)) {
    writeJsonAtomic(CONFIG_PATH, DEFAULT_CONFIG);
    return { ...DEFAULT_CONFIG };
  }
  const stored = readJson(CONFIG_PATH, {});
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
    throw new RegistryError(`${CONFIG_PATH} must contain a JSON object.`);
  }
  const config = { ...DEFAULT_CONFIG, ...stored };
  config.dashboardPort = validatePort(config.dashboardPort);
  if (!['127.0.0.1', 'localhost', '::1'].includes(config.dashboardHost)) {
    throw new RegistryError('dashboardHost must be a loopback host (127.0.0.1, localhost, or ::1).');
  }
  const healthInterval = Number(config.healthCheckInterval);
  if (!Number.isFinite(healthInterval) || healthInterval < 5) {
    throw new RegistryError('healthCheckInterval must be at least 5 seconds.');
  }
  config.healthCheckInterval = healthInterval;
  return config;
}

export const PATHS = Object.freeze({
  rafterDir: RAFTER_DIR,
  registry: REGISTRY_PATH,
  config: CONFIG_PATH,
});
