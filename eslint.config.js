import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

const browserGlobals = {
  AbortController: 'readonly',
  AbortSignal: 'readonly',
  Blob: 'readonly',
  BroadcastChannel: 'readonly',
  CustomEvent: 'readonly',
  Element: 'readonly',
  Event: 'readonly',
  File: 'readonly',
  FormData: 'readonly',
  HTMLTextAreaElement: 'readonly',
  Intl: 'readonly',
  KeyboardEvent: 'readonly',
  localStorage: 'readonly',
  NodeJS: 'readonly',
  ResizeObserver: 'readonly',
  setInterval: 'readonly',
  setTimeout: 'readonly',
  clearInterval: 'readonly',
  clearTimeout: 'readonly',
  window: 'readonly',
  document: 'readonly',
  console: 'readonly',
  fetch: 'readonly',
};

const nodeGlobals = {
  Buffer: 'readonly',
  NodeJS: 'readonly',
  clearInterval: 'readonly',
  clearTimeout: 'readonly',
  console: 'readonly',
  process: 'readonly',
  setInterval: 'readonly',
  setTimeout: 'readonly',
  URL: 'readonly',
};

export default tseslint.config(
  {
    linterOptions: {
      reportUnusedDisableDirectives: 'off',
    },
  },
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.vercel/**',
      '**/.venv/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      'referenceUI/**',
      'trade-chart-client-refference/**',
      'seed-data/**',
      'docs/**',
      'agent/**',
      'python-screener-service/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: [
      'client/**/*.{js,mjs,cjs,ts,tsx}',
      'server/**/*.{js,mjs,cjs,ts,tsx}',
      'dev/**/*.{js,mjs,cjs}',
      'scripts/**/*.{js,mjs,cjs}',
    ],
    languageOptions: {
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
      globals: {
        ...browserGlobals,
        ...nodeGlobals,
        __APP_VERSION__: 'readonly',
      },
    },
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      'no-console': 'off',
      'no-debugger': 'error',
      'no-empty': 'off',
      'no-func-assign': 'off',
      'no-prototype-builtins': 'off',
      'no-undef': 'off',
      'no-useless-escape': 'off',
      'no-unused-expressions': 'off',
      'no-useless-assignment': 'off',
      'preserve-caught-error': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'off',
    },
  },
  {
    files: ['client/e2e/**/*.ts', 'client/src/**/*.test.{ts,tsx}', 'client/src/__tests__/**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        expect: 'readonly',
      },
    },
  }
);
