import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';

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
    
    const lessonPath = path.join(__dirname, '..', 'content', 'zones', 'act1', 'character_creation', 'zone-0-lesson-1.yaml');
    const content = fs.readFileSync(lessonPath, 'utf-8');
    const lessonData = yaml.load(content);
    
    // Build the lesson using the same approach as the runner
    const tempDir = path.join(process.env.TMPDIR || '/tmp', `vitest-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    
    const fullCode = `${lessonData.prelude}\n${lessonData.solution}\n${lessonData.epilogue}`;
    const mainCpp = path.join(tempDir, 'main.cpp');
    fs.writeFileSync(mainCpp, fullCode);
    
    const exePath = path.join(tempDir, 'lesson.exe');
    const compilerPath = '/usr/bin/g++';
    const gameapiCpp = path.join(__dirname, '..', 'gameapi', 'gameapi.cpp');
    const jsonInclude = path.join(__dirname, '..', 'gameapi', 'third_party');
    
    // Compile
    execSync(`${compilerPath} -std=c++17 -O0 -g0 -Wall -I${path.join(__dirname, '..', 'gameapi')} -I${jsonInclude} ${mainCpp} ${gameapiCpp} -o ${exePath}`, { stdio: 'pipe' });
    
    // Run with sandbox
    const sandboxPath = path.join(__dirname, '..', 'toolchain', 'bin', 'sandbox_run');
    const result = execSync(`${sandboxPath} --wall-ms 3000 --cpu-ms 2000 --mem-mb 512 --stdout-cap-kb 1024 -- ${exePath}`, { encoding: 'utf-8' });
    
    // Verify we get check events for hp, mp, staminaRegen
    expect(result).toContain('"id":"hp"');
    expect(result).toContain('"value":100');
    expect(result).toContain('"id":"mp"');
    expect(result).toContain('"value":50');
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
