import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `base: './'` keeps the build portable: it works from a sub-path and inside a
// Capacitor WebView (capacitor://localhost, file://).
//
// The alias is resolved from `import.meta.url` rather than `__dirname`, because
// package.json sets "type": "module" and this config is loaded as ESM, where
// __dirname does not exist.
export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: { host: true, port: 5173 },
  build: { outDir: 'dist', sourcemap: true },
});
