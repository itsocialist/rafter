---
name: Rafter AI Handoff
description: Instructions for AI assistants on how to use Rafter for dev server management
---

# Rafter AI Handoff Protocol

## What is Rafter?

Rafter is a CLI tool and daemon that manages the user's local development servers. It eliminates the friction of remembering start commands, dealing with port conflicts, and tracking deployment URLs.

## The .rafter.json Contract

Every Rafter-managed project has a `.rafter.json` file in its root. This is a **machine-readable contract** that tells you everything you need to know about running the project.

### Reading the Contract

```bash
cat .rafter.json
```

Example output:
```json
{
  "name": "pm-hub",
  "type": "next",
  "port": 3131,
  "startCmd": "npm run dev",
  "buildCmd": "npm run build",
  "deployments": {
    "production": "https://pm-hub.vercel.app"
  },
  "tags": ["product-management", "dashboard"]
}
```

### What Each Field Means

| Field | Purpose |
|-------|---------|
| `name` | Unique project identifier |
| `type` | Framework type: `next`, `vite`, `cra`, `python`, `express`, `mcp`, `unknown` |
| `port` | **Assigned port** — use this, never hardcode 3000 |
| `startCmd` | The exact command to start the dev server |
| `buildCmd` | The command to build for production |
| `deployments` | Map of environment → URL |
| `tags` | Searchable labels |

## How to Start a Project

**ALWAYS use Rafter** instead of raw `npm` commands. This prevents port conflicts and ensures proper tracking.

```bash
# Start by name (from anywhere)
rafter start pm-hub

# Start from the project directory
rafter start .

# If not registered yet, register first
rafter register
rafter start .
```

## How to Stop a Project

```bash
# Stop one
rafter stop pm-hub

# Stop all running servers
rafter stop --all
```

## How to Check Status

```bash
# See all projects
rafter status

# See port map
rafter ports

# Find a project
rafter find <query>
```

## When Creating a New Project

After scaffolding a new project (e.g., `npx create-next-app`), **always register it with Rafter**:

```bash
rafter register
```

This will:
1. Auto-detect the framework type
2. Assign a unique, conflict-free port from the correct range
3. Create `.rafter.json` in the project root

### Port Ranges

| Framework | Range | Example |
|-----------|-------|---------|
| Next.js | 3100–3199 | pm-hub → 3131 |
| Vite/React | 3200–3299 | buxx-jeopardy → 3224 |
| Python | 3300–3399 | ciq-gemstones → 3315 |
| Express/Node | 3400–3499 | living-decks → 3494 |
| MCP Servers | 3500–3599 | key-silk → 3527 |
| Other | 3600–3699 | LibreChat → 3648 |

## Bulk Operations

```bash
# Scan and register all projects in the workspace
rafter scan ~/workspace

# Dry run to preview
rafter scan ~/workspace --dry-run

# Inspect unmanaged listeners without terminating them
rafter gc
```

## Dashboard

The Mission Control dashboard runs at `http://localhost:9000` when the daemon is active.

```bash
# Start the daemon
rafter daemon start

# Open the dashboard
rafter dashboard

# Check daemon health
rafter daemon status
```

## Key Principle

**Never guess a port number.** Always read `.rafter.json` or run `rafter status` to find the correct port. This eliminates the #1 developer friction point: port conflicts.
