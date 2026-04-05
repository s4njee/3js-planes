import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig(() => ({
  define: {
    __ASSET_VERSION__: JSON.stringify(Date.now().toString()),
  },
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react') || id.includes('node_modules/scheduler')) {
            return 'react-vendor';
          }

          if (id.includes('node_modules/@react-three')) {
            return 'r3f-vendor';
          }

          if (id.includes('node_modules/three/addons')) {
            return 'three-addons';
          }

          if (id.includes('node_modules/three')) {
            return 'three-core';
          }

          if (id.includes('node_modules/troika-three-text')) {
            return 'troika-text';
          }

          if (id.includes('/src/monolith/')) {
            return 'monolith-runtime';
          }
        },
      },
    },
  },
}));
