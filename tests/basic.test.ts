import { describe, it, expect } from 'vitest';

describe('Project Structure Tests', () => {
  it('should have package.json with required scripts', async () => {
    const pkg = await import('../package.json', { assert: { type: 'json' } });
    
    expect(pkg).toBeDefined();
    expect(pkg.scripts).toHaveProperty('build');
    expect(pkg.scripts).toHaveProperty('test');
  });
});

describe('UI Build Tests', () => {
  it('should have built UI assets in dist', async () => {
    const fs = await import('fs');
    
    const uiIndexHtml = 'dist/ui/index.html';
    const uiAssetsDir = 'dist/ui/assets';
    
    expect(fs.existsSync(uiIndexHtml)).toBe(true);
    expect(fs.existsSync(uiAssetsDir)).toBe(true);
  });
});
