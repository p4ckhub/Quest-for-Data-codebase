import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import * as os from 'os';

function getCompilerPath(): string {
  const path = require('path');
  const fs = require('fs');
  const TOOLCHAIN_DIR = path.join(__dirname, '..', 'toolchain');
  const lockPath = path.join(TOOLCHAIN_DIR, 'toolchain.lock.json');
  if (fs.existsSync(lockPath)) {
    const lockData = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
    const profileKey = process.platform === 'win32' ? 'windows-native' : 'linux-native';
    const profile = lockData.profiles?.[profileKey];
    if (profile && profile.path) {
      return profile.path;
    }
  }
  return process.platform === 'win32' ? 'g++' : '/usr/bin/g++';
}

describe('Phase 0 Pipeline Tests', () => {
  it('should have toolchain lock with linux-native profile', () => {
    const fs = require('fs');
    const path = require('path');
    
    const lockPath = path.join(__dirname, '..', 'toolchain', 'toolchain.lock.json');
    expect(fs.existsSync(lockPath)).toBe(true);
    
    const lockData = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
    expect(lockData.profiles).toBeDefined();
    expect(lockData.profiles['linux-native']).toBeDefined();
  });

  it('should compile and run a simple program through the Cast pipeline', () => {
    const yaml = require('js-yaml');
    const fs = require('fs');
    const path = require('path');
    
    const lessonPath = path.join(__dirname, '..', 'content', 'zones', 'act1', 'character_creation', 'awakening-101.yaml');
    const content = fs.readFileSync(lessonPath, 'utf-8');
    const lessonData = yaml.load(content);
    
    // Apply substitution (as the runner does)
    const classesPath = path.join(__dirname, '..', 'content', 'classes.json');
    const classesData = JSON.parse(fs.readFileSync(classesPath, 'utf-8'));
    const warrior = classesData.classes['warrior'];
    
    // Substitute variables in the lesson
    const substituteString = (text) => {
      if (!text) return text;
      return text
        .replace(/\{\{class_name\}\}/g, warrior.display_name)
        .replace(/\{\{weapon\}\}/g, warrior.weapon)
        .replace(/\{\{starter_spell\}\}/g, warrior.starter_spell.signature);
    };
    
    const substitutedLesson = {
      ...lessonData,
      solution: substituteString(lessonData.solution),
    };

    // Build the lesson using the same approach as the runner: since P2-0.5
    // the solution is a complete program (visible main), no prelude/epilogue
    const tempDir = path.join(os.tmpdir(), `vitest-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    const fullCode = substitutedLesson.solution;
    const mainCpp = path.join(tempDir, 'main.cpp');
    fs.writeFileSync(mainCpp, fullCode);

    const exePath = path.join(tempDir, 'lesson.exe');
    const compilerPath = getCompilerPath();
    const gameapiCpp = path.join(__dirname, '..', 'gameapi', 'gameapi.cpp');
    const jsonInclude = path.join(__dirname, '..', 'gameapi', 'third_party');
    
    // Compile
    execSync(`${compilerPath} -std=c++17 -O0 -g0 -Wall -I${path.join(__dirname, '..', 'gameapi')} -I${jsonInclude} ${mainCpp} ${gameapiCpp} -o ${exePath}`, { stdio: 'pipe' });
    
    // Run with sandbox
    const sandboxPath = path.join(__dirname, '..', 'toolchain', 'bin', 'sandbox_run');
    const result = execSync(`${sandboxPath} --wall-ms 3000 --cpu-ms 2000 --mem-mb 512 --stdout-cap-kb 1024 -- ${exePath}`, { encoding: 'utf-8' });
    
    // Verify the greeting reaches stdout (validation is output-based post P2-0.5)
    expect(result).toContain('Warrior');
    expect(result).toContain('I enter the fray');
  });

  it('should validate gold lessons through the full pipeline', () => {
    const fs = require('fs');
    const path = require('path');
    
    // Run the gold lessons validation (this is the real test)
    try {
      execSync(`ts-node ${path.join(__dirname, '..', 'scripts', 'validate-gold-lessons.ts')}`, { 
        encoding: 'utf-8',
        stdio: 'pipe'
      });
    } catch (e: any) {
      expect.fail('Gold lessons validation should pass');
    }
  }, 15000);
});
