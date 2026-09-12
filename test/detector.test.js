import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { detectProject } from '../src/core/detector.js';

function project(name, files) {
  const root = mkdtempSync(join(tmpdir(), 'rafter-detector-'));
  const path = join(root, name);
  mkdirSync(path);
  for (const [filename, contents] of Object.entries(files)) {
    const target = join(path, filename);
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, contents);
  }
  return path;
}

test('uses directory name when package name is generic', () => {
  const path = project('billing-console', {
    'package.json': JSON.stringify({ name: 'app', scripts: { dev: 'vite' }, devDependencies: { vite: '^7.0.0' } }),
  });
  const result = detectProject(path);
  assert.equal(result.name, 'billing-console');
  assert.equal(result.packageName, 'app');
  assert.deepEqual(result.aliases, ['app']);
});

test('recognizes SvelteKit before generic Vite', () => {
  const path = project('portal', {
    'package.json': JSON.stringify({ name: 'portal', scripts: { dev: 'vite dev' }, devDependencies: { vite: '^7', '@sveltejs/kit': '^2' } }),
  });
  assert.equal(detectProject(path).type, 'svelte');
});

test('preserves a remote local config with no start command', () => {
  const path = project('docs', {
    '.rafter.json': JSON.stringify({ name: 'docs', type: 'remote', runtime: 'remote', startCmd: '', devUrl: 'https://example.com' }),
  });
  const result = detectProject(path);
  assert.equal(result.startCmd, '');
  assert.equal(result.devUrl, 'https://example.com');
});

test('detects FastAPI from pyproject.toml', () => {
  const path = project('service', { 'pyproject.toml': '[project]\ndependencies = ["fastapi"]\n' });
  assert.equal(detectProject(path).framework, 'FastAPI');
});
