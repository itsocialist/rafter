/** Local-only Rafter dashboard and lifecycle API. */

import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { getAllProjects, getConfig, getProject, PATHS } from '../core/registry.js';
import { findOrphans, getServerStatus, readServiceLog, startServer, stopAll, stopServer } from '../core/process.js';
import { ALL_PORT_RANGES } from '../core/ports.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function isAllowedOrigin(origin, port) {
  if (!origin) return true;
  try {
    const url = new URL(origin);
    return ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname) && Number(url.port || 80) === Number(port);
  } catch {
    return false;
  }
}

function apiError(res, error) {
  const status = error?.name === 'PortConflictError' ? 409 : 500;
  res.status(status).json({ error: error?.message || 'Unexpected Rafter error' });
}

function publicProject(project) {
  // Environment values may contain credentials. They are launch-only state and
  // must never cross the daemon API or WebSocket boundary.
  const { env, ...safe } = project;
  return safe;
}

function publicListener(listener) {
  return {
    pid: listener.pid,
    port: listener.port,
    process: listener.process,
    cwd: listener.cwd,
    ownership: listener.ownership,
  };
}

export function createRafterServer(overrides = {}) {
  const config = { ...getConfig(), ...overrides };
  const requestedPort = Number(config.dashboardPort ?? 9000);
  let port = requestedPort;
  const host = config.dashboardHost || '127.0.0.1';
  const healthInterval = Math.max(5, Number(config.healthCheckInterval || 30)) * 1000;
  const app = express();
  const server = createServer(app);
  const clients = new Set();
  const startedAt = new Date().toISOString();
  let statusTimer;
  let broadcasting = false;

  const wss = new WebSocketServer({
    server,
    maxPayload: 64 * 1024,
    perMessageDeflate: false,
    verifyClient: ({ origin }, done) => done(isAllowedOrigin(origin, port), isAllowedOrigin(origin, port) ? 101 : 403, 'Forbidden'),
  });

  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', req.path.startsWith('/api/') ? 'no-store' : 'no-cache');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self' ws: wss:; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    );
    next();
  });
  app.use(express.json({ limit: '32kb', strict: true }));
  app.use(express.static(join(__dirname, '..', 'dashboard'), { index: false, dotfiles: 'deny' }));

  // A cross-origin form can issue a POST to localhost. Reject its Origin, and
  // require same-origin dashboard requests to opt into state changes.
  app.use('/api', (req, res, next) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
    if (!isAllowedOrigin(req.get('origin'), port)) return res.status(403).json({ error: 'Cross-origin action rejected' });
    if (req.get('origin') && req.get('x-rafter-action') !== 'dashboard') {
      return res.status(403).json({ error: 'Missing action header' });
    }
    next();
  });

  async function projectsWithStatus() {
    return Promise.all(getAllProjects().map(async project => ({ ...publicProject(project), ...(await getServerStatus(project)) })));
  }

  async function broadcastStatus() {
    if (broadcasting || clients.size === 0) return;
    broadcasting = true;
    try {
      const message = JSON.stringify({ type: 'status', projects: await projectsWithStatus() });
      for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) client.send(message);
      }
    } finally {
      broadcasting = false;
    }
  }

  app.get('/api/projects', async (req, res) => {
    try { res.json(await projectsWithStatus()); } catch (error) { apiError(res, error); }
  });

  app.get('/api/project/:name', async (req, res) => {
    try {
      const project = getProject(req.params.name);
      if (!project) return res.status(404).json({ error: 'Project not found' });
      res.json({ ...publicProject(project), ...(await getServerStatus(project)) });
    } catch (error) { apiError(res, error); }
  });

  app.get('/api/project/:name/logs', (req, res) => {
    try {
      const project = getProject(req.params.name);
      if (!project) return res.status(404).json({ error: 'Project not found' });
      const requestedBytes = Number(req.query.bytes || 64 * 1024);
      res.json({ name: project.name, ...readServiceLog(project, { maxBytes: requestedBytes }) });
    } catch (error) { apiError(res, error); }
  });

  app.post('/api/project/:name/start', async (req, res) => {
    try {
      const project = getProject(req.params.name);
      if (!project) return res.status(404).json({ error: 'Project not found' });
      const result = await startServer(project);
      await broadcastStatus();
      res.status(result.state === 'already-running' ? 200 : 202).json({ success: true, ...result });
    } catch (error) { apiError(res, error); }
  });

  app.post('/api/project/:name/stop', async (req, res) => {
    try {
      const project = getProject(req.params.name);
      if (!project) return res.status(404).json({ error: 'Project not found' });
      const result = await stopServer(project, { force: req.query.force === 'true' });
      await broadcastStatus();
      const status = result.reason === 'port-conflict' ? 409 : result.reason === 'not-running' ? 200 : 202;
      res.status(status).json({ success: result.stopped, ...result });
    } catch (error) { apiError(res, error); }
  });

  app.post('/api/stop-all', async (req, res) => {
    try {
      const results = await stopAll(getAllProjects(), { force: req.query.force === 'true' });
      await broadcastStatus();
      res.json({ stopped: results.filter(result => result.stopped).length, results: results.map(result => ({ name: result.project.name, stopped: result.stopped, reason: result.reason })) });
    } catch (error) { apiError(res, error); }
  });

  app.get('/api/ports', async (req, res) => {
    try {
      const projects = await projectsWithStatus();
      const ranges = {};
      for (const [type, range] of Object.entries(ALL_PORT_RANGES)) {
        ranges[type] = {
          ...range,
          projects: projects.filter(project => project.type === type).map(({ name, port: projectPort, running, state, ownership }) => ({ name, port: projectPort, running, state, ownership })),
        };
      }
      res.json(ranges);
    } catch (error) { apiError(res, error); }
  });

  app.get('/api/port-map', async (req, res) => {
    try {
      const projects = await projectsWithStatus();
      const unmanaged = findOrphans(getAllProjects()).map(publicListener);
      const entries = [
        ...projects.filter(project => project.port).map(project => ({
          kind: 'registered',
          name: project.name,
          port: project.port,
          framework: project.framework || project.type,
          runtime: project.runtime || 'process',
          running: project.running,
          listening: project.portInUse || project.running,
          state: project.state,
          health: project.health,
          ownership: project.ownership,
          pid: project.pid,
          path: project.path,
        })),
        ...unmanaged.map(listener => ({
          kind: 'unmanaged',
          name: listener.process || 'unknown',
          port: listener.port,
          runtime: 'process',
          running: true,
          listening: true,
          state: 'unmanaged',
          ownership: 'unmanaged',
          pid: listener.pid,
          path: listener.cwd,
        })),
        {
          kind: 'daemon',
          name: 'rafterd',
          port,
          framework: 'Rafter daemon',
          runtime: 'process',
          running: true,
          listening: true,
          state: 'running',
          health: 'healthy',
          ownership: 'managed',
          pid: process.pid,
          path: PATHS.rafterDir,
        },
      ].sort((left, right) => left.port - right.port || left.name.localeCompare(right.name));
      res.json({
        generatedAt: new Date().toISOString(),
        summary: {
          assigned: projects.filter(project => project.port).length,
          listening: entries.filter(entry => entry.listening).length,
          managed: entries.filter(entry => entry.listening && ['managed', 'path', 'matched'].includes(entry.ownership)).length,
          unmanaged: unmanaged.length,
          conflicts: entries.filter(entry => entry.state === 'conflict').length,
        },
        entries,
      });
    } catch (error) { apiError(res, error); }
  });

  app.get('/api/discovery', (req, res) => {
    try { res.json({ unmanaged: findOrphans(getAllProjects()).map(publicListener) }); } catch (error) { apiError(res, error); }
  });

  // Kept for dashboard compatibility. GC no longer kills unregistered software.
  app.post('/api/gc', (req, res) => {
    try {
      const unmanaged = findOrphans(getAllProjects()).map(publicListener);
      res.json({ found: unmanaged.length, killed: 0, unmanaged, message: 'Unmanaged listeners were reported, not terminated.' });
    } catch (error) { apiError(res, error); }
  });

  app.get('/api/daemon', (req, res) => {
    const uptimeSeconds = Math.floor((Date.now() - Date.parse(startedAt)) / 1000);
    res.json({
      status: 'healthy',
      pid: process.pid,
      startedAt,
      uptimeSeconds,
      uptime: `${Math.floor(uptimeSeconds / 3600)}h ${Math.floor((uptimeSeconds % 3600) / 60)}m`,
      clients: clients.size,
      host,
      port,
    });
  });

  app.use('/api', (error, req, res, next) => {
    if (!error) return next();
    const status = error.type === 'entity.parse.failed' || error.type === 'entity.too.large' ? 400 : 500;
    res.status(status).json({ error: status === 400 ? 'Invalid JSON request body' : 'API request failed' });
  });

  app.use((req, res, next) => {
    if (req.method !== 'GET') return next();
    res.sendFile(join(__dirname, '..', 'dashboard', 'index.html'));
  });

  wss.on('connection', async ws => {
    clients.add(ws);
    try { ws.send(JSON.stringify({ type: 'init', projects: await projectsWithStatus() })); } catch { ws.close(); }
    ws.on('error', () => clients.delete(ws));
    ws.on('close', () => clients.delete(ws));
  });
  // ws mirrors HTTP server failures on its own EventEmitter. Keep startup
  // failures owned by start() instead of turning them into uncaught errors.
  wss.on('error', error => {
    if (server.listening) console.error(`Rafter WebSocket error: ${error.message}`);
  });

  async function start() {
    await new Promise((resolvePromise, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => {
        port = server.address().port;
        server.off('error', reject);
        resolvePromise();
      });
    });
    statusTimer = setInterval(() => { void broadcastStatus(); }, healthInterval);
    statusTimer.unref();
    return { host, port, startedAt };
  }

  async function close() {
    if (statusTimer) clearInterval(statusTimer);
    for (const client of clients) client.close();
    await new Promise(resolvePromise => server.close(() => resolvePromise()));
  }

  return { app, server, wss, start, close, broadcastStatus, config: { ...config, dashboardHost: host, dashboardPort: requestedPort }, startedAt };
}

const PID_FILE = join(PATHS.rafterDir, 'daemon.pid');

function removeOwnPidFile() {
  if (!existsSync(PID_FILE)) return;
  try {
    const raw = readFileSync(PID_FILE, 'utf-8').trim();
    const stored = raw.startsWith('{') ? JSON.parse(raw).pid : Number(raw);
    if (Number(stored) === process.pid) unlinkSync(PID_FILE);
  } catch {}
}

async function startStandalone() {
  const instance = createRafterServer();
  try {
    const address = await instance.start();
    writeFileSync(PID_FILE, `${JSON.stringify({ pid: process.pid, startedAt: instance.startedAt })}\n`, { mode: 0o600 });
    console.log(`\n  Rafter daemon running`);
    console.log(`    Dashboard: http://${address.host}:${address.port}`);
    console.log(`    PID:       ${process.pid}`);
    console.log(`    Projects:  ${getAllProjects().length} registered\n`);
  } catch (error) {
    console.error(`Rafter daemon failed: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  const shutdown = async () => {
    removeOwnPidFile();
    await instance.close();
  };
  process.once('SIGTERM', () => { void shutdown().then(() => process.exit(0)); });
  process.once('SIGINT', () => { void shutdown().then(() => process.exit(0)); });
  process.once('exit', removeOwnPidFile);
}

if (process.argv[1] && resolvePath(process.argv[1]) === resolvePath(__filename)) void startStandalone();

function resolvePath(path) {
  try { return fileURLToPath(new URL(`file://${path}`)); } catch { return path; }
}
