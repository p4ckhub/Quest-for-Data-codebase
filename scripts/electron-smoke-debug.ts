import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';

console.log('app module:', typeof app);
console.log('app.isReady:', typeof app?.isReady);

if (typeof app === 'undefined') {
  console.error('FATAL: app is undefined');
  process.exit(1);
}
