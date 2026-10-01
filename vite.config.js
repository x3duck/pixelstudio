import { defineConfig } from 'vite';

// three.js alone is a ~700 kB chunk; raise the warning threshold so builds stay quiet.
export default defineConfig({
  build: { chunkSizeWarningLimit: 1000 },
});
