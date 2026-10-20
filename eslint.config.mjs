// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs'],
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
      'test/multitenant-*.e2e-spec.ts',
      'test/helpers/mariadb-test-container.ts',
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
      'test/multitenant-*.e2e-spec.ts',
      'test/helpers/mariadb-test-container.ts',
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
      "prettier/prettier": ["error", { endOfLine: "auto" }],
    },
  },
);
