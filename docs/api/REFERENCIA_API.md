<!--
Trazabilidad:
- REQ: REQ-008, REQ-009, REQ-010
- Modelo ejecutor: minimax-m3.1-flash-free
- Propósito: referencia formal de la API real del backend (rutas, autenticación, reglas y respuestas).
- Responsabilidad: documento; describe el comportamiento observado en el código y no lo modifica.
-->

# Referencia formal de la API

> **Fuente de verdad**: el código fuente de este repositorio. Este documento **describe** lo
> que el backend hace hoy; no sustituye a Swagger. Toda ruta, rol, DTO y código de error
> citados aquí se han leído en el fichero correspondiente (ver §9).

- Base: `http(s)://<host>:<puerto>` — **no hay prefijo global de ruta** (`main.ts` no llama a
  `setGlobalPrefix`), por lo que las rutas cuelgan de la raíz.
- Puerto por defecto: `process.env.PORT ?? 3000`.
- Swagger UI: `GET /api/docs` (habilitado según `src/common/config/swagger.config.ts`).
- OpenAPI: `GET /api/docs-json`.

---

## 1. Convenciones globales

### 1.1 Autenticación

Dos tipos de sesión, con **secreto y audiencia propios** e incompatibles entre sí
(`src/auth/clientes/cliente-jwt.constants.ts` → `AUDIENCIA_CLIENTE = 'barberia-clientes'`):

| Tipo | Emisor | Audiencia | Guards que lo aceptan |
|------|--------|-----------|----------------------|
| Personal (barbero, administrador,|superadmin de negocio) | `POST /auth/google` | `barberia` | `JwtAuthGuard` |
| Cliente | `POST /auth/clientes/google` | `barberia-clientes` | `ClienteJwtAuthGuard` |

- Cabecera: `Authorization: Bearer <accessToken>`.
- Un token de personal es **rechazado** por las rutas de cliente y viceversa.
- `POST /auth/refresh` (guard `JwtSesionGuard`) renueva el token de personal recalculando
  los roles vigentes en base de datos, de modo que revocar un perfil surte efecto inmediato.

### 1.2 Contexto de negocio (multitenant)

El negocio (tenant) se resuelve **por petición**, con esta prioridad
(`src/modules/negocios/service/negocio-resolucion.service.ts`):

1. **Subdominio** — `acme.<NEGOCIO_DOMINIO_BASE>` → `slug = acme`. Es el mecanismo de
   producción. Sin `NEGOCIO_DOMINIO_BASE` configurado, el `Host` **no** se interpreta.
2. **Cabecera `X-Negocio-Slug`** — alternativa para clientes móviles, emuladores y entornos
   sin subdominio. Restrictible en producción con `NEGOCIO_PERMITIR_HEADER_SLUG=false`.

Reglas:

- Si la petición **no apunta** a ningún negocio → la cadena continúa **sin contexto**
  (comportamiento de plataforma).
- Si apunta a un negocio **inexistente o inactivo** → **404**, sin revelar si existe pero
  está inactivo (misma respuesta en ambos casos).
- El contexto se propaga con `AsyncLocalStorage`
  (`src/modules/negocios/negocio-contexto.service.ts`) a lo largo de toda la cadena
  asíncrona, y la extensión `prisma-extension-aislamiento.ts` añade automáticamente el
  filtro `negocioId` a los modelos con ámbito de negocio
  (`src/modules/negocios/aislamiento.constants.ts`).
- `POST /auth/tenant/:slug` cambia de negocio la sesión de personal en caliente.

### 1.3 Validación de entrada

`ValidationPipe` global (`src/main.ts`):

```ts
new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })
```

Consecuencia práctica: **un campo no declarado en el DTO provoca 400**, y los parámetros
de ruta y query también se validan cuando tienen DTO.

### 1.4 Formato de error

Filtro global `src/logger/all-exceptions.filter.ts` (`@Catch()`), para **todas** las
excepciones:

```json
{
  "statusCode": 409,
  "timestamp": "2026-10-21T00:00:00.000Z",
  "path": "/reservas",
  "message": "La franja solicitada ya está ocupada",
  "code": "SLOT_TAKEN"
}
```

- `message`: string o array de strings (errores de validación de `class-validator`).
- `code`: **solo** en los conflictos de dominio; es el valor de
  `src/common/exceptions/domain-conflict.exception.ts`.
- `path`: la ruta **saneada** (REQ-010): los valores sensibles de la query string
  aparecen como `[redactado]`. Antes se devolvía la URL cruda.
- Los errores 5xx y de base de datos se registran como error crítico y generan alerta por
  correo; los 400 y 409 se registran como error de cliente.
- Cabecera de respuesta `X-Request-Id`: UUID que identifica la petición y permite
  correlacionar la respuesta con el log y con el correo de alerta.

**Qué se registra y qué se notifica (REQ-009)**: el contexto que va al logger y al correo
de alerta se construye con una **lista blanca** (`timestamp`, `method`, `path` saneada,
`status`, `requestId`, `codigoError`, `ip`, `user`, `message`). **El cuerpo de la
petición no se registra ni se envía por correo**: es donde viajan el ID token de Google,
las contraseñas y los datos de acceso. La ruta se sanea: se redactan los segmentos con
forma de credencial y los valores sensibles de la query string.

**Qué se devuelve al cliente (REQ-010)**: la respuesta de error usa **la misma ruta
saneada** que el log y el correo. Un secreto en la query string no sale en el cuerpo de
la respuesta, ni en los logs, ni en el correo de alerta. El resto del contrato de la
respuesta (`statusCode`, `timestamp`, `message`, `code`, `details`) no cambia, y la
cabecera `X-Request-Id` se conserva.

### 1.5 Códigos de dominio (`code`, HTTP 409)

| Código | Significado |
|--------|-------------|
| `SERVICE_INACTIVE` | El servicio no está activo en este negocio. |
| `BARBER_INACTIVE` | El barbero no está activo. |
| `BARBER_NO_SCHEDULE` | El barbero no tiene horario para esa fecha/hora. |
| `NO_BARBER_FOR_SERVICE` | Ningún barbero del negocio presta el servicio. |
| `SLOT_TAKEN` | La franja ya está reservada. |
| `DUPLICATE_OWN_RESERVATION` | El cliente ya tiene una reserva propia en esa franja. |
| `IDEMPOTENCY_KEY_CONFLICT` | La `Idempotency-Key` ya se usó con un cuerpo distinto. |

### 1.6 Idempotencia

`POST /reservas` acepta la cabecera opcional `Idempotency-Key` (UUID v4, validado con
`src/modules/reservas/common/regex-uuid-v4.ts`).

- Misma clave + mismo negocio → devuelve la **misma** reserva (mismo `id`) y **no** escribe.
- Misma clave + negocio distinto → reserva distinta (el índice es `(negocioId, idempotencyKey)`).
- La unicidad la impone un índice UNIQUE en base de datos, no solo la lógica de aplicación.

### 1.7 CORS y cabeceras

- `helmet()` activo.
- CORS con **lista explícita** de orígenes (nunca `*`), `credentials: true`, y listas
  explícitas de métodos y cabeceras admitidas (`src/common/config/cors.config.ts`).

---

## 2. Roles efectivos

Los roles **no** se leen de `Usuario.rol` (que es informativo, `PERSONAL`): se derivan de las
membresías activas del usuario en el negocio del contexto
(`src/modules/negocios/service/negocio-roles.service.ts`).

| Rol | Significado |
|-----|-------------|
| `SUPERADMIN` | Administrador **fundador** del negocio. Es un rol **por negocio**, no de plataforma. |
| `ADMINISTRADOR` | Administrador del negocio. |
| `BARBERO` | Barbero del negocio. |

Un usuario sin rol activo en el negocio de la petición recibe **403**.

---

## 3. Sistema y autenticación

| Método | Ruta | Auth | Rol | Cuerpo / Query | Respuesta |
|--------|------|------|-----|----------------|-----------|
| GET | `/` | — | — | — | `200` texto `Hello World!` (health check del proceso; no consulta la base de datos) |
| POST | `/auth/google` | — | — | `{ idToken }` | `200` `{ accessToken, usuario, negocio }` |
| POST | `/auth/refresh` | `JwtSesionGuard` | — | — | `200` token renovado con roles vigentes |
| POST | `/auth/tenant/:slug` | `JwtSesionGuard` | — | — | `200` sesión con el negocio indicado |
| POST | `/auth/clientes/google` | — | — | `{ idToken }` | `200` `{ accessToken, cliente }` |

Reglas:

- `POST /auth/google` da de alta/reutiliza el usuario y calcula los roles **efectivos** en la
  barbería de la petición. Cuenta desactivada o sin perfil activo → **403**.
- `POST /auth/clientes/google` no exige registro previo ni rol: da de alta el cliente de
  forma idempotente por su cuenta de Google y emite un token de **cliente**.
- El ID Token de Google se valida por firma, emisor, audiencia, expiración y correo
  verificado.

---

## 4. Reservas (`/reservas`)

| Método | Ruta | Auth | Rol | Cuerpo / Query | Respuesta |
|--------|------|------|-----|----------------|-----------|
| POST | `/reservas` | `ClienteOpcionalJwtAuthGuard` | — (cliente opcional) | `CrearReservaDto` + `Idempotency-Key` (opcional) | `201` `ReservaCreadaResponseDto` |
| POST | `/reservas/admin` | `JwtAuthGuard` | `SUPERADMIN`, `ADMINISTRADOR` | `CrearReservaAdminDto` | `201` `ReservaCreadaResponseDto` |
| GET | `/reservas/admin` | `JwtAuthGuard` | `SUPERADMIN` | `FiltroReservasAdminDto` (query) | `200` `ReservaAdminDetalleDto[]` |
| GET | `/reservas/admin/:reservaId` | `JwtAuthGuard` | `SUPERADMIN` | — | `200` `ReservaAdminDetalleDto` |
| PATCH | `/reservas/admin/:reservaId` | `JwtAuthGuard` | `SUPERADMIN` | `ModificarReservaDto` | `200` `ReservaModificadaResponseDto` |
| PATCH | `/reservas/admin/:reservaId/cancelar` | `JwtAuthGuard` | `SUPERADMIN` | — | `200` `ReservaCanceladaResponseDto` |
| GET | `/reservas/admin/clientes` | `JwtAuthGuard` | `SUPERADMIN`, `ADMINISTRADOR` | — | `200` `ReservaAdminDetalleDto[]` |
| PATCH | `/reservas/:reservaId/completar` | `JwtAuthGuard` | `BARBERO`, `ADMINISTRADOR`, `SUPERADMIN` | — | `200` `ReservaCompletadaResponseDto` |
| PATCH | `/reservas/:reservaId/no-show` | `JwtAuthGuard` | `BARBERO`, `ADMINISTRADOR`, `SUPERADMIN` | — | `200` `ReservaNoShowResponseDto` |
| GET | `/reservas/barbero/me` | `JwtAuthGuard` | `BARBERO` | — | `200` `AgendaBarberoResponseDto` |
| GET | `/reservas/barbero/me/agenda` | `JwtAuthGuard` | `BARBERO` | `ConsultaAgendaSemanalDto` | `200` `AgendaSemanalBarberoResponseDto` |
| GET | `/reservas/me` | `ClienteJwtAuthGuard` | — (cliente) | — | `200` `MisReservasResponseDto` |
| GET | `/reservas/me/:reservaId` | `ClienteJwtAuthGuard` | — (cliente) | — | `200` `ReservaClienteDto` |
| PATCH | `/reservas/me/:reservaId` | `ClienteJwtAuthGuard` | — (cliente) | `ModificarReservaDto` | `200` `ReservaModificadaResponseDto` |
| PATCH | `/reservas/me/:reservaId/cancelar` | `ClienteJwtAuthGuard` | — (cliente) | — | `200` `ReservaCanceladaResponseDto` |
| PATCH | `/reservas/invitado/:reservaId` | token de gestión | — | `ModificarReservaDto` + token | `200` `ReservaModificadaResponseDto` |
| PATCH | `/reservas/invitado/:reservaId/cancelar` | token de gestión | — | token | `200` `ReservaCanceladaResponseDto` |

### 4.1 Creación de reserva (`POST /reservas`)

`CrearReservaDto`: `servicioId` (entero ≥ 1), `barberoId` (entero ≥ 1), `fecha`
(`YYYY-MM-DD`), `hora` (`HH:mm`), `nombre` (≤ 100), `apellido` (≤ 100), `telefono` (≤ 30).

- Autenticación **opcional**: con token de cliente la reserva queda vinculada a ese cliente;
  sin token, la reserva es de **invitado** y la respuesta incluye `tokenGestion`.
- `tokenGestion` es un token **secreto** de gestión: el cliente que lo conserve puede
  modificar o cancelar esa reserva por `/reservas/invitado/:reservaId`. Se entrega
  **una sola vez**, en la respuesta de creación.
- En el almacén se guarda cifrado (AES-256-GCM, clave derivada con HKDF de `JWT_SECRET`)
  en `gestionTokenCifrado`, más su hash en `gestionTokenHash` para validar sin descifrar.
- Disponibilidad revalidada **dentro de la misma transacción** que inserta. Ante una
  carrera, el índice UNIQUE `(barberoId, date, startTime, slotActivo)` rechaza la segunda
  inserción (error 1062 en MySQL) y la API responde **409**.
- Estados iniciales: `PENDING`.

### 4.2 Modificación y cancelación por el cliente

Sí: un **cliente autenticado** puede modificar (`PATCH /reservas/me/:reservaId`) y cancelar
(`PATCH /reservas/me/:reservaId/cancelar`) **sus propias** reservas, sin token de gestión.
El guard valida la pertenencia de la reserva al cliente de la sesión; una reserva ajena
responde **404** (no se revela su existencia).

Un invitado usa las rutas `/reservas/invitado/...` con su `tokenGestion`.

### 4.3 Estados de una reserva

`PENDING` → `COMPLETED` / `NO_SHOW` / `CANCELLED`. Cancelar libera la franja
(`slotActivo` pasa a NULL) y la hace reservable de nuevo.

---

## 5. Usuarios y barberos

| Método | Ruta | Auth | Rol | Cuerpo / Query | Respuesta |
|--------|------|------|-----|----------------|-----------|
| POST | `/usuarios/administradores` | `JwtAuthGuard` | `SUPERADMIN` | `CrearAdministradorDto` | `201` administrador creado |
| GET | `/usuarios/administradores` | `JwtAuthGuard` | `SUPERADMIN` | `FiltroAdministradoresDto` | `200` lista |
| PATCH | `/usuarios/administradores/:id/estado` | `JwtAuthGuard` | `SUPERADMIN` | `CambiarEstadoUsuarioDto` | `200` |
| POST | `/usuarios/barberos` | `JwtAuthGuard` | `SUPERADMIN`, `ADMINISTRADOR` | `CrearBarberoDto` | `201` barbero creado |
| GET | `/usuarios/barberos/gestion` | `JwtAuthGuard` | `SUPERADMIN`, `ADMINISTRADOR` | `FiltroBarberosDto` | `200` lista de gestión |
| GET | `/usuarios/barberos` | — | — | `FiltroBarberosDto` | `200` catálogo público |
| PATCH | `/usuarios/barberos/:usuarioId/comision` | `JwtAuthGuard` | `SUPERADMIN`, `ADMINISTRADOR` | `ActualizarComisionDto` (0–100) | `200` |
| PATCH | `/usuarios/barberos/:usuarioId/estado` | `JwtAuthGuard` | `SUPERADMIN`, `ADMINISTRADOR` | `CambiarEstadoUsuarioDto` | `200` |
| POST | `/usuarios/barberos/foto` | `JwtAuthGuard` | `SUPERADMIN`, `ADMINISTRADOR`, `BARBERO` | fichero `archivo` | `201` foto del barbero autenticado |
| DELETE | `/usuarios/barberos/foto` | `JwtAuthGuard` | `SUPERADMIN`, `ADMINISTRADOR`, `BARBERO` | — | `200` |
| POST | `/usuarios/barberos/:usuarioId/foto` | `JwtAuthGuard` | `SUPERADMIN`, `ADMINISTRADOR` | fichero `archivo` | `201` foto de un barbero concreto |
| GET | `/usuarios/me` | `JwtAuthGuard` | cualquier sesión de personal | — | `200` `UsuarioPerfilDto` |
| GET | `/usuarios/:usuarioId` | `JwtAuthGuard` | `SUPERADMIN`, `ADMINISTRADOR`, `BARBERO` | — | `200` `UsuarioPerfilDto` |
| PATCH | `/usuarios/:usuarioId` | `JwtAuthGuard` | `SUPERADMIN`, `ADMINISTRADOR`, `BARBERO` | `ActualizarUsuarioDto` | `200` |
| PATCH | `/usuarios/:usuarioId/estado` | `JwtAuthGuard` | `SUPERADMIN`, `ADMINISTRADOR` | `CambiarEstadoUsuarioDto` | `200` |
| POST | `/usuarios/me/barbero` | `JwtAuthGuard` | `SUPERADMIN`, `ADMINISTRADOR`, `BARBERO` | `ConfigurarBarberoDto` | `200` convierte la sesión actual en barbero |
| POST | `/usuarios/:usuarioId/barbero` | `JwtAuthGuard` | `SUPERADMIN` | `ConfigurarBarberoDto` | `200` convierte un usuario en barbero del negocio |
| GET | `/usuarios/simular-error-grave` | `JwtAuthGuard` | `SUPERADMIN`, `ADMINISTRADOR` (comprobación explícita) | — | `500` **siempre**, y solo si el simulador está habilitado; en otro caso `404` (sin sesión: `401`) |

Reglas:

- `POST /usuarios/me/barbero` y `POST /usuarios/:usuarioId/barbero` crean el perfil de
  barbero **en el negocio del contexto**, no globalmente.
- `PATCH /usuarios/:usuarioId/estado` cambia el estado **global** del usuario (no por
  negocio); el alcance por negocio se gestiona con las membresías.
- `GET /usuarios/simular-error-grave` (diagnóstico de la cadena de alertas) exige **sesión
  de personal**, **rol de administración** del negocio y **habilitación explícita** por
  entorno (`SIMULADOR_ERROR_HABILITADO=true`). Está **siempre deshabilitado en
  producción** (`NODE_ENV=production`) y, si no está habilitado, responde **404**. Sin
  sesión responde **401**. Un intento no autorizado **no** genera correo de alerta: por
  eso el rol se comprueba de forma explícita y no con `RolesGuard` (que respondería 403, y
  el filtro global envía correo ante todo 403).
- `GET /usuarios/simular-error-grave` está documentado aquí como **cambio de contrato**
  (REQ-009): antes era público y siempre respondía 500.

---

## 6. Servicios (`/servicios`)

| Método | Ruta | Auth | Rol | Cuerpo / Query | Respuesta |
|--------|------|------|-----|----------------|-----------|
| POST | `/servicios` | `JwtAuthGuard` | `SUPERADMIN`, `ADMINISTRADOR` | `CrearServicioDto` | `201` servicio creado |
| GET | `/servicios` | — | — | `FiltroServiciosDto` | `200` catálogo público |
| GET | `/servicios/gestion` | `JwtAuthGuard` | `SUPERADMIN`, `ADMINISTRADOR` | `FiltroServiciosDto` | `200` catálogo de gestión |
| GET | `/servicios/:id` | `JwtAuthGuard` | `SUPERADMIN`, `ADMINISTRADOR`, `BARBERO` | — | `200` `ServicioResponseDto` |
| PATCH | `/servicios/:id` | `JwtAuthGuard` | `SUPERADMIN`, `ADMINISTRADOR` | `ActualizarServicioDto` | `200` |
| PATCH | `/servicios/:id/estado` | `JwtAuthGuard` | `SUPERADMIN`, `ADMINISTRADOR` | `CambiarEstadoServicioDto` | `200` |
| GET | `/servicios/barbero/:barberoId` | — | — | — | `200` servicios activos de ese barbero |
| GET | `/servicios/:servicioId/barberos` | — | — | — | `200` `BarberoPorServicioDto[]` |
| POST | `/servicios/:id/foto` | `JwtAuthGuard` | `SUPERADMIN`, `ADMINISTRADOR` | fichero `archivo` | `201` |
| DELETE | `/servicios/:id/foto` | `JwtAuthGuard` | `SUPERADMIN`, `ADMINISTRADOR` | — | `200` |

---

## 7. Productos (`/productos`)

| Método | Ruta | Auth | Rol | Cuerpo / Query | Respuesta |
|--------|------|------|-----|----------------|-----------|
| POST | `/productos` | `JwtAuthGuard` | `SUPERADMIN`, `ADMINISTRADOR` | `CrearProductoDto` + fichero `imagen` opcional | `201` producto creado |
| GET | `/productos` | `JwtAuthGuard` | `SUPERADMIN`, `ADMINISTRADOR` | — | `200` listado administrativo (ACTIVO e INACTIVO) |
| GET | `/productos/catalogo` | — | — | — | `200` catálogo público de productos ACTIVO |
| GET | `/productos/catalogo/:productoId` | — | — | — | `200` `ProductoCatalogoResponseDto` |
| GET | `/productos/:productoId` | `JwtAuthGuard` | `SUPERADMIN`, `ADMINISTRADOR` | — | `200` detalle administrativo |
| PATCH | `/productos/:productoId` | `JwtAuthGuard` | `SUPERADMIN`, `ADMINISTRADOR` | `ActualizarProductoDto` + fichero `imagen` opcional | `200` |
| PATCH | `/productos/:productoId/estado` | `JwtAuthGuard` | `SUPERADMIN`, `ADMINISTRADOR` | `CambiarEstadoProductoDto` | `200` |

Reglas del catálogo público:

- El negocio se resuelve por subdominio o `X-Negocio-Slug`; nunca por body ni query.
- Solo se devuelven productos `ACTIVO` del negocio del contexto, ordenados por nombre.
- Los campos públicos son `id`, `nombre`, `descripcion`, `precio` e `imagenUrl`; no se
  exponen `estado` ni fechas de auditoría.
- Un producto inactivo, inexistente o de otro negocio responde **404** con el mismo
  mensaje, para no revelar su existencia.
- Si no hay productos activos, responde `200` con
  `{ "mensaje": "No hay productos disponibles en este momento", "productos": [] }`.
- Sin contexto de negocio responde **403**; con un slug inexistente o inactivo, **404**.

### 7.1 Descuentos (`/descuentos`)

| Método | Ruta | Auth | Rol | Cuerpo / Query | Respuesta |
|--------|------|------|-----|----------------|-----------|
| POST | `/descuentos` | `JwtAuthGuard` | `SUPERADMIN, ADMINISTRADOR` | `CrearDescuentoDto` | `201` `DescuentoCreadoResponseDto` |

Reglas de creación (HE-10-HU-02):

- El negocio sale del contexto autorizado; `negocioId` y `activo` en el cuerpo se rechazan
  con **400** por el `ValidationPipe` global.
- Los roles efectivos `SUPERADMIN` y `ADMINISTRADOR` del negocio crean. `BARBERO` recibe **403**.
- El cuerpo identifica **un** elemento: `tipo` (`PRODUCTO` o `SERVICIO`) y `elementoId`.
  El servidor mapea el tipo a `productoId` o `servicioId`; no admite ambos.
- `porcentaje` es numérico, entre **1 y 99** inclusive, con **máximo dos decimales**. Un
  tercer decimal se rechaza con **400**; no se redondea.
- `diasSemana` exige al menos un `WeekDay` válido. Los duplicados se eliminan y la
  respuesta los devuelve en orden canónico.
- Un elemento admite **un único descuento**, esté activo o inactivo. El segundo intento
  responde **409**; la unicidad la impone la base de datos, no solo la comprobación previa.
- El descuento nace **inactivo** (`activo: false`). Crearlo no lo aplica.
- Un producto o servicio inexistente o de otro negocio responde **404** con el mismo
  mensaje, para no revelar su existencia.
- La creación no evalúa precios ni acumula promociones; esa aplicación corresponde a la
  consulta de catálogo/reserva. HU-02 no expone endpoint de cancelación.

---

## 8. Horarios y disponibilidad

### 8.1 Del barbero autenticado (`/usuarios/me/barbero`)

| Método | Ruta | Auth | Rol | Cuerpo / Query | Respuesta |
|--------|------|------|-----|----------------|-----------|
| GET | `/usuarios/me/barbero/horario-semanal` | `JwtAuthGuard` | `SUPERADMIN`, `ADMINISTRADOR`, `BARBERO` | — | `200` `HorarioSemanalResponseDto` |
| PUT | `/usuarios/me/barbero/horario-semanal` | `JwtAuthGuard` | `SUPERADMIN`, `ADMINISTRADOR`, `BARBERO` | `ReemplazarHorarioSemanalDto` | `200` `HorarioSemanalResponseDto` |
| GET | `/usuarios/me/barbero/disponibilidad` | `JwtAuthGuard` | `SUPERADMIN`, `ADMINISTRADOR`, `BARBERO` | `ConsultaDisponibilidadDto` | `200` `DisponibilidadDetalladaResponseDto` |
| GET | `/usuarios/me/barbero/bloqueos-horario` | `JwtAuthGuard` | `SUPERADMIN`, `ADMINISTRADOR`, `BARBERO` | `FiltroBloqueosHorarioDto` | `200` `BloqueoHorarioResponseDto[]` |
| POST | `/usuarios/me/barbero/bloqueos-horario` | `JwtAuthGuard` | `SUPERADMIN`, `ADMINISTRADOR`, `BARBERO` | `CrearBloqueoHorarioDto` | `201` `BloqueoHorarioAccionResponseDto` |
| PATCH | `/usuarios/me/barbero/bloqueos-horario/:id` | `JwtAuthGuard` | `SUPERADMIN`, `ADMINISTRADOR`, `BARBERO` | `ActualizarBloqueoHorarioDto` | `200` |
| DELETE | `/usuarios/me/barbero/bloqueos-horario/:id` | `JwtAuthGuard` | `SUPERADMIN`, `ADMINISTRADOR`, `BARBERO` | — | `200` |
| PATCH | `/usuarios/me/barbero/bloqueos-horario/:id/reactivar` | `JwtAuthGuard` | `SUPERADMIN`, `ADMINISTRADOR`, `BARBERO` | — | `200` |

`PUT /horario-semanal` **reemplaza** el conjunto completo: `[{ dia: WeekDay, startTime, endTime }]`.

### 8.2 Disponibilidad pública

| Método | Ruta | Auth | Rol | Query | Respuesta |
|--------|------|------|-----|-------|-----------|
| GET | `/usuarios/barberos/:barberoId/disponibilidad` | — | — | `ConsultaDisponibilidadDto` | `200` `DisponibilidadPublicaResponseDto` |

`ConsultaDisponibilidadDto`: `fecha` (`YYYY-MM-DD`, obligatoria), `servicioId` (entero ≥ 1,
opcional).

**Es informativa**: no reserva ni bloquea la franja. La reserva real se hace en
`POST /reservas`, que revalida dentro de la transacción.

### 8.3 Gestión de horarios de cualquier barbero (`/usuarios/barberos`)

| Método | Ruta | Auth | Rol | Respuesta |
|--------|------|------|-----|-----------|
| GET | `/usuarios/barberos/:barberoId/horario-semanal` | `JwtAuthGuard` | `SUPERADMIN` | `HorarioSemanalResponseDto` |
| PUT | `/usuarios/barberos/:barberoId/horario-semanal` | `JwtAuthGuard` | `SUPERADMIN` | `HorarioSemanalResponseDto` |
| GET | `/usuarios/barberos/:barberoId/bloqueos-horario` | `JwtAuthGuard` | `SUPERADMIN` | `BloqueoHorarioResponseDto[]` |
| POST | `/usuarios/barberos/:barberoId/bloqueos-horario` | `JwtAuthGuard` | `SUPERADMIN` | `BloqueoHorarioAccionResponseDto` |
| PATCH | `/usuarios/barberos/:barberoId/bloqueos-horario/:id` | `JwtAuthGuard` | `SUPERADMIN` | `BloqueoHorarioAccionResponseDto` |
| DELETE | `/usuarios/barberos/:barberoId/bloqueos-horario/:id` | `JwtAuthGuard` | `SUPERADMIN` | `BloqueoHorarioAccionResponseDto` |
| PATCH | `/usuarios/barberos/:barberoId/bloqueos-horario/:id/reactivar` | `JwtAuthGuard` | `SUPERADMIN` | `BloqueoHorarioAccionResponseDto` |

---

## 9. Perfil del negocio (`/perfil-negocio`)

| Método | Ruta | Auth | Rol | Cuerpo | Respuesta |
|--------|------|------|-----|--------|-----------|
| GET | `/perfil-negocio` | — | — | — | `200` `PerfilNegocioPublicoResponseDto` |
| GET | `/perfil-negocio/gestion` | `JwtAuthGuard` | `SUPERADMIN`, `ADMINISTRADOR` | — | `200` `PerfilNegocioGestionResponseDto` |
| PUT | `/perfil-negocio` | `JwtAuthGuard` | `SUPERADMIN`, `ADMINISTRADOR` | `ActualizarPerfilNegocioDto` | `200` `PerfilNegocioGestionResponseDto` |
| PUT | `/perfil-negocio/referencias` | `JwtAuthGuard` | `SUPERADMIN`, `ADMINISTRADOR` | `ActualizarPerfilNegocioDto` (referencias) | `200` `PerfilNegocioGestionResponseDto` |
| POST | `/perfil-negocio/favicon` | `JwtAuthGuard` | `SUPERADMIN`, `ADMINISTRADOR` | `archivo` (SVG/PNG) | `201` |
| POST | `/perfil-negocio/banner` | `JwtAuthGuard` | `SUPERADMIN`, `ADMINISTRADOR` | `archivo` (PNG) | `201` |
| POST | `/perfil-negocio/logo-blanco` | `JwtAuthGuard` | `SUPERADMIN`, `ADMINISTRADOR` | `archivo` (SVG/PNG) | `201` |
| POST | `/perfil-negocio/logo-negro` | `JwtAuthGuard` | `SUPERADMIN`, `ADMINISTRADOR` | `archivo` (SVG/PNG) | `201` |
| DELETE | `/perfil-negocio/favicon` | `JwtAuthGuard` | `SUPERADMIN`, `ADMINISTRADOR` | — | `200` |
| DELETE | `/perfil-negocio/banner` | `JwtAuthGuard` | `SUPERADMIN`, `ADMINISTRADOR` | — | `200` |
| DELETE | `/perfil-negocio/logo-blanco` | `JwtAuthGuard` | `SUPERADMIN`, `ADMINISTRADOR` | — | `200` |
| DELETE | `/perfil-negocio/logo-negro` | `JwtAuthGuard` | `SUPERADMIN`, `ADMINISTRADOR` | — | `200` |

Reglas de los recursos de marca:

- Tamaño máximo por tipo en `src/common/config/uploads.config.ts`; formato y SVG con límite
  propio (`LIMITE_BYTES_SVG`, `LIMITE_BYTES_PNG`).
- El tipo real del fichero se valida **por contenido** (`detectar-tipo-archivo.ts`), no por
  extensión.
- Los SVG se **sanean** antes de servirse (`sanitizar-svg.ts`).
- Los ficheros se guardan bajo un directorio **propio del negocio**; el perfil expone
  únicamente la ruta pública del recurso.
- El borrado del fichero es lógica: se limpia la referencia y se elimina el recurso.

---

## 10. WhatsApp (`/whatsapp`)

Todas las rutas exigen `JwtAuthGuard` + rol `SUPERADMIN` o `ADMINISTRADOR`
(decoradores a nivel de controlador).

| Método | Ruta | Cuerpo | Respuesta |
|--------|------|--------|-----------|
| GET | `/whatsapp/status` | — | `200` estado de la sesión y QR |
| POST | `/whatsapp/iniciar` | — | `200` inicia/despierta la sesión |
| POST | `/whatsapp/pausar` | — | `200` pausa la sesión |
| POST | `/whatsapp/desconectar` | — | `200` desvincula la cuenta |
| GET | `/whatsapp/plantillas` | — | `200` plantillas de mensajes |
| PUT | `/whatsapp/plantillas` | `ActualizarPlantillasDto` | `200` |
| POST | `/whatsapp/plantillas/reset` | — | `200` restablece las plantillas por defecto |

Las plantillas de WhatsApp están **aisladas por negocio** (`WhatsAppPlantilla.negocioId`).
Los recordatorios usan `PerfilNegocio.direccion` como dirección canónica, con reserva al
campo heredado `Negocio.direccion` y al valor `negocio_direccion` de la configuración.

---

## 11. Configuración

El módulo `src/modules/configuracion` **no expone ningún endpoint HTTP**: la
configuración (del sistema y del negocio) se gestiona internamente y por base de datos.
Ver `docs/api/MATRIZ_AUDITORIA_ENDPOINTS.md` (gap G-04).

---

## 12. Cómo se verificó este documento

- Rutas, guards y roles: extraídos de los 16 controladores del proyecto
  (`src/app.controller.ts`, `src/auth/**`, `src/modules/**`): **86 rutas** en el código.
- Contraste con el documento OpenAPI generado en ejecución (`GET /api/docs-json`): el
  backend expone **86 operaciones**, una por ruta. Las 86 están presentes en
  `docs/api/REFERENCIA_API.md` (verificado en ambos sentidos por script).
- Formato de error: `src/logger/all-exceptions.filter.ts`.
- Resolución de tenant: `src/modules/negocios/service/negocio-resolucion.service.ts` y
  `src/modules/negocios/middleware/negocio-contexto.middleware.ts`.
- Códigos de dominio: `src/common/exceptions/domain-conflict.exception.ts`.
- Descuentos: `src/modules/descuentos/controller/descuentos.controller.ts`,
  `src/modules/descuentos/service/descuento.service.ts`,
  `src/modules/descuentos/repository/descuento.repository.ts`.
- Idempotencia y cifrado del token: `src/modules/reservas/service/reservas.service.ts`,
  `src/modules/reservas/repository/reservas.repository.ts`,
  `prisma/schema.prisma`.
- Reglas de disponibilidad: `src/modules/horarios/service/disponibilidad.service.ts` y
  `src/modules/horarios/strategies/`.
- Swagger: `src/main.ts` (`SwaggerModule.setup('api/docs', ...)`).
