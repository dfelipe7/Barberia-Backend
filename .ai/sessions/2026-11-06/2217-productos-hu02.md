# HE-03-HU-02 — Consultar listado y detalle administrativo de productos

- **Herramienta**: OpenCode
- **Modelo**: unknown
- **Sesión**: 2026-11-06T22:17:00-05:00
- **Commit resultante**: sin commit (pendiente de aprobación humana)
- **Rama**: `feature/gestion-productos`

---

## Prompt original del humano (resumen literal de los criterios)

> "Visualización de productos
> Dado que el administrador ha iniciado sesión y se encuentra en el módulo de productos
> Cuando acceda al listado de productos
> Entonces el sistema deberá mostrar los productos registrados junto con su nombre, descripción, precio, imagen y estado."
>
> "Identificación del estado
> Dado que existen productos registrados con diferentes estados
> Cuando el administrador consulte el listado
> Entonces el sistema deberá permitir identificar cuáles productos se encuentran activos y cuáles inactivos."
>
> "Catálogo sin productos registrados
> Dado que no existen productos registrados en el sistema
> Cuando el administrador acceda al listado
> Entonces el sistema deberá mostrar un mensaje indicando que no existen productos registrados."
>
> "Consulta de información del producto
> Dado que existen productos registrados
> Cuando el administrador seleccione un producto del listado
> Entonces el sistema deberá mostrar la información completa registrada para dicho producto."

Restricciones del encargo: solo backend, sin frontend; tenant desde contexto validado por servidor; roles/permisos; aislamiento con dos tenants; no declarar pruebas sin ejecutarlas; commit solo con aprobación humana.

---

## Plan ejecutado

1. `GET /productos`: listado administrativo del negocio del contexto, activos e inactivos, orden estable `creadoEn DESC, id DESC`.
2. `GET /productos/:productoId`: detalle completo; producto inexistente o de otro negocio responde 404 uniforme.
3. Respuesta de listado `{ productos: ProductoResponseDto[], mensaje?: string }`, siguiendo el mecanismo existente de `MisReservasResponseDto` para listas vacías.
4. Flujo `ProductosController → ProductosFacade → ProductoService → ProductoRepository → Prisma`; el controlador solo delega.
5. Aislamiento en el `where` de Prisma mediante `NegocioAislamientoService.filtroLectura()`.
6. Swagger documentado con `@ApiOperation`, `@ApiOkResponse`, `@ApiNotFoundResponse`, `@ApiParam` y `@ApiNegocioHeader`.
7. Pruebas unitarias de controlador, fachada, servicio y repositorio; e2e con MySQL 8.0 real y dos negocios.

---

## Contratos finales

### `GET /productos`

- Guards: `JwtAuthGuard` + `RolesGuard`; roles `SUPERADMIN`, `ADMINISTRADOR`.
- El `SUPERADMIN` es de la membresía del negocio: puede consultar el catálogo de su barbería, no el de otro tenant.
- Tenant: `X-Negocio-Slug` validado por el middleware; nunca desde query/body.
- 200:

```json
{
  "productos": [
    {
      "id": 1,
      "nombre": "Cera mate",
      "descripcion": "Fijación fuerte",
      "precio": 35000.5,
      "imagenUrl": "/uploads/negocios/1/productos/cera.png",
      "estado": "ACTIVO",
      "creadoEn": "2026-11-06T...",
      "actualizadoEn": "2026-11-06T..."
    }
  ]
}
```

- Sin productos: 200 `{ "mensaje": "No existen productos registrados", "productos": [] }`.
- 401 sin token; 403 sin rol o sin contexto de negocio válido.

### `GET /productos/:productoId`

- Mismos guards y tenant.
- 200: `ProductoResponseDto` completo.
- 400 si el id no es entero positivo.
- 404 uniforme para producto inexistente o de otro negocio: `"El producto no se encuentra disponible"`.

No se añadió paginación: los listados administrativos existentes (`/reservas/admin`, `/servicios/gestion`) tampoco la tienen. Se conserva el orden estable.

---

## Matriz criterio → prueba → resultado

| Criterio original | Prueba | Resultado |
|---|---|---|
| Visualización de productos | e2e `[Visualización de productos] el listado devuelve nombre, descripción, precio, imagen y estado` | PASS |
| Identificación del estado | e2e `[Identificación del estado] el listado distingue productos ACTIVO e INACTIVO` | PASS |
| Catálogo sin productos registrados | e2e `[Catálogo sin productos registrados] responde colección vacía y mensaje sin error de servidor` | PASS |
| Consulta de información del producto | e2e `[Consulta de información del producto] el detalle devuelve toda la información registrada` | PASS |
| Aislamiento entre tenants | e2e `[Aislamiento] ni el listado ni el detalle revelan productos de otro tenant` | PASS |
| SUPERADMIN de la barbería | e2e `[SUPERADMIN] el superadministrador de la barbería consulta su catálogo y no accede a otro tenant` | PASS |
| Permisos | e2e `[Permisos] el listado y el detalle exigen rol administrativo y token` | PASS |
| Validación de identificador | e2e `[Validación] el detalle rechaza identificadores no positivos o no numéricos` | PASS |

Pruebas unitarias añadidas: delegación del controlador, coordinación de fachada, mensaje de lista vacía, mapeo de estados, 404 de detalle y filtro tenant en repositorio. El e2e de aislamiento compara explícitamente `status` y `message` entre producto ajeno e inexistente.

---

## Verificaciones ejecutadas

| Comando | Resultado |
|---|---|
| `npm run typecheck` | PASS — 0 errores |
| `npx eslint src/modules/productos test/multitenant-productos.e2e-spec.ts` | PASS — 0 errores/warnings |
| `npx jest --runInBand src/modules/productos` | PASS — 5 suites / 37 tests |
| `npx jest --config ./test/jest-multitenant.json test/multitenant-productos.e2e-spec.ts --runInBand` | PASS — 15/15 tests con MySQL 8.0 real |
| `npm run build` | PASS |
| `npm test -- --runInBand` | FALLA — 1 suite / 1 test de 103 suites y 1250 tests: `src/common/config/uploads.config.spec.ts:117` tiene un `describe` anidado dentro de `it('separa las imágenes de producto del resto del negocio')`. Causa: resolución del merge `b012289`, no HU-01. Registrado como `DEBT-007`. |

---

## Riesgos, suposiciones y deuda vecina

- El contrato de listado es un objeto `{ productos, mensaje? }`, no un array directo, para cumplir el criterio de mensaje sin inventar un endpoint. Es el mismo mecanismo de `MisReservasResponseDto`.
- `ProductosListadoResponseDto` existe explícitamente con `@ApiProperty` para `productos` y `@ApiPropertyOptional` para `mensaje`.
- El filtro de negocio vive en el `where` de Prisma (`filtroLectura()`), no en un `if` posterior a la lectura.
- No se añadieron índices nuevos. La sugerencia `@@index([negocioId, creadoEn, id])` quedó registrada como `DEBT-006` (BAJA), con cierre vía `EXPLAIN` sobre catálogo grande.
- El detalle ajeno usa 404, no 403, para no revelar existencia entre negocios.
- Deuda vecina detectada y registrada como `DEBT-007`: el merge `b012289` anidó un `describe` dentro de un `it` en `uploads.config.spec.ts:117`. HU-01 (`3cdd88f`) sí modifica el archivo, pero añade su `it` correctamente; el anidamiento aparece en la resolución del merge, no en HU-01. Es preexistente a HU-02 y no se corrigió por estar fuera de alcance.
- Verificación de autoría del fallo: `git log --full-history --oneline -- src/common/config/uploads.config.spec.ts` muestra `b012289`, `0f7085c`, `46b92e7` y `3cdd88f`; `git show 46b92e7` y `git show 3cdd88f` muestran ambos bloques en el nivel correcto; `git show b012289 -- src/common/config/uploads.config.spec.ts` evidencia que la resolución del merge movió el `describe` dentro del `it`.
- No se implementaron HU-03..HU-05, edición, cambio de estado, inventario, ventas, pagos ni frontend.

---

## Estado del historial

- HU-01 ya está commiteada en `3cdd88f` (`feat(productos): HE-03-HU-01 registrar producto con imagen opciona`).
- HU-02 no modifica `prisma/schema.prisma`, migraciones ni `src/common/config/uploads.config.spec.ts`.
- `git status` muestra solo los 11 archivos de HU-02, `TECH_DEBT.md` y esta bitácora.

## Pendiente de confirmación

- [ ] Commit atómico `feat(products): consultar listado y detalle administrativo [HE-03-HU-02]`
- [ ] Incluir `TECH_DEBT.md` (DEBT-006 y DEBT-007) en el commit o separarlo en `docs(tech-debt): añade DEBT-006 y DEBT-007`
- [ ] Push / PR
