import { app, BrowserWindow, ipcMain, IpcMainInvokeEvent } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

// Import our save service
import { 
  SaveData, 
  writeSave, 
  loadSave, 
  listSaves, 
  deleteSave,
  getSaveDirectory 
} from './saves';

// Import runner module for lesson execution
import { runLesson, substituteVariables } from '../runner/src/index';
import * as classesJson from '../content/classes.json';
import * as spritesJson from '../content/sprites.json';

// Test seam: acceptance drivers point saves at a throwaway dir so automated
// runs never touch real player saves.
if (process.env.QUEST_USER_DATA) {
  app.setPath('userData', process.env.QUEST_USER_DATA);
}

// Global reference to main window
let mainWindow: BrowserWindow | null = null;

// Zone graph data (loaded at startup)
let zoneGraph: any = null;

// the sandpit (PHASE1.5 §2): standalone practice zone, deliberately outside
// the numbered zone progression. Its manifest lists lessons in order with a
// mandatory flag; adding a lesson later = drop a YAML + one manifest line.
let sandpitData: any = null;

function loadSandpit() {
  const yaml = require('js-yaml');
  const dir = path.join(__dirname, '../../content/sandpit');
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'sandpit.json'), 'utf-8'));
    const lessons = manifest.lessons
      .map((entry: any) => {
        try {
          const data: any = yaml.load(fs.readFileSync(path.join(dir, entry.file), 'utf-8'));
          return {
            id: data.id,
            title: data.title ?? data.id,
            concept: data.concept ?? '',
            mandatory: !!entry.mandatory,
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    sandpitData = { id: 'sandpit', title: manifest.title ?? 'the sandpit', lessons };
  } catch (e) {
    sandpitData = null;
  }
}

function loadZoneGraph() {
  // Build the world-map graph from content: the zones manifest gives order and
  // titles. Lesson order within a zone comes from the zone's own zone.json
  // manifest (ordered file list, same shape as sandpit.json) when present;
  // zones without one fall back to filename sort. Nothing here is hardcoded
  // content.
  const yaml = require('js-yaml');
  const act1Dir = path.join(__dirname, '../../content/zones/act1');
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(act1Dir, 'zones.json'), 'utf-8'));
    const zones = manifest.zones.map((zone: any) => {
      const zoneDir = path.join(act1Dir, zone.id);
      let lessons: any[] = [];
      if (fs.existsSync(zoneDir)) {
        let files: string[];
        const zoneManifestPath = path.join(zoneDir, 'zone.json');
        if (fs.existsSync(zoneManifestPath)) {
          const zoneManifest = JSON.parse(fs.readFileSync(zoneManifestPath, 'utf-8'));
          files = zoneManifest.lessons.map((entry: any) => entry.file);
        } else {
          files = fs.readdirSync(zoneDir)
            .filter((f) => f.endsWith('.yaml') && !f.startsWith('encounter-'))
            .sort();
        }
        lessons = files
          .map((f) => {
            try {
              const data: any = yaml.load(fs.readFileSync(path.join(zoneDir, f), 'utf-8'));
              return { id: data.id, title: data.title ?? data.id, concept: data.concept ?? '' };
            } catch {
              return null;
            }
          })
          .filter(Boolean);
      }
      return { ...zone, lessons };
    });
    zoneGraph = { act1: { zones } };
  } catch (e) {
    zoneGraph = null;
  }
}

// Find a lesson YAML file anywhere under content/zones or content/sandpit by
// its `id:` field (filenames don't match the lesson's own id)
function findLessonFile(lessonId: string): string | null {
  const yaml = require('js-yaml');
  const contentRoots = [
    path.join(__dirname, '../../content/zones'),
    path.join(__dirname, '../../content/sandpit'),
  ];

  const walk = (dir: string): string | null => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const found = walk(fullPath);
        if (found) return found;
      } else if (entry.isFile() && entry.name.endsWith('.yaml')) {
        try {
          const data = yaml.load(fs.readFileSync(fullPath, 'utf-8'));
          if (data && data.id === lessonId) return fullPath;
        } catch (e) {
          // skip unparsable files
        }
      }
    }
    return null;
  };

  for (const root of contentRoots) {
    if (!fs.existsSync(root)) continue;
    const found = walk(root);
    if (found) return found;
  }
  return null;
}

// Content data cache — both JSON files nest their payload under a top-level
// key ({ version, classes: {...} } / { version, sprites: {...} }), so unwrap
// here; lesson:cast looks classes up directly by id.
const contentCache: Record<string, any> = {
  classes: (classesJson as any).classes,
  sprites: (spritesJson as any).sprites
};

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 1280,
    minHeight: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    backgroundColor: '#1a1a2e',
    titleBarStyle: 'hiddenInset'
  });
  
  // Load Vite dev server in development or ui/dist in production
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    // __dirname is dist/app at runtime; the built UI lives at <root>/ui/dist
    mainWindow.loadFile(path.join(__dirname, '../../ui/dist/index.html'));
  }
  
  // Load zone graph and sandpit manifest on window ready
  loadZoneGraph();
  loadSandpit();
  
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// IPC Handlers registration
function registerIPCHandlers() {
  // === SAVE SERVICE IPC HANDLERS ===
  
  // save:list - List all save slots with their status
  ipcMain.handle('save:list', (event: IpcMainInvokeEvent) => {
    return listSaves();
  });
  
  // save:load - Load a specific save slot
  ipcMain.handle('save:load', (event: IpcMainInvokeEvent, slot: number) => {
    if (slot < 1 || slot > 3) {
      return { success: false, error: `Invalid slot: ${slot}` };
    }
    const result = loadSave(slot);
    return result;
  });
  
  // save:write - Write to a specific save slot
  ipcMain.handle('save:write', (event: IpcMainInvokeEvent, slot: number, data: SaveData) => {
    if (slot < 1 || slot > 3) {
      return { success: false, error: `Invalid slot: ${slot}` };
    }
    const result = writeSave(slot, data);
    return result;
  });
  
  // save:delete - Delete a specific save slot
  ipcMain.handle('save:delete', (event: IpcMainInvokeEvent, slot: number) => {
    if (slot < 1 || slot > 3) {
      return { success: false, error: `Invalid slot: ${slot}` };
    }
    const result = deleteSave(slot);
    return result;
  });
  
  // === LESSON SERVICE IPC HANDLERS ===
  
  // lesson:load - Load and prepare a lesson for the renderer
  ipcMain.handle('lesson:load', (event: IpcMainInvokeEvent, lessonId: string, className?: string) => {
    try {
      const lessonPath = findLessonFile(lessonId);

      if (!lessonPath) {
        return { success: false, error: `Lesson not found: ${lessonId}` };
      }

      const yaml = require('js-yaml');
      let lessonData = yaml.load(fs.readFileSync(lessonPath, 'utf-8'));

      // Substitute {{class_name}}/{{weapon}}/{{starter_spell}} so the renderer
      // never displays raw template placeholders
      const classData = className && contentCache.classes[className];
      if (classData) {
        lessonData = substituteVariables(lessonData, classData);
      }

      return { success: true, lesson: lessonData };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });
  
  // lesson:cast - Perform full lesson execution cycle
  ipcMain.handle('lesson:cast', async (event: IpcMainInvokeEvent, params: {
    lessonId: string;
    playerCode: string;
    className: string;
  }) => {
    try {
      const yaml = require('js-yaml');

      // Load lesson file
      const lessonPath = findLessonFile(params.lessonId);
      if (!lessonPath) {
        return { success: false, error: `Lesson not found: ${params.lessonId}` };
      }

      const lessonData = yaml.load(fs.readFileSync(lessonPath, 'utf-8'));
      
      // Get class-specific values for substitution
      const classData = contentCache.classes[params.className];
      if (!classData) {
        return { success: false, error: `Class not found: ${params.className}` };
      }
      
      // Apply class-specific substitutions
      const lesson = substituteVariables(lessonData, classData);
      
      // Run the lesson through the runner
      const result = await runLesson(lesson, params.playerCode);
      
      return { success: true, ...result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });
  
  // === COMBAT IPC HANDLERS ===
  // One combat session at a time. All combat math runs in the C++ harness
  // under sandbox_run (§11.5); these handlers only shuttle state and events.

  let activeCombat: { dir: string; spells: any[] } | null = null;

  // combat:start - Begin an encounter: build CombatState from encounter YAML
  ipcMain.handle('combat:start', (event: IpcMainInvokeEvent, params: {
    playerClass: string;
    encounterId: string;
    spells: any[];           // spellbook entries from the save
    playerHp?: number;       // carry current HP into the fight
    playerMp?: number;
  }) => {
    try {
      const os = require('os');
      const { createCombatState, writeCombatState } = require('../runner/src/combat');

      const encounterPath = findLessonFile(params.encounterId);
      if (!encounterPath) {
        return { success: false, error: `Encounter not found: ${params.encounterId}` };
      }
      const yaml = require('js-yaml');
      const enc = yaml.load(fs.readFileSync(encounterPath, 'utf-8'));

      const enemies = (enc.enemies ?? [enc]).map((e: any, i: number) => ({
        id: e.enemy_id ?? e.id ?? `enemy-${i + 1}`,
        type: e.type ?? 'monster',
        hp: e.hp ?? 30,
        max_hp: e.max_hp ?? e.hp ?? 30,
        statuses: [],
        attack: {
          min: e.damage_formula?.dice_min ?? 2,
          max: e.damage_formula?.dice_max ?? 6,
        },
        ...(e.grow_hp_per_turn ? { grow_hp_per_turn: e.grow_hp_per_turn } : {}),
        ...(e.leak_bytes ? { leak_bytes: e.leak_bytes } : {}),
      }));

      const overrides: any = {};
      if (typeof params.playerHp === 'number') overrides.hp = params.playerHp;
      if (typeof params.playerMp === 'number') overrides.mp = params.playerMp;

      const state = createCombatState(params.playerClass, enemies, overrides);
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quest-combat-'));
      writeCombatState(dir, state);
      activeCombat = { dir, spells: params.spells ?? [] };

      return { success: true, state, encounter: enc };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // combat:turn - Execute a single combat turn in the active session
  ipcMain.handle('combat:turn', (event: IpcMainInvokeEvent, params: { action: string }) => {
    try {
      if (!activeCombat) {
        return { success: false, error: 'No active combat session' };
      }
      const { runCombatTurn } = require('../runner/src/combat');
      const result = runCombatTurn(activeCombat.dir, params.action, activeCombat.spells);
      return { success: true, ...result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // combat:end - Tear down the active session
  ipcMain.handle('combat:end', () => {
    try {
      if (activeCombat) {
        fs.rmSync(activeCombat.dir, { recursive: true, force: true });
        activeCombat = null;
      }
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });
  
  // === CONTENT IPC HANDLERS ===
  
  // content:get - Get various content data
  ipcMain.handle('content:get', (event: IpcMainInvokeEvent, type: string, id?: string) => {
    try {
      if (type === 'classes') {
        return { success: true, classes: contentCache.classes };
      } else if (type === 'sprites') {
        return { success: true, sprites: contentCache.sprites };
      } else if (type === 'zone' && id) {
        const zonePath = path.join(__dirname, `../../content/zones/${id}.json`);
        if (!fs.existsSync(zonePath)) {
          return { success: false, error: `Zone not found: ${id}` };
        }
        const zoneData = JSON.parse(fs.readFileSync(zonePath, 'utf-8'));
        return { success: true, zone: zoneData };
      } else if (type === 'zoneGraph') {
        return { success: true, graph: zoneGraph };
      } else if (type === 'sandpit') {
        return { success: true, sandpit: sandpitData };
      } else {
        return { success: false, error: `Unknown content type: ${type}` };
      }
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });
}

// App lifecycle
app.whenReady().then(() => {
  createWindow();
  registerIPCHandlers();
  
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

// Export for potential testing
export { createWindow, registerIPCHandlers };
