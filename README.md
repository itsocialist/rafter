# Rafter

[![CI](https://github.com/itsocialist/rafter/actions/workflows/ci.yml/badge.svg)](https://github.com/itsocialist/rafter/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-0ea5e9.svg)](LICENSE)
[![Node.js 20+](https://img.shields.io/badge/node-%3E%3D20-10b981.svg)](package.json)

**Run every local project by name, keep ports stable, and see what is actually alive.**

AI-assisted development makes it easy to create five apps before lunch—and just as easy to lose track of which terminal owns port 3000. Rafter gives people and coding agents one local control plane for every development service.

```text
"Start the billing API"        → rafter start billing-api
"What is running?"             → rafter status --running
"Which service owns 3131?"     → rafter ports
"Why will this app not start?" → rafter doctor
```

Rafter recognizes common project types, assigns stable ports, remembers start commands, verifies process ownership, captures service output, and presents the result in a local dashboard.

## Why Rafter

- **Names instead of directories.** Start a registered project from anywhere with `rafter start <name>`.
- **Stable port assignments.** Framework-aware ranges keep a large workspace predictable.
- **Safe process control.** Rafter stops only processes it can tie to the registered project. Unknown port owners are reported as conflicts.
- **Useful service recognition.** Next.js, Vite, SvelteKit, Astro, Node APIs, Python frameworks, MCP servers, Docker, Go, Rust, and Rails are detected automatically.
- **One operational screen.** Mission Control shows service state, health, PID, memory, ownership, live stdout/stderr, and a full port map.
- **An agent-readable contract.** Each project can carry a small `.rafter.json` file so an AI coding agent does not have to guess how to run it.

## Quick start

Rafter supports macOS and Linux with Node.js 20 or newer. `lsof` is required for listener discovery.

Install the CLI directly from GitHub:

```sh
npm install --global github:itsocialist/rafter
```

Preview a workspace scan, register the projects, and start Mission Control:

```sh
rafter scan ~/workspace --dry-run
rafter scan ~/workspace
rafter daemon start
rafter dashboard
```

Then start any project by name:

```sh
rafter start billing-api
```

The dashboard runs locally at [http://localhost:9000](http://localhost:9000).

## Mission Control

The dashboard has two views:

- **Services** provides lifecycle controls, health and ownership details, and a live 64 KB tail of combined stdout/stderr for the selected project.
- **Port Map** lists assigned and active ports with service, framework, state, ownership, PID, and path. Filters isolate listening services and conflicts.

The daemon binds to `127.0.0.1` by default. State-changing requests are same-origin protected, and environment values never cross the dashboard API.

## Use Rafter with an AI coding agent

Commit a `.rafter.json` file in each managed project:

```json
{
  "name": "billing-api",
  "type": "express",
  "runtime": "process",
  "port": 3421,
  "startCmd": "npm run dev",
  "healthCheck": "/health",
  "aliases": ["billing"]
}
```

That file is the handoff contract between the project, the developer, and the agent. It answers the questions that usually produce broken shell commands: what the service is called, how it starts, and which port it owns.

This repository also includes reusable agent instructions in [`.agent/skills/rafter-handoff/SKILL.md`](.agent/skills/rafter-handoff/SKILL.md) and command workflows under [`.agent/workflows`](.agent/workflows).

Recommended instruction for a coding agent:

```text
Use Rafter for local service lifecycle. Read .rafter.json or run rafter status
before starting a server. Never guess or reuse a port, and do not kill a port
owner unless Rafter verifies that it belongs to the selected project.
```

## Commands

```text
rafter register [--name NAME] [--port PORT] [--start-cmd CMD]
rafter scan [DIRECTORY] [--dry-run]
rafter find QUERY
rafter status [--running] [--verbose] [--json]
rafter doctor [--json]
rafter configure [NAME] [--name NAME] [--port PORT]
                         [--start-cmd CMD] [--health-check URL_OR_PATH]
rafter start [NAME]
rafter stop NAME
rafter stop --all
rafter unregister NAME [--force]
rafter ports
rafter gc
rafter kill-port PORT [--force]
rafter daemon start|stop|restart|status|logs
rafter dashboard
```

Names resolve by canonical name, alias, project-directory name, then unique prefix. Re-registering the same path with a new name preserves the old name as an alias.

`rafter doctor` is read-only. It detects duplicate paths or ports, generic names, missing paths, configuration drift, stale process records, and live ownership conflicts.

## Safety model

- A listener belongs to a service only when its PID/process group was launched by Rafter or its working directory is inside the registered project path.
- An unverified listener on a registered port is a `conflict`. Start and stop operations leave it alone.
- `rafter gc` reports unmanaged development listeners; it never kills them.
- `rafter kill-port` is the explicit low-level escape hatch. It starts with `SIGTERM`; `--force` permits `SIGKILL` after a timeout.
- Registry updates are validated, locked, atomically written, and stored with owner-only permissions.
- Service logs are returned only through a registered project name and as a bounded, plain-text tail.

## Running-state meanings

| State | Meaning |
|---|---|
| `running` | The registered service owns the listener. |
| `unhealthy` | The listener exists, but the configured health check failed. |
| `starting` | The managed PID exists and is inside the startup grace period. |
| `no-listener` | The managed PID exists but no configured-port listener was found. |
| `conflict` | The port is occupied by an unverified process. |
| `stopped` | No listener or live managed process was found. |
| `online` / `offline` | Remote URL probe result. |

## Local state

Rafter stores machine-specific state under `~/.rafter`:

- `registry.json` — registered services and managed-process identity
- `config.json` — dashboard and workspace settings
- `logs/` — daemon and per-service logs

Set `RAFTER_HOME` to use an isolated state directory for testing or automation.

## Development

```sh
git clone https://github.com/itsocialist/rafter.git
cd rafter
npm ci
npm test
npm link
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidance and [SECURITY.md](SECURITY.md) for vulnerability reporting.

## License

MIT © 2026 Brian Dawson
