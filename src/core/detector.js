/**
 * Rafter — Project Detector
 * Auto-detects project type, start command, and framework from filesystem clues.
 */

import { readFileSync, existsSync } from 'fs';
import { join, basename } from 'path';

/** @typedef {'next' | 'vite' | 'cra' | 'svelte' | 'astro' | 'express' | 'python' | 'mcp' | 'docker' | 'go' | 'rust' | 'ruby' | 'unknown'} ProjectType */

/**
 * @typedef {Object} DetectionResult
 * @property {string} name
 * @property {ProjectType} type
 * @property {string} startCmd
 * @property {string} [buildCmd]
 * @property {string} [framework]
 * @property {string} [packageName]
 * @property {string[]} [aliases]
 */

/**
 * Detect project type and configuration from a directory.
 * @param {string} projectDir - Absolute path to the project directory
 * @returns {DetectionResult}
 */
export function detectProject(projectDir) {
  const name = basename(projectDir);

  // Check for .rafter.json first (already configured)
  const rafterConfig = join(projectDir, '.rafter.json');
  if (existsSync(rafterConfig)) {
    try {
      const config = JSON.parse(readFileSync(rafterConfig, 'utf-8'));
      return {
        name: config.name || name,
        type: config.type || 'unknown',
        startCmd: typeof config.startCmd === 'string' ? config.startCmd : 'npm run dev',
        buildCmd: config.buildCmd,
        framework: config.framework || config.type,
        packageName: config.packageName,
        aliases: config.aliases || [],
        runtime: config.runtime,
        port: config.port,
        healthCheck: config.healthCheck,
        devUrl: config.devUrl,
        deployments: config.deployments,
        tags: config.tags,
      };
    } catch (error) {
      throw new Error(`Invalid ${rafterConfig}: ${error.message}`);
    }
  }

  // Check for Docker Compose
  const composeFiles = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'];
  for (const file of composeFiles) {
    if (existsSync(join(projectDir, file))) {
      return {
        name,
        type: 'docker',
        runtime: 'docker',
        startCmd: 'docker compose up -d',
        framework: 'Docker Compose',
      };
    }
  }

  // Check for Dockerfile only
  if (existsSync(join(projectDir, 'Dockerfile'))) {
    const dockerName = name.toLowerCase().replace(/[^a-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '') || 'rafter-service';
    return {
      name,
      type: 'docker',
      runtime: 'docker',
      startCmd: `docker build -t ${dockerName} . && docker run -d --name ${dockerName} ${dockerName}`,
      framework: 'Docker',
    };
  }

  // Check for package.json (Node.js project)
  const pkgPath = join(projectDir, 'package.json');
  if (existsSync(pkgPath)) {
    return detectNodeProject(projectDir, pkgPath, name);
  }

  // Check for Python project
  const reqPath = join(projectDir, 'requirements.txt');
  const pyprojectPath = join(projectDir, 'pyproject.toml');
  if (existsSync(reqPath) || existsSync(pyprojectPath)) {
    return detectPythonProject(projectDir, name);
  }

  if (existsSync(join(projectDir, 'go.mod'))) {
    return { name, type: 'go', startCmd: 'go run .', framework: 'Go' };
  }

  if (existsSync(join(projectDir, 'Cargo.toml'))) {
    return { name, type: 'rust', startCmd: 'cargo run', framework: 'Rust' };
  }

  if (existsSync(join(projectDir, 'Gemfile'))) {
    const rails = existsSync(join(projectDir, 'config', 'application.rb'));
    return {
      name,
      type: 'ruby',
      startCmd: rails ? 'bundle exec rails server' : 'bundle exec ruby app.rb',
      framework: rails ? 'Ruby on Rails' : 'Ruby',
    };
  }

  return {
    name,
    type: 'unknown',
    startCmd: '',
    framework: undefined,
  };
}

/**
 * Detect Node.js project specifics.
 */
function detectNodeProject(projectDir, pkgPath, name) {
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  } catch (error) {
    throw new Error(`Invalid ${pkgPath}: ${error.message}`);
  }

  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const scripts = pkg.scripts || {};
  const packageName = typeof pkg.name === 'string' ? pkg.name : undefined;
  const configuredName = pkg.rafter && typeof pkg.rafter.name === 'string' ? pkg.rafter.name : undefined;
  const genericNames = new Set(['app', 'api', 'client', 'frontend', 'server', 'src', 'web']);
  const detectedName = configuredName || (packageName && !genericNames.has(packageName.toLowerCase()) ? packageName : name);
  const aliases = [...new Set([name, packageName].filter(alias => alias && alias !== detectedName))];
  const base = { name: detectedName, packageName, aliases };

  // Next.js detection
  if (deps['next']) {
    return {
      ...base,
      type: 'next',
      startCmd: scripts.dev ? 'npm run dev' : 'npx next dev',
      buildCmd: scripts.build ? 'npm run build' : 'npx next build',
      framework: 'Next.js',
    };
  }

  // Frameworks that commonly include Vite must be checked first.
  if (deps['@sveltejs/kit'] || existsSync(join(projectDir, 'svelte.config.js'))) {
    return {
      ...base,
      type: 'svelte',
      startCmd: scripts.dev ? 'npm run dev' : 'npx vite dev',
      buildCmd: scripts.build ? 'npm run build' : undefined,
      framework: 'SvelteKit',
    };
  }

  if (deps['astro'] || existsSync(join(projectDir, 'astro.config.mjs'))) {
    return {
      ...base,
      type: 'astro',
      startCmd: scripts.dev ? 'npm run dev' : 'npx astro dev',
      buildCmd: scripts.build ? 'npm run build' : undefined,
      framework: 'Astro',
    };
  }

  // Vite detection
  if (deps['vite'] || existsSync(join(projectDir, 'vite.config.js')) || existsSync(join(projectDir, 'vite.config.ts'))) {
    return {
      ...base,
      type: 'vite',
      startCmd: scripts.dev ? 'npm run dev' : 'npx vite',
      buildCmd: scripts.build ? 'npm run build' : 'npx vite build',
      framework: 'Vite',
    };
  }

  // Create React App detection
  if (deps['react-scripts']) {
    return {
      ...base,
      type: 'cra',
      startCmd: 'npm start',
      buildCmd: 'npm run build',
      framework: 'Create React App',
    };
  }

  // MCP server detection
  if (pkg.name?.includes('mcp') || deps['@modelcontextprotocol/sdk']) {
    return {
      ...base,
      type: 'mcp',
      startCmd: scripts.start ? 'npm start' : 'node src/index.js',
      framework: 'MCP Server',
    };
  }

  // Express detection
  if (deps['express'] || deps['fastify'] || deps['koa']) {
    const framework = deps['express'] ? 'Express' : deps['fastify'] ? 'Fastify' : 'Koa';
    return {
      ...base,
      type: 'express',
      startCmd: scripts.dev ? 'npm run dev' : scripts.start ? 'npm start' : 'node server.js',
      buildCmd: scripts.build ? 'npm run build' : undefined,
      framework,
    };
  }

  // Generic Node.js project
  return {
    ...base,
    type: 'unknown',
    startCmd: scripts.dev
      ? 'npm run dev'
      : scripts.start ? 'npm start'
        : existsSync(join(projectDir, 'index.js')) ? 'node index.js' : '',
    buildCmd: scripts.build ? 'npm run build' : undefined,
    framework: 'Node.js',
  };
}

/**
 * Detect Python project specifics.
 */
function detectPythonProject(projectDir, name) {
  // Check for common Python frameworks
  const reqPath = join(projectDir, 'requirements.txt');
  let requirements = '';
  if (existsSync(reqPath)) {
    try { requirements = readFileSync(reqPath, 'utf-8').toLowerCase(); } catch {}
  }
  const pyprojectPath = join(projectDir, 'pyproject.toml');
  if (existsSync(pyprojectPath)) {
    try { requirements += `\n${readFileSync(pyprojectPath, 'utf-8').toLowerCase()}`; } catch {}
  }

  // FastAPI
  if (requirements.includes('fastapi') || requirements.includes('uvicorn')) {
    return {
      name,
      type: 'python',
      startCmd: 'uvicorn main:app --reload',
      framework: 'FastAPI',
    };
  }

  // Flask
  if (requirements.includes('flask')) {
    return {
      name,
      type: 'python',
      startCmd: 'flask run --reload',
      framework: 'Flask',
    };
  }

  // Django
  if (requirements.includes('django') || existsSync(join(projectDir, 'manage.py'))) {
    return {
      name,
      type: 'python',
      startCmd: 'python manage.py runserver',
      framework: 'Django',
    };
  }

  // Generic Python
  const entrypoint = ['main.py', 'app.py', 'server.py'].find(file => existsSync(join(projectDir, file)));
  return {
    name,
    type: 'python',
    startCmd: entrypoint ? `python ${entrypoint}` : '',
    framework: 'Python',
  };
}

/**
 * Check if a directory looks like a project (has recognizable config files).
 * @param {string} dir
 * @returns {boolean}
 */
export function isProject(dir) {
  const markers = [
    'package.json',
    'requirements.txt',
    'pyproject.toml',
    'Cargo.toml',
    'go.mod',
    'Gemfile',
    'docker-compose.yml',
    'docker-compose.yaml',
    'compose.yml',
    'compose.yaml',
    'Dockerfile',
  ];
  return markers.some(m => existsSync(join(dir, m)));
}
