import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Relative asset paths so the built index.html works when Electron loads it
  // via file:// (absolute /assets/... paths resolve to the filesystem root)
  base: './',
  plugins: [react()],
  test: {
    globals: true,
    environment: 'node'
  }
});
