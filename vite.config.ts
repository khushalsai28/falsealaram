import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        background: resolve(__dirname, "src/background.ts"),
        "src/popup/index": resolve(__dirname, "src/popup/index.html"),
        "src/options/index": resolve(__dirname, "src/options/index.html"),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === "background" ? "[name].js" : "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
