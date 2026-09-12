/** rafter doctor — read-only service registry audit. */

import chalk from 'chalk';
import { getAllProjects } from '../../core/registry.js';
import { inspectProjects } from '../../core/doctor.js';
import { printHeader, success, warn, error, info } from '../ui.js';

export async function doctorCommand(options) {
  const report = await inspectProjects(getAllProjects());
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  printHeader();
  console.log();
  if (!report.findings.length) {
    success(`${report.projects} registered service${report.projects === 1 ? '' : 's'} passed registry and ownership checks.`);
    console.log();
    return;
  }

  for (const finding of report.findings) {
    const prefix = finding.severity === 'error' ? error : finding.severity === 'warning' ? warn : info;
    prefix(`${finding.project ? `${chalk.white.bold(finding.project)}: ` : ''}${finding.message}`);
    if (finding.suggestion) info(`Suggested name: ${chalk.cyan(finding.suggestion)}`);
  }
  console.log();
  console.log(chalk.dim(`  ${report.errors} errors · ${report.warnings} warnings · ${report.projects} registered`));
  console.log();
  if (report.errors) process.exitCode = 1;
}
