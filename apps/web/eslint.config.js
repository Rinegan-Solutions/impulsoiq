import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'public/mockServiceWorker.js'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // Unused vars are an error, but an underscore prefix marks a deliberate discard.
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
      // Mock handlers and agent payloads legitimately carry loose shapes.
      '@typescript-eslint/no-explicit-any': 'warn',

      // eslint-plugin-react-hooks v6 ships React Compiler rules. This app does
      // not use the compiler, and the pattern these flag here is the standard
      // async data-fetch effect (`useEffect(() => { load(); }, [load])`), which
      // is correct without it. Kept visible as a warning rather than silenced,
      // so it stays on the radar if we adopt the compiler later.
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
);
