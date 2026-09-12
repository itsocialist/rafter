---
description: Register the current project with Rafter so it can be managed from any AI session or the Mission Control dashboard
---

# /dev-register — Register a Project with Rafter

Use this workflow when you've just created a new project, or when you're in a project that hasn't been registered with Rafter yet.

## Steps

// turbo
1. **Check if the project is already registered**
   ```bash
   cat .rafter.json 2>/dev/null || echo "NOT REGISTERED"
   ```

2. **If not registered, register it**
   ```bash
   rafter register
   ```
   This will:
   - Auto-detect the framework (Next.js, Vite, Python, Express, etc.)
   - Assign a unique, conflict-free port
   - Create a `.rafter.json` file in the project root
   - Add the project to the central registry at `~/.rafter/registry.json`

3. **If the user wants to add deployment URLs**, edit the `.rafter.json` to include:
   ```json
   {
     "deployments": {
       "production": "https://...",
       "staging": "https://..."
     }
   }
   ```
   Then re-register to sync:
   ```bash
   rafter register
   ```

4. **Verify registration**
   ```bash
   rafter status
   ```
