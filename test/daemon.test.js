import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createServer } from 'http';

process.env.RAFTER_HOME = join(mkdtempSync(join(tmpdir(), 'rafter-daemon-')), 'state');
const { createRafterServer } = await import('../src/daemon/server.js');
const { registerProject } = await import('../src/core/registry.js');

test('serves local health and rejects cross-origin actions', async t => {
  const projectPath = join(mkdtempSync(join(tmpdir(), 'rafter-api-project-')), 'api');
  mkdirSync(projectPath);
  registerProject({
    name: 'api-test',
    path: projectPath,
    type: 'express',
    runtime: 'process',
    port: 39999,
    startCmd: 'npm start',
    env: { SECRET_TOKEN: 'must-not-leak' },
    registeredAt: new Date().toISOString(),
  });
  const instance = createRafterServer({ dashboardPort: 0, healthCheckInterval: 60 });
  let address;
  try {
    address = await instance.start();
  } catch (error) {
    if (error.code === 'EPERM') {
      t.skip('environment does not permit loopback listeners');
      return;
    }
    throw error;
  }
  t.after(() => instance.close());

  const base = `http://${address.host}:${address.port}`;
  const health = await fetch(`${base}/api/daemon`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).port, address.port);
  assert.equal(health.headers.get('x-content-type-options'), 'nosniff');
  const dashboard = await (await fetch(base)).text();
  assert.match(dashboard, /PORT MAP/);
  assert.match(dashboard, /id="port-table-body"/);
  assert.match(dashboard, /id="detail-output"/);

  const projects = await (await fetch(`${base}/api/projects`)).json();
  assert.equal(projects.length, 1);
  assert.equal(Object.hasOwn(projects[0], 'env'), false);

  const logs = await (await fetch(`${base}/api/project/api-test/logs`)).json();
  assert.equal(logs.name, 'api-test');
  assert.equal(logs.available, false);

  const noHeader = await fetch(`${base}/api/gc`, { method: 'POST', headers: { Origin: base } });
  assert.equal(noHeader.status, 403);

  const rejected = await fetch(`${base}/api/gc`, { method: 'POST', headers: { Origin: 'https://evil.example' } });
  assert.equal(rejected.status, 403);

  const accepted = await fetch(`${base}/api/gc`, {
    method: 'POST',
    headers: { Origin: base, 'X-Rafter-Action': 'dashboard' },
  });
  assert.equal(accepted.status, 200);
  assert.equal((await accepted.json()).killed, 0);

  const malformed = await fetch(`${base}/api/gc`, {
    method: 'POST',
    headers: { Origin: base, 'X-Rafter-Action': 'dashboard', 'Content-Type': 'application/json' },
    body: '{',
  });
  assert.equal(malformed.status, 400);

  // A foreign listener on an assigned port must survive a start request.
  const foreign = createServer((req, res) => res.end('still alive'));
  await new Promise((resolvePromise, reject) => {
    foreign.once('error', reject);
    foreign.listen(0, '127.0.0.1', resolvePromise);
  });
  t.after(() => new Promise(resolvePromise => foreign.close(resolvePromise)));
  const foreignPort = foreign.address().port;
  const conflictPath = join(mkdtempSync(join(tmpdir(), 'rafter-conflict-')), 'service');
  mkdirSync(conflictPath);
  registerProject({
    name: 'conflict-service',
    path: conflictPath,
    type: 'express',
    runtime: 'process',
    port: foreignPort,
    startCmd: 'npm start',
    registeredAt: new Date().toISOString(),
  });
  const conflict = await fetch(`${base}/api/project/conflict-service/start`, {
    method: 'POST',
    headers: { Origin: base, 'X-Rafter-Action': 'dashboard' },
  });
  assert.equal(conflict.status, 409);
  assert.equal(await (await fetch(`http://127.0.0.1:${foreignPort}`)).text(), 'still alive');

  const map = await (await fetch(`${base}/api/port-map`)).json();
  assert.ok(map.entries.some(entry => entry.kind === 'daemon' && entry.name === 'rafterd'));
  assert.ok(map.entries.some(entry => entry.name === 'api-test' && entry.port === 39999));
  assert.ok(map.entries.some(entry => entry.name === 'conflict-service' && entry.state === 'conflict' && entry.listening));
  assert.equal(map.summary.conflicts, 1);
});
