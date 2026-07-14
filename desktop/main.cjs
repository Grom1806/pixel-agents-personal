const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const port = Number(process.env.PIXEL_AGENTS_PORT || 3100);
let serverProcess;

function isServerReady() {
  return new Promise((resolve) => {
    const request = http.get(`http://127.0.0.1:${port}/api/health`, (response) => {
      response.resume();
      resolve(response.statusCode === 200);
    });
    request.setTimeout(500, () => request.destroy());
    request.on('error', () => resolve(false));
  });
}

async function startServer() {
  if (await isServerReady()) return;
  const tsxCli = path.join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  serverProcess = spawn('node.exe', [tsxCli, 'server\\src\\cli.ts', '--port', String(port)], {
    cwd: repoRoot,
    stdio: 'ignore',
    windowsHide: true,
  });

  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await isServerReady()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Не удалось запустить локальный сервер Pixel Agents.');
}

async function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 900,
    minHeight: 640,
    title: 'Pixel Agents Personal',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });
  window.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    console.error(`[renderer:${level}] ${message} (${sourceId}:${line})`);
  });
  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error(`[load:${errorCode}] ${errorDescription}: ${validatedURL}`);
  });
  window.webContents.on('render-process-gone', (_event, details) => {
    console.error(`[renderer-gone] ${details.reason}`);
  });
  await window.loadURL(`http://127.0.0.1:${port}/`);
}

ipcMain.handle('pixel-agents:choose-project-folder', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Выберите любой файл внутри проекта',
    buttonLabel: 'Открыть',
    properties: ['openFile'],
    filters: [{ name: 'Все файлы', extensions: ['*'] }],
  });
  return result.canceled || !result.filePaths[0] ? null : path.dirname(result.filePaths[0]);
});

app.whenReady().then(async () => {
  await startServer();
  await createWindow();
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  if (serverProcess?.pid) {
    spawn('taskkill.exe', ['/pid', String(serverProcess.pid), '/t', '/f'], { windowsHide: true });
  }
});
