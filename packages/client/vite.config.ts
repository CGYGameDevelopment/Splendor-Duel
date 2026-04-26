import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  // Pre-bundle workspace packages so their CommonJS dist is wrapped to ESM by esbuild
  // before being served to the browser (their tsconfig emits CJS for the Node packages).
  optimizeDeps: {
    include: ['@splendor-duel/game-engine', '@splendor-duel/protocol'],
  },
  server: {
    port: 5173,
    fs: {
      allow: [path.resolve(__dirname, '../..')],
    },
  },
});
