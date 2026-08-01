import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    exclude: ["tests/perf/**"],
    setupFiles: ["./tests/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: [
        "src/parser/parser.ts",
        "src/parser/parserTokens.ts",
        "src/parser/tokenHandling.ts",
        "src/parser/tokenScanStage.ts",
      ],
      thresholds: {
        perFile: true,
        lines: 85,
        functions: 85,
        branches: 80,
        statements: 85,
      },
    },
  },
});
