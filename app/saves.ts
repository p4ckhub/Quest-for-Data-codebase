import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

// Schema is loaded at runtime, no ajv dependency needed
// We'll use simple validation based on the schema structure

export interface SaveData {
  save_version: number;
  created_utc: string;
  updated_utc: string;
  player: {
    name: string;
    class: string;
    level: number;
    xp: number;
    stats?: {
      hp: number;
      mp: number;
      str: number;
      agi: number;
      int: number;
    };
  };
  zones: Record<string, any>;
  spellbook?: Array<{ lesson_id: string; name: string; signature: string; source: string; equipped: boolean }>;
  inventory?: Array<{ item_id: string; count: number }>;
  settings_snapshot?: {
    reduced_motion: boolean;
    font_size: number;
    colorblind_palette: boolean;
    animation_speed: number;
  };
}

export interface SaveResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  corruptBackupPath?: string;
}

export function getSaveDirectory(): string {
  return path.join(app.getPath('userData'), 'saves');
}

export function getSlotPath(slot: number): string {
  if (slot < 1 || slot > 3) {
    throw new Error(`Invalid slot number: ${slot}. Must be 1-3.`);
  }
  const savesDir = getSaveDirectory();
  return path.join(savesDir, `slot${slot}.json`);
}

// Validate save data matches the schema requirements
export function validateSave(data: any): { valid: boolean; errors?: string[] } {
  const errors: string[] = [];
  
  // Basic structure checks
  if (typeof data !== 'object' || data === null) {
    errors.push('Save data must be an object');
    return { valid: false, errors };
  }
  
  // Required top-level fields
  const requiredTopLevel = ['save_version', 'created_utc', 'updated_utc', 'player', 'zones'];
  for (const field of requiredTopLevel) {
    if (!(field in data)) {
      errors.push(`Missing required field: ${field}`);
    }
  }
  
  // save_version must be 1
  if (data.save_version !== 1) {
    errors.push('save_version must be 1');
  }
  
  // Date format validation (ISO 8601: YYYY-MM-DDTHH:mm:ssZ or with milliseconds)
  const isoDateRegex = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]+)?Z$/;
  if (!isoDateRegex.test(data.created_utc || '')) {
    errors.push(`created_utc must be ISO 8601 format (got: ${data.created_utc})`);
  }
  if (!isoDateRegex.test(data.updated_utc || '')) {
    errors.push(`updated_utc must be ISO 8601 format (got: ${data.updated_utc})`);
  }
  
  // Player validation
  const player = data.player;
  if (!player || typeof player !== 'object') {
    errors.push('player must be an object');
  } else {
    const playerRequired = ['name', 'class', 'level', 'xp'];
    for (const field of playerRequired) {
      if (!(field in player)) {
        errors.push(`player.${field} is required`);
      }
    }
    
    // Player.stats (if present)
    if (player.stats !== undefined) {
      const statsFields = ['hp', 'mp', 'str', 'agi', 'int'];
      for (const field of statsFields) {
        if (!(field in player.stats)) {
          errors.push(`player.stats.${field} is required`);
        }
      }
    }
  }
  
  // zones must be an object
  if (!data.zones || typeof data.zones !== 'object') {
    errors.push('zones must be an object');
  }
  
  return { valid: errors.length === 0, errors };
}

export function backupCorruptFile(slot: number, corruptContent: string): string {
  const slotPath = getSlotPath(slot);
  const corruptPath = `${slotPath}.corrupt.json`;
  
  // Ensure save directory exists
  const savesDir = getSaveDirectory();
  if (!fs.existsSync(savesDir)) {
    fs.mkdirSync(savesDir, { recursive: true });
  }
  
  // Backup the corrupt content
  fs.writeFileSync(corruptPath, corruptContent, 'utf-8');
  
  return corruptPath;
}

export function writeSave(slot: number, data: SaveData): SaveResult<void> {
  try {
    if (slot < 1 || slot > 3) {
      return { success: false, error: `Invalid slot number: ${slot}. Must be 1-3.` };
    }
    
    // Validate before write
    const validation = validateSave(data);
    if (!validation.valid) {
      return { 
        success: false, 
        error: `Save data validation failed: ${validation.errors?.join('; ')}` 
      };
    }
    
    const savesDir = getSaveDirectory();
    if (!fs.existsSync(savesDir)) {
      fs.mkdirSync(savesDir, { recursive: true });
    }
    
    const slotPath = getSlotPath(slot);
    const tempPath = path.join(savesDir, `.slot${slot}.tmp`);
    
    // Atomic write: write to temp file, then rename
    const content = JSON.stringify(data, null, 2);
    fs.writeFileSync(tempPath, content, 'utf-8');
    
    try {
      fs.renameSync(tempPath, slotPath);
    } catch (renameError) {
      // Rename failed - clean up temp file and report error
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
      return { 
        success: false, 
        error: `Failed to commit save file: ${(renameError as Error).message}` 
      };
    }
    
    return { success: true };
    
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export function loadSave(slot: number): SaveResult<SaveData> {
  try {
    if (slot < 1 || slot > 3) {
      return { 
        success: false, 
        error: `Invalid slot number: ${slot}. Must be 1-3.` 
      };
    }
    
    const slotPath = getSlotPath(slot);
    
    if (!fs.existsSync(slotPath)) {
      return { 
        success: false, 
        error: `Save slot ${slot} not found` 
      };
    }
    
    let content: string;
    try {
      content = fs.readFileSync(slotPath, 'utf-8');
    } catch (readError) {
      // Read failed - backup corrupt file
      if (fs.existsSync(slotPath)) {
        const corruptPath = backupCorruptFile(slot, 'Read error');
        return { 
          success: false, 
          error: `Failed to read save file`,
          corruptBackupPath: corruptPath 
        };
      }
      return { 
        success: false, 
        error: `Save slot ${slot} not found` 
      };
    }
    
    let data: SaveData;
    try {
      data = JSON.parse(content);
    } catch (parseError) {
      // JSON parse failed - backup corrupt file
      const corruptPath = backupCorruptFile(slot, content);
      return { 
        success: false, 
        error: `Save file is corrupted (invalid JSON)`,
        corruptBackupPath: corruptPath 
      };
    }
    
    // Validate against schema
    const validation = validateSave(data);
    if (!validation.valid) {
      // Schema validation failed - backup corrupt file
      const corruptPath = backupCorruptFile(slot, content);
      return { 
        success: false, 
        error: `Save file schema validation failed: ${validation.errors?.join('; ')}`,
        corruptBackupPath: corruptPath 
      };
    }
    
    // Migration: if save_version < current, apply migrations
    // Currently v1 = identity (no migration needed)
    
    return { success: true, data };
    
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export function listSaves(): Record<number, { exists: boolean; corrupted?: boolean }> {
  const result: Record<number, { exists: boolean; corrupted?: boolean }> = {};
  
  for (let slot = 1; slot <= 3; slot++) {
    const slotPath = getSlotPath(slot);
    const corruptPath = `${slotPath}.corrupt.json`;
    
    if (fs.existsSync(corruptPath)) {
      result[slot] = { exists: true, corrupted: true };
    } else if (fs.existsSync(slotPath)) {
      result[slot] = { exists: true, corrupted: false };
    } else {
      result[slot] = { exists: false };
    }
  }
  
  return result;
}

export function deleteSave(slot: number): SaveResult<void> {
  try {
    if (slot < 1 || slot > 3) {
      return { success: false, error: `Invalid slot number: ${slot}. Must be 1-3.` };
    }
    
    const slotPath = getSlotPath(slot);
    
    if (!fs.existsSync(slotPath)) {
      return { 
        success: false, 
        error: `Save slot ${slot} not found` 
      };
    }
    
    fs.unlinkSync(slotPath);
    
    // Also remove corrupted backup if it exists
    const corruptPath = `${slotPath}.corrupt.json`;
    if (fs.existsSync(corruptPath)) {
      fs.unlinkSync(corruptPath);
    }
    
    return { success: true };
    
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}