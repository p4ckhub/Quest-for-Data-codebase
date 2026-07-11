import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import * as path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['tests/**/*.test.ts', 'tests/ui/**/*.test.tsx', 'runner/tests/**/*.test.ts'],
    alias: [
      // monaco-setup imports the full monaco-editor bundle, which jsdom can't run
      { find: /^.*monaco-setup$/, replacement: path.resolve(__dirname, 'tests/ui/monaco-setup-stub.ts') },
    ],
  },
});
