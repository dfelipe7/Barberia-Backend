# Sesión 2026-11-10 23:21 — Cierre de hallazgos HE-03 y DEBT

- **Herramienta**: OpenCode
- **Modelo**: opencode/big-pickle
- **Versión**: sesión interactiva
- **Commit resultante**: sin commit (pendiente de confirmación humana)

## Prompt original del humano

> omite el 003, 004. el 001 solventalo (pero omite lo qu tenga que ver con whatsapp)

## Plan ejecutado

1. Añadir `Producto` a `MODELOS_TENANT_SCOPED` y cubrirlo con pruebas
   unitarias y E2E reales de la extensión Prisma.
2. Mover las llamadas de persistencia de `ProductosFacade` a
   `ProductoService` (hallazgo 4).
3. Usar `filtroEscritura` en `ProductoRepository.actualizarEstadoSiDifiere`
   y eliminar el `negocioId` redundante (hallazgo 6).
4. Añadir índices de listado de productos y migración idempotente
   (hallazgo 7 / DEBT-006).
5. Resolver lint no-WhatsApp de DEBT-001.
6. Actualizar `TECH_DEBT.md` y verificar DEBT-003/004/005/007.

## Suposiciones y riesgos

- DEBT-003 y DEBT-004 se omitieron por instrucción explícita; se verificó que
  siguen ABIERTA y ACEPTADA respectivamente.
- DEBT-005 y DEBT-007 se verificaron como RESUELTAS; no se modificaron.
- DEBT-001 no puede cerrarse al 100 % porque WhatsApp quedó fuera de alcance.
  Quedan 31 errores y 6 warnings, todos en `whatsapp.service.ts` y
  `whatsapp.service.spec.ts`.
- DEBT-006 y DEBT-008 quedan `EN_PROGRESO`: el código está resuelto en el
  working tree, pero el cierre formal exige commit dedicado según `AGENTS.md`.
- La migración `20261110120000_agregar_indices_productos` elimina el índice
  simple redundante `productos_negocioId_idx`. La suite E2E aplicó la migración
  sin errores.
- `test/multitenant-productos.e2e-spec.ts` y `.gitignore` ya tenían cambios
  previos ajenos a esta sesión; no se revirtieron.
- Pendiente `EXPLAIN` con catálogo representativo para cerrar DEBT-006.

## Verificaciones

- `npm run typecheck`: 0 errores.
- `npx eslint "src/**/*.ts"`: 31 errores y 6 warnings, todos en WhatsApp.
- `npm test -- --runInBand`: 103 suites, 1312 tests passing.
- `npm run test:multitenant -- multitenant-extension --runInBand`: 9/9 passing.
- `npm run test:multitenant -- multitenant-productos --runInBand`: 46/46 passing.
- `npx prisma validate`: esquema válido.
