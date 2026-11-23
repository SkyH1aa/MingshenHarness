import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    build: {
      // Keep each sandbox preload self-contained. electron-vite 6 provides
      // isolatedEntries for independent multi-entry bundles in build/watch.
      externalizeDeps: false,
      isolatedEntries: true,
      rolldownOptions: {
        input: {
          index: resolve(__dirname, "src/preload/index.ts"),
          startup: resolve(__dirname, "src/preload/startup.ts"),
          companion: resolve(__dirname, "src/preload/companion.ts"),
        },
        output: {
          entryFileNames: "[name].js",
        },
      },
    },
  },
  renderer: {
    resolve: { dedupe: ["react", "react-dom"] },
    plugins: [react()],
    build: {
      rolldownOptions: {
        input: {
          index: resolve(__dirname, "src/renderer/index.html"),
          startup: resolve(__dirname, "src/renderer/startup.html"),
          companion: resolve(__dirname, "src/renderer/companion.html"),
        },
      },
    },
  },
});
