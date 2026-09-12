/**
 * rafter ports — Display port allocation map
 */

import chalk from 'chalk';
import { getAllProjects } from '../../core/registry.js';
import { ALL_PORT_RANGES } from '../../core/ports.js';
import { getServerStatus } from '../../core/process.js';
import { printHeader, statusDot, fmtPort, pad } from '../ui.js';

export async function portsCommand() {
  printHeader();

  const projects = getAllProjects();

  if (projects.length === 0) {
    console.log();
    console.log(chalk.dim('  No projects registered. Run ') + chalk.cyan('rafter register') + chalk.dim(' or ') + chalk.cyan('rafter scan'));
    console.log();
    return;
  }

  // Group projects by type
  const byType = {};
  for (const p of projects) {
    const type = p.type || 'unknown';
    if (!byType[type]) byType[type] = [];
    byType[type].push(p);
  }

  const typeLabels = {
    next: 'Next.js',
    vite: 'Vite / React',
    cra: 'Create React App',
    svelte: 'SvelteKit',
    astro: 'Astro',
    python: 'Python',
    express: 'Express / Node',
    mcp: 'MCP Servers',
    go: 'Go',
    rust: 'Rust',
    ruby: 'Ruby',
    unknown: 'Other',
  };

  const typeColors = {
    next: chalk.white,
    vite: chalk.magenta,
    cra: chalk.magenta,
    svelte: chalk.magenta,
    astro: chalk.magenta,
    python: chalk.blue,
    express: chalk.green,
    mcp: chalk.cyan,
    go: chalk.cyan,
    rust: chalk.yellow,
    ruby: chalk.red,
    unknown: chalk.dim,
  };

  console.log();
  console.log(chalk.dim('  PORT ALLOCATION MAP'));
  console.log(chalk.dim('  ─────────────────────────────────────────────'));
  console.log();

  for (const [type, range] of Object.entries(ALL_PORT_RANGES)) {
    const label = typeLabels[type] || type;
    const color = typeColors[type] || chalk.dim;
    const typeProjects = byType[type] || [];

    if (typeProjects.length === 0) {
      console.log(`  ${color(pad(label, 20))} ${chalk.dim(`${range.min}–${range.max}`)}  ${chalk.dim('(empty)')}`);
    } else {
      console.log(`  ${color(pad(label, 20))} ${chalk.dim(`${range.min}–${range.max}`)}`);
      for (const p of typeProjects.sort((a, b) => a.port - b.port)) {
        const status = await getServerStatus(p);
        const state = status.state === 'conflict' ? chalk.yellow(' conflict') : '';
        console.log(`    ${statusDot(status.running)} ${pad(chalk.white(p.name), 24)} :${fmtPort(p.port)}${state}`);
      }
    }
    console.log();
  }
}
