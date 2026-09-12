/**
 * rafter register — Register current directory as a Rafter project
 */

import { resolve } from 'path';
import { existsSync } from 'fs';
import chalk from 'chalk';
import { detectProject } from '../../core/detector.js';
import { registerProject, getProject, getProjectByPath, validatePort } from '../../core/registry.js';
import { allocatePort } from '../../core/ports.js';
import { printHeader, success, warn, info, typeBadge, fmtPort } from '../ui.js';

/**
 * @param {Object} options
 */
export async function registerCommand(options) {
  const projectDir = resolve(process.cwd());
  printHeader();

  const detected = detectProject(projectDir);
  const name = options.name || detected.name;
  const tags = options.tags ? options.tags.split(',').map(t => t.trim()).filter(Boolean) : (detected.tags || []);

  // Check if already registered
  const existing = getProject(name) || getProjectByPath(projectDir);
  if (existing) {
    warn(`Project ${chalk.white.bold(existing.name)} is already registered`);
    info(`Re-registering with updated settings...`);
  }

  // --- Remote app ---
  if (options.url) {
    let devUrl;
    try {
      devUrl = new URL(options.url);
      if (!['http:', 'https:'].includes(devUrl.protocol)) throw new Error('unsupported protocol');
    } catch {
      warn(`Invalid remote URL: ${options.url}`);
      return;
    }
    const project = {
      name,
      path: projectDir,
      type: 'remote',
      runtime: 'remote',
      devUrl: devUrl.toString(),
      startCmd: '',
      deployments: {},
      tags,
      registeredAt: new Date().toISOString(),
    };
    registerProject(project);
    console.log();
    success(`Registered ${chalk.white.bold(name)} as a remote app`);
    console.log();
    console.log(`  ${chalk.dim('Type')}       ${typeBadge('remote', 'Remote')}`);
    console.log(`  ${chalk.dim('URL')}        ${chalk.cyan(devUrl.toString())}`);
    console.log(`  ${chalk.dim('Config')}     ${chalk.dim('.rafter.json')}`);
    console.log();
    info(`Open with: ${chalk.cyan(`rafter start ${name}`)}`);
    console.log();
    return;
  }

  // --- Docker app ---
  const isDocker = options.docker || detected.runtime === 'docker';
  if (isDocker) {
    const port = options.port ? validatePort(options.port) : (detected.port ? validatePort(detected.port) : null);
    const project = {
      name,
      path: projectDir,
      type: 'docker',
      runtime: 'docker',
      ...(port ? { port } : {}),
      startCmd: options.startCmd || detected.startCmd || 'docker compose up -d',
      framework: detected.framework || 'Docker',
      deployments: {},
      tags,
      registeredAt: new Date().toISOString(),
    };
    registerProject(project);
    console.log();
    success(`Registered ${chalk.white.bold(name)} as a Docker project`);
    console.log();
    console.log(`  ${chalk.dim('Type')}       ${typeBadge('docker', project.framework)}`);
    if (port) console.log(`  ${chalk.dim('Port')}       ${fmtPort(port)}`);
    console.log(`  ${chalk.dim('Start')}      ${chalk.white(project.startCmd)}`);
    console.log(`  ${chalk.dim('Config')}     ${chalk.dim('.rafter.json')}`);
    console.log();
    info(`Start with: ${chalk.cyan(`rafter start ${name}`)}`);
    console.log();
    return;
  }

  // --- Local process app ---
  if (!detected.startCmd && !options.startCmd) {
    warn(`Could not auto-detect project type in ${chalk.white(projectDir)}`);
    info(`Use ${chalk.cyan('--start-cmd "your command"')} to specify manually.`);
    info(`For Docker projects, add ${chalk.cyan('--docker')} flag.`);
    info(`For remote apps, add ${chalk.cyan('--url <url>')} flag.`);
    console.log();
    return;
  }

  const type = detected.type;
  const port = options.port
    ? allocatePort(name, type, options.port)
    : detected.port ? validatePort(detected.port) : allocatePort(name, type);
  const project = {
    name,
    path: projectDir,
    type,
    runtime: 'process',
    port,
    startCmd: options.startCmd || detected.startCmd,
    buildCmd: detected.buildCmd,
    framework: detected.framework,
    packageName: detected.packageName,
    aliases: detected.aliases || [],
    healthCheck: detected.healthCheck,
    deployments: {},
    tags,
    registeredAt: new Date().toISOString(),
  };

  registerProject(project);

  console.log();
  success(`Registered ${chalk.white.bold(name)}`);
  console.log();
  console.log(`  ${chalk.dim('Type')}       ${typeBadge(type, detected.framework)}`);
  console.log(`  ${chalk.dim('Port')}       ${fmtPort(port)}`);
  console.log(`  ${chalk.dim('Start')}      ${chalk.white(project.startCmd)}`);
  if (project.buildCmd) {
    console.log(`  ${chalk.dim('Build')}      ${chalk.white(project.buildCmd)}`);
  }
  console.log(`  ${chalk.dim('Config')}     ${chalk.dim('.rafter.json')}`);
  console.log();
  info(`Start with: ${chalk.cyan(`rafter start ${name}`)}`);
  console.log();
}
