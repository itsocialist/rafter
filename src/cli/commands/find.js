/**
 * rafter find <query> — Fuzzy search projects
 */

import chalk from 'chalk';
import { searchProjects } from '../../core/registry.js';
import { getServerStatus } from '../../core/process.js';
import { printHeader, statusDot, fmtPort, pad, typeBadge, info } from '../ui.js';

/**
 * @param {string} query
 */
export async function findCommand(query) {
  printHeader();

  const results = searchProjects(query);

  if (results.length === 0) {
    console.log();
    info(`No projects matching "${chalk.white(query)}".`);
    info(`Run ${chalk.cyan('rafter status')} to see all registered projects.`);
    console.log();
    return;
  }

  console.log();
  console.log(chalk.dim(`  Found ${results.length} match${results.length > 1 ? 'es' : ''}:`));
  console.log();

  for (const p of results) {
    const status = await getServerStatus(p);
    console.log(
      `  ${statusDot(status.running)} ` +
      pad(chalk.white(p.name), 28) +
      typeBadge(p.type, p.framework) + '  ' +
      chalk.dim('port ') + fmtPort(p.port)
    );
    if (p.tags && p.tags.length > 0) {
      console.log(`    ${chalk.dim('tags: ' + p.tags.join(', '))}`);
    }
  }

  console.log();
}
