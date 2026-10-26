<!--
Trazabilidad:
- REQ: REQ-008, REQ-009, REQ-010
- Modelo ejecutor: minimax-m3.1-flash-free
- Propósito: auditoría de suficiencia de endpoints frente a las reglas de negocio del sistema.
- Responsabilidad: documento; audita el estado actual y no modifica el backend.
-->

# Auditoría de suficiencia de endpoints

> **Alcance**: ¿la API actual permite satisfyacer las reglas de negocio del sistema de
> reservas de barbería? La fuente es el código (`src/**`), no la documentación previa.
> Cada fila indica la ruta real que cubre la regla y el estado real (**cubierta**,
> **parcial** o **no cubierta**).
>
> Este documento **no propone ni implementa** cambios: los huecos quedan registrados para
> su posterior decisión.

## 1. Resumen

| Regla de negocio | Estado | Observación |
|------------------|--------|-------------|
| Autenticar personal con Google OAuth | **Cubierta** | `POST /auth/google` + `POST /auth/refresh` + `POST /auth/tenant/:slug` |
| Autenticar clientes con Google OAuth | **Cubierta** | `POST /auth/clientes/google` |
| Gestionar usuarios (altas, estado, perfil) | **Cubierta** | `/usuarios/**` |
| Gestionar barberos y su perfil | **Cubierta** | `/usuarios/barberos/**` |
| Gestionar servicios y sus asignaciones | **Cubierta** | `/servicios/**` |
| Gestionar el perfil y la marca del negocio | **Cubierta** | `/perfil-negocio/**` |
| Crear y consultar horarios (agenda semanal) | **Cubierta** | `/usuarios/me/barbero/horario-semanal` y `/usuarios/barberos/:barberoId/horario-semanal` |
| Bloquear y reactivar franjas | **Cubierta** | `/bloqueos-horario/**` |
| Consultar disponibilidad | **Cubierta** (informativa) | `GET /usuarios/barberos/:barberoId/disponibilidad` |
| Crear reservas (invitado y cliente) | **Cubierta** | `POST /reservas` |
| Consultar reservas propias | **Cubierta** | `GET /reservas/me`, `GET /reservas/me/:reservaId` |
| **Reprogramar** reservas | **Cubierta** | `PATCH /reservas/me/:reservaId` (cliente), `/invitado/...` (invitado), `PATCH /reservas/admin/:reservaId` |
| **Cancelar** reservas | **Cubierta** | `PATCH /reservas/me/:reservaId/cancelar`, `/invitado/.../cancelar`, `/reservas/admin/:reservaId/cancelar` |
| Cerrar la agenda (completado / no show) | **Cubierta** | `PATCH /reservas/:reservaId/completar`, `PATCH /reservas/:reservaId/no-show` |
| Notificar por WhatsApp (plantillas y recordatorios) | **Parcial** | Plantillas y cron de recordatorios; **no hay envío manual** (G-06) |
| **Gestionar la configuración operativa** | **No cubierta** | El módulo de configuración no tiene controlador (G-01) |
| Gestionar los clientes del negocio | **Parcial** | Solo `GET /reservas/admin/clientes` (clientes con reserva, máx. 20) (G-04) |
| Reportes / facturación / comisiones consultables | **No cubierta** | No hay endpoints de lectura (G-03, G-08) |

## 2. Matriz regla → endpoints

| Regla | Endpoints que la cubren | Estado |
|-------|-------------------------|--------|
| Alta de personal con rol de negocio | `POST /usuarios/administradores` (SUPERADMIN), `POST /usuarios/barberos` (SUPERADMIN, ADMINISTRADOR), `POST /usuarios/:usuarioId/barbero` (SUPERADMIN), `POST /usuarios/me/barbero` | Cubierta |
| Baja lógica de personal | `PATCH /usuarios/administradores/:id/estado`, `PATCH /usuarios/barberos/:usuarioId/estado`, `PATCH /usuarios/:usuarioId/estado` | Cubierta |
| Ficha de persona | `GET /usuarios/me`, `GET /usuarios/:usuarioId`, `PATCH /usuarios/:usuarioId` | Cubierta |
| Catálogo de servicios | `GET /servicios` (público), `GET /servicios/gestion`, `GET /servicios/:id` | Cubierta |
| Alta/edición/baja de servicio | `POST /servicios`, `PATCH /servicios/:id`, `PATCH /servicios/:id/estado` | Cubierta |
| Asignación de barberos a un servicio | `POST /servicios` y `PATCH /servicios/:id` (campo `barberoIds[]`), `GET /servicios/:servicioId/barberos` | Cubierta |
| Servicios de un barbero | `GET /servicios/barbero/:barberoId` | Cubierta |
| Agenda semanal del barbero | `GET/PUT /usuarios/me/barbero/horario-semanal` | Cubierta |
| Agenda semanal de cualquier barbero | `GET/PUT /usuarios/barberos/:barberoId/horario-semanal` (SUPERADMIN) | Cubierta |
| Bloqueos de horario | `GET/POST/PATCH/DELETE` en `/usuarios/me/barbero/bloqueos-horario` y en `/usuarios/barberos/:barberoId/bloqueos-horario` | Cubierta |
| Disponibilidad de un barbero | `GET /usuarios/barberos/:barberoId/disponibilidad` (público, informativa) | Cubierta |
| Disponibilidad detallada del propio barbero | `GET /usuarios/me/barbero/disponibilidad` | Cubierta |
| Reserva de invitado | `POST /reservas` sin token + `tokenGestion` | Cubierta |
| Reserva de cliente autenticado | `POST /reservas` con token de cliente | Cubierta |
| Reserva creada por administración | `POST /reservas/admin` | Cubierta |
| Idempotencia de la reserva | `POST /reservas` con `Idempotency-Key` | Cubierta |
| Modificar / cancelar reserva propia | `PATCH /reservas/me/:reservaId`, `PATCH /reservas/me/:reservaId/cancelar` | Cubierta |
| Modificar / cancelar reserva de invitado | `PATCH /reservas/invitado/:reservaId(/cancelar)` con `tokenGestion` | Cubierta |
| Modificar / cancelar reserva (SUPERADMIN) | `PATCH /reservas/admin/:reservaId(/cancelar)` | Cubierta |
| Agenda de reservas del barbero | `GET /reservas/barbero/me`, `GET /reservas/barbero/me/agenda` | Cubierta |
| Listado de reservas del negocio | `GET /reservas/admin` (**solo SUPERADMIN**) | Parcial (G-02) |
| Estados finales de la reserva | `PATCH /reservas/:reservaId/completar`, `PATCH /reservas/:reservaId/no-show` | Cubierta |
| Perfil y marca del negocio | `GET /perfil-negocio`, `GET/PUT /perfil-negocio`, `PUT /perfil-negocio/referencias` | Cubierta |
| Recursos de marca (favicon, banner, logos) | `POST/DELETE /perfil-negocio/{favicon,banner,logo-blanco,logo-negro}` | Cubierta |
| Sesión de WhatsApp | `GET /whatsapp/status`, `POST /whatsapp/iniciar|pausar|desconectar` | Cubierta |
| Plantillas de WhatsApp | `GET/PUT /whatsapp/plantillas`, `POST /whatsapp/plantillas/reset` | Cubierta |
| Recordatorios automáticos | cron `src/modules/reservas/cron/recordatorios.cron.ts` (no es endpoint) | Cubierta (automática) |
| Envío manual de WhatsApp | — | **No cubierta** (G-06) |
| Parámetros operativos del negocio (anticipación, activos) | — | **No cubierta** (G-01) |
| Ficha del cliente autenticado | — | **No cubierta** (G-05) |
| Consulta de comisión de un barbero | — | **No cubierta** (G-03) |

## 3. Brechas (priorizadas)

### G-01 — La configuración operativa no tiene API · **Alta**

`src/modules/configuracion` expone un servicio completo (`obtenerTexto`, `obtenerNumero`,
`obtenerBooleano`, `guardarTexto`, `guardarNumero`, `inicializarValoresOperativos`,
con caché de 60 s e invalidación), pero **no existe ningún controlador** para él: en el
repositorio no hay `configuracion.controller.ts`.

Consecuencia: los parámetros operativos por negocio (valores iniciales, direcciones de
respaldo, parámetros de los recordatorios) solo se pueden cambiar por base de datos o por
script. La regla «gestionar la configuración operativa» **no es satisfacible desde la API**.

*Estado*: hueco confirmado leyendo `src/modules/configuracion/` y listando los 15
controladores del proyecto.

### G-02 — El administrador del negocio no puede listar sus reservas · **Alta**

| Operación | Rol permitido |
|-----------|---------------|
| Crear una reserva (`POST /reservas/admin`) | `SUPERADMIN`, `ADMINISTRADOR` |
| Listar clientes con reservas (`GET /reservas/admin/clientes`) | `SUPERADMIN`, `ADMINISTRADOR` |
| **Listar reservas** (`GET /reservas/admin`) | **solo `SUPERADMIN`** |
| Ver una reserva (`GET /reservas/admin/:reservaId`) | **solo `SUPERADMIN`** |
| Modificar / cancelar (`PATCH /reservas/admin/:reservaId[/cancelar]`) | **solo `SUPERADMIN`** |

El `ADMINISTRADOR` puede crear una reserva y consultar quién es el cliente, pero no puede
ver ni gestionar las reservas del negocio. Además, `GET /reservas/admin/clientes` está
definido en un controlador de **reservas** y devuelve clientes, no reservas: la ruta
parcialmente duplica el prefijo `admin` con otro significado.

*Estado*: verificado leyendo `src/modules/reservas/controller/reservas.controller.ts`
(líneas de decoradores `@Roles` de cada ruta).

### G-03 — No se puede consultar la comisión de un barbero · **Media**

Solo existe `PATCH /usuarios/barberos/:usuarioId/comision` (escritura, 0–100). Ningún
endpoint devuelve el porcentaje vigente ni el importe calculado por periodo. Sin lectura,
la comisión no es verificable ni auditable desde la API.

### G-04 — No hay gestión de clientes del negocio · **Media**

El único endpoint de clientes es `GET /reservas/admin/clientes`, que devuelve **los
clientes que tienen reservas** (con `take: 20`), no el padrón de clientes. No hay alta,
ficha, edición ni baja de cliente: el cliente se crea implícitamente al reservar
(`clientesRepository`), y sus datos (teléfono, nombre) solo se pueden corregir reescribiendo
la reserva.

### G-05 — El cliente autenticado no tiene endpoint de perfil · **Media**

`POST /auth/clientes/google` devuelve el token y un resumen (`id`, `nombre`, `apellido`,
`correo`), pero no existe `GET /auth/clientes/me` ni forma de actualizar los datos del
cliente (por ejemplo, el teléfono, que se solicita en cada reserva). El cliente queda
obligado a volver a escribir su teléfono en cada reserva.

### G-06 — No hay envío manual de WhatsApp · **Media**

Las rutas de WhatsApp cubren sesión, plantillas y reset, y existe un cron de recordatorios.
No hay ninguna ruta para **enviar un mensaje a un cliente concreto** (confirmación manual,
recordatorio a pedido, mensaje de la barbería). La regla «notificar por WhatsApp» solo se
satisface de forma automática.

### G-07 — Disponibilidad sin consulta agregada · **Baja**

La disponibilidad se consulta **por barbero** (`GET /usuarios/barberos/:barberoId/disponibilidad`).
Para montar una agenda de reservas hay que llamar una vez por barbero (N+1 desde el
frontend) o composing con `GET /servicios/:servicioId/barberos`.

### G-08 — Reportes y facturación inexistentes · **Baja**

No hay ningún endpoint de reporte: ingresos, ocupación, cancelaciones, comisiones
acumuladas o cierre de caja. `GET /reservas/admin` con filtros es la única materia prima,
y solo para `SUPERADMIN`.

### G-09 — Los listados no tienen paginación · **Baja**

Sobre 103 llamadas a `findMany` en los repositorios, **solo una** pagina
(`clientes.repository.ts`, `take: 20`). El resto (`GET /servicios`, `GET /usuarios/barberos`,
`GET /reservas/admin`, `GET /reservas/me`, listados de bloqueos) devuelven el conjunto
completo. Con volumen real, la respuesta y el uso de memoria crecen sin cota; además,
`GET /reservas/me` no admite filtros ni paginación.

### G-10 — Sin histórico de cambios · **Baja (informativo)**

Ni las reservas ni el perfil del negocio guardan historial de cambios. `PerfilNegocio`
guarda `creadoEn` y `actualizadoEn`, pero no qué cambió. Las reservas guardan el estado
actual, no su evolución.

### G-11 — Gestión de la barbería sin API · **Informativo (por diseño)**

`SUPERADMIN` es un rol **por negocio** (Fase 10), así que no existe —por diseño— una API
de plataforma para listar, activar o desactivar barberías. No es un hueco: es una decisión
de arquitectura documentada en `CONTRATOS_API_MULTITENANT.md` §7.

## 4. Cambios posteriores a la auditoría (REQ-009)

Esta matriz es una foto del estado auditado. Después, `REQ-009` cambió **un** endpoint:

- `GET /usuarios/simular-error-grave` pasó de **público** (siempre `500`) a **sesión de
  personal + rol de administración + habilitación explícita por entorno**
  (`SIMULADOR_ERROR_HABILITADO=true`, nunca en producción). Sin sesión → `401`; sin rol
  o deshabilitado → `404`. Detalle en `docs/api/HALLAZGOS_CONSISTENCIA.md` (H-01).

El resto de la matriz (19 reglas, 11 brechas G-01 a G-11) sigue vigente: **G-01 a G-11
continúan abiertos**.

## 5. Trazabilidad de la auditoría
- Inventario de rutas: extraído de los **15 controladores** del repositorio
  (`src/app.controller.ts`, `src/auth/**`, `src/modules/**`).
- Roles: decoradores `@Roles` de cada ruta.
- Ausencia de controlador de configuración: confirmado listando `src/modules/configuracion/`
  (4 ficheros, ninguno controlador).
- Ausencia de controlador de clientes: confirmado listando los 15 controladores.
- Paginación: `Select-String` sobre `src/modules/*/repository/*.ts` (`take:`/`skip:`) →
  una única aparición.
- Comisión sin lectura: `Select-String` sobre `barberos.controller.ts` → una única ruta de
  comisión, de escritura.
