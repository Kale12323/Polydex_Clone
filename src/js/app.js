/* ============================================================
   POLYDEX — Material Intelligence Workbench
   Renderer application logic
   ============================================================ */

const { groupTexturesIntoMaterials, autoTagMaterial, identifyMapType } = require('../../autoTagger');
const { PBR_PRESETS } = require('../../pbrGenerator');
const THREE = require('three');

// -----------------------------------------------------------
// State
// -----------------------------------------------------------
const state = {
  activeTab: 'tab-index',
  selectedAsset: null,
  assets: [],
  filteredAssets: [],
  category: 'all',
  activeTags: new Set(),
  searchQuery: '',
  sortMode: 'name',
  threshold: 80,
  importDir: '',
  importMaterials: [],
  ollamaOnline: false,
  ollamaModels: [],
  ollamaModel: '',
  previewRenderers: new Map(),
  inspectorRenderer: null,
  inspectorScene: null,
  terminal: null,
  terminalOpen: false
};

// -----------------------------------------------------------
// DOM helpers
// -----------------------------------------------------------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

function toast(msg, type = '') {
  let container = $('#toast-container');
  if (!container) {
    container = el('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  const t = el('div', `toast ${type}`, msg);
  container.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 300); }, 3000);
}

function termLog(msg) {
  if (state.terminal) {
    state.terminal.writeln(`\x1b[33m${new Date().toLocaleTimeString()}\x1b[0m ${msg}`);
  }
  console.log(`[term] ${msg}`);
}

// -----------------------------------------------------------
// Window controls
// -----------------------------------------------------------
function initWindowControls() {
  $('#btn-min')?.addEventListener('click', () => window.electron?.ipcSend('window-min'));
  $('#btn-max')?.addEventListener('click', () => window.electron?.ipcSend('window-max'));
  $('#btn-close')?.addEventListener('click', () => window.electron?.ipcSend('window-close'));
}

// -----------------------------------------------------------
// Tab navigation
// -----------------------------------------------------------
const TAB_TITLES = {
  'tab-index': { title: 'Overview', subtitle: 'Material Intelligence Workbench' },
  'tab-library': { title: 'Library', subtitle: 'Indexed Materials' },
  'tab-autotag': { title: 'Auto-Tag', subtitle: 'Neural PBR Tagging Pipeline' },
  'tab-import': { title: 'Import', subtitle: 'Batch PBR Renaming & Ingest' }
};

function switchTab(tabId) {
  state.activeTab = tabId;
  $$('.view-panel').forEach(p => p.classList.toggle('active', p.id === tabId));
  $$('.rail-item[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
  const info = TAB_TITLES[tabId] || { title: '', subtitle: '' };
  $('#main-title').textContent = info.title;
  $('#main-subtitle').textContent = info.subtitle;
  renderPanelContent();
  // Dispose old preview renderers when leaving library
  if (tabId !== 'tab-library') disposePreviewRenderers();
  if (tabId !== 'tab-import') disposePreviewRenderers();
}

function initTabs() {
  $$('.rail-item[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}

// -----------------------------------------------------------
// Secondary panel content (contextual)
// -----------------------------------------------------------
function renderPanelContent() {
  const c = $('#panel-content');
  if (!c) return;
  c.innerHTML = '';
  if (state.activeTab === 'tab-library') {
    c.appendChild(el('div', 'side-section', '<h4>Quick Filters</h4>'));
    const wrap = el('div', 'side-section');
    const inp = el('input');
    inp.type = 'search';
    inp.placeholder = 'Filter...';
    inp.value = state.searchQuery;
    inp.addEventListener('input', () => { state.searchQuery = inp.value; applyFilters(); });
    wrap.appendChild(inp);
    c.appendChild(wrap);
  } else if (state.activeTab === 'tab-import') {
    const sec = el('div', 'side-section');
    sec.innerHTML = '<h4>Import Status</h4>';
    const row = el('div', 'spec-row', `<span>Materials</span><span class="val">${state.importMaterials.length}</span>`);
    sec.appendChild(row);
    c.appendChild(sec);
  } else {
    c.appendChild(el('div', 'inspector-empty', 'Context panel'));
  }
}

// -----------------------------------------------------------
// Library: build assets from presets + auto-tag
// -----------------------------------------------------------
function buildAssetLibrary() {
  state.assets = PBR_PRESETS.map(preset => {
    const mat = {
      id: preset.id,
      name: preset.name,
      rawKey: preset.id,
      maps: { albedo: true, normal: true, roughness: true, metallic: preset.metallic > 0, ao: true },
      files: [],
      resolution: preset.resolution,
      format: preset.format,
      tags: [],
      category: preset.category,
      confidence: 0,
      type: preset.type,
      baseColor: preset.baseColor,
      secondaryColor: preset.secondaryColor,
      roughness: preset.roughness,
      metallic: preset.metallic
    };
    const result = autoTagMaterial(mat, { threshold: state.threshold });
    mat.category = result.category !== 'misc' ? result.category : preset.category;
    mat.tags = result.tagList;
    mat.confidence = result.confidenceAvg;
    return mat;
  });
  applyFilters();
}

function applyFilters() {
  let list = state.assets.slice();
  if (state.category !== 'all') {
    list = list.filter(a => a.category === state.category);
  }
  if (state.activeTags.size > 0) {
    list = list.filter(a => state.activeTags.has(a.category) || a.tags.some(t => state.activeTags.has(t)));
  }
  if (state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    list = list.filter(a => a.name.toLowerCase().includes(q) || a.tags.some(t => t.includes(q)) || a.category.includes(q));
  }
  if (state.sortMode === 'name') list.sort((a, b) => a.name.localeCompare(b.name));
  else if (state.sortMode === 'size') list.sort((a, b) => (b.resolution || '').localeCompare(a.resolution || ''));
  else list.sort((a, b) => b.confidence - a.confidence);
  state.filteredAssets = list;
  renderGrid();
  renderTagCloud();
}

function renderGrid() {
  const grid = $('#assetGrid');
  const count = $('#gridCount');
  if (!grid) return;
  grid.innerHTML = '';
  if (count) count.textContent = state.filteredAssets.length;
  if (state.filteredAssets.length === 0) {
    grid.appendChild(el('div', 'grid-empty', 'No materials match the current filters.'));
    return;
  }
  state.filteredAssets.forEach(asset => {
    const card = el('div', 'asset-card');
    if (state.selectedAsset && state.selectedAsset.id === asset.id) card.classList.add('selected');
    card.addEventListener('click', () => selectAsset(asset));

    const thumb = el('div', 'asset-thumb');
    const canvas = el('canvas');
    thumb.appendChild(canvas);
    const badge = el('div', 'asset-badge', asset.resolution);
    thumb.appendChild(badge);
    card.appendChild(thumb);

    const body = el('div', 'asset-body');
    body.appendChild(el('div', 'asset-name', asset.name));
    body.appendChild(el('div', 'asset-meta', `<span>${asset.category}</span><span>·</span><span>${asset.format}</span>`));
    const tags = el('div', 'asset-tags');
    asset.tags.slice(0, 4).forEach(t => tags.appendChild(el('span', 'tag-chip', t)));
    card.appendChild(body);
    grid.appendChild(card);

    // Defer 3D preview rendering
    requestAnimationFrame(() => renderAssetPreview(canvas, asset));
  });
}

function renderTagCloud() {
  const cloud = $('#tagCloud');
  if (!cloud) return;
  cloud.innerHTML = '';
  const tagSet = new Set();
  state.assets.forEach(a => { tagSet.add(a.category); a.tags.forEach(t => tagSet.add(t)); });
  Array.from(tagSet).sort().slice(0, 24).forEach(t => {
    const chip = el('span', 'tag-chip' + (state.activeTags.has(t) ? ' active' : ''), t);
    chip.addEventListener('click', () => {
      if (state.activeTags.has(t)) state.activeTags.delete(t);
      else state.activeTags.add(t);
      applyFilters();
    });
    cloud.appendChild(chip);
  });
}

// -----------------------------------------------------------
// 3D asset preview (sphere with PBR-ish material)
// -----------------------------------------------------------
function renderAssetPreview(canvas, asset) {
  if (!canvas || !asset) return;
  try {
    const w = canvas.clientWidth || 200;
    const h = canvas.clientHeight || 200;
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setSize(w, h, false);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, w / h, 0.1, 100);
    camera.position.set(0, 0, 3.2);

    const baseColor = new THREE.Color(asset.baseColor || '#888888');
    const geo = new THREE.SphereGeometry(1, 48, 48);
    const mat = new THREE.MeshStandardMaterial({
      color: baseColor,
      roughness: asset.roughness !== undefined ? asset.roughness : 0.5,
      metalness: asset.metallic !== undefined ? asset.metallic : 0.0
    });
    const mesh = new THREE.Mesh(geo, mat);
    scene.add(mesh);

    const ambient = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(ambient);
    const key = new THREE.DirectionalLight(0xffeedd, 1.2);
    key.position.set(2, 2, 3);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xff6b00, 0.6);
    rim.position.set(-2, -1, -2);
    scene.add(rim);

    let raf;
    let angle = 0;
    function loop() {
      angle += 0.008;
      mesh.rotation.y = angle;
      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    }
    loop();

    state.previewRenderers.set(canvas, { renderer, raf });
  } catch (e) {
    showFallback(canvas);
  }
}

function showFallback(canvas) {
  if (!canvas) return;
  const parent = canvas.parentElement;
  if (!parent) return;
  parent.innerHTML = '<div class="asset-thumb-fallback"><span>PBR</span></div>';
}

function disposePreviewRenderers() {
  state.previewRenderers.forEach(({ renderer, raf }) => {
    cancelAnimationFrame(raf);
    try { renderer.dispose(); } catch (e) {}
  });
  state.previewRenderers.clear();
}

// -----------------------------------------------------------
// Library filters
// -----------------------------------------------------------
function initLibraryFilters() {
  $$('#catList button').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('#catList button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.category = btn.dataset.cat;
      applyFilters();
    });
  });
  const search = $('#searchInput');
  if (search) search.addEventListener('input', () => { state.searchQuery = search.value; applyFilters(); });
  const topSearch = $('#topSearch');
  if (topSearch) topSearch.addEventListener('input', () => { state.searchQuery = topSearch.value; applyFilters(); });
  const sortSel = $('#sortSelect');
  if (sortSel) sortSel.addEventListener('change', () => { state.sortMode = sortSel.value; applyFilters(); });
  const thr = $('#threshold');
  if (thr) thr.addEventListener('input', () => {
    state.threshold = parseInt(thr.value);
    const tv = $('#thresholdValue');
    const tv2 = $('#thresholdValue2');
    if (tv) tv.textContent = state.threshold + '%';
    if (tv2) tv2.textContent = state.threshold + '%';
    buildAssetLibrary();
  });
}

// -----------------------------------------------------------
// Inspector
// -----------------------------------------------------------
function selectAsset(asset) {
  state.selectedAsset = asset;
  $$('.asset-card').forEach(c => c.classList.remove('selected'));
  renderInspector();
}

function renderInspector() {
  const c = $('#inspector-content');
  if (!c) return;
  c.innerHTML = '';
  if (!state.selectedAsset) {
    c.appendChild(el('div', 'inspector-empty', 'Select an asset to inspect'));
    return;
  }
  const a = state.selectedAsset;

  const preview = el('div', 'insp-preview');
  const canvas = el('canvas');
  preview.appendChild(canvas);
  c.appendChild(preview);

  const sec1 = el('div', 'insp-section');
  sec1.appendChild(el('div', 'insp-name', a.name));
  sec1.appendChild(el('div', 'insp-cat', a.category));
  c.appendChild(sec1);

  const sec2 = el('div', 'insp-section');
  sec2.appendChild(el('h5', '', 'Properties'));
  const grid = el('div', 'insp-grid');
  grid.appendChild(field('Resolution', a.resolution));
  grid.appendChild(field('Format', a.format));
  grid.appendChild(field('Confidence', a.confidence + '%'));
  grid.appendChild(field('Workflow', a.metallic > 0 ? 'Metallic' : 'Dielectric'));
  sec2.appendChild(grid);
  c.appendChild(sec2);

  const sec3 = el('div', 'insp-section');
  sec3.appendChild(el('h5', '', 'Map Channels'));
  const maps = el('div', 'insp-maps');
  ['albedo', 'normal', 'roughness', 'metallic', 'ao', 'displacement'].forEach(ch => {
    const has = !!(a.maps && a.maps[ch]);
    maps.appendChild(el('div', 'insp-map-row', `<span class="${has ? 'ch' : 'missing'}">${ch.toUpperCase()}</span><span class="${has ? '' : 'missing'}">${has ? '✓' : '—'}</span>`));
  });
  sec3.appendChild(maps);
  c.appendChild(sec3);

  const sec4 = el('div', 'insp-section');
  sec4.appendChild(el('h5', '', 'Tags'));
  const tags = el('div', 'insp-tags');
  a.tags.forEach(t => tags.appendChild(el('span', 'tag-chip', t)));
  sec4.appendChild(tags);
  c.appendChild(sec4);

  const sec5 = el('div', 'insp-section');
  const actions = el('div', 'insp-actions');
  actions.appendChild(el('button', 'btn ghost', 'Open Folder'));
  actions.appendChild(el('button', 'btn', 'Export'));
  sec5.appendChild(actions);
  c.appendChild(sec5);

  requestAnimationFrame(() => renderInspectorPreview(canvas, a));
}

function field(label, val) {
  const f = el('div', 'insp-field');
  f.appendChild(el('label', '', label));
  f.appendChild(el('span', '', String(val)));
  return f;
}

function renderInspectorPreview(canvas, asset) {
  if (!canvas) return;
  try {
    const w = canvas.clientWidth || 280;
    const h = canvas.clientHeight || 280;
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setSize(w, h, false);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, w / h, 0.1, 100);
    camera.position.set(0, 0, 3.5);

    const baseColor = new THREE.Color(asset.baseColor || '#888888');
    const geo = new THREE.SphereGeometry(1, 64, 64);
    const mat = new THREE.MeshStandardMaterial({
      color: baseColor,
      roughness: asset.roughness !== undefined ? asset.roughness : 0.5,
      metalness: asset.metallic !== undefined ? asset.metallic : 0.0
    });
    const mesh = new THREE.Mesh(geo, mat);
    scene.add(mesh);

    scene.add(new THREE.AmbientLight(0xffffff, 0.35));
    const key = new THREE.DirectionalLight(0xffeedd, 1.3);
    key.position.set(2, 2, 3);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xff6b00, 0.7);
    rim.position.set(-2, -1, -2);
    scene.add(rim);

    let raf, angle = 0;
    function loop() {
      angle += 0.006;
      mesh.rotation.y = angle;
      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    }
    loop();
    state.inspectorRenderer = { renderer, raf };
  } catch (e) {
    showFallback(canvas);
  }
}

function disposeInspectorRenderer() {
  if (state.inspectorRenderer) {
    cancelAnimationFrame(state.inspectorRenderer.raf);
    try { state.inspectorRenderer.renderer.dispose(); } catch (e) {}
    state.inspectorRenderer = null;
  }
}

// -----------------------------------------------------------
// Terminal drawer
// -----------------------------------------------------------
function initTerminal() {
  const btn = $('#btn-terminal');
  const container = $('#terminal-container');
  const closeBtn = $('#terminal-close');
  if (btn) btn.addEventListener('click', () => toggleTerminal());
  if (closeBtn) closeBtn.addEventListener('click', () => toggleTerminal(false));
}

function toggleTerminal(open) {
  const container = $('#terminal-container');
  if (!container) return;
  state.terminalOpen = open !== undefined ? open : !state.terminalOpen;
  container.classList.toggle('open', state.terminalOpen);
  if (state.terminalOpen && !state.terminal) initTerminalInstance();
  if (state.terminalOpen) {
    const rail = $('#btn-terminal');
    if (rail) rail.classList.add('active');
  } else {
    const rail = $('#btn-terminal');
    if (rail) rail.classList.remove('active');
  }
}

function initTerminalInstance() {
  try {
    const Terminal = require('xterm').Terminal;
    state.terminal = new Terminal({
      theme: {
        background: '#0e120e',
        foreground: '#a7b0a3',
        cursor: '#ff6b00',
        selection: '#ff6b0044'
      },
      fontFamily: 'Consolas, monospace',
      fontSize: 12,
      cursorBlink: true
    });
    state.terminal.open($('#terminal'));
    state.terminal.writeln('\x1b[33mPOLYDEX\x1b[0m Material Intelligence Workbench v1.0.0');
    state.terminal.writeln('Type "help" for available commands.');
    state.terminal.writeln('');
    prompt();
    state.terminal.onData(data => handleTerminalInput(data));
  } catch (e) {
    console.error('Terminal init failed', e);
  }
}

let termInputBuffer = '';
function prompt() {
  if (state.terminal) state.terminal.write('\x1b[33m$\x1b[0m ');
}
function handleTerminalInput(data) {
  if (!state.terminal) return;
  for (const ch of data) {
    const code = ch.charCodeAt(0);
    if (code === 13) {
      state.terminal.writeln('');
      processCommand(termInputBuffer.trim());
      termInputBuffer = '';
      prompt();
    } else if (code === 127) {
      if (termInputBuffer.length > 0) {
        termInputBuffer = termInputBuffer.slice(0, -1);
        state.terminal.write('\b \b');
      }
    } else if (code >= 32) {
      termInputBuffer += ch;
      state.terminal.write(ch);
    }
  }
}
function processCommand(cmd) {
  if (!cmd) return;
  const parts = cmd.split(/\s+/);
  const cmdName = parts[0].toLowerCase();
  switch (cmdName) {
    case 'help':
      state.terminal.writeln('Commands: help, status, scan <dir>, tags, assets, clear, exit');
      break;
    case 'status':
      state.terminal.writeln(`Assets indexed: ${state.assets.length}`);
      state.terminal.writeln(`Ollama: ${state.ollamaOnline ? 'ONLINE' : 'OFFLINE'}`);
      state.terminal.writeln(`Import materials: ${state.importMaterials.length}`);
      break;
    case 'assets':
      state.assets.forEach((a, i) => state.terminal.writeln(`  ${String(i).padStart(2, '0')} ${a.name} [${a.category}]`));
      break;
    case 'tags':
      state.assets.forEach(a => state.terminal.writeln(`  ${a.name}: ${a.tags.join(', ')}`));
      break;
    case 'scan':
      if (parts[1]) { state.terminal.writeln(`Scanning ${parts[1]}...`); scanFolder(parts[1]); }
      else state.terminal.writeln('Usage: scan <directory>');
      break;
    case 'clear':
      state.terminal.clear();
      break;
    case 'exit':
      toggleTerminal(false);
      break;
    default:
      state.terminal.writeln(`Unknown command: ${cmdName}`);
  }
}

// -----------------------------------------------------------
// Modals
// -----------------------------------------------------------
function initModals() {
  const settingsBtn = $('#main-settings');
  const railSettings = $('#rail-settings');
  const settingsModal = $('#settingsModal');
  const closeSettings = $('#btnCloseSettings');
  const cancelSettings = $('#btnCancelSettings');
  const saveSettings = $('#btnSaveSettings');

  const openSettings = () => settingsModal.classList.add('open');
  const closeSettingsModal = () => settingsModal.classList.remove('open');
  settingsBtn?.addEventListener('click', openSettings);
  railSettings?.addEventListener('click', openSettings);
  closeSettings?.addEventListener('click', closeSettingsModal);
  cancelSettings?.addEventListener('click', closeSettingsModal);
  saveSettings?.addEventListener('click', () => {
    closeSettingsModal();
    toast('Settings saved', 'success');
  });
  settingsModal?.addEventListener('click', (e) => { if (e.target === settingsModal) closeSettingsModal(); });

  const accountBtn = $('.rail-item.user');
  const accountModal = $('#accountModal');
  const closeAccount = $('#btnCloseAccount');
  const doneAccount = $('#btnDoneAccount');
  accountBtn?.addEventListener('click', () => accountModal.classList.add('open'));
  closeAccount?.addEventListener('click', () => accountModal.classList.remove('open'));
  doneAccount?.addEventListener('click', () => accountModal.classList.remove('open'));
  accountModal?.addEventListener('click', (e) => { if (e.target === accountModal) accountModal.classList.remove('open'); });

  const refresh = $('#main-refresh');
  refresh?.addEventListener('click', () => { buildAssetLibrary(); toast('Library refreshed'); });
  const btnRefresh = $('#btnRefresh');
  btnRefresh?.addEventListener('click', () => { buildAssetLibrary(); toast('Library refreshed'); });
  const btnSettings = $('#btnSettings');
  btnSettings?.addEventListener('click', openSettings);
}

// -----------------------------------------------------------
// Import tab
// -----------------------------------------------------------
function initImport() {
  $('#btnPickFolder')?.addEventListener('click', pickFolder);
  $('#btnRescan')?.addEventListener('click', () => { if (state.importDir) scanFolder(state.importDir); else toast('Choose a folder first', 'warning'); });
  $('#btnGenerateAI')?.addEventListener('click', generateWithAI);
  $('#btnApplyRenames')?.addEventListener('click', applyRenames);
  $('#btnOpenFolder')?.addEventListener('click', () => { if (state.importDir) window.electron?.ipcInvoke('open-path', state.importDir); });
}

async function pickFolder() {
  const dir = await window.electron?.ipcInvoke('select-folder');
  if (!dir) return;
  state.importDir = dir;
  const inp = $('#importDir');
  if (inp) { inp.value = dir; }
  termLog(`Folder selected: ${dir}`);
  await scanFolder(dir);
}

async function scanFolder(dir) {
  setProgress('Scanning directory...');
  termLog(`Scanning ${dir}`);
  const result = await window.electron?.ipcInvoke('scan-directory', dir);
  if (!result || result.error) {
    setProgress('Scan failed: ' + (result?.error || 'unknown'));
    toast('Scan failed: ' + (result?.error || 'unknown'), 'error');
    return;
  }
  const files = result.files || [];
  if (files.length === 0) {
    setProgress('No texture files found.');
    state.importMaterials = [];
    renderImportTable();
    return;
  }
  const materials = groupTexturesIntoMaterials(files);
  materials.forEach(m => {
    const tagResult = autoTagMaterial(m, { threshold: state.threshold });
    m.category = tagResult.category;
    m.tags = tagResult.tagList;
    m.confidence = tagResult.confidenceAvg;
    m.heuristicTags = tagResult.tagList;
    m.proposedName = null;
    m.aiName = null;
    m.aiCategory = null;
    m.aiTags = null;
  });
  state.importMaterials = materials;
  setProgress(`Found ${materials.length} material sets from ${files.length} textures.`);
  termLog(`Found ${materials.length} materials, ${files.length} files`);
  renderImportTable();
}

function setProgress(msg, busy) {
  const p = $('#importProgress');
  if (p) { p.textContent = msg; p.classList.toggle('busy', !!busy); }
  const mode = $('#importMode');
  if (mode) mode.textContent = busy ? '● AI PROCESSING' : '● HEURISTIC';
}

function renderImportTable() {
  const table = $('#importTable');
  const count = $('#importCount');
  if (!table) return;
  table.innerHTML = '';
  if (count) count.textContent = state.importMaterials.length;
  if (state.importMaterials.length === 0) {
    table.appendChild(el('div', 'grid-empty', 'Nothing imported yet — choose a texture folder above.'));
    return;
  }
  state.importMaterials.forEach((mat, idx) => {
    const row = el('div', 'import-row');

    const head = el('div', 'import-row-head');
    head.appendChild(el('div', 'mat-name', mat.name));
    head.appendChild(el('div', '', `${mat.files.length} files · ${mat.resolution} · ${mat.category}`));
    row.appendChild(head);

    const channels = el('div', 'import-channels');
    ['albedo', 'normal', 'roughness', 'metallic', 'ao', 'displacement'].forEach(ch => {
      const has = !!(mat.maps && mat.maps[ch]);
      channels.appendChild(el('span', 'channel-pill' + (has ? ' has' : ''), ch));
    });
    row.appendChild(channels);

    const renameCol = el('div', 'import-rename');
    const displayName = mat.aiName || mat.proposedName || mat.name;
    const sep = $('#optSeparator')?.value || '_';
    const caseMode = $('#optCase')?.value || 'pascal';
    const includeMap = $('#optMapSuffix')?.value !== 'off';
    const includeRes = $('#optResSuffix')?.value !== 'off';
    mat.files.forEach(f => {
      const mapType = identifyMapType(f.name);
      const newName = buildRename(displayName, mapType, mat.resolution, sep, caseMode, includeMap, includeRes);
      const line = el('div', 'rename-line');
      line.appendChild(el('span', 'from', f.name));
      line.appendChild(el('span', 'arrow', '→'));
      line.appendChild(el('span', 'to', newName));
      renameCol.appendChild(line);
    });
    row.appendChild(renameCol);

    table.appendChild(row);
  });
}

function buildRename(baseName, mapType, resolution, sep, caseMode, includeMap, includeRes) {
  let name = baseName;
  if (caseMode === 'snake') name = name.replace(/\s+/g, '_').toLowerCase();
  else if (caseMode === 'lower') name = name.replace(/\s+/g, sep).toLowerCase();
  else name = name.replace(/\s+/g, sep);
  const parts = [name];
  if (includeMap && mapType !== 'unknown') parts.push(mapType);
  if (includeRes && resolution) parts.push(resolution.toLowerCase());
  return parts.join(sep) + '.png';
}

async function generateWithAI() {
  if (state.importMaterials.length === 0) { toast('Scan a folder first', 'warning'); return; }
  if (!state.ollamaOnline) { toast('Ollama is offline. Start the local Ollama service to use AI.', 'error'); return; }
  const model = $('#ollamaModel')?.value || state.ollamaModel;
  if (!model) { toast('No model selected', 'warning'); return; }
  setProgress('Generating AI names...', true);
  termLog(`AI generate with model ${model} on ${state.importMaterials.length} materials`);
  let done = 0;
  for (const mat of state.importMaterials) {
    try {
      const res = await window.electron?.ipcInvoke('ollama-generate', { model, item: mat });
      if (res && res.ok) {
        mat.aiName = res.name;
        mat.aiCategory = res.category;
        mat.aiTags = res.tags;
        mat.name = res.name;
        if (res.category && res.category !== 'misc') mat.category = res.category;
        if (res.tags && res.tags.length) mat.tags = res.tags;
      }
    } catch (e) {}
    done++;
    setProgress(`AI generating... ${done}/${state.importMaterials.length}`, true);
  }
  setProgress(`AI naming complete for ${done} materials.`);
  renderImportTable();
  toast('AI naming complete', 'success');
}

async function applyRenames() {
  if (state.importMaterials.length === 0) { toast('Nothing to rename', 'warning'); return; }
  if (!state.importDir) { toast('No folder selected', 'warning'); return; }
  const sep = $('#optSeparator')?.value || '_';
  const caseMode = $('#optCase')?.value || 'pascal';
  const includeMap = $('#optMapSuffix')?.value !== 'off';
  const includeRes = $('#optResSuffix')?.value !== 'off';
  const renames = [];
  state.importMaterials.forEach(mat => {
    const displayName = mat.aiName || mat.proposedName || mat.name;
    mat.files.forEach(f => {
      const mapType = identifyMapType(f.name);
      const newName = buildRename(displayName, mapType, mat.resolution, sep, caseMode, includeMap, includeRes);
      if (f.name !== newName) renames.push({ from: f.name, to: newName });
    });
  });
  if (renames.length === 0) { toast('No renames needed', 'warning'); return; }
  setProgress(`Applying ${renames.length} renames...`, true);
  termLog(`Applying ${renames.length} renames`);
  const result = await window.electron?.ipcInvoke('rename-files', { dir: state.importDir, renames });
  if (!result) { setProgress('Rename failed'); toast('Rename failed', 'error'); return; }
  const ok = (result.results || []).filter(r => r.ok).length;
  const fail = (result.results || []).filter(r => !r.ok).length;
  setProgress(`Renamed ${ok} files, ${fail} failed.`);
  toast(`${ok} files renamed${fail ? `, ${fail} failed` : ''}`, fail ? 'warning' : 'success');
  if (state.importDir) await scanFolder(state.importDir);
}

// -----------------------------------------------------------
// Ollama status
// -----------------------------------------------------------
async function checkOllama() {
  const res = await window.electron?.ipcInvoke('ollama-status');
  const pill = $('#ollamaStatus');
  const sel = $('#ollamaModel');
  if (!res) return;
  state.ollamaOnline = res.online;
  state.ollamaModels = res.models || [];
  if (pill) {
    pill.textContent = res.online ? '● ONLINE' : '○ OFFLINE';
    pill.className = 'status-pill ' + (res.online ? 'online' : 'offline');
  }
  if (sel) {
    sel.innerHTML = '';
    if (res.online && state.ollamaModels.length > 0) {
      state.ollamaModels.forEach(m => {
        const opt = el('option', '', m);
        opt.value = m;
        sel.appendChild(opt);
      });
      state.ollamaModel = state.ollamaModels[0];
    } else {
      sel.appendChild(el('option', '', '— offline —'));
    }
  }
  termLog(`Ollama ${res.online ? 'online' : 'offline'}${res.online ? ` (${state.ollamaModels.length} models)` : ''}`);
}

// -----------------------------------------------------------
// Electron bridge
// -----------------------------------------------------------
function ensureElectronBridge() {
  if (window.electron) return;
  // nodeIntegration is true, so we can build a minimal bridge
  try {
    const { ipcRenderer } = require('electron');
    window.electron = {
      ipcSend: (ch, ...args) => ipcRenderer.send(ch, ...args),
      ipcInvoke: (ch, ...args) => ipcRenderer.invoke(ch, ...args)
    };
  } catch (e) {
    console.error('Failed to create electron bridge', e);
  }
}

// -----------------------------------------------------------
// Init
// -----------------------------------------------------------
function init() {
  ensureElectronBridge();
  initWindowControls();
  initTabs();
  initLibraryFilters();
  initTerminal();
  initModals();
  initImport();
  buildAssetLibrary();
  checkOllama();
  termLog('POLYDEX initialized');
}

document.addEventListener('DOMContentLoaded', init);
