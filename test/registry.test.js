import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const home = mkdtempSync(join(tmpdir(), 'rafter-registry-'));
process.env.RAFTER_HOME = join(home, 'state');
const registry = await import('../src/core/registry.js');

function makeProject(name) {
  const path = join(home, name);
  mkdirSync(path, { recursive: true });
  return { name, path, type: 'next', runtime: 'process', port: 3101, startCmd: 'npm run dev', registeredAt: new Date().toISOString() };
}

test('registers atomically and resolves by directory name', () => {
  const saved = registry.registerProject({ ...makeProject('service-name'), name: 'product-name', aliases: ['legacy-name'] });
  assert.equal(registry.getProject('legacy-name').name, 'product-name');
  assert.equal(registry.resolveProject('service-name').project.name, 'product-name');
  assert.equal(JSON.parse(readFileSync(registry.PATHS.registry, 'utf-8'))['product-name'].port, 3101);
  assert.equal(saved.runtime, 'process');
});

test('renaming a path preserves its old name as an alias', () => {
  const current = registry.getProject('product-name');
  registry.registerProject({ ...current, name: 'better-name' });
  assert.equal(registry.getProject('product-name').name, 'better-name');
  assert.equal(registry.getAllProjects().length, 1);
});

test('rejects duplicate ports and unsafe names', () => {
  assert.throws(() => registry.registerProject({ ...makeProject('other'), port: 3101 }), /already assigned/);
  assert.throws(() => registry.validateProjectName('__proto__'), /Reserved/);
  assert.throws(() => registry.validatePort('3100oops'), /Invalid port/);
});
