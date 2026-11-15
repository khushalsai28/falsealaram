import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: false,
    rollupOptions: {
      input: resolve(__dirname, "src/content.ts"),
      output: {
        format: "iife",
        entryFileNames: "content.js",
      },
    },
  },
});
