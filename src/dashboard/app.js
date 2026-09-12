/**
 * Rafter Mission Control — Dashboard Application
 * Real-time project management via WebSocket + REST API
 */

(function () {
  'use strict';

  // ─── State ──────────────────────────────────────────────

  let projects = [];
  let selectedProject = null;
  let selectedIndex = -1;
  let searchQuery = '';
  let currentView = 'services';
  let portMap = { summary: {}, entries: [] };
  let portFilter = 'all';
  let lastPortMapFetch = 0;
  let ws = null;
  let reconnectTimer = null;
  let logPollTimer = null;
  let logRequestId = 0;

  // ─── DOM References ─────────────────────────────────────

  const $ = (sel) => document.querySelector(sel);
  const $list = $('#project-list');
  const $count = $('#project-count');
  const $search = $('#search-input');
  const $detailEmpty = $('#detail-empty');
  const $detailContent = $('#detail-content');
  const $detailName = $('#detail-name');
  const $detailBadge = $('#detail-badge');
  const $detailPort = $('#detail-port');
  const $detailStatus = $('#detail-status');
  const $detailPid = $('#detail-pid');
  const $detailMem = $('#detail-mem');
  const $detailHealth = $('#detail-health');
  const $detailOwner = $('#detail-owner');
  const $detailCmd = $('#detail-cmd');
  const $detailPath = $('#detail-path');
  const $detailOutput = $('#detail-output');
  const $detailOutputMeta = $('#detail-output-meta');
  const $btnRefreshOutput = $('#btn-refresh-output');
  const $detailDeploySection = $('#detail-deployments-section');
  const $detailDeploy = $('#detail-deployments');
  const $detailTagsSection = $('#detail-tags-section');
  const $detailTags = $('#detail-tags');
  const $topoStrip = $('#topology-strip');
  const $btnStart = $('#btn-start');
  const $btnStop = $('#btn-stop');
  const $btnOpen = $('#btn-open');
  const $btnEdit = $('#btn-edit');
  const $metadataForm = $('#metadata-form');
  const $metadataName = $('#metadata-name');
  const $metadataType = $('#metadata-type');
  const $metadataFramework = $('#metadata-framework');
  const $metadataPort = $('#metadata-port');
  const $metadataStartCmd = $('#metadata-start-cmd');
  const $metadataHealth = $('#metadata-health');
  const $metadataAliases = $('#metadata-aliases');
  const $metadataTags = $('#metadata-tags');
  const $metadataError = $('#metadata-error');
  const $btnSaveMetadata = $('#btn-save-metadata');
  const $btnCancelMetadata = $('#btn-cancel-metadata');
  const $btnStopAll = $('#btn-stop-all');
  const $btnGC = $('#btn-gc');
  const $main = $('#main');
  const $portMapScreen = $('#port-map-screen');
  const $topology = $('#topology');
  const $viewServices = $('#view-services');
  const $viewPorts = $('#view-ports');
  const $portSummary = $('#port-summary');
  const $portRanges = $('#port-ranges');
  const $portTableBody = $('#port-table-body');
  const $portListCount = $('#port-list-count');
  const $btnRefreshPorts = $('#btn-refresh-ports');

  // ─── WebSocket Connection ───────────────────────────────

  function connectWebSocket() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${location.host}`);

    ws.onopen = () => {
      console.log('[Rafter] WebSocket connected');
      $('.daemon-dot').style.background = 'var(--green)';
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'init' || data.type === 'status') {
        projects = data.projects;
        render();
        if (currentView === 'ports' && Date.now() - lastPortMapFetch > 5000) fetchPortMap();
      }
    };

    ws.onclose = () => {
      console.log('[Rafter] WebSocket disconnected, reconnecting...');
      $('.daemon-dot').style.background = 'var(--red)';
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connectWebSocket, 3000);
    };

    ws.onerror = () => ws.close();
  }

  // ─── API Calls ──────────────────────────────────────────

  async function actionFetch(url, { method = 'POST', body } = {}) {
    const headers = { 'X-Rafter-Action': 'dashboard' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(url, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  async function fetchProjects() {
    try {
      const res = await fetch('/api/projects');
      projects = await res.json();
      render();
    } catch (err) {
      console.error('[Rafter] Failed to fetch projects:', err);
    }
  }

  async function fetchPortMap() {
    $btnRefreshPorts.disabled = true;
    try {
      const res = await fetch('/api/port-map');
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      portMap = await res.json();
      lastPortMapFetch = Date.now();
      renderPortMap();
    } catch (err) {
      console.error('[Rafter] Failed to fetch port map:', err);
      $portListCount.textContent = 'Port inventory unavailable';
    } finally {
      $btnRefreshPorts.disabled = false;
    }
  }

  async function fetchProjectLogs(name) {
    const requestId = ++logRequestId;
    const wasFollowing = $detailOutput.scrollHeight - $detailOutput.scrollTop - $detailOutput.clientHeight < 32;
    try {
      const res = await fetch(`/api/project/${encodeURIComponent(name)}/logs?bytes=65536`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      if (requestId !== logRequestId || selectedProject?.name !== name) return;
      if (!data.available) {
        $detailOutput.textContent = 'No captured output yet. Start this service with Rafter to begin capture.';
        $detailOutputMeta.textContent = 'waiting for first Rafter-managed start';
        return;
      }
      $detailOutput.textContent = data.content || 'The service has not written any output yet.';
      const size = data.bytes >= 1024 ? `${Math.round(data.bytes / 1024)} KB` : `${data.bytes} B`;
      $detailOutputMeta.textContent = `${data.truncated ? 'tail · ' : ''}${size} · stdout + stderr`;
      if (wasFollowing) $detailOutput.scrollTop = $detailOutput.scrollHeight;
    } catch (err) {
      if (requestId !== logRequestId || selectedProject?.name !== name) return;
      $detailOutput.textContent = `Output unavailable: ${err.message}`;
      $detailOutputMeta.textContent = 'log read failed';
    }
  }

  function watchProjectLogs(name) {
    clearInterval(logPollTimer);
    void fetchProjectLogs(name);
    logPollTimer = setInterval(() => {
      if (currentView === 'services' && selectedProject?.name === name) void fetchProjectLogs(name);
    }, 1500);
  }

  async function apiStart(name) {
    $btnStart.disabled = true;
    $btnStart.textContent = '...';
    try {
      await actionFetch(`/api/project/${encodeURIComponent(name)}/start`);
      await fetchProjectLogs(name);
    } catch (err) {
      console.error('[Rafter] Start failed:', err);
    }
    $btnStart.disabled = false;
    $btnStart.innerHTML = '<span class="btn-dot start-dot"></span> START';
  }

  async function apiStop(name) {
    $btnStop.disabled = true;
    try {
      await actionFetch(`/api/project/${encodeURIComponent(name)}/stop`);
    } catch (err) {
      console.error('[Rafter] Stop failed:', err);
    }
    $btnStop.disabled = false;
  }

  async function apiStopAll() {
    $btnStopAll.disabled = true;
    try {
      await actionFetch('/api/stop-all');
    } catch (err) {
      console.error('[Rafter] Stop all failed:', err);
    }
    $btnStopAll.disabled = false;
  }

  async function apiGC() {
    $btnGC.disabled = true;
    $btnGC.textContent = '...';
    try {
      const data = await actionFetch('/api/gc');
      $btnGC.textContent = data.found > 0 ? `${data.found} FOUND` : 'CLEAN';
      setTimeout(() => { $btnGC.textContent = 'DISCOVER'; }, 2000);
      if (currentView === 'ports') fetchPortMap();
    } catch (err) {
      $btnGC.textContent = 'DISCOVER';
    }
    $btnGC.disabled = false;
  }

  function openMetadataEditor(project) {
    $metadataName.value = project.name || '';
    $metadataType.value = project.type || 'unknown';
    $metadataFramework.value = project.framework || '';
    $metadataPort.value = project.port || '';
    $metadataStartCmd.value = project.startCmd || '';
    $metadataHealth.value = project.healthCheck || '';
    $metadataAliases.value = (project.aliases || []).join(', ');
    $metadataTags.value = (project.tags || []).join(', ');
    $metadataPort.disabled = project.running || project.runtime !== 'process';
    $metadataPort.title = project.running
      ? 'Stop the service before changing its port.'
      : project.runtime !== 'process' ? 'Only process services use assigned ports.' : '';
    $metadataError.textContent = '';
    $metadataForm.classList.remove('hidden');
    $btnEdit.setAttribute('aria-expanded', 'true');
    $metadataName.focus();
  }

  function closeMetadataEditor() {
    $metadataForm.classList.add('hidden');
    $metadataError.textContent = '';
    $btnEdit.setAttribute('aria-expanded', 'false');
  }

  function csvValues(value) {
    return [...new Set(value.split(',').map(item => item.trim()).filter(Boolean))];
  }

  async function apiUpdateMetadata(event) {
    event.preventDefault();
    if (!selectedProject) return;
    const originalName = selectedProject.name;
    const body = {
      name: $metadataName.value.trim(),
      type: $metadataType.value.trim().toLowerCase(),
      framework: $metadataFramework.value.trim(),
      startCmd: $metadataStartCmd.value.trim(),
      healthCheck: $metadataHealth.value.trim(),
      aliases: csvValues($metadataAliases.value),
      tags: csvValues($metadataTags.value),
    };
    if (!$metadataPort.disabled) body.port = $metadataPort.value ? Number($metadataPort.value) : null;

    $btnSaveMetadata.disabled = true;
    $btnSaveMetadata.textContent = 'SAVING...';
    $metadataError.textContent = '';
    try {
      const data = await actionFetch(`/api/project/${encodeURIComponent(originalName)}`, { method: 'PATCH', body });
      await fetchProjects();
      const updated = projects.find(project => project.name === data.project.name);
      if (updated) selectProject(updated, getFilteredProjects().findIndex(project => project.name === updated.name));
      closeMetadataEditor();
    } catch (err) {
      $metadataError.textContent = err.message;
    } finally {
      $btnSaveMetadata.disabled = false;
      $btnSaveMetadata.textContent = 'SAVE CHANGES';
    }
  }

  // ─── Rendering ──────────────────────────────────────────

  function render() {
    renderProjectList();
    renderTopology();
    if (selectedProject) {
      const updated = projects.find(p => p.name === selectedProject.name);
      if (updated) {
        selectedProject = updated;
        renderDetail(updated);
      }
    }
    if (currentView === 'ports' && portMap.entries.length) renderPortMap();
  }

  function getFilteredProjects() {
    let filtered = [...projects];
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(p =>
        p.name.toLowerCase().includes(q) ||
        (p.framework && p.framework.toLowerCase().includes(q)) ||
        (p.type && p.type.toLowerCase().includes(q)) ||
        (p.path && p.path.toLowerCase().includes(q)) ||
        (p.aliases && p.aliases.some(a => a.toLowerCase().includes(q))) ||
        (p.tags && p.tags.some(t => t.toLowerCase().includes(q)))
      );
    }
    // Sort: running first, then alphabetical
    filtered.sort((a, b) => {
      if (a.running && !b.running) return -1;
      if (!a.running && b.running) return 1;
      return a.name.localeCompare(b.name);
    });
    return filtered;
  }

  function renderProjectList() {
    const filtered = getFilteredProjects();
    $count.textContent = `${filtered.filter(p => p.running).length}/${filtered.length}`;

    $list.innerHTML = filtered.map((p, i) => `
      <div class="project-item${selectedProject && selectedProject.name === p.name ? ' active' : ''}"
           data-name="${escapeHtml(p.name)}" data-index="${i}">
        <div class="project-dot ${p.running ? 'running' : 'stopped'}"></div>
        <span class="project-name">${escapeHtml(p.name)}</span>
        <span class="project-port">${p.port ? `:${p.port}` : p.runtime || '—'}</span>
      </div>
    `).join('');

    // Attach click handlers
    $list.querySelectorAll('.project-item').forEach(el => {
      el.addEventListener('click', () => {
        const name = el.dataset.name;
        const project = projects.find(p => p.name === name);
        if (project) selectProject(project, parseInt(el.dataset.index));
      });
    });
  }

  function selectProject(project, index) {
    selectedProject = project;
    selectedIndex = index;
    $detailEmpty.classList.add('hidden');
    $detailContent.classList.remove('hidden');
    closeMetadataEditor();

    // Re-trigger animation
    $detailContent.style.animation = 'none';
    $detailContent.offsetHeight; // reflow
    $detailContent.style.animation = '';

    renderDetail(project);
    watchProjectLogs(project.name);
    renderProjectList(); // Update active state
  }

  function renderDetail(p) {
    $detailName.textContent = p.name;

    // Badge
    const badgeClass = `badge-${p.type || 'unknown'}`;
    $detailBadge.className = `framework-badge ${badgeClass}`;
    $detailBadge.textContent = p.framework || p.type || 'unknown';

    // Meta
    $detailPort.textContent = p.port ? `:${p.port}` : '—';
    const state = (p.state || (p.running ? 'running' : 'stopped')).toUpperCase();
    $detailStatus.textContent = `${p.running ? '●' : '○'} ${state}`;
    $detailStatus.className = `meta-value ${p.running ? 'status-running' : 'status-stopped'}`;
    $detailPid.textContent = p.pid || '—';
    $detailMem.textContent = p.mem || '—';
    $detailHealth.textContent = p.health || 'unknown';
    $detailOwner.textContent = p.ownership || (p.runtime === 'remote' ? 'remote' : '—');

    // Command & path
    $detailCmd.textContent = p.startCmd || '—';
    $detailPath.textContent = p.path || '—';

    // Deployments
    if (p.deployments && Object.keys(p.deployments).length > 0) {
      $detailDeploySection.classList.remove('hidden');
      $detailDeploy.innerHTML = Object.entries(p.deployments).map(([env, url]) => `
        <div class="deployment-link">
          <span class="deployment-env">${escapeHtml(env)}</span>
          <a href="${escapeHtml(url)}" target="_blank" rel="noopener" class="deployment-url">${escapeHtml(url)}</a>
        </div>
      `).join('');
    } else {
      $detailDeploySection.classList.add('hidden');
    }

    // Tags
    if (p.tags && p.tags.length > 0) {
      $detailTagsSection.classList.remove('hidden');
      $detailTags.innerHTML = p.tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('');
    } else {
      $detailTagsSection.classList.add('hidden');
    }

    // Button visibility
    $btnStart.style.display = p.running ? 'none' : 'flex';
    $btnStop.style.display = p.running ? 'flex' : 'none';
    $btnOpen.style.display = p.running || p.runtime === 'remote' ? 'flex' : 'none';
  }

  // ─── Port Topology ─────────────────────────────────────

  const TOPO_RANGES = [
    { types: ['next'], label: 'NEXT.JS', min: 3100, max: 3199, cssClass: 'topo-next' },
    { types: ['vite', 'cra', 'svelte', 'astro'], label: 'WEB UI', min: 3200, max: 3299, cssClass: 'topo-vite' },
    { types: ['python'], label: 'PYTHON', min: 3300, max: 3399, cssClass: 'topo-python' },
    { types: ['express'], label: 'NODE API', min: 3400, max: 3499, cssClass: 'topo-express' },
    { types: ['mcp'], label: 'MCP', min: 3500, max: 3599, cssClass: 'topo-mcp' },
    { types: ['go', 'rust', 'ruby', 'unknown'], label: 'OTHER', min: 3600, max: 3699, cssClass: 'topo-unknown' },
  ];

  function renderTopology() {
    $topoStrip.innerHTML = TOPO_RANGES.map(range => {
      const rangeProjects = projects.filter(p => p.port && range.types.includes(p.type) && p.port >= range.min && p.port <= range.max);
      const dots = rangeProjects
        .sort((a, b) => a.port - b.port)
        .map(p => `<div class="topo-dot ${p.running ? 'active' : 'inactive'}"
                        data-tooltip="${escapeHtml(p.name)} :${p.port}"></div>`)
        .join('');

      return `
        <div class="topo-range ${range.cssClass}">
          <div class="topo-bar">${dots}</div>
          <span class="topo-label">${range.label} ${rangeProjects.length ? `(${rangeProjects.length})` : ''}</span>
        </div>
      `;
    }).join('');
  }

  // ─── Port Map Screen ───────────────────────────────────

  function switchView(view) {
    currentView = view;
    const showPorts = view === 'ports';
    $main.classList.toggle('hidden', showPorts);
    $topology.classList.toggle('hidden', showPorts);
    $portMapScreen.classList.toggle('hidden', !showPorts);
    $viewServices.classList.toggle('active', !showPorts);
    $viewPorts.classList.toggle('active', showPorts);
    $viewServices.setAttribute('aria-pressed', String(!showPorts));
    $viewPorts.setAttribute('aria-pressed', String(showPorts));
    $search.placeholder = showPorts ? 'Search ports, services, paths...' : 'Search services...';
    if (showPorts) fetchPortMap();
    else render();
  }

  function portEntryMatches(entry) {
    if (portFilter === 'listening' && !entry.listening) return false;
    if (portFilter === 'attention' && !['conflict', 'unmanaged', 'unhealthy', 'starting', 'no-listener'].includes(entry.state)) return false;
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return [entry.port, entry.name, entry.framework, entry.runtime, entry.state, entry.ownership, entry.path, entry.pid]
      .some(value => value !== undefined && String(value).toLowerCase().includes(query));
  }

  function stateClass(entry) {
    if (entry.state === 'conflict' || entry.state === 'unhealthy') return 'attention';
    if (entry.state === 'unmanaged') return 'unmanaged';
    return entry.running ? 'running' : 'stopped';
  }

  function renderPortMap() {
    const summary = portMap.summary || {};
    const cards = [
      ['ASSIGNED', summary.assigned || 0, 'registered ports'],
      ['LISTENING', summary.listening || 0, 'active listeners'],
      ['MANAGED', summary.managed || 0, 'owned listeners'],
      ['UNMANAGED', summary.unmanaged || 0, 'review required'],
      ['CONFLICTS', summary.conflicts || 0, 'blocked actions'],
    ];
    $portSummary.innerHTML = cards.map(([label, value, note]) => `
      <div class="port-stat ${label === 'UNMANAGED' && value ? 'warn' : ''} ${label === 'CONFLICTS' && value ? 'danger' : ''}">
        <span class="port-stat-label">${label}</span>
        <strong>${value}</strong>
        <span>${note}</span>
      </div>
    `).join('');

    const mappedPorts = new Set();
    const rangeMarkup = TOPO_RANGES.map(range => {
      const entries = portMap.entries.filter(entry => entry.port >= range.min && entry.port <= range.max);
      entries.forEach(entry => mappedPorts.add(entry.port));
      const markers = entries.map(entry => {
        const position = ((entry.port - range.min) / (range.max - range.min)) * 100;
        const label = `${entry.name} :${entry.port} · ${entry.state}`;
        return `<button class="range-marker ${stateClass(entry)}" style="left:${position}%" data-port-name="${entry.kind === 'registered' ? escapeHtml(entry.name) : ''}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}"></button>`;
      }).join('');
      return `
        <div class="range-card">
          <div class="range-card-head">
            <span>${escapeHtml(range.label)}</span>
            <span>${range.min}–${range.max} · ${entries.length}</span>
          </div>
          <div class="range-track">${markers}</div>
        </div>
      `;
    }).join('');
    const outside = portMap.entries.filter(entry => !mappedPorts.has(entry.port));
    const outsideMarkup = outside.length ? `
      <div class="range-card outside-range">
        <div class="range-card-head"><span>OTHER LISTENERS</span><span>${outside.length}</span></div>
        <div class="outside-ports">${outside.map(entry => `<span class="outside-port ${stateClass(entry)}">:${entry.port} ${escapeHtml(entry.name)}</span>`).join('')}</div>
      </div>
    ` : '';
    $portRanges.innerHTML = rangeMarkup + outsideMarkup;

    const filtered = portMap.entries.filter(portEntryMatches).sort((left, right) => left.port - right.port || left.name.localeCompare(right.name));
    $portListCount.textContent = `${filtered.length} of ${portMap.entries.length} entries`;
    $portTableBody.innerHTML = filtered.map(entry => `
      <tr class="port-row ${stateClass(entry)}" data-service-name="${entry.kind === 'registered' ? escapeHtml(entry.name) : ''}">
        <td><span class="port-number">:${entry.port}</span></td>
        <td>
          <span class="port-service-name">${escapeHtml(entry.name)}</span>
          <span class="port-kind">${escapeHtml(entry.kind)}</span>
        </td>
        <td>${escapeHtml(entry.framework || entry.runtime || '—')}</td>
        <td><span class="state-pill ${stateClass(entry)}"><span></span>${escapeHtml(entry.state || 'unknown')}</span></td>
        <td>${escapeHtml(entry.ownership || '—')}</td>
        <td class="mono-muted">${entry.pid || '—'}</td>
        <td class="path-cell" title="${escapeHtml(entry.path || '')}">${escapeHtml(entry.path || '—')}</td>
      </tr>
    `).join('') || '<tr><td colspan="7" class="port-empty">No ports match this filter.</td></tr>';

    attachPortMapEvents();
  }

  function attachPortMapEvents() {
    document.querySelectorAll('[data-service-name]').forEach(element => {
      const name = element.dataset.serviceName;
      if (!name) return;
      element.addEventListener('click', () => {
        const project = projects.find(item => item.name === name);
        if (!project) return;
        switchView('services');
        selectProject(project, getFilteredProjects().findIndex(item => item.name === name));
      });
    });
    document.querySelectorAll('[data-port-name]').forEach(element => {
      const name = element.dataset.portName;
      if (!name) return;
      element.addEventListener('click', () => {
        const project = projects.find(item => item.name === name);
        if (!project) return;
        switchView('services');
        selectProject(project, getFilteredProjects().findIndex(item => item.name === name));
      });
    });
  }

  // ─── Particle Background ───────────────────────────────

  function initParticles() {
    const canvas = document.getElementById('particles');
    const ctx = canvas.getContext('2d');
    let particles = [];
    const PARTICLE_COUNT = 60;

    function resize() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    }

    function createParticles() {
      particles = [];
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        particles.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          size: Math.random() * 1.5 + 0.5,
          opacity: Math.random() * 0.25 + 0.05,
          speedX: (Math.random() - 0.5) * 0.15,
          speedY: (Math.random() - 0.5) * 0.1,
          phase: Math.random() * Math.PI * 2,
        });
      }
    }

    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const time = Date.now() * 0.001;

      for (const p of particles) {
        p.x += p.speedX;
        p.y += p.speedY;

        // Wrap around
        if (p.x < 0) p.x = canvas.width;
        if (p.x > canvas.width) p.x = 0;
        if (p.y < 0) p.y = canvas.height;
        if (p.y > canvas.height) p.y = 0;

        // Breathe opacity
        const breathe = Math.sin(time + p.phase) * 0.1 + p.opacity;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(100, 200, 255, ${breathe})`;
        ctx.fill();
      }

      requestAnimationFrame(draw);
    }

    resize();
    createParticles();
    draw();
    window.addEventListener('resize', () => {
      resize();
      createParticles();
    });
  }

  // ─── Keyboard Navigation ───────────────────────────────

  function initKeyboard() {
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !$metadataForm.classList.contains('hidden')) {
        e.preventDefault();
        closeMetadataEditor();
        return;
      }
      // Focus search on /
      if (e.key === '/' && document.activeElement !== $search) {
        e.preventDefault();
        $search.focus();
        return;
      }

      // Escape clears search or deselects
      if (e.key === 'Escape') {
        if (document.activeElement === $search) {
          $search.value = '';
          $search.blur();
          searchQuery = '';
          render();
        } else {
          selectedProject = null;
          selectedIndex = -1;
          clearInterval(logPollTimer);
          logRequestId += 1;
          $detailEmpty.classList.remove('hidden');
          $detailContent.classList.add('hidden');
          renderProjectList();
        }
        return;
      }

      // Don't intercept while editing fields or operating buttons.
      if (e.target.closest('input, textarea, select, button')) return;

      if (e.key === '1') {
        switchView('services');
        return;
      }
      if (e.key === '2') {
        switchView('ports');
        return;
      }

      if (currentView !== 'services') return;

      const filtered = getFilteredProjects();

      // Arrow navigation
      if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault();
        selectedIndex = Math.min(selectedIndex + 1, filtered.length - 1);
        if (filtered[selectedIndex]) selectProject(filtered[selectedIndex], selectedIndex);
      }

      if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault();
        selectedIndex = Math.max(selectedIndex - 1, 0);
        if (filtered[selectedIndex]) selectProject(filtered[selectedIndex], selectedIndex);
      }

      // Enter: toggle start/stop
      if (e.key === 'Enter' && selectedProject) {
        e.preventDefault();
        if (selectedProject.running) {
          apiStop(selectedProject.name);
        } else {
          apiStart(selectedProject.name);
        }
      }

      // o: open in browser
      if (e.key === 'o' && selectedProject && (selectedProject.running || selectedProject.runtime === 'remote')) {
        window.open(serviceUrl(selectedProject), '_blank', 'noopener');
      }

      // d: open deployment
      if (e.key === 'd' && selectedProject && selectedProject.deployments) {
        const firstUrl = Object.values(selectedProject.deployments)[0];
        if (firstUrl) window.open(firstUrl, '_blank');
      }

      // g: inspect unmanaged listeners
      if (e.key === 'g') {
        apiGC();
      }
    });
  }

  // ─── Event Handlers ─────────────────────────────────────

  function initEvents() {
    // Search
    $search.addEventListener('input', (e) => {
      searchQuery = e.target.value;
      render();
    });

    // Action buttons
    $btnStart.addEventListener('click', () => {
      if (selectedProject) apiStart(selectedProject.name);
    });

    $btnStop.addEventListener('click', () => {
      if (selectedProject) apiStop(selectedProject.name);
    });

    $btnOpen.addEventListener('click', () => {
      if (selectedProject) {
        window.open(serviceUrl(selectedProject), '_blank', 'noopener');
      }
    });
    $btnEdit.addEventListener('click', () => {
      if (!selectedProject) return;
      if ($metadataForm.classList.contains('hidden')) openMetadataEditor(selectedProject);
      else closeMetadataEditor();
    });
    $metadataForm.addEventListener('submit', apiUpdateMetadata);
    $btnCancelMetadata.addEventListener('click', closeMetadataEditor);

    $btnStopAll.addEventListener('click', apiStopAll);
    $btnGC.addEventListener('click', apiGC);
    $viewServices.addEventListener('click', () => switchView('services'));
    $viewPorts.addEventListener('click', () => switchView('ports'));
    $btnRefreshPorts.addEventListener('click', fetchPortMap);
    $btnRefreshOutput.addEventListener('click', () => {
      if (selectedProject) void fetchProjectLogs(selectedProject.name);
    });
    document.querySelectorAll('[data-port-filter]').forEach(button => {
      button.addEventListener('click', () => {
        portFilter = button.dataset.portFilter;
        document.querySelectorAll('[data-port-filter]').forEach(item => item.classList.toggle('active', item === button));
        renderPortMap();
      });
    });
  }

  // ─── Helpers ────────────────────────────────────────────

  function serviceUrl(project) {
    return project.devUrl || `http://localhost:${project.port}`;
  }

  function escapeHtml(str) {
    if (str === undefined || str === null) return '';
    return String(str).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c])
    );
  }

  // ─── Initialize ─────────────────────────────────────────

  function init() {
    initParticles();
    initKeyboard();
    initEvents();
    fetchProjects();
    connectWebSocket();
  }

  // Boot
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
