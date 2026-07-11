import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';

let mainWindow: BrowserWindow | null = null;
let readyReceived = false;

async function createWindow() {
  const startTimestamp = Date.now();
  
  // Wait for app to be ready with timeout
  if (app.isReady()) {
    await createWindowInternal(startTimestamp);
  } else {
    app.on('ready', () => {
      const elapsed = Date.now() - startTimestamp;
      if (elapsed < 5000) {
        createWindowInternal(startTimestamp);
      }
    });
  }
}

async function createWindowInternal(startTimestamp: number) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    backgroundColor: '#1a1a2e',
    titleBarStyle: 'hiddenInset'
  });
  
  // Load the app - try dev server first, fall back to dist
  if (process.env.NODE_ENV === 'development') {
    try {
      mainWindow.loadURL('http://localhost:5173');
    } catch (e) {
      mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
    }
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
  
  // Show window
  mainWindow.show();
  
  // Wait for renderer to send 'ready' message
  const timeout = setTimeout(() => {
    if (!readyReceived) {
      console.error('Timeout waiting for renderer ready signal');
      app.quit();
      process.exit(1);
    }
  }, 10000);
  
  // Listen for ready IPC from renderer
  ipcMain.on('renderer-ready', () => {
    clearTimeout(timeout);
    readyReceived = true;
    console.log('Smoke test: received ready signal from renderer');
    
    // Clean shutdown
    app.quit();
    process.exit(0);
  });
}

// Quit when all windows are closed
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Start
createWindow();
