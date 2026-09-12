/**
 * rafter deployments — List all deployment URLs
 */

import chalk from 'chalk';
import { getAllProjects } from '../../core/registry.js';
import { printHeader, printDivider, pad, info } from '../ui.js';

export async function deploymentsCommand() {
  printHeader();

  const projects = getAllProjects();
  const withDeployments = projects.filter(
    p => p.deployments && Object.keys(p.deployments).length > 0
  );

  if (withDeployments.length === 0) {
    console.log();
    info('No deployment URLs registered.');
    info(`Add deployments to ${chalk.cyan('.rafter.json')} in your project directories.`);
    console.log();
    console.log(chalk.dim('  Example .rafter.json:'));
    console.log(chalk.dim('  {'));
    console.log(chalk.dim('    "deployments": {'));
    console.log(chalk.dim('      "production": "https://myapp.vercel.app",'));
    console.log(chalk.dim('      "staging": "https://myapp-staging.vercel.app"'));
    console.log(chalk.dim('    }'));
    console.log(chalk.dim('  }'));
    console.log();
    return;
  }

  console.log();
  console.log(
    '  ' +
    pad(chalk.dim('PROJECT'), 26) +
    pad(chalk.dim('ENVIRONMENT'), 16) +
    chalk.dim('URL')
  );
  printDivider();

  for (const p of withDeployments.sort((a, b) => a.name.localeCompare(b.name))) {
    let first = true;
    for (const [env, url] of Object.entries(p.deployments)) {
      console.log(
        '  ' +
        pad(first ? chalk.white(p.name) : '', 26) +
        pad(chalk.dim(env), 16) +
        chalk.cyan(url)
      );
      first = false;
    }
  }

  console.log();
}
