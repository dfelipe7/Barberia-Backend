# Reporte de bloqueo HE-04 e integración con la disponibilidad (HE-08 · HU-04)

## 1. Resumen ejecutivo

La disponibilidad (HU-04) de HE-08 quedó **implementada y cubierta por pruebas**, pero **no puede anunciar franjas libres reales todavía** porque la fuente de verdad de reservas pertenece a **HE-04** y ese módulo **no existe en este backend**: no hay modelo `Reservation`, ni enum `ReservationStatus`, ni `ReservasRepository`/`ReservationsService`.

En lugar de inventar reservas o devolver franjas potencialmente ocupadas, se aplicó la estrategia aprobada: **proveedor inyectable + fail-closed**. El endpoint público está registrado, pero responde **HTTP 503** mientras no haya proveedor real de reservas. Esto cumple la regla de negocio crítica de la spec (§8.2): **`DisponibilidadService` es la única fuente de verdad sobre si una franja es reservable**, y esa frase no puede afirmarse sin consultar HE-04.

Este documento describe (a) el bloqueo, (b) el comportamiento actual y (c) el **contrato de integración** que HE-04 debe implementar para activar la disponibilidad sin tocar los controllers ni duplicar reglas.

## 2. Bloqueo identificado

| Elemento | Estado |
|---|---|
| Modelo Prisma `Reservation` / enum `ReservationStatus` | **Ausente** (schema solo tiene Usuario/Administrador/Barbero/Cliente/Servicio/BarberoServicio/BarberWeeklySlot/BarberScheduleBlock/GeneralClosure). |
| Módulo/servicio/repositorio de reservas (HE-04) | **Ausente**. |
| Regla de ocupación (qué estados ocupan agenda) | Definida en la spec (§6.3): ocupan todos salvo `CANCELLED`. Verificable en código solo cuando exista HE-04. |
| Consulta “¿esta franja tiene reserva no cancelada?” | **No implementable** hoy. |

Decisión aprobada por el responsable del producto: **no** hardcodear un mock, **no** asumir ausencia de reservas y **no** reimplementar el algoritmo en HE-04. Se define un puerto y se falla cerrada hasta que HE-04 lo implemente.

## 3. Decisión: proveedor inyectable + fail-closed

- Puerto: `PROVEEDOR_RESERVAS_ACTIVAS` (`symbol`) en `src/modules/horarios/ports/proveedor-reservas-activas.port.ts`.
- Implementación por defecto: `ProveedorReservasActivasNoDisponible`, que **rechaza siempre** con `ReservasNoDisponiblesError`.
- La regla `ReservaActivaRule` (prioridad 40) delega en el puerto. Si el puerto falla, la fachada traduce el error a **`ServiceUnavailableException` (503)** y **aborta el cálculo completo de esa fecha**.
- La fachada **nunca** degrada a “sin reservas” de forma silenciosa: si no puede verificar ocupación, no responde disponibilidad.

## 4. Comportamiento actual del endpoint

`GET /usuarios/barberos/:barberoId/disponibilidad?servicioId=&fecha=YYYY-MM-DD` (público) y `GET /usuarios/me/barbero/disponibilidad?servicioId=&fecha=YYYY-MM-DD` (autenticado).

| Caso | Respuesta |
|---|---|
| Barbero inexistente/inactivo | `404` |
| `servicioId` inexistente/inactivo | `404` |
| `servicioId` no asignado al barbero | `400` |
| `fecha` con formato/valor inválido | `400` |
| **Fecha válida sin franjas de horario semanal** (`slots: []`) | **`200`** con `slots: []` — no hay nada que reservar, no se consulta reservas. Seguro y correcto. |
| **Fecha válida con al menos una franja dentro de horario** | **`503`** `ServiceUnavailableException` — fail-closed mientras HE-04 no esté integrado. |
| Auth: usuario sin perfil de barbero (endpoint `me`) | `403` |
| Auth: identidad no resoluble (endpoint `me`) | `401` |

Nota: la fecha se valida como fecha de calendario (`YYYY-MM-DD`) con `FechaBogotaService.esFechaCalendarioValida` y se convierte a `Date` UTC medianoche para columnas `@db.Date`.

## 5. Capa involucrada

- `service/disponibilidad.service.ts` — fachada de cálculo (`calcularDisponibilidad`, `obtenerDisponibilidadPublica`, `obtenerDisponibilidadDetallada`, `obtenerDisponibilidadDetalladaDelBarberoAutenticado`).
- `strategies/` — `horario-semanal.rule.ts` (10), `cierre-general.rule.ts` (20), `bloqueo-activo.rule.ts` (30), `reserva-activa.rule.ts` (40); contrato en `regla-disponibilidad.strategy.ts`.
- `ports/proveedor-reservas-activas.port.ts` — puerto de HE-04.
- `mappers/disponibilidad.mapper.ts` — `aPublica` (solo `AVAILABLE`, sin motivos privados) / `aDetallada`.
- `horarios.module.ts` — registra reglas, fachada, mapper y el proveedor por defecto.
- Repos: `BarberosRepository.obtenerBarberoActivoPorId`, `ServiciosRepository.obtenerServicioActivoPorId`, `ServiciosRepository.existeAsignacionBarbero`, `HorariosRepository.obtenerFranjasActivasPorBarberoYDia`, `BloqueosHorarioRepository.listarActivosPorBarberoYFecha`, `CierresGeneralesRepository.obtenerActivosEnFecha`.

## 6. Contrato de integración propuesto para HE-04

### 6.1 HE-04 implementa el puerto de reservas

`src/modules/horarios/ports/proveedor-reservas-activas.port.ts`:

```ts
export const PROVEEDOR_RESERVAS_ACTIVAS = Symbol('PROVEEDOR_RESERVAS_ACTIVAS');

export interface ConsultaConflictoReserva {
  barberoId: number; // Barbero.id (no Usuario.id)
  fecha: string;     // 'YYYY-MM-DD'
  startTime: string; // 'HH:mm'
  endTime: string;   // 'HH:mm'
}

export interface ProveedorReservasActivas {
  existeReservaNoCanceladaEnFranja(
    consulta: ConsultaConflictoReserva,
  ): Promise<boolean>;
}
```

Obligaciones de la implementación real (HE-04):

1. Interpretar `[startTime, endTime)` como rango semiabierto de 60 minutos.
2. Considerar **ocupante** toda reserva cuyo estado **no** sea `CANCELLED` (`PENDING`, `CONFIRMED`, `IN_PROGRESS`, `COMPLETED`) — spec §6.3.
3. Usar `barberoId = Barbero.id` y `fecha` como día de calendario, sin desplazamientos de zona (`America/Bogota`).
4. Si la consulta no puede resolverse (BD caída, etc.), debe **lanzar**, no devolver `false`.

### 6.2 Activación: sustituir el proveedor por defecto

En `horarios.module.ts`, reemplazar el registro actual por la implementación de HE-04:

```ts
// antes
{ provide: PROVEEDOR_RESERVAS_ACTIVAS, useClass: ProveedorReservasActivasNoDisponible },
// después ( cuando HE-04 exista )
{ provide: PROVEEDOR_RESERVAS_ACTIVAS, useClass: ProveedorReservasActivasPrisma },
```

Sin cambios en `DisponibilidadService`, `ReservaActivaRule`, controllers ni DTOs. Si HE-04 vive en otro módulo, exportarlo e importarlo (evitar `forwardRef` salvo dependencia circular real y justificada).

### 6.3 HE-04 consume la disponibilidad como fuente única

HE-04 **no** debe reimplementar reglas de horario, cierres, bloqueos ni reservas. Debe inyectar `DisponibilidadService` (ya exportado por `HorariosModule`) y:

- Antes de listar franjas al cliente: usar `obtenerDisponibilidadPublica({ barberoId, servicioId, fecha })`.
- Antes de crear/mover una reserva y **dentro** de la transacción que confirma: revalidar con `calcularDisponibilidad`/`obtenerDisponibilidadDetallada` usando la misma política de dominio compartida (spec §8.2, §16).

Para consumo interno/transaccional, `calcularDisponibilidad` devuelve el estado por franja:

```ts
type FranjaEvaluada = { startTime: string; endTime: string; estado: EstadoFranja };
// EstadoFranja: AVAILABLE | RESERVED | BLOCKED | GENERAL_CLOSURE | OUTSIDE_SCHEDULE
```

### 6.4 Semántica de errores que HE-04 debe propagar

| Excepción de la fachada | Causa | Traducción sugerida en HE-04 |
|---|---|---|
| `NotFoundException` | barbero/servicio inexistente o inactivo | `404` |
| `BadRequestException` | servicio no asignado; fecha inválida | `400` |
| `ServiceUnavailableException` | proveedor de reservas no disponible (`fail-closed`) | `503` |
| `Unauthorized/Forbidden` | endpoint `me` sin identidad/perfil de barbero | `401` / `403` |

Códigos de dominio ya previstos por la spec para reservas: `SLOT_ALREADY_RESERVED` (409) y `OUT_OF_WORKING_HOURS` (400) — a materializar cuando exista HE-04.

### 6.5 Secuencia transaccional recomendada (HE-04)

1. Validar servicio asignado y fecha.
2. `obtenerDisponibilidadDetallada` → confirmar que la franja objetivo está `AVAILABLE`.
3. En una única transacción: revalidar la franja (bloqueo optimista/restricción de unicidad) y crear la reserva.
4. No cancelar ni mover reservas automáticamente por cambios de horario/bloqueo.

## 7. Puntos de extensión (no implementados hoy)

- **Anticipación mínima / horizonte máximo de reserva**: aparecen en la spec original pero “no se describen reglas adicionales” (doc HE-08, línea ~97). **No se hardcodearon**. Cuando el producto los defina, agregar una regla `AnticipacionRule` con `orden` entre 40 y `AVAILABLE` (p. ej. 50) y registrarla en `REGLAS_DISPONIBILIDAD`; la fachada la compone sin cambios.
- **Festivos**: los cierres generales (`GeneralClosure`) ya modelan no laborables; no se añade calendario de festivos automático.
- **Vista pública**: `aPublica` filtra únicamente `AVAILABLE` y descarta motivos; nunca revela `RESERVED`/`BLOCKED`/`GENERAL_CLOSURE`/notas/info de cliente (spec §9.8).

## 8. Checklist de activación

- [ ] HE-04 define `Reservation` + `ReservationStatus` (o reutiliza la noción de “reserva no cancelada”).
- [ ] HE-04 implementa `ProveedorReservasActivas` con la política `estado != CANCELLED`.
- [ ] Sustituir `useClass` en `horarios.module.ts`.
- [ ] Pruebas de integración cruzada: franja reservada ⇒ `RESERVED` y **no** aparece en `aPublica`; cancelación ⇒ vuelve a `AVAILABLE`.
- [ ] Prueba transaccional concurrente (spec §7.6): dos intentos de reservar la misma franja ⇒ solo uno triunfa.

## 9. Verificación ejecutada

- `npx jest src/modules/horarios` → **18 suites / 135 tests OK**.
- `npx jest` → **42 suites / 387 tests OK**.
- `npm run build` → OK. `npx tsc --noEmit` → solo 2 errores preexistentes ajenos (`usuarios.repository.spec.ts:65,77`).
- ESLint de los archivos nuevos: solo categorías ya presentes en el repo (`no-unsafe-*`, `unbound-method`, `prettier`); **sin categorías nuevas**. Archivos nuevos formateados con Prettier.
- No se ejecutó migración Prisma (requiere BD/autorización). No se hizo commit.
