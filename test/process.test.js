import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

process.env.RAFTER_HOME = join(mkdtempSync(join(tmpdir(), 'rafter-process-')), 'state');
const { classifyOwnership, getServiceLogPath, readServiceLog } = await import('../src/core/process.js');
const { PATHS } = await import('../src/core/registry.js');

const project = { path: '/workspace/app', process: { pid: 10, pgid: 10 } };

test('classifies direct and process-group ownership', () => {
  assert.equal(classifyOwnership(project, { pid: 10 }, undefined), 'managed');
  assert.equal(classifyOwnership(project, { pid: 22, pgid: 10 }, undefined), 'managed');
});

test('classifies listener cwd ownership and rejects prefix lookalikes', () => {
  assert.equal(classifyOwnership(project, { pid: 22, cwd: '/workspace/app/src' }, undefined), 'path');
  assert.equal(classifyOwnership(project, { pid: 22, cwd: '/workspace/application' }, undefined), 'conflict');
});

test('reads a bounded, plain-text service log tail', () => {
  mkdirSync(join(PATHS.rafterDir, 'logs'), { recursive: true });
  const logProject = { name: 'log reader', path: '/workspace/log-reader' };
  const logPath = getServiceLogPath(logProject);
  writeFileSync(logPath, `${'old line\n'.repeat(400)}\x1b[31mnew output\x1b[0m\n`);

  const result = readServiceLog(logProject, { maxBytes: 1024 });
  assert.equal(result.available, true);
  assert.equal(result.truncated, true);
  assert.match(result.content, /new output/);
  assert.doesNotMatch(result.content, /\x1b\[/);
  assert.ok(result.content.length < 1024);
});
