import test from 'node:test';
import assert from 'node:assert/strict';
import { browserCommand } from '../src/cli/open-url.js';

test('selects the native URL opener for supported platforms', () => {
  assert.deepEqual(browserCommand('darwin'), { command: 'open', args: [] });
  assert.deepEqual(browserCommand('linux'), { command: 'xdg-open', args: [] });
});
