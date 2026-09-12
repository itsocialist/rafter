---
description: Show the status of all dev projects — what's running, what's stopped, which ports are in use
---

# /dev-status — Check Dev Environment Status

## Steps

// turbo
1. **Show all registered projects with live status**
   ```bash
   rafter status
   ```

// turbo
2. **Show the port allocation map** (optional, if user asks about ports)
   ```bash
   rafter ports
   ```

// turbo
3. **Check for orphan processes** (optional, if user mentions zombie/orphan processes)
   ```bash
   rafter gc
   ```

4. **Summarize** the state:
   - How many projects are running
   - Any port conflicts or warnings
   - Memory usage of running services
   - Suggest cleanup if needed
