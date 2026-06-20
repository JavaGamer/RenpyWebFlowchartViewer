import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";

// https://vite.dev/config/
export default defineConfig({
  base: "/RenpyWebFlowchartViewer/",
  plugins: [react(), tailwindcss()],
  server: {
    watch: {
      ignored: ["**/node_modules/**", "**/.deno/**", "**/.git/**"],
    },
  },
  resolve: {
    alias: {
      // Browser stubs for Node.js built-ins used by @renpy/ast
      "node:fs/promises": resolve(__dirname, "src/stubs/fs-stub.ts"),
      "node:fs": resolve(__dirname, "src/stubs/fs-stub.ts"),
      console: resolve(__dirname, "src/stubs/console-stub.ts"),
    },
  },
  optimizeDeps: {
    include: ["@renpy/ast"],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          "react-vendor": ["react", "react-dom"],
          "react-flow": ["@xyflow/react"],
          "graph": ["@dagrejs/dagre", "graphology"],
        },
      },
    },
  },
});
