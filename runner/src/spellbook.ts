import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import { findProjectRoot } from './index';

// Resolved from the project root, not __dirname: this module runs both from
// source (vitest/ts-node) and compiled under dist/ (Electron main process).
const GAMEAPI_DIR = path.join(findProjectRoot(), 'gameapi');
const TOOLCHAIN_DIR = path.join(findProjectRoot(), 'toolchain');

// Get compiler path for spellbook compilation check
function getCompilerPath(): string {
  const lockPath = path.join(TOOLCHAIN_DIR, 'toolchain.lock.json');
  if (fs.existsSync(lockPath)) {
    try {
      const lockData = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
      const linuxNative = lockData.profiles?.['linux-native'];
      if (linuxNative && linuxNative.path) {
        return linuxNative.path;
      }
    } catch { /* ignore */ }
  }
  return '/usr/bin/g++';
}

// Spell interface matching save.json structure (§13: `source`; the legacy
// test shape used `source_code` — both accepted, `source` preferred)
export interface Spell {
  lesson_id: string;
  name: string;
  signature: string;
  source?: string;
  source_code?: string;
  equipped?: boolean;
}

// Save object interface: real saves use `spellbook` (§13); legacy `spells` accepted
export interface SaveObject {
  spells?: Spell[];
  spellbook?: Spell[];
}

function spellsOf(save: SaveObject): Spell[] {
  return save.spellbook ?? save.spells ?? [];
}

function sourceOf(spell: Spell): string {
  return spell.source ?? spell.source_code ?? '';
}

/**
 * Generate spellbook.h from a save object
 * Implements all five rules from §11.8:
 * 1. Namespace-wrap each spell: namespace sb_<lesson_id_underscored> { ... }
 * 2. Source-of-truth is the save, not hardcoded values
 * 3. Recompile gate via spellbook_check.cpp with rollback on failure
 * 4. Log but never brick the save on failure
 * 5. Generate complete header file with all spells
 */
export function generateSpellbook(saveObject: SaveObject, outputDir: string): void {
  // Step 1: Build the spellbook content
  const spellbookContent = buildSpellbookContent(saveObject);
  
  // Step 2: Backup previous spellbook if exists (for rollback)
  const outputPath = path.join(outputDir, 'spellbook.h');
  let backupPath = path.join(outputDir, 'spellbook.h.bak');
  if (fs.existsSync(outputPath)) {
    fs.copyFileSync(outputPath, backupPath);
  }
  
  // Step 3: Write to output file temporarily
  const tempPath = path.join(outputDir, 'spellbook.h.tmp');
  fs.writeFileSync(tempPath, spellbookContent);
  
  try {
    // Step 4: Compile check (recompile gate)
    const checkExePath = compileSpellbookCheck(outputDir);
    
    // If compilation succeeds, move temp to final
    if (fs.existsSync(checkExePath)) {
      fs.renameSync(tempPath, outputPath);
      if (fs.existsSync(backupPath)) {
        fs.unlinkSync(backupPath);  // Remove backup on success
      }
      console.log('[spellbook] spellbook.h regenerated successfully with', spellsOf(saveObject).length, 'spells');
    } else {
      throw new Error('Spellbook compile check failed - no executable produced');
    }
  } catch (e: any) {
    // Step 5: Rollback on failure
    if (fs.existsSync(backupPath)) {
      fs.renameSync(backupPath, outputPath);  // Restore previous spellbook.h
      console.log('[spellbook] Rollback: restored previous spellbook.h due to compile failure');
    } else if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);  // Remove temp on failure
    }
    
    console.error('[spellbook] Error generating spellbook.h:', (e as Error).message);
    throw new Error(`Spellbook generation failed: ${(e as Error).message}`);
  }
}

/**
 * Compile the spellbook check harness
 * Returns path to compiled executable if successful, undefined on failure
 */
function compileSpellbookCheck(spellbookDir: string): string | undefined {
  const checkDir = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'spellbook-check-'));
  const exePath = path.join(checkDir, 'spellbook_check.exe');

  const checkCpp = path.join(GAMEAPI_DIR, 'spellbook_check.cpp');
  const spellbookH = path.join(spellbookDir, 'spellbook.h.tmp');
  const jsonInclude = path.join(GAMEAPI_DIR, 'third_party');
  const compilerPath = getCompilerPath();

  // Stage the candidate header under its real name in an isolated dir so the
  // check compile never touches the repo's gameapi/ directory.
  fs.copyFileSync(spellbookH, path.join(checkDir, 'spellbook.h'));

  try {
    const cmd = `${compilerPath} -std=c++17 -O0 -g0 -Wall -I${checkDir} -I${GAMEAPI_DIR} -I${jsonInclude} ${checkCpp} -o ${exePath}`;
    execSync(cmd, { stdio: 'pipe' });
    return exePath;
  } catch (e: any) {
    // Surface the compiler diagnostics — a silent undefined here makes
    // spellbook failures undebuggable from the UI error alone.
    const diag = (e.stderr ?? '').toString().split('\n').slice(0, 12).join('\n');
    console.error('[spellbook] compile check failed:\n' + diag);
    return undefined;
  }
}

/**
 * Build the full spellbook.h content from save object
 */
function buildSpellbookContent(saveObject: SaveObject): string {
  const lines: string[] = [];
  const spells = spellsOf(saveObject);

  // Header comment
  lines.push('// Spellbook - namespace-wrapped spells generated from save.json');
  lines.push('// This file is regenerated by runner/src/spellbook.ts');
  lines.push('// DO NOT EDIT MANUALLY - changes will be overwritten');
  lines.push('');
  lines.push('#ifndef SPELLBOOK_H');
  lines.push('#define SPELLBOOK_H');
  lines.push('');
  lines.push('#include <string>');
  lines.push('');

  // Generate namespace-wrapped spells for each spell in save
  // Each spell gets both declaration and implementation inside the namespace
  for (const spell of spells) {
    const nsName = lessonIdToNamespace(spell.lesson_id);

    lines.push(`namespace ${nsName} {`);
    lines.push(`    // Spell: ${spell.name}`);
    lines.push(`    // Declaration: ${spell.signature}`);
    lines.push('');
    lines.push(sourceOf(spell));
    lines.push('');
    lines.push(`}  // namespace ${nsName}`);
    lines.push('');
  }

  // Dispatcher: the combat harness resolves an action name to its
  // namespace-qualified spell symbol through this (§11.8 rule 3). If two
  // spells share a display name, the most recently forged wins.
  lines.push('inline int spellbook_cast(const std::string& spell_name, bool& found) {');
  lines.push('    found = true;');
  for (let i = spells.length - 1; i >= 0; i--) {
    const spell = spells[i];
    const nsName = lessonIdToNamespace(spell.lesson_id);
    const funcName = extractFunctionName(spell.signature);
    // The harness casts by name with no caller-supplied arguments, so spells
    // with parameters get a fixed focus value per numeric param. A spell whose
    // signature we can't call this way is left out rather than breaking the
    // whole spellbook compile (§11.8 rule 4).
    const args = buildCastArguments(spell.signature);
    if (args === null) continue;
    lines.push(`    if (spell_name == "${spell.name}") return ${nsName}::${funcName}(${args});`);
  }
  lines.push('    found = false;');
  lines.push('    return 0;');
  lines.push('}');
  lines.push('');
  lines.push('#endif  // SPELLBOOK_H');

  return lines.join('\n') + '\n';
}

/**
 * Build the argument list used to cast a spell from the dispatcher.
 * Zero-parameter spells cast bare; each numeric parameter (int/double/float)
 * receives the fixed focus value 5. Returns null when a parameter can't be
 * defaulted this way, meaning the spell is not castable from combat.
 */
const CAST_FOCUS_VALUE = 5;
function buildCastArguments(signature: string): string | null {
  const parenMatch = signature.match(/\(([^)]*)\)/);
  if (!parenMatch) return null;
  const paramList = parenMatch[1].trim();
  if (paramList === '' || paramList === 'void') return '';
  const args: string[] = [];
  for (const param of paramList.split(',')) {
    const type = param.trim().split(/\s+/)[0];
    if (type === 'int' || type === 'long' || type === 'double' || type === 'float') {
      args.push(String(CAST_FOCUS_VALUE));
    } else {
      return null;
    }
  }
  return args.join(', ');
}

/**
 * Extract function name from signature (e.g., "int strike()" -> "strike")
 */
function extractFunctionName(signature: string): string {
  // Find the function name after the return type
  const match = signature.match(/([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/);
  return match ? match[1] : 'unknown';
}

/**
 * Convert lesson_id to C++ namespace-safe identifier
 * Example: 'act1-character-creation-zone-0-lesson-1' -> 'sb_act1_character_creation_zone_0_lesson_1'
 */
function lessonIdToNamespace(lessonId: string): string {
  // Replace dashes and dots with underscores, prefix with 'sb_'
  let ns = lessonId.replace(/[-.]/g, '_');
  // Also replace spaces and other special chars
  ns = ns.replace(/[^a-zA-Z0-9_]/g, '_');
  // Ensure it starts with a letter or underscore
  if (!ns.match(/^[a-zA-Z_]/)) {
    ns = 'sb_' + ns;
  }
  return 'sb_' + ns;
}

/**
 * Load save object from JSON file
 */
export function loadSave(savePath: string): SaveObject {
  const data = fs.readFileSync(savePath, 'utf-8');
  const saveObject: SaveObject = JSON.parse(data);

  if (!saveObject.spellbook && !saveObject.spells) {
    saveObject.spells = [];
  }

  return saveObject;
}

/**
 * Generate spellbook from a save file path
 */
export function generateSpellbookFromFile(savePath: string, outputDir: string): void {
  const saveObject = loadSave(savePath);
  generateSpellbook(saveObject, outputDir);
}

// Export types for external use
// Spell and SaveObject already exported above
