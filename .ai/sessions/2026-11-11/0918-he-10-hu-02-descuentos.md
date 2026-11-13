# HE-10-HU-02 — Crear un descuento para un producto o servicio

- **Herramienta**: Antigravity
- **Modelo**: Gemini 3.8 Flash
- **Sesión**: 2026-11-11T09:18:00-05:00
- **Commit resultante**: sin commit (pendiente de aprobación humana)
- **Rama**: `feature/gestion-descuentos`

---

## Prompt original del humano

> haz esto (ya hay cosas implementadas):HE-10-HU-02 — Crear un descuento para un producto o servicio
> "Identificador original: HE-10-HU-02
> Referencia normalizada: HE-10-HU-02
> Como: Administrador
> Quiero: Crear un descuento para un producto o servicio
> Para: Definir un porcentaje y los días de la semana en que se aplicará el beneficio comercial."
> Actúa como ingeniero senior backend en un SaaS multitenant para barberías (Kyrios Studio). Implementa exclusivamente la historia indicada y el soporte API necesario. [...]

---

## Plan ejecutado

1. **Auditoría del estado preexistente**:
   - Se constató que el modelo `Descuento` ya estaba agregado en `prisma/schema.prisma` junto con la migración `20261111120000_agregar_descuentos/migration.sql`.
   - Se verificó la arquitectura por capas en `src/modules/descuentos`:
     - Controlador: `DescuentosController` (`POST /descuentos`) protegido con `JwtAuthGuard` y `Roles('ADMINISTRADOR')`.
     - Fachada: `DescuentosFacade` coordinando `NegocioAislamientoService.negocioIdRequerido()` y `DescuentoService`.
     - Servicio de dominio: `DescuentoService` validando porcentaje (1-99, max 2 decimales), normalizando días de la semana, comprobando existencia del elemento en el tenant y evitando duplicados lógicos.
     - Repositorio: `DescuentoRepository` aplicando `filtroLectura` e interceptando violaciones de unicidad en base de datos (`P2002` a `ConflictException`).
     - Aislamiento multitenant: `Descuento` registrado en `MODELOS_TENANT_SCOPED`.
2. **Ajustes de Calidad y Linting**:
   - Se corrigieron 8 errores de Prettier en `descuento.service.ts` y `descuento.service.spec.ts`.
3. **Verificación y Pruebas**:
   - `npm run typecheck`: 0 errores.
   - `npx eslint "src/modules/descuentos/**/*.ts" "test/multitenant-descuentos.e2e-spec.ts" --no-fix`: 0 errores.
   - Tests unitarios: 4 suites, 21 tests pasando (`npx jest src/modules/descuentos`).
   - Tests E2E multitenant contra MySQL 8.0 real en Docker: 1 suite, 14 tests pasando (`multitenant-descuentos.e2e-spec.ts`).
   - `npm run build`: 0 errores.
   - Documentación actualizada en `docs/api/REFERENCIA_API.md` sección 7.1.

---

## Matriz de Criterios de Aceptación (HE-10-HU-02)

| Criterio | Comportamiento esperado | Prueba asociada | Resultado |
|---|---|---|---|
| **CA-01** (Acceso/Permisos/Tenant) | `ADMINISTRADOR` y `SUPERADMIN` del negocio crean (403 a BARBERO; 401 sin token); 404 para elemento inexistente o de otro negocio; rechaza `negocioId`/`activo` en body (400). Decisión humana aprobada: SUPERADMIN también gestiona descuentos. | `multitenant-descuentos.e2e-spec.ts`: pruebas de roles, atributos prohibidos y aislamiento. `descuento.service.spec.ts:139,149`. | **PASS** |
| **CA-02** (Creación válida) | Registra un único descuento inactivo para producto o servicio y responde elemento y confirmación. | `descuento.service.spec.ts:60,75`. `multitenant-descuentos.e2e-spec.ts:383,404`. | **PASS** |
| **CA-03** (Porcentaje inválido) | Rechaza porcentaje < 1, > 99 o no numérico con 400. | `descuento.service.spec.ts:101`. `multitenant-descuentos.e2e-spec.ts:421`. | **PASS** |
| **CA-04** (Días obligatorios) | Requiere al menos un día válido; normaliza duplicados y ordena según orden canónico; rechaza vacíos e inválidos con 400. | `descuento.service.spec.ts:112`. `multitenant-descuentos.e2e-spec.ts:454,477`. | **PASS** |
| **CA-05** (Unicidad por elemento) | Rechaza creación si ya existe descuento para el elemento (activo o inactivo) con 409. Maneja concurrencia mediante `@@unique`. | `descuento.service.spec.ts:126`. `descuento.repository.spec.ts:73`. `multitenant-descuentos.e2e-spec.ts:491,511`. | **PASS** |
| **CA-06** (Cancelación) | Cancelar no persiste datos ni expone endpoint destructivo de formulario. | `multitenant-descuentos.e2e-spec.ts:531`. | **PASS** |
| **CA-07** (Estado inicial inactivo) | El descuento nace `activo: false` en BD y respuesta; requiere activación explícita posterior. | `descuento.service.spec.ts:60`. `multitenant-descuentos.e2e-spec.ts:545`. | **PASS** |
| **CA-08** (Precisión del porcentaje) | Admite hasta 2 decimales (ej. 10.25); rechaza 3 decimales (ej. 10.251) sin redondear silenciosamente. | `descuento.service.spec.ts:101,164`. `multitenant-descuentos.e2e-spec.ts:560`. | **PASS** |
| **CA-09** (Sin acumulación) | Unicidad estricta por elemento; no hay cupones ni acumulación en esta versión. | Soportado por la regla de unicidad por elemento en BD y servicio. | **PASS** |

---

## Verificaciones automáticas

- `npm run typecheck`: PASS (0 errores).
- `npx eslint` sobre archivos de la historia: PASS (0 errores).
- `npx jest src/modules/descuentos`: PASS (21/21 tests unitarios).
- `npx jest --config ./test/jest-multitenant.json test/multitenant-descuentos.e2e-spec.ts --runInBand`: PASS (14/14 tests con MySQL 8.0 real en Docker).
- `npm run build`: PASS (`nest build` exitoso).

---

## Pendiente de confirmación

- [ ] Autorización para commit atómico de HE-10-HU-02.
- [ ] Push / PR.

