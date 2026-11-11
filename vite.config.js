import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// aree della mappa (public/mappa/aree, src/data/aree.js): il gioco le scarica; nella pagina autosufficiente sono dentro
function areeMappa(mode) {
  const id = 'virtual:aree-mappa';
  return {
    name: 'aree-mappa',
    resolveId: (s) => (s === id ? '\0' + id : null),
    load(s) {
      if (s !== '\0' + id) return null;
      if (mode !== 'single') return 'export default null;';
      const { aree } = JSON.parse(readFileSync('src/data/padova-map.json', 'utf8'));
      if (!aree) return 'export default null;';
      return 'export default [' + aree.chiavi.map((k) => readFileSync(`public/mappa/aree/${k}.json`, 'utf8')).join(',') + '];';
    },
  };
}

export default defineConfig(({ mode }) => ({
  base: './',
  plugins: mode === 'single' ? [areeMappa(mode), viteSingleFile()] : [areeMappa(mode)],
  build: {
    outDir: mode === 'single' ? 'dist-single' : 'dist',
    copyPublicDir: mode !== 'single',
    chunkSizeWarningLimit: 6000, // la rete della mappa (OSM + GTFS) è inclusa nel bundle; le aree no (public/mappa/aree)
  },
  server: { host: true },
}));
