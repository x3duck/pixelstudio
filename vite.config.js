import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// two pages: the flame-headed swordsman (index.html) and the earth mage (mage.html).
// three.js alone is a ~700 kB chunk; raise the warning threshold so builds stay quiet.
export default defineConfig({
  build: {
    chunkSizeWarningLimit: 1000,
    rolldownOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        mage: resolve(import.meta.dirname, 'mage.html'),
      },
    },
  },
});
