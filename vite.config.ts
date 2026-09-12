import { defineConfig } from "vite";
import { resolve } from "node:path";

/**
 * Multi-page build: the main playground app plus standalone Interactive
 * Reasoning Debugger pages (debuggers/*.html), each openable on its own.
 * Add a new entry here whenever a new debuggers/<module>.html is created.
 */
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        debuggersIndex: resolve(__dirname, "debuggers/index.html"),
        debuggersSudoku: resolve(__dirname, "debuggers/sudoku.html"),
        debuggersZebra: resolve(__dirname, "debuggers/zebra.html"),
        debuggersKenKen: resolve(__dirname, "debuggers/kenken.html"),
        debuggersHitori: resolve(__dirname, "debuggers/hitori.html"),
        debuggersVDP: resolve(__dirname, "debuggers/vdp.html"),
      },
    },
  },
});
