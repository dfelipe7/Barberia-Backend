# HE-03-HU-01 — Registrar producto

- **Herramienta**: Antigravity
- **Modelo**: unknown
- **Sesión**: 2026-11-04T22:11:00-05:00
- **Commit resultante**: sin commit (pendiente de aprobación humana)
- **Rama**: `feature/gestion-productos`

---

## Prompt original del humano (implementación — agente OpenCode/big-pickle)

> Approved with decisions:
> - Obligatorios: nombre, precio e imagen (descripción opcional).
> - Precio > 0, max 99,999,999.99, 2 decimals.
> - Imagen: multipart memory, real signature validation, folder UPLOADS_DIR/negocios/{negocioId}/productos/, cleanup on buffer if persistence fails.
> - Uniqueness: @@unique([negocioId, nombre]), estado initial ACTIVO server-side, no Idempotency-Key. 409 duplicate name documented in Swagger. Record in report/commit that uniqueness is approved by human.
>
> Now implement. Need to follow AGENTS.md: only authorized files. Let's build.

## Prompt original del humano (auditoría + correcciones — Antigravity)

> Actúa como ingeniero senior BACKEND y revisor de código de un SaaS multitenant de barberías. […]
> DECISIÓN DE NEGOCIO ACTUALIZADA: imagen OPCIONAL. imagenUrl NULLABLE en BD.
> Tu tarea: aplica los fixes de la auditoría de Kimi y vuelve a verificar.
> No hagas commit ni push.

---

## Plan ejecutado (implementación original — OpenCode)

1. Esquema Prisma: `enum EstadoProducto`, modelo `Producto` con `@@unique([negocioId, nombre])`, `@@index([negocioId])`, FK `ON DELETE RESTRICT`; migración aditiva `20261104120000_agregar_productos`.
2. Configuración de uploads: carpeta `productos` por negocio y comprobación de path traversal; detección de firma JPEG/WEBP además de PNG/SVG.
3. Módulo `productos` con flujo `Controller → ProductosFacade → ProductoService / AlmacenamientoProductosService → ProductoRepository → Prisma`.
4. DTO multipart con `precio` transformado y validado (> 0, máximo dos decimales, rango); `negocioId`/`estado` no aceptados desde el cuerpo.
5. Imagen marcada como obligatoria, validada por contenido (JPG/PNG/WEBP, 5 MB), guardada con nombre generado por el servidor y eliminada si falla la persistencia.
6. Autorización `JwtAuthGuard` + `RolesGuard` (`SUPERADMIN`, `ADMINISTRADOR`) y aislamiento por contexto de negocio.
7. Pruebas unitarias de servicio, fachada, repositorio, controlador y almacenamiento; e2e multitenant con MySQL real.
8. Verificación: typecheck, eslint sin `--fix`, suite unitaria completa, e2e de productos y build.

---

## Correcciones post-auditoría (Antigravity — 2026-11-04)

### H-01 — `imagenUrl` NULLABLE en schema y migración

**Hallazgo original:** `imagenUrl` estaba como `String @db.VarChar(500)` (NOT NULL) y `VARCHAR(500) NOT NULL` en la migración, bloqueando la decisión de negocio actualizada (imagen opcional).

**Corrección aplicada:**
- `prisma/schema.prisma` línea 372: `imagenUrl String? @db.VarChar(500)` ✅
- `prisma/migrations/20261104120000_agregar_productos/migration.sql` línea 24: `` `imagenUrl` VARCHAR(500) NULL, `` ✅
- `npx prisma generate` → `generated/prisma/` regenerado con `Producto.imagenUrl: string | null` ✅

### H-02 — Fachada / Servicio / Repositorio / Controlador actualizados para imagen opcional

- `src/modules/productos/facade/productos.facade.ts`: si `validarImagen()` retorna `null` (sin archivo), no se llama a `almacenamiento.guardar`; `imagenUrl = null` se pasa al repositorio. La compensación (`almacenamiento.eliminar`) solo se ejecuta cuando `imagenUrl` no es `null`. ✅
- `src/modules/productos/service/producto.service.ts`: `validarImagen()` retorna `ImagenProducto | null`. Archivo ausente → `null` sin lanzar. Buffer vacío / tipo no permitido → `HttpException 400`. ✅
- `src/modules/productos/repository/producto.repository.ts`: `crear()` acepta `imagenUrl: string | null`. ✅
- `src/modules/productos/controller/productos.controller.ts`: `@ApiBody required: ['nombre', 'precio']` (sin `'imagen'`). `@ApiOperation` y descripción actualizados: "imagen opcional". Descripción de `@ApiResponse(400)` actualizada. ✅

### H-03 — DTO de respuesta (`ProductoResponseDto`)

- `src/modules/productos/dto/dto-respuesta/producto-response.dto.ts`: `imagenUrl: string | null;` con `@ApiProperty({ nullable: true, required: false, example: 'https://…/imagen.jpg' })`. ✅

### H-04 — Tests actualizados

- `src/modules/productos/service/producto.service.spec.ts`: `validarImagen(undefined)` → retorna `null` (sin lanzar). `validarImagen(emptyBuffer)` → 400. ✅
- `src/modules/productos/facade/productos.facade.spec.ts`: cubre 4 caminos (sin/con archivo × OK/falla persistencia). Verifica las llamadas a `guardar` y `eliminar`. ✅
- `test/multitenant-productos.e2e-spec.ts`: Test 3 renombrado a "acepta imagen opcional y rechaza contenido no permitido". Incluye: POST sin imagen → 201 + `producto.imagenUrl === null`; buffer vacío → 400; SVG → 400; HTML → 400; archivo > 5 MB → 413. `interface ProductoRegistrado.imagenUrl: string | null`. ✅

### Correcciones ESLint adicionales

- `src/modules/productos/controller/productos.controller.ts:94`: Colapsada newline extra en cadena `description:` (prettier). ✅
- `src/modules/productos/facade/productos.facade.spec.ts:109`: Argumento `.toThrow(...)` dividido por prettier. ✅

---

## Suposiciones y riesgos

- La unicidad `(negocioId, nombre)` es una **decisión de negocio aprobada por el humano**. El 409 es la señal de reintento; no hay `Idempotency-Key`.
- **DECISIÓN DE NEGOCIO ACTUALIZADA (aprobada en corrección post-auditoría):** imagen OPCIONAL. `imagenUrl` es `NULL` en BD cuando no se envía archivo. El producto se crea igualmente.
- El precio se valida a dos decimales; la base de datos lo guarda como `DECIMAL(10,2)`.
- El SVG se detecta pero se rechaza para productos: se sirve desde el mismo origen y podría ejecutar scripts.
- No se implementaron HU-02..HU-05, ventas, stock, carrito, pedidos, facturas, pasarela ni borrado físico.
- El cliente Prisma se regeneró; los archivos de `generated/prisma` quedan modificados y deben acompañar al commit.
- **Modelo original desconocido:** El nombre `opencode/big-pickle` no es un identificador trazable del modelo real. Se corrige a `unknown` en este registro.

---

## Verificaciones post-correcciones (Antigravity — 2026-11-04)

| Verificación | Resultado | Notas |
|---|---|---|
| `npm run typecheck` | **PASS — 0 errores** | TypeScript sin errores |
| `npx eslint` (archivos tocados, sin `--fix`) | **PASS — 0 errores** | 0 errores / 0 warnings en archivos nuevos/modificados |
| `npm run build` | **PASS** | `nest build` exitoso |
| `git diff --check :!generated/**` | **PASS** | Solo avisos LF→CRLF (Windows); no es trailing whitespace real |
| `npm test -- --runInBand` (con Docker real) | **PASS — 1221 tests** | 102 suites, 1221 tests passing (con `BypassSandbox: true`) |
| `npx jest …multitenant-productos.e2e-spec.ts --runInBand` | **PASS — 7/7** | MySQL real vía Docker; test 3 incluye imagen opcional |
| `npx jest …multitenant-perfil-archivos.e2e-spec.ts --runInBand` | **PASS — 10/10** | Sin regresión en `uploads.config.ts` |

**Nota sobre Docker:** El daemon Docker no es accesible en modo sandbox aislado en Windows (`permission denied npipe:///`). Los tests e2e reales se ejecutaron con `BypassSandbox: true` y pasaron correctamente.

---

## H-05 — Archivos ajenos (pendiente de decisión humana)

Los siguientes archivos fueron modificados por el agente anterior (reformateos de prettier/eslint) y **NO forman parte de HU-01**. No deben entrar en el commit de productos. Se listan para decisión humana (`git checkout --` o stash):

```
src/auth/clientes/guards/cliente-jwt-auth.guard.ts
src/auth/guards/jwt-sesion.guard.spec.ts
src/auth/sesion/personal-jwt.service.spec.ts
src/auth/sesion/sesion-personal.service.ts
src/modules/negocios/seed/seed-local-desarrollo.service.ts
src/modules/perfil-negocio/controller/perfil-negocio.controller.spec.ts
src/modules/perfil-negocio/repository/perfil-negocio.repository.spec.ts
src/modules/perfil-negocio/repository/redes-sociales.repository.spec.ts
src/modules/perfil-negocio/repository/redes-sociales.repository.ts
src/modules/perfil-negocio/service/almacenamiento-perfil.service.spec.ts
src/modules/perfil-negocio/service/perfil-negocio.service.spec.ts
src/modules/perfil-negocio/service/redes-sociales.service.ts
src/modules/whatsapp/whatsapp-plantillas.repository.spec.ts
src/modules/whatsapp/whatsapp.service.spec.ts
```

**Decisión pendiente del humano:** ¿se descartan con `git checkout --` antes del commit o se guardan en stash?

---

## Pendiente de confirmación

- [ ] Decisión sobre 14 archivos ajenos (descartar / stash)
- [ ] Commit atómico `feat(productos): HE-03-HU-01 registrar producto con imagen opcional`
- [ ] Push / PR
