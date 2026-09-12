---
description: Intelligently start a dev project by name, reading .rafter.json, resolving port conflicts, and launching the server
---

# /dev-start — Start a Dev Project

This workflow enables Antigravity (or any AI assistant) to start any registered Rafter project with zero friction.

## Steps

1. **Identify the project**
   - If the user provides a project name, use it directly
   - If in a project directory, read the `.rafter.json` file to get the project name
   - If neither, run `rafter find <query>` to search, or `rafter status` to list all projects

// turbo
2. **Check project status**
   ```bash
   rafter status
   ```
   Look at the output to see if the target project is already running.

3. **If the project is already running**, inform the user:
   - Show the running URL: `http://localhost:<port>`
   - Ask if they want to restart it

// turbo
4. **Start the project**
   ```bash
   rafter start <project-name>
   ```
   This will:
   - Detect port conflicts and refuse to disturb an unverified owner
   - Start the dev server with the correct command
   - Inject the correct PORT environment variable
   - Open the browser automatically

5. **Verify the project started** by checking status:
   ```bash
   rafter status --running
   ```

6. **Report to the user**:
   - Project name and URL
   - Port number
   - Any conflict that requires review
