import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'
import eslintConfigPrettier from 'eslint-config-prettier'

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
  },
  {
    // shadcn primitives export their cva variant helpers next to the
    // component (buttonVariants, toggleVariants, …), and Plate plugin
    // modules export plugin objects next to their element components.
    files: ['src/components/ui/**/*.tsx', 'src/editor/plate/**/*.tsx'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
  {
    // Every color comes from a theme token (src/styles/themes.css), so no
    // hex literals in UI code. Matches #rgb / #rrggbb / #rrggbbaa as a whole
    // word, which leaves anchors like "#add-note" alone.
    files: ['src/{components,views,onboarding,editor,app}/**/*.tsx'],
    ignores: ['**/*.test.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'Literal[value=/(^|[^\\w-])#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})(?![\\w-])/]',
          message:
            'No hex colors in UI code: use a theme token (bg-brand, text-muted-foreground, var(--chip), …).',
        },
        {
          selector:
            'TemplateElement[value.raw=/(^|[^\\w-])#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})(?![\\w-])/]',
          message:
            'No hex colors in UI code: use a theme token (bg-brand, text-muted-foreground, var(--chip), …).',
        },
      ],
    },
  },
  eslintConfigPrettier,
])
