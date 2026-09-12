/**
 * rafter scan [directory] — Bulk register all projects in a directory
 */

import { resolve } from 'path';
import { readdirSync, statSync } from 'fs';
import chalk from 'chalk';
import { detectProject, isProject } from '../../core/detector.js';
import { registerProject, getProjectByPath } from '../../core/registry.js';
import { allocatePort } from '../../core/ports.js';
import { getConfig } from '../../core/registry.js';
import { printHeader, success, warn, info, typeBadge, fmtPort, printDivider, pad } from '../ui.js';

/**
 * @param {string} [directory]
 * @param {Object} options
 */
export async function scanCommand(directory, options) {
  printHeader();

  const config = getConfig();
  const scanDir = resolve(directory || config.workspace || process.cwd());

  console.log();
  info(`Scanning ${chalk.white(scanDir)} for projects...`);
  console.log();

  // Find all subdirectories that look like projects
  let entries;
  try {
    entries = readdirSync(scanDir);
  } catch (err) {
    warn(`Cannot read directory: ${scanDir}`);
    console.log();
    return;
  }

  const discovered = [];
  const skipped = [];

  for (const entry of entries) {
    // Skip hidden dirs, node_modules, etc.
    if (entry.startsWith('.') || entry === 'node_modules' || entry === 'temp' || entry === 'tmp') continue;

    const fullPath = resolve(scanDir, entry);
    try {
      const stat = statSync(fullPath);
      if (!stat.isDirectory()) continue;
    } catch { continue; }

    if (!isProject(fullPath)) continue;

    // Check if already registered
    const existing = getProjectByPath(fullPath);
    if (existing) {
      skipped.push(existing);
      continue;
    }

    const detected = detectProject(fullPath);
    if (!detected.startCmd) continue;

    discovered.push({ ...detected, path: fullPath });
  }

  if (discovered.length === 0 && skipped.length === 0) {
    info('No projects found in this directory.');
    console.log();
    return;
  }

  // Report skipped (already registered)
  if (skipped.length > 0) {
    console.log(chalk.dim(`  Already registered: ${skipped.length}`));
    for (const s of skipped) {
      console.log(`    ${chalk.dim('○')} ${chalk.dim(s.name)} → :${chalk.dim(String(s.port))}`);
    }
    console.log();
  }

  // Report discovered
  if (discovered.length === 0) {
    info('All projects already registered.');
    console.log();
    return;
  }

  console.log(`  ${chalk.white.bold(`Found ${discovered.length} new project${discovered.length > 1 ? 's' : ''}`)}:`);
  console.log();

  // Dry run - just show what would be registered
  if (options.dryRun) {
    for (const d of discovered) {
      const port = d.runtime === 'docker' ? null : allocatePort(d.name, d.type);
      console.log(
        `    ${typeBadge(d.type, d.framework)} ` +
        pad(chalk.white(d.name), 28) +
        `→ ${port ? `:${fmtPort(port)}` : chalk.dim('docker')}` +
        chalk.dim(` (${d.startCmd})`)
      );
    }
    console.log();
    info(`This was a dry run. Remove ${chalk.cyan('--dry-run')} to register.`);
    console.log();
    return;
  }

  // Register all discovered projects
  let registered = 0;
  for (const d of discovered) {
    const port = d.runtime === 'docker' ? null : allocatePort(d.name, d.type);
    const project = {
      name: d.name,
      path: d.path,
      type: d.type,
      runtime: d.runtime || (d.type === 'docker' ? 'docker' : 'process'),
      ...(port ? { port } : {}),
      startCmd: d.startCmd,
      buildCmd: d.buildCmd,
      framework: d.framework,
      packageName: d.packageName,
      aliases: d.aliases || [],
      deployments: {},
      tags: [],
      registeredAt: new Date().toISOString(),
    };

    registerProject(project);
    registered++;

    console.log(
      `    ${chalk.green('✓')} ${typeBadge(d.type, d.framework)} ` +
      pad(chalk.white(d.name), 28) +
      `→ ${port ? `:${fmtPort(port)}` : chalk.dim('docker')}`
    );
  }

  console.log();
  success(`Registered ${registered} project${registered > 1 ? 's' : ''}.`);
  info(`Run ${chalk.cyan('rafter status')} to see all projects.`);
  console.log();
}
