import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          './types',
          './types/index',
          '../types',
          '../types/index',
          '../../types',
          '../../types/index',
          '../../../types',
          '../../../types/index',
          '../../../../types',
          '../../../../types/index',
          '**/src/types',
          '**/src/types/index',
        ],
      }],
    },
  },
  {
    files: ['src/domain/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          '../parser/*',
          '../infrastructure/*',
          '../application/*',
          '../ui/*',
        ],
      }],
    },
  },
  {
    files: ['src/parser/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          '../application/*',
          './application/*',
          '../infrastructure/*',
          './infrastructure/*',
          '../ui/*',
          './ui/*',
        ],
      }],
    },
  },
  {
    files: ['src/infrastructure/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          '../application/*',
          './application/*',
          '../ui/*',
          './ui/*',
        ],
      }],
    },
  },
  {
    files: ['src/application/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          '../ui/*',
          './ui/*',
        ],
      }],
    },
  },
])
