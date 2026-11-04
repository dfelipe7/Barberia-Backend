/**
 * Trazabilidad:
 * - REQ: REQ-009
 * - Modelo ejecutor: minimax-m3.1-flash-free
 * - Propósito: permitir que ESLint analice la suite E2E nueva, que vive fuera de tsconfig.json.
 * - Responsabilidad: configuración de ESLint. No define reglas de negocio.
 */
// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs', 'test/**/*.js'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // Los scripts de migración (`prisma/multitenant`) y las pruebas de
    // integración de la migración viven fuera de `tsconfig.json`, que solo
    // incluye `src/**`. Se desactiv aquí `projectService` (heredado del
    // bloque anterior) para poder asignarles un proyecto de TypeScript
    // propio: `project` y `projectService` son mutuamente excluyentes.
    //
    // El alcance se limita a los archivos NUEVOS de esta fase: el resto de
    // `test/` conserva el análisis previo (sin cambios en su resultado).
    files: [
      'prisma/multitenant/**/*.ts',
      'test/**/*.ts',
    ],
    languageOptions: {
      parserOptions: {
        projectService: false,
      },
    },
  },
  {
    files: [
      'prisma/multitenant/**/*.ts',
      'test/**/*.ts',
    ],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.lint-multitenant.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      "prettier/prettier": ["error", { endOfLine: "auto" }],
    },
  },
  {
    // Archivos de pruebas: en Jest, las aserciones (expect(mock).toHaveBeenCalled())
    // y los mocks dinámicos entran en conflicto con reglas de tipado estricto
    // pensadas para código de producción (DEBT-001 Fase 1).
    files: ['**/*.spec.ts', '**/*.e2e-spec.ts', 'test/**/*.ts'],
    rules: {
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
);
