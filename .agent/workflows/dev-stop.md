---
description: Stop a running dev project gracefully, or stop all running services
---

# /dev-stop — Stop a Dev Project

## Steps

1. **Identify what to stop**
   - If the user says "stop all" or "stop everything", use `--all` flag
   - If a specific project name is given, use it
   - If in a project directory, read `.rafter.json` for the project name

// turbo
2. **Stop the project(s)**
   ```bash
   rafter stop <project-name>
   ```
   Or to stop everything:
   ```bash
   rafter stop --all
   ```

// turbo
3. **Verify** by checking status:
   ```bash
   rafter status
   ```

4. **Report** what was stopped and list any unmanaged listeners that still require review.
