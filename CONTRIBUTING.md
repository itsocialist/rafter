# Contributing to Rafter

Rafter should make local development services easier to identify and safer to manage. Contributions that improve recognition, lifecycle reliability, portability, or dashboard clarity are welcome.

## Development setup

```sh
git clone https://github.com/itsocialist/rafter.git
cd rafter
npm ci
npm test
```

Use an isolated state directory while developing so tests and manual experiments do not alter your normal registry:

```sh
export RAFTER_HOME="$(mktemp -d)/rafter"
node src/cli/index.js register
node src/daemon/server.js
```

## Before opening a pull request

```sh
npm run check
npm audit --omit=dev
npm pack --dry-run
```

Please include:

- the user-visible problem and intended behavior;
- tests for lifecycle, registry, detection, or API changes;
- manual verification notes for dashboard changes;
- platform details for process or port-discovery changes.

## Design constraints

- Never terminate a process based only on its port number.
- Treat missing ownership evidence as a conflict, not permission to act.
- Keep the dashboard loopback-only unless a separate authenticated design is introduced.
- Do not expose registered environment values or arbitrary filesystem paths through log APIs.
- Preserve `.rafter.json` compatibility or document and test a migration.
