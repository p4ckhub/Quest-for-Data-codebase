import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

console.log('Preload: starting...');

// Define types for the context bridge
export interface SaveService {
  list(): Promise<Record<number, { exists: boolean; corrupted?: boolean }>>;
  load(slot: number): Promise<{ success: boolean; data?: any; error?: string; corruptBackupPath?: string }>;
  write(slot: number, data: any): Promise<{ success: boolean; error?: string }>;
  delete(slot: number): Promise<{ success: boolean; error?: string }>;
}

export interface LessonService {
  load(lessonId: string, className?: string): Promise<{ success: boolean; lesson?: any; error?: string }>;
  cast(params: { lessonId: string; playerCode: string; className: string }): Promise<any>;
}

export interface CombatService {
  start(params: {
    playerClass: string;
    encounterId: string;
    spells: any[];
    playerHp?: number;
    playerMp?: number;
  }): Promise<{ success: boolean; state?: any; encounter?: any; error?: string }>;
  turn(params: { action: string }): Promise<{ success: boolean; events?: any[]; state?: any; error?: string }>;
  end(): Promise<{ success: boolean; error?: string }>;
}

export interface ContentService {
  get(type: string, id?: string): Promise<any>;
}

export interface GameAPI {
  saves: SaveService;
  lessons: LessonService;
  combat: CombatService;
  content: ContentService;
}

// Type declarations for the renderer
declare global {
  interface Window {
    gameapi: GameAPI;
  }
}

const api: GameAPI = {
  // === SAVE SERVICE ===
  saves: {
    list: () => ipcRenderer.invoke('save:list'),
    
    load: (slot: number) => ipcRenderer.invoke('save:load', slot),
    
    write: (slot: number, data: any) => ipcRenderer.invoke('save:write', slot, data),
    
    delete: (slot: number) => ipcRenderer.invoke('save:delete', slot)
  },
  
  // === LESSON SERVICE ===
  lessons: {
    load: (lessonId: string, className?: string) => ipcRenderer.invoke('lesson:load', lessonId, className),
    
    cast: (params: { lessonId: string; playerCode: string; className: string }) => 
      ipcRenderer.invoke('lesson:cast', params)
  },
  
  // === COMBAT SERVICE ===
  combat: {
    start: (params: {
      playerClass: string;
      encounterId: string;
      spells: any[];
      playerHp?: number;
      playerMp?: number;
    }) => ipcRenderer.invoke('combat:start', params),
    turn: (params: { action: string }) => ipcRenderer.invoke('combat:turn', params),
    end: () => ipcRenderer.invoke('combat:end')
  },
  
  // === CONTENT SERVICE ===
  content: {
    get: (type: string, id?: string) => ipcRenderer.invoke('content:get', type, id)
  }
};

console.log('Preload: exposing gameapi...');
// Expose only the API, not any Node.js APIs
contextBridge.exposeInMainWorld('gameapi', api);

// Also expose a simple ready signal mechanism
interface ReadySignal {
  send: (channel: string) => void;
}

const readySignal: ReadySignal = {
  send: (channel: string) => ipcRenderer.send(channel)
};
console.log('Preload: exposing readySignal...');
(contextBridge as any).exposeInMainWorld('readySignal', readySignal);
console.log('Preload: done');
