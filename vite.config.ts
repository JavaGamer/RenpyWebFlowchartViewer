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
      "@": resolve(__dirname, "./src"),
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
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (id.includes("@xyflow/react")) {
              return "react-flow";
            }
            if (id.includes("lucide-react")) {
              return "lucide";
            }
            if (id.includes("@radix-ui")) {
              return "radix-ui";
            }
            if (
              id.includes("/node_modules/react/") ||
              id.includes("/node_modules/react-dom/") ||
              id.includes("\\node_modules\\react\\") ||
              id.includes("\\node_modules\\react-dom\\")
            ) {
              return "react-vendor";
            }
            if (id.includes("elkjs")) {
              return "elkjs";
            }
            if (id.includes("@dagrejs/dagre") || id.includes("graphology")) {
              return "graph";
            }
            if (id.includes("@renpy/ast")) {
              return "renpy-ast";
            }
            if (id.includes("minisearch")) {
              return "minisearch";
            }
          }
        },
      },
    },
  },
});
