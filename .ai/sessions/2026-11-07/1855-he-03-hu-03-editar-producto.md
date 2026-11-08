# HE-03-HU-03 — Editar información del producto

- Herramienta: OpenCode
- Modelo: unknown
- Versión: OpenCode CLI
- Commit resultante: sin commit
- Prompt original: no disponible literalmente en esta sesión; continuación de la tarea HE-03-HU-03 (edición administrativa de producto).

## Plan ejecutado

1. DTO parcial `ActualizarProductoDto` con rechazo de campos internos por el `ValidationPipe` global.
2. Validación de negocio en `ProductoService`: campos omitidos o con el mismo valor no generan escritura, descripción vacía/null limpiada, nombre/precio nulos o inválidos rechazados, duplicado por negocio y 404 uniforme.
3. Repositorio con `update` acotado por negocio, traducción de `P2002`/`P2025` y consulta de imágenes compartidas.
4. Fachada con guardado de imagen nueva, compensación si falla la BD y limpieza de la imagen anterior solo si no está compartida.
5. Controlador `PATCH /productos/:productoId` con guards, roles, Swagger y multipart opcional.
6. Pruebas unitarias y e2e de criterios, aislamiento, permisos, validación e imágenes.

## Suposiciones y riesgos

- Una edición sin cambios reales devuelve el producto actual sin escribir de nuevo en BD.
- La imagen anterior solo se elimina después de confirmar la actualización y si ningún otro producto del mismo negocio la referencia.
- El fallo al limpiar un archivo antiguo se registra como advertencia y no convierte la respuesta en 500.
- `npm run lint` completo sigue reportando errores preexistentes fuera de `productos` (whatsapp, reservas, servicios, multer y extensión Prisma). Los archivos tocados pasan ESLint sin errores.

## Verificaciones

- `npm run typecheck`: 0 errores.
- `npx eslint "src/modules/productos/**/*.ts" "test/multitenant-productos.e2e-spec.ts"`: 0 errores.
- `npm test -- productos --runInBand`: 63/63 passing.
- `npm run test:multitenant -- multitenant-productos`: 25/25 passing.
- `npm run build`: OK.
