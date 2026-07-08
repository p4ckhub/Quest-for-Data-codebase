import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('gameapi', {
  readFile: (filePath: string) => ipcRenderer.invoke('fs:readFile', filePath),
  writeFile: (filePath: string, content: string) => ipcRenderer.invoke('fs:writeFile', filePath, content),
  exists: (filePath: string) => ipcRenderer.invoke('fs:exists', filePath),
  directoryExists: (dirPath: string) => ipcRenderer.invoke('fs:directoryExists', dirPath)
});
