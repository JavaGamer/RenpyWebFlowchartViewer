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
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.d.ts",
        "src/main.tsx",
        "src/stubs/**",
        "src/assets/**",
        "src/infrastructure/*Worker.ts",
      ],
      thresholds: {
        perFile: false,
        lines: 75,
        functions: 75,
        branches: 60,
        statements: 75,
      },
    },
  },
});
