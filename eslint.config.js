import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";
import { defineConfig, globalIgnores } from "eslint/config";
import jsxA11y from "eslint-plugin-jsx-a11y";

export default defineConfig([
  globalIgnores(["dist"]),
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
      jsxA11y.flatConfigs.recommended,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      "complexity": ["warn", 20],
      "max-lines": ["warn", {
        max: 500,
        skipBlankLines: true,
        skipComments: true,
      }],
      "no-restricted-imports": ["error", {
        patterns: [
          "./types",
          "./types/index",
          "../types",
          "../types/index",
          "../../types",
          "../../types/index",
          "../../../types",
          "../../../types/index",
          "../../../../types",
          "../../../../types/index",
          "**/src/types",
          "**/src/types/index",
        ],
      }],
    },
  },
  {
    files: ["src/infrastructure/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [
          "../application/*",
          "./application/*",
          "../ui/*",
          "./ui/*",
        ],
      }],
    },
  },
]);
