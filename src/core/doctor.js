/** Read-only registry and runtime diagnostics. */

import { existsSync, readFileSync } from 'fs';
import { basename, dirname, join } from 'path';
import { getServerStatus } from './process.js';

const GENERIC_NAMES = new Set(['app', 'api', 'client', 'frontend', 'server', 'src', 'web']);

function localConfig(path) {
  try {
    return JSON.parse(readFileSync(join(path, '.rafter.json'), 'utf-8'));
  } catch {
    return undefined;
  }
}

function localConfigName(path) {
  const parsed = localConfig(path);
  return typeof parsed?.name === 'string' ? parsed.name : undefined;
}

export async function inspectProjects(projects) {
  const findings = [];
  const byPort = new Map();
  const byPath = new Map();

  for (const project of projects) {
    if (project.port) {
      const owners = byPort.get(project.port) || [];
      owners.push(project.name);
      byPort.set(project.port, owners);
    }
    const pathOwners = byPath.get(project.path) || [];
    pathOwners.push(project.name);
    byPath.set(project.path, pathOwners);
  }

  for (const project of projects) {
    if (!existsSync(project.path)) {
      findings.push({ severity: 'error', code: 'missing-path', project: project.name, message: `Project path does not exist: ${project.path}` });
    }
    if (GENERIC_NAMES.has(project.name.toLowerCase())) {
      const samePathNames = byPath.get(project.path) || [];
      const canonicalPeer = samePathNames.find(name => !GENERIC_NAMES.has(name.toLowerCase()));
      const directory = basename(project.path);
      const suggested = canonicalPeer || (GENERIC_NAMES.has(directory.toLowerCase()) ? basename(dirname(project.path)) : directory);
      findings.push({
        severity: 'warning',
        code: 'generic-name',
        project: project.name,
        message: `Generic service name; "${suggested}" is easier to resolve.`,
        suggestion: suggested,
      });
    }
    const local = localConfig(project.path);
    const localName = typeof local?.name === 'string' ? local.name : undefined;
    if (localName && localName !== project.name) {
      findings.push({
        severity: 'warning',
        code: 'config-drift',
        project: project.name,
        message: `Local .rafter.json uses canonical name "${localName}".`,
        suggestion: localName,
      });
    }
    for (const field of ['port', 'type', 'runtime', 'startCmd', 'healthCheck']) {
      if (local && local[field] !== undefined && local[field] !== project[field]) {
        findings.push({
          severity: 'warning',
          code: 'config-drift',
          project: project.name,
          message: `Local .rafter.json ${field} (${JSON.stringify(local[field])}) differs from the registry (${JSON.stringify(project[field])}).`,
        });
      }
    }

    const status = await getServerStatus(project);
    if (status.state === 'conflict') {
      findings.push({
        severity: 'error',
        code: 'port-conflict',
        project: project.name,
        message: `Port ${project.port} is owned by ${status.owner?.process || 'another process'} (PID ${status.owner?.pid || 'unknown'}).`,
      });
    }
    if (project.process?.pid && status.state === 'stopped') {
      findings.push({ severity: 'warning', code: 'stale-process', project: project.name, message: `Recorded PID ${project.process.pid} is no longer running.` });
    }
  }

  for (const [port, owners] of byPort) {
    if (owners.length > 1) findings.push({ severity: 'error', code: 'duplicate-port', message: `Port ${port} is assigned to: ${owners.join(', ')}.` });
  }
  for (const [path, owners] of byPath) {
    if (owners.length > 1) {
      const configured = localConfigName(path);
      const preferred = configured && owners.includes(configured)
        ? configured
        : owners.find(name => !GENERIC_NAMES.has(name.toLowerCase())) || owners[0];
      findings.push({
        severity: 'error',
        code: 'duplicate-path',
        message: `Path ${path} is registered as ${owners.join(', ')}; keep "${preferred}" and unregister the duplicate.`,
        suggestion: preferred,
      });
    }
  }

  findings.sort((left, right) => {
    const rank = { error: 0, warning: 1, info: 2 };
    return rank[left.severity] - rank[right.severity] || (left.project || '').localeCompare(right.project || '');
  });
  return {
    healthy: findings.every(finding => finding.severity !== 'error'),
    projects: projects.length,
    errors: findings.filter(finding => finding.severity === 'error').length,
    warnings: findings.filter(finding => finding.severity === 'warning').length,
    findings,
  };
}
