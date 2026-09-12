import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLsofFields, selectPort } from '../src/core/ports.js';

test('parses multiple lsof listener records', () => {
  const parsed = parseLsofFields('p123\ncnode\nf10\nn*:3100\np456\ncpython3\nf8\nn127.0.0.1:3300\n');
  assert.deepEqual(parsed, [
    { pid: 123, process: 'node', port: 3100, address: '*:3100' },
    { pid: 456, process: 'python3', port: 3300, address: '127.0.0.1:3300' },
  ]);
});

test('deterministic allocation skips unavailable ports', () => {
  const first = selectPort('example', 'next', new Set());
  const second = selectPort('example', 'next', new Set([first]));
  assert.ok(first >= 3100 && first <= 3199);
  assert.notEqual(second, first);
});
