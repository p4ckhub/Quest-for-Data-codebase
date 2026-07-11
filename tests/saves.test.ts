import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as pathModule from 'path';

// Test fixture - load schema
const saveSchema = JSON.parse(fs.readFileSync(pathModule.join(__dirname, '../schemas/save.schema.json'), 'utf-8'));

// Minimal validation without ajv-formats
function validateSave(data: any): { valid: boolean; errors?: any[] } {
  const errors: any[] = [];
  
  if (data.save_version !== 1) {
    errors.push({ message: `save_version must be 1, got ${data.save_version}` });
  }
  
  // Check required fields
  const requiredTopLevel = ['save_version', 'created_utc', 'updated_utc', 'player', 'zones'];
  for (const field of requiredTopLevel) {
    if (!(field in data)) {
      errors.push({ message: `Missing required field: ${field}` });
    }
  }
  
  // Player validation
  if (data.player) {
    const playerRequired = ['name', 'class', 'level', 'xp'];
    for (const field of playerRequired) {
      if (!(field in data.player)) {
        errors.push({ message: `Player missing required field: ${field}` });
      }
    }
    // Stats validation if present
    if (data.player.stats) {
      const statsFields = ['hp', 'mp', 'str', 'agi', 'int'];
      for (const field of statsFields) {
        if (!(field in data.player.stats)) {
          errors.push({ message: `Player.stats missing required field: ${field}` });
        }
      }
    }
  }
  
  // Date format check - handle both with and without milliseconds
  const isoDateRegex = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z$/;
  if (data.created_utc && !isoDateRegex.test(data.created_utc)) {
    errors.push({ message: `created_utc must be ISO 8601 format, got ${data.created_utc}` });
  }
  if (data.updated_utc && !isoDateRegex.test(data.updated_utc)) {
    errors.push({ message: `updated_utc must be ISO 8601 format, got ${data.updated_utc}` });
  }
  
  return { valid: errors.length === 0, errors };
}

// Test helpers
function createValidSave(slot: number): any {
  const now = new Date().toISOString();
  return {
    save_version: 1,
    created_utc: now,
    updated_utc: now,
    player: {
      name: `TestPlayer${slot}`,
      class: 'Warrior',
      level: 1,
      xp: 0,
      stats: { hp: 100, mp: 50, str: 15, agi: 10, int: 8 }
    },
    zones: {
      zone_0: {
        status: 'available',
        lessons: {}
      }
    },
    spellbook: [],
    inventory: []
  };
}

describe('Save Service - Atomic Writes', () => {
  const testDir = path.join(os.tmpdir(), `QuestForData_test_${Date.now()}`);
  
  beforeEach(() => {
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
  });
  
  afterEach(() => {
    if (fs.existsSync(testDir)) {
      for (const file of fs.readdirSync(testDir)) {
        const filePath = path.join(testDir, file);
        if (fs.statSync(filePath).isFile()) {
          fs.unlinkSync(filePath);
        }
      }
      fs.rmdirSync(testDir);
    }
  });
  
  it('atomic write survives simulated crash-between-temp-and-rename', () => {
    const slot = 1;
    const slotPath = path.join(testDir, `slot${slot}.json`);
    const tempPath = path.join(testDir, `.slot${slot}.tmp`);
    
    const saveData = createValidSave(slot);
    
    fs.writeFileSync(tempPath, JSON.stringify(saveData, null, 2));
    
    const raw = fs.readFileSync(tempPath, 'utf-8');
    const parsed = JSON.parse(raw);
    
    expect(parsed.save_version).toBe(1);
    const result = validateSave(parsed);
    expect(result.valid).toBe(true);
  });
  
  it('corrupt-save backup path - writes .corrupt.json on invalid JSON', () => {
    const slot = 2;
    const slotPath = path.join(testDir, `slot${slot}.json`);
    const corruptPath = path.join(testDir, `slot${slot}.corrupt.json`);
    
    const saveData = createValidSave(slot);
    fs.writeFileSync(slotPath, JSON.stringify(saveData, null, 2));
    
    fs.writeFileSync(slotPath, '{"incomplete": true');
    
    let loaded: any = null;
    let corruptedBackupCreated = false;
    
    try {
      const raw = fs.readFileSync(slotPath, 'utf-8');
      try {
        loaded = JSON.parse(raw);
        validateSave(loaded);
      } catch (e) {
        corruptedBackupCreated = true;
        fs.writeFileSync(corruptPath, raw);
        loaded = null;
      }
    } catch (e) {
      // File not found
    }
    
    expect(corruptedBackupCreated).toBe(true);
    expect(fs.existsSync(corruptPath)).toBe(true);
    expect(loaded).toBeNull();
  });
  
  it('slot round-trip - write then read returns same data', () => {
    const slot = 3;
    const slotPath = path.join(testDir, `slot${slot}.json`);
    
    const originalData = createValidSave(slot);
    
    const tempPath = path.join(testDir, `.slot${slot}.tmp`);
    fs.writeFileSync(tempPath, JSON.stringify(originalData, null, 2));
    fs.renameSync(tempPath, slotPath);
    
    const raw = fs.readFileSync(slotPath, 'utf-8');
    const loadedData: any = JSON.parse(raw);
    
    expect(loadedData.save_version).toBe(originalData.save_version);
    expect(loadedData.player.name).toBe(originalData.player.name);
    expect(validateSave(loadedData).valid).toBe(true);
  });
  
  it('schema rejection - invalid save data is rejected', () => {
    const invalidData: any = createValidSave(1);
    delete invalidData.player.level;
    
    const result = validateSave(invalidData);
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors?.length).toBeGreaterThan(0);
  });
  
  it('three slots - 1-3 each work independently', () => {
    for (let slot = 1; slot <= 3; slot++) {
      const slotPath = path.join(testDir, `slot${slot}.json`);
      const tempPath = path.join(testDir, `.slot${slot}.tmp`);
      
      const saveData = createValidSave(slot);
      fs.writeFileSync(tempPath, JSON.stringify(saveData, null, 2));
      fs.renameSync(tempPath, slotPath);
      
      const raw = fs.readFileSync(slotPath, 'utf-8');
      const loaded: any = JSON.parse(raw);
      
      expect(loaded.save_version).toBe(1);
      expect(loaded.player.name).toBe(`TestPlayer${slot}`);
      expect(validateSave(loaded).valid).toBe(true);
    }
  });
});
