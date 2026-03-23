import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig({
  plugins: [
    react(),
    nodePolyfills({
      globals: { Buffer: true, global: true, process: true },
      // SIN ESTO el polyfill solo llega al código de la app, pero NO al
      // código pre-buildeado de @coral-xyz/anchor en node_modules.
      // Anchor usa Buffer.from() internamente al serializar args tipo string
      // con su coder de Borsh — eso causa el "Received type undefined".
      protocolImports: true,
    }),
  ],
  define: {
    global: 'globalThis',
  }
});