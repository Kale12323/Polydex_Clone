const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { groupTexturesIntoMaterials } = require('./autoTagger');

const OLLAMA_BASE = 'http://localhost:11434';

function fetchWithTimeout(url, options = {}, timeoutMs = 3000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

let win;

function createWindow () {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 650,
    frame: false, // Custom terminal titlebar
    backgroundColor: '#0a0d0a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  win.loadFile('index.html');

  win.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[Renderer] ${message} (at ${sourceId}:${line})`);
  });

  // IPC handlers for window controls
  ipcMain.on('window-min', () => win.minimize());
  ipcMain.on('window-max', () => {
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.on('window-close', () => win.close());

  // IPC handler to open folder picker
  ipcMain.handle('select-folder', async () => {
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
      title: 'Select PBR Materials / Textures Directory'
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0];
  });

  // IPC handler to scan folder for textures
  ipcMain.handle('scan-directory', async (event, dirPath) => {
    try {
      if (!fs.existsSync(dirPath)) return { error: 'Path does not exist' };
      const files = scanDirRecursive(dirPath, 3);
      return { path: dirPath, files };
    } catch (err) {
      return { error: err.message };
    }
  });

  // Open directory in native file explorer
  ipcMain.handle('open-path', async (event, targetPath) => {
    if (fs.existsSync(targetPath)) {
      if (fs.statSync(targetPath).isDirectory()) {
        shell.openPath(targetPath);
      } else {
        shell.showItemInFolder(targetPath);
      }
      return true;
    }
    return false;
  });

  // Save file dialog
  ipcMain.handle('save-file-dialog', async (event, { defaultName, content, ext }) => {
    const result = await dialog.showSaveDialog(win, {
      defaultPath: defaultName || `polydex_export.${ext || 'txt'}`,
      filters: [{ name: 'Export File', extensions: [ext || 'txt', 'py', 'json', 'bat'] }]
    });
    if (!result.canceled && result.filePath) {
      fs.writeFileSync(result.filePath, content, 'utf8');
      return result.filePath;
    }
    return null;
  });

  // ---------- Import tab: local Ollama model + PBR renaming ----------

  // Check Ollama availability and list installed models
  ipcMain.handle('ollama-status', async () => {
    try {
      const res = await fetchWithTimeout(`${OLLAMA_BASE}/api/tags`, {}, 3000);
      if (!res.ok) return { online: false, models: [], error: `HTTP ${res.status}` };
      const data = await res.json();
      const models = (data.models || []).map(m => m.name);
      return { online: true, models };
    } catch (err) {
      return { online: false, models: [], error: err.message };
    }
  });

  // Ask the local Ollama model to propose a clean PBR name/category/tags for one material
  ipcMain.handle('ollama-generate', async (event, { model, item }) => {
    const prompt = [
      'You are a PBR material librarian. Given a texture set description, propose a clean material name.',
      'Respond ONLY with minified JSON, no markdown, in this exact shape:',
      '{"name":"<2-4 word Pascal Case material name>","category":"<one of: wood, metal, stone, fabric, concrete, ground, brick, ceramic, plastic, scifi, misc>","tags":["<3-8 lowercase descriptor tags>"]}',
      '',
      `Folder/filename context: ${item.rawKey}`,
      `Texture files: ${item.files.map(f => f.name).join(', ')}`,
      `Channels present: ${Object.keys(item.maps || {}).join(', ') || 'unknown'}`,
      `Heuristic tags: ${(item.heuristicTags || []).join(', ')}`
    ].join('\n');

    try {
      const res = await fetchWithTimeout(`${OLLAMA_BASE}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: model || 'llama3.2',
          prompt,
          stream: false,
          format: 'json',
          options: { temperature: 0.2 }
        })
      }, 60000);
      if (!res.ok) return { ok: false, error: `Ollama HTTP ${res.status}` };
      const data = await res.json();
      let parsed;
      try {
        parsed = JSON.parse(data.response);
      } catch (e) {
        return { ok: false, error: 'Model returned invalid JSON' };
      }
      if (!parsed || typeof parsed.name !== 'string' || !parsed.name.trim()) {
        return { ok: false, error: 'Model returned no name' };
      }
      return {
        ok: true,
        name: String(parsed.name).trim(),
        category: typeof parsed.category === 'string' ? parsed.category.toLowerCase() : 'misc',
        tags: Array.isArray(parsed.tags) ? parsed.tags.map(t => String(t).toLowerCase()).slice(0, 8) : []
      };
    } catch (err) {
      const msg = err.name === 'AbortError' ? 'Ollama request timed out' : err.message;
      return { ok: false, error: msg };
    }
  });

  // Physically rename texture files on disk with collision safety
  ipcMain.handle('rename-files', async (event, { dir, renames }) => {
    if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
      return { results: [], error: 'Invalid directory' };
    }
    // Reject duplicate targets within the batch (case-insensitive on Windows)
    const seen = new Map();
    for (const r of renames) {
      const key = path.join(dir, r.to).toLowerCase();
      if (seen.has(key)) {
        return { results: [], error: `Duplicate target in batch: ${r.to}` };
      }
      seen.set(key, r.from);
    }
    const results = [];
    for (const r of renames) {
      const fromPath = path.join(dir, r.from);
      const toPath = path.join(dir, r.to);
      try {
        if (!fs.existsSync(fromPath)) {
          results.push({ from: r.from, to: r.to, ok: false, error: 'Source not found' });
          continue;
        }
        if (fromPath.toLowerCase() !== toPath.toLowerCase() && fs.existsSync(toPath)) {
          results.push({ from: r.from, to: r.to, ok: false, error: 'Target already exists' });
          continue;
        }
        let finalTo = toPath;
        // Case-only rename on case-insensitive filesystems needs a temp hop
        if (fromPath.toLowerCase() === toPath.toLowerCase() && fromPath !== toPath) {
          finalTo = toPath + '.polydex-tmp';
          fs.renameSync(fromPath, finalTo);
          fs.renameSync(finalTo, toPath);
        } else {
          fs.renameSync(fromPath, toPath);
        }
        results.push({ from: r.from, to: r.to, ok: true });
      } catch (err) {
        results.push({ from: r.from, to: r.to, ok: false, error: err.message });
      }
    }
    return { results };
  });
}

function scanDirRecursive(dir, maxDepth = 3, currentDepth = 0) {
  let results = [];
  if (currentDepth > maxDepth) return results;
  try {
    const list = fs.readdirSync(dir);
    for (const file of list) {
      const fullPath = path.join(dir, file);
      try {
        const stat = fs.statSync(fullPath);
        if (stat && stat.isDirectory()) {
          results = results.concat(scanDirRecursive(fullPath, maxDepth, currentDepth + 1));
        } else {
          const ext = path.extname(file).toLowerCase();
          if (['.png', '.jpg', '.jpeg', '.tga', '.exr', '.hdr', '.tif', '.tiff', '.webp', '.bmp'].includes(ext)) {
            results.push({
              name: file,
              path: fullPath,
              size: stat.size,
              ext: ext
            });
          }
        }
      } catch (e) {}
    }
  } catch (e) {}
  return results;
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
