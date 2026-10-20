import { defineConfig } from 'eslint/config'
import tseslint from '@electron-toolkit/eslint-config-ts'
import eslintConfigPrettier from '@electron-toolkit/eslint-config-prettier'
import eslintPluginReact from 'eslint-plugin-react'
import eslintPluginReactHooks from 'eslint-plugin-react-hooks'
import eslintPluginReactRefresh from 'eslint-plugin-react-refresh'

export default defineConfig(
  // .claude holds other checkouts of this repo (session worktrees)
  { ignores: ['**/node_modules', '**/dist', '**/out', '.claude', '.tools'] },
  tseslint.configs.recommended,
  eslintPluginReact.configs.flat.recommended,
  eslintPluginReact.configs.flat['jsx-runtime'],
  {
    settings: {
      react: {
        version: 'detect'
      }
    }
  },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': eslintPluginReactHooks,
      'react-refresh': eslintPluginReactRefresh
    },
    rules: {
      ...eslintPluginReactHooks.configs.recommended.rules,
      ...eslintPluginReactRefresh.configs.vite.rules
    }
  },
  {
    // Build/test helper scripts (plain node scripts, not app code)
    files: ['tests/e2e/helpers/**/*.mjs', 'scripts/**/*.mjs'],
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off'
    }
  },
  {
    // App entry point: renders the root and exports nothing (fast-refresh
    // only-export-components is noise for an entry file)
    files: ['src/renderer/src/main.tsx'],
    rules: {
      'react-refresh/only-export-components': 'off'
    }
  },
  {
    // shadcn/radix-generated UI primitives: these files legitimately export
    // variants/helpers alongside components (fast-refresh warning is noise),
    // use internal props (prop-types) and cmdk-specific DOM attributes.
    files: ['src/renderer/src/components/ui/**'],
    rules: {
      'react-refresh/only-export-components': 'off',
      'react/prop-types': 'off',
      'react/no-unknown-property': 'off'
    }
  },
  {
    // This codebase relies on TypeScript inference for local functions and
    // callbacks; requiring explicit return types everywhere would add 300+
    // annotations with no safety gain (tsc already checks assignability).
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off'
    }
  },
  eslintConfigPrettier
)
