import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Three builds: (default) popup+options HTML + static files, then content & background as
// self-contained IIFE bundles (content scripts cannot use ES-module imports).
export default defineConfig(({ mode }) => {
  const r = (p: string) => resolve(__dirname, p);
  if (mode === 'content' || mode === 'background') {
    return {
      publicDir: false,
      envDir: __dirname,
      build: {
        outDir: r('dist'), emptyOutDir: false, target: 'chrome110',
        lib: { entry: r(`src/${mode}/index.ts`), name: `FalseAlarm_${mode}`, formats: ['iife'] as const, fileName: () => `${mode}.js` },
      },
    };
  }
  return {
    root: r('src'), base: './', publicDir: r('public'), envDir: __dirname,
    build: {
      outDir: r('dist'), emptyOutDir: true, target: 'chrome110',
      rollupOptions: { input: { popup: r('src/popup/popup.html'), options: r('src/options/options.html') } },
    },
  };
});
