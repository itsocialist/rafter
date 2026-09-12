# Security policy

## Supported versions

Security fixes are applied to the latest release on the default branch.

## Reporting a vulnerability

Do not open a public issue for a vulnerability that could expose local files, environment values, service logs, or unauthorized process control.

Use GitHub's private vulnerability reporting for `itsocialist/rafter`:

<https://github.com/itsocialist/rafter/security/advisories/new>

Include the affected version, operating system, reproduction steps, impact, and any proposed mitigation. You should receive an acknowledgement within seven days.

## Security boundaries

Rafter is designed as a local development tool. Its dashboard is not an internet-facing control plane. The default loopback binding, origin checks, ownership verification, and explicit force operations are security boundaries and should not be disabled casually.
