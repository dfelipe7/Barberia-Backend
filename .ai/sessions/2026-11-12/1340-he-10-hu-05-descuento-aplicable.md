# HE-10-HU-05 — Visualizar el descuento aplicable en productos y servicios

- **Herramienta**: Antigravity
- **Modelo**: Gemini 3.8 Flash
- **Sesión**: 2026-11-12T13:40:00-05:00
- **Commit resultante**: sin commit (pendiente de aprobación humana)
- **Rama**: `feature/gestion-descuentos`

---

## Prompt original del humano

> HE-10-HU-05 — Visualizar el descuento aplicable en productos y servicios
> "Identificador original: HE-10-HU-05
> Referencia normalizada: HE-10-HU-05
> Como: Cliente y Administrador
> Quiero: Visualizar el descuento aplicable en productos y servicios
> Para: Conocer el precio final antes de confirmar la compra o reserva."
> Actúa como ingeniero senior backend en un SaaS multitenant para barberías (Kyrios Studio). Implementa exclusivamente la historia indicada y el soporte API necesario. [...]

---

## Plan ejecutado

1. **Diseño y contratos API**:
   - `GET /descuentos/aplicable/producto/:productoId`
   - `GET /descuentos/aplicable/servicio/:servicioId` (acepta query opcional `?fecha=YYYY-MM-DD`)
   - DTO de respuesta `DescuentoAplicableResponseDto`:
     - `tipo`, `elementoId`, `nombreElemento`
     - `aplica`: boolean (evaluación efectiva del descuento)
     - `diaEvaluado`: `WeekDay` en la zona horaria del negocio (o `null` para servicios sin fecha)
     - `zonaHoraria`: string con el nombre IANA del negocio (ej. `'America/Bogota'`)
     - `porcentajeAplicado`: number o null
     - `precioOriginal`: number
     - `precioFinal`: number o null
     - `descuento`: condiciones registradas `{ id, activo, porcentaje, diasSemana }` o null
     - `mensaje`: descriptivo del resultado
   - Constantes de evaluación incorporadas en `src/modules/descuentos/descuentos.constants.ts`.

2. **Arquitectura por capas**:
   - **Controlador** (`src/modules/descuentos/controller/descuentos.controller.ts`):
     - Endpoints públicos del tenant mediante `@ApiNegocioHeader()`, sin requerir JWT para permitir consulta desde el catálogo y la reserva previa.
     - Valida parámetros mediante `ParseIntPipe` y comprobación defensiva `<= 0`.
     - Ubicados antes de `@Get(':descuentoId')` para evitar colisión de rutas en NestJS/Express.
     - Delega a `DescuentosFacade.evaluarDescuentoProducto` y `DescuentosFacade.evaluarDescuentoServicio`.
   - **Fachada** (`src/modules/descuentos/facade/descuentos.facade.ts`):
     - Resuelve `negocioAislamientoService.negocioIdRequerido()` garantizando el ámbito del tenant.
     - Delega en `DescuentoEvaluadorService`.
   - **Servicio Evaluador** (`src/modules/descuentos/service/descuento-evaluador.service.ts`):
     - Servicio desacoplado y reutilizable para evaluación de aplicabilidad y cálculo de importes.
     - `evaluarProducto`: determina el día de la semana actual en la zona horaria del negocio y evalúa condiciones de descuento.
     - `evaluarServicio`: interpreta la fecha `YYYY-MM-DD` en la zona horaria de la barbería y evalúa condiciones. Si se omite `fecha`, devuelve precio original y condiciones sin precio promocional final (CA-08).
     - `calcularPrecioFinal`: fórmula verificable `Math.round(precioOriginal * ((100 - porcentaje) / 100) * 100) / 100`.
   - **Repositorio** (`src/modules/descuentos/repository/descuento.repository.ts`):
     - Método `obtenerZonaHorariaNegocio(negocioId)`: consulta la zona horaria configurada en la tabla `negocios` (por defecto `'America/Bogota'`).

3. **Criterios de aceptación cubiertos**:
   - **CA-01 (Indicador visible)**: descuento activo en día configurado muestra porcentaje y precio promocional.
   - **CA-02 / CA-05 (Precio final verificable)**: cálculo exacto con dos decimales (ej. 100 con 10% da 90.00).
   - **CA-03 (Día no aplicable)**: descuento activo pero día no coincidente mantiene precio original sin descuento.
   - **CA-04 (Descuento inactivo)**: descuento inactivo no aplica y devuelve precio original.
   - **CA-06 (Activo frente a aplicable)**: se distinguen claramente las condiciones registradas de la aplicabilidad puntual.
   - **CA-07 (Zona horaria)**: evaluación realizada siempre en la zona horaria oficial del tenant, nunca UTC ni navegador.
   - **CA-08 (Servicio sin fecha)**: servicio sin fecha muestra precio original y condiciones sin precio definitivo.
   - **CA-09 a CA-13 (INT-RES)**: declarados PENDIENTES de la integración con reservas (`HE-04-HU-12`, posterior).

4. **Documentación viva**:
   - `docs/api/REFERENCIA_API.md`: actualizada con filas en tabla 7.1 y sección de reglas para `HE-10-HU-05`.

---

## Verificaciones ejecutadas

1. **Typecheck**:
   ```
   npm run typecheck
   Exit code 0, 0 errores.
   ```

2. **Lint**:
   ```
   npx eslint "src/modules/descuentos/**/*.ts" "test/multitenant-descuentos.e2e-spec.ts"
   Exit code 0, 0 errores, 0 warnings.
   ```

3. **Pruebas unitarias**:
   ```
   npx jest src/modules/descuentos
   Test Suites: 5 passed, 5 total
   Tests:       78 passed, 78 total
   ```

4. **Pruebas E2E Multitenant**:
   ```
   npx jest --config ./test/jest-multitenant.json test/multitenant-descuentos.e2e-spec.ts --runInBand
   Test Suites: 1 passed, 1 total
   Tests:       40 passed, 40 total (MySQL 8.0 real en Docker)
   ```

5. **Build de producción**:
   ```
   npm run build
   Exit code 0.
   ```

---

## Archivos modificados y creados

- `docs/api/REFERENCIA_API.md` (modificado: tabla y reglas de visualización de descuento aplicable)
- `src/modules/descuentos/descuentos.constants.ts` (modificado: mensajes y constantes de evaluación)
- `src/modules/descuentos/dto/dto-respuesta/descuento-aplicable-response.dto.ts` (creado: DTO de respuesta y condiciones)
- `src/modules/descuentos/repository/descuento.repository.ts` (modificado: `obtenerZonaHorariaNegocio`)
- `src/modules/descuentos/service/descuento-evaluador.service.ts` (creado: lógica de evaluación, cálculo y zona horaria)
- `src/modules/descuentos/service/descuento-evaluador.service.spec.ts` (creado: 14 pruebas unitarias)
- `src/modules/descuentos/facade/descuentos.facade.ts` (modificado: métodos de fachada)
- `src/modules/descuentos/facade/descuentos.facade.spec.ts` (modificado: pruebas unitarias de fachada)
- `src/modules/descuentos/controller/descuentos.controller.ts` (modificado: endpoints `@Get('aplicable/producto/:id')` y `@Get('aplicable/servicio/:id')`)
- `src/modules/descuentos/controller/descuentos.controller.spec.ts` (modificado: pruebas unitarias del controlador)
- `src/modules/descuentos/descuentos.module.ts` (modificado: registro y exportación de `DescuentoEvaluadorService`)
- `test/multitenant-descuentos.e2e-spec.ts` (modificado: 7 pruebas E2E multitenant de HE-10-HU-05)
- `.ai/sessions/2026-11-12/1340-he-10-hu-05-descuento-aplicable.md` (creado: esta sesión de trazabilidad)

---

## Estado

Implementación de HE-10-HU-05 completada al 100% y verificada. El Sprint 3 de descuentos cuenta ahora con las 5 historias implementadas y probadas (HU-01, HU-02, HU-03, HU-04, HU-05).

