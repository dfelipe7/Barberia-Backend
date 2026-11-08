# HE-03-HU-04 — Controlar estado y disponibilidad del producto

- Herramienta: OpenCode
- Modelo: unknown
- Versión: OpenCode CLI
- Commit resultante: sin commit
- Prompt original: no disponible literalmente en esta sesión; continuación de HE-03-HU-04 con alcance confirmado por el humano: solo `PATCH /productos/:productoId/estado`, sin catálogo público (HU-05).

## Plan ejecutado

1. DTO `CambiarEstadoProductoDto` con estado explícito `ACTIVO | INACTIVO`.
2. `ProductoService.cambiarEstadoProducto`: 404 uniforme para producto ajeno/inexistente; escritura condicional y lectura posterior para responder el estado actual.
3. `ProductoRepository.actualizarEstadoSiDifiere`: `updateMany` con filtro `{ id, negocioId, estado: { not: estado } }`, de modo que dos peticiones concurrentes al mismo estado no reescriben la fila.
4. `ProductosFacade.cambiarEstado` como punto de entrada del caso de uso, inyectando el `negocioId` del contexto.
5. `PATCH /productos/:productoId/estado` con `JwtAuthGuard`, `RolesGuard`, roles `SUPERADMIN`/`ADMINISTRADOR` y Swagger.
6. Pruebas unitarias y e2e de los cuatro criterios de aceptación, idempotencia secuencial y concurrente, concurrencia con estados distintos, aislamiento y permisos.

## Matriz de criterios de aceptación

- Desactivación de un producto: e2e deja `INACTIVO` en BD y en el listado administrativo; se interpreta como no disponible para clientes (el catálogo público es HU-05).
- Activación de un producto: e2e devuelve `ACTIVO` en BD y en el listado administrativo.
- Conservación de información: e2e verifica que `id`, `negocioId`, `nombre`, `descripcion`, `precio`, `imagenUrl` y `creadoEn` no cambian; solo cambian `estado` y `actualizadoEn`.
- Confirmación del cambio de estado: e2e verifica 200, mensaje de confirmación y producto con el estado nuevo.
- Extras: idempotencia secuencial, idempotencia concurrente al mismo estado, concurrencia con estados distintos, aislamiento entre negocios (404 uniforme), permisos por rol y validación del DTO.

## Suposiciones y riesgos

- No se añadió catálogo público de productos: se implementará y probará en HU-05.
- CA-01 se verificó con el listado administrativo de HU-02 y consulta directa a BD, según indicación humana.
- No se modificaron `prisma/schema.prisma`, migraciones, `uploads.config.ts` ni `detectar-tipo-archivo.ts`.
- No se añadieron índices ni migraciones; `estado` ya existe desde HU-01.
- La idempotencia concurrente se garantiza con `updateMany` condicional; no se añadieron transacciones ni bloqueos explícitos.

## Verificaciones

- `npm run typecheck`: 0 errores.
- `npx eslint "src/modules/productos/**/*.ts" "test/multitenant-productos.e2e-spec.ts"`: 0 errores.
- `npm test -- productos --runInBand`: 70/70 passing.
- `npm run test:multitenant -- multitenant-productos`: 35/35 passing.
- `npm run build`: OK.
