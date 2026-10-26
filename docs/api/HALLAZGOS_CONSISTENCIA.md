<!--
Trazabilidad:
- REQ: REQ-008, REQ-009, REQ-010
- Modelo ejecutor: minimax-m3.1-flash-free
- Propósito: auditoría de consistencia entre reglas documentadas, código real y cobertura de pruebas.
- Responsabilidad: documento; audita y reporta, no corrige.
-->

# Hallazgos de consistencia (reglas ↔ código ↔ pruebas)

> Auditoría de **solo lectura** del backend. Cada hallazgo cita el fichero y la línea donde
> se verificó. No se ha modificado ningún fichero de `src/` ni de `test/` durante esta
> auditoría.

## 0. Resumen

| # | Hallazgo | Severidad | Tipo | Estado |
|---|----------|-----------|------|--------|
| H-01 | Endpoint de prueba de error 500 **sin autenticar** | **Alta** | Seguridad | **CORREGIDO (REQ-009)** |
| H-02 | El `idToken` de Google se escribe en los logs y en la alerta por correo | **Alta** | Seguridad | **CORREGIDO (REQ-009)** |
| H-03 | El contrato describe la vista de gestión del perfil con "bloques + auditoría" que no existen | Media | Documentación | Abierto |
| H-04 | Tres formatos distintos de la ruta pública de los recursos de marca | Media | Documentación | Abierto |
| H-05 | `details.horariosAlternativos` es parte del contrato y **no tiene ninguna prueba** | Media | Pruebas | Abierto |
| H-06 | La matriz RACI documenta 36 de 85 rutas | Baja | Documentación | Abierto |
| H-07 | No existía un catálogo completo de la API | Media | Documentación | **Resuelto en REQ-008** |
| H-08 | Los 7 códigos de dominio del contrato coinciden con el código y tienen prueba | — | Conforme | Cerrado |
| H-09 | El health check `GET /` existe en el código pero **no está montado**: responde 404 | Media | Código | **CORREGIDO (REQ-009)** |
| H-10 | `npm run test:e2e` está roto: 4 suites no cargan | Media | Pruebas | **CORREGIDO (REQ-009)** |

> Los hallazgos marcados **CORREGIDO** lo están porque existe una **prueba que lo verifica**,
> no solo porque el código haya cambiado. La evidencia de cada uno está en su apartado y en
> `docs/solicitudes/REQ-009.md`.

---

## H-01 — Endpoint de prueba de error 500 sin autenticar · **Alta** · CORREGIDO (REQ-009)

`src/modules/usuarios/controller/usuarios.controller.ts:39-48`

```ts
@Get('simular-error-grave')
simularError() {
  throw new InternalServerErrorException('¡Simulación de explosión del servidor (Error 500)!');
}
```

- **No tiene `@UseGuards`**: la clase tiene `@ApiBearerAuth()` a nivel de controlador
  (línea 32), pero eso solo afecta a Swagger; la ruta es **pública**.
- El `AllExceptionsFilter` (`src/logger/all-exceptions.filter.ts:74-84`) trata cualquier
  ≥500 como error crítico y **envía una alerta por correo**
  (`alertsService.sendSecurityAlert`, línea 83).

Consecuencias:

1. Cualquiera, sin credenciales, puede generar un correo de alerta al responsable de
   seguridad: vector de **spam de alertas** y degradación de la señalización real.
2. Genera ruido permanente en la monitorización: una ruta accesible que siempre falla.
3. Es la **única** ruta del backend cuyo propósito es fallar.

*Recomendación*: eliminar la ruta del código de producción, o protegerla con
`JwtAuthGuard` + rol de administración y limitar su ejecución al entorno de desarrollo
(por ejemplo, responder 404 cuando `NODE_ENV === 'production'`).

**Corrección aplicada (REQ-009)** — la ruta ahora exige tres cosas a la vez:

1. **Sesión de personal válida** (`JwtAuthGuard`). Sin sesión → **401** (y el filtro global
   no envía correo en los 401).
2. **Rol de administración del negocio** (`SUPERADMIN` o `ADMINISTRADOR`). La comprobación
   es explícita y **no** usa `RolesGuard`, a propósito: `RolesGuard` responde 403 y el
   filtro global envía correo de alerta ante **todo** 403, de modo que un intento no
   autorizado podría generar correo. Aquí se responde **404**, que no genera alerta.
3. **Habilitación explícita por entorno**: `SIMULADOR_ERROR_HABILITADO=true`, y
   **nunca** en producción (`NODE_ENV=production` la deshabilita aunque se pida).

Verificación: `test/seguridad-simulador.e2e-spec.ts` (6 pruebas HTTP) comprueba los cuatro
casos — sin sesión (401, sin correo), con sesión sin rol (404, sin correo), sin
habilitación (404, sin correo), en producción (404, sin correo) y con habilitación y rol
(500, **sí** se envía la alerta). El correo se verifica con el servicio de alertas
**doble**: se comprueba que se invoca, no que se envíe de verdad.

## H-02 — El `idToken` de Google se escribe en los logs y en la alerta por correo · **Alta** · CORREGIDO (REQ-009)

`src/logger/all-exceptions.filter.ts:52` construye el contexto de log:

```ts
const logContext = {
  timestamp: new Date().toISOString(),
  path: request.url,
  method: request.method,
  ip: request.ip,
  body: request.body, // Opcional, con cuidado en prod
  user: request.user?.email || request.user?.sub,
  message,
};
```

- El comentario del propio código advierte del riesgo ("con cuidado en prod"), pero el
  `body` se incluye **siempre**.
- `POST /auth/google` y `POST /auth/clientes/google` reciben el **ID Token de Google en el
  cuerpo** (`src/auth/google/dto/google-login.dto.ts` → campo `idToken`). Un token inválido
  produce 401 y una cuenta sin perfil produce 403.
- Para el **403**, el filtro no solo escribe el log: **envía el mismo `logContext` por
  correo** (`all-exceptions.filter.ts:66-72`). Es decir, el ID Token de Google viaja al buzón
  del responsable de seguridad.

Precisión importante: el **token de gestión de invitado no está afectado**, porque viaja en
la cabecera `X-Reservation-Management-Token` y el filtro no registra cabeceras
(`src/modules/reservas/controller/reservas.controller.ts:670`).

*Recomendación*: no registrar `request.body`; como mínimo, sustituirlo por una lista de
claves permitidas, o enmascarar los campos sensibles (`idToken`, `token`, `password`)
antes de construir el contexto.

**Corrección aplicada (REQ-009)** — el cuerpo **ha desaparecido** del contexto:

- `src/logger/sanitizar-contexto-error.ts` construye el contexto con una **lista blanca**:
  `timestamp`, `method`, `path` (saneada), `status`, `requestId`, `codigoError`, `ip`,
  `user` y `message`. **No hay `body`**, ni cabeceras, ni cookies.
- La **ruta** se sanea: se redactan los segmentos que parecen credenciales y los valores
  sensibles de la query string (por nombre o por forma), conservando el nombre del
  parámetro para no perder contexto.
- `src/modules/alerts/alerts.service.ts` **construye el correo con sus propia lista
  blanca**: aunque un llamador pasara un `body` o una cabecera `Authorization`, el
  correo no puede arrastrarlos.
- Se añade un `requestId` (UUID) al contexto y a la respuesta (cabecera `X-Request-Id`),
  para correlacionar log, correo y respuesta.

Verificación: `src/logger/all-exceptions.filter.spec.ts` y
`src/modules/alerts/alerts.service.spec.ts` usan el secreto de prueba
`SECRETO-DE-PRUEBA-NO-DEBE-APARECER` y comprueban que **no** aparece ni en lo registrado
por el logger ni en el `text`/`html` del correo; `test/seguridad-simulador.e2e-spec.ts`
repite la comprobación sobre la petición real. Comprobado además en ejecución: el
`logs/security-*.log` generado por una petición 401 real contiene el contexto seguro y
**ningún** archivo de log contiene la clave `body`.

**Revisión REQ-010 (refinamiento)**: la revisión precommit detectó dos cosas que la Fase
H había dejado sueltas:

1. La **respuesta HTTP** devolvía la URL **cruda** (`path: request.url`), de modo que un
   secreto en la query string se ocultaba en el log pero **no** en el cuerpo de la
   respuesta. Corregido: la respuesta usa la misma ruta saneada. El resto del contrato
   (`statusCode`, `timestamp`, `message`, `code`, `details`) y la cabecera `X-Request-Id`
   no cambian. Comprobado en ejecución:
   `path: "/usuarios/me?token=[redactado]&id_token=[redactado]&fecha=2026-10-21"`.
2. El nombre de parámetro **`key`** no estaba en la lista de nombres sensibles (solo
   `api_key` y `apiKey`). Corregido: `key`, `x-key` y `api_key` se redactan, sin
   castigar nombres inocuos que lo contengan (`sortKey`).

Límite conocido y documentado: la redacción se apoya en el **nombre** del parámetro y en
la **forma** del valor (24+ caracteres tipo base64/hex). Un secreto **corto** en un
parámetro de nombre inocuo **no** se detecta.

## H-03 — La vista de gestión del perfil no tiene "bloques + auditoría" · Media

`CONTRATOS_API_MULTITENANT.md:338` describe:

> `GET /perfil-negocio/gestion` → Vista de gestión: bloques + auditoría.

El DTO real (`src/modules/perfil-negocio/dto/dto-respuesta/perfil-negocio-gestion.response.dto.ts`)
expone: `frasePrincipal`, `direccion`, `ciudad`, `departamento`, `referencia`, `latitud`,
`longitud`, `mapsUrl`, `faviconUrl`, `bannerUrl`, `logoBlancoUrl`, `logoNegroUrl`,
`negocio`, `configurado`, `contenido`, `ubicacion`, `referenciasArchivo`, `creadoEn`,
`actualizadoEn`.

- **No existe** ningún campo de "bloques".
- "Auditoría" se reduce a dos marcas de tiempo (`creadoEn`, `actualizadoEn`); no hay
  historial de quién cambió qué ni cuándo.

*Corrección*: o se corrige la descripción del contrato, o se implementan los bloques y la
auditoría. Hoy el contrato **promete más de lo que la API entrega**.

## H-04 — Tres formatos distintos de la ruta pública de los recursos de marca · Media

| Fuente | Formato |
|--------|---------|
| Ejemplo del DTO (`perfil-negocio-gestion.response.dto.ts`) | `/uploads/negocios/kyrios-studio/favicon.png` |
| Comentario en `src/modules/perfil-negocio/perfil-negocio.constants.ts:31` | `/uploads/negocios/kyrios/logo.png` |
| **Implementación real** (`src/modules/perfil-negocio/service/perfil-negocio.service.ts:319`) | `/uploads/negocios/{contexto.id}/perfil/<archivo>` |

La implementación real usa el **id numérico** del negocio y añade el segmento `perfil/`.
Ni el ejemplo del DTO (que además usa el slug) ni el comentario de las constantes
coinciden con lo que devuelve la API.

Consecuencia: un consumidor que construya la URL a partir del ejemplo del DTO (o que
escriba un test a partir de él) obtendrá un 404.

*Corrección*: unificar el formato en el ejemplo del DTO, en el comentario de las
constantes y en la documentación; lo natural es documentar el formato real
(`/uploads/negocios/{id}/perfil/{archivo}`).

## H-05 — `details.horariosAlternativos` no tiene ninguna prueba · Media

`CONTRATOS_API_MULTITENANT.md:753-756` declara parte del contrato público:

> `SLOT_TAKEN` incluye, cuando se puede calcular, hasta **tres horarios alternativos
> libres** del mismo barbero y la misma fecha en `details.horariosAlternativos`.

La **implementación existe y es correcta**
(`src/modules/reservas/service/reservas.service.ts:1813-1848`): calcula la disponibilidad
después del fallo, filtra `AVAILABLE`, corta con `.slice(0, 3)` (línea 1838) y devuelve `[]`
si la disponibilidad no se puede calcular. El filtro global sí propaga `details` a la
respuesta (`all-exceptions.filter.ts:45` y `:100`).

El problema es la **cobertura**: buscando `horariosAlternativos` en todo el repositorio
(`src/` y `test/`), las únicas apariciones están en el propio servicio. **Ninguna prueba**
verifica:

- que el 409 `SLOT_TAKEN` incluya `details.horariosAlternativos`;
- que nunca supere 3 elementos;
- que la lista vaya vacía cuando la disponibilidad no se puede calcular.

Es el único punto del contrato con una promesa observable en la respuesta HTTP que queda
sin verificar. *Corrección*: añadir una prueba que fije ese comportamiento.

## H-06 — La matriz RACI documenta 36 de 85 rutas · Baja

`docs/matriz-raci-roles.md` (documento **local**: está en `.gitignore` bajo `/docs/*`) enumera
las funcionalidades por rol, pero no cubre **49 de las 85 rutas** del backend, entre ellas:

- `GET /reservas/me/:reservaId` (detalle de reserva propia del cliente);
- `PATCH /reservas/me/:reservaId` y `PATCH /reservas/me/:reservaId/cancelar`;
- `PATCH /reservas/invitado/:reservaId` y `.../cancelar`;
- `PATCH /reservas/:reservaId/completar` y `PATCH /reservas/:reservaId/no-show`;
- `GET /reservas/barbero/me/agenda`;
- `GET /servicios/barbero/:barberoId` y `GET /servicios/:servicioId/barberos`;
- `GET /usuarios/barberos/:barberoId/disponibilidad`;
- todas las rutas de bloqueos de horario de terceros;
- todas las rutas de subida/borrado de recursos de marca;
- `POST /auth/refresh` y `POST /auth/tenant/:slug`;
- los `PATCH .../estado` de administrador, barbero, usuario y servicio.

Además usa nombres de parámetro antiguos (`:id`) donde el código usa `:usuarioId` (por
ejemplo `PATCH /usuarios/barberos/:id/comision` frente a la ruta real
`PATCH /usuarios/barberos/:usuarioId/comision`), y da por retirado
`POST /usuarios/sincronizar-superadmin` **correctamente** (la retirada está documentada en
`CONTRATOS_API_MULTITENANT.md` §7.3).

*Corrección*: regenerar la matriz a partir del catálogo de rutas, o marcarla como
"resumen funcional" y remitir a `docs/api/REFERENCIA_API.md` para el detalle.

## H-07 — No existía un catálogo completo de la API · Media — **Resuelto en este REQ**

El backend tiene **85 rutas** en 15 controladores. La documentación previa
(`CONTRATOS_API_MULTITENANT.md`) es un **contrato de cambios** (qué se rompió y qué debe
migrar el frontend), no una referencia: enumera las rutas afectadas por las fases 9 a 16,
no el catálogo completo. Para responder «¿qué puede hacer la API?» era necesario leer los
15 controladores.

*Resuelto*: `docs/api/REFERENCIA_API.md` recoge las 85 rutas con método, autenticación,
rol, cuerpo y respuesta, y `docs/api/MATRIZ_AUDITORIA_ENDPOINTS.md` las cruza con las reglas
de negocio.

## H-08 — Códigos de dominio: contrato, código y pruebas coinciden — Conforme
Los 7 códigos declarados en `CONTRATOS_API_MULTITENANT.md` §9.4 coinciden **uno a uno** con
`CODIGOS_CONFLICTO` en `src/common/exceptions/domain-conflict.exception.ts`
(`SERVICE_INACTIVE`, `BARBER_INACTIVE`, `BARBER_NO_SCHEDULE`, `NO_BARBER_FOR_SERVICE`,
`SLOT_TAKEN`, `DUPLICATE_OWN_RESERVATION`, `IDEMPOTENCY_KEY_CONFLICT`) y **los 7 tienen al
menos una prueba** que los verifica:

| Código | Ficheros de prueba que lo mencionan |
|--------|--------------------------------------|
| `SERVICE_INACTIVE` | 3 |
| `BARBER_INACTIVE` | 3 |
| `BARBER_NO_SCHEDULE` | 1 |
| `NO_BARBER_FOR_SERVICE` | 3 |
| `SLOT_TAKEN` | 5 |
| `DUPLICATE_OWN_RESERVATION` | 2 |
| `IDEMPOTENCY_KEY_CONFLICT` | 1 (`test/multitenant-reservas-concurrencia.e2e-spec.ts:444`) |

## H-09 — El health check `GET /` no está montado · Media · CORREGIDO (REQ-009)

`src/app.controller.ts` declara un controlador de estado:

```ts
@Controller()
export class AppController {
  @Get()
  getHello(): string { return this.appService.getHello(); }   // "Hello World!"
}
```

Pero `src/app.module.ts` **no lo registra**: el decorador `@Module` (líneas 25-81) no tiene
la propiedad `controllers`, y `AppController` no aparece en ningún módulo. Consecuencia
verificada **en ejecución** (backend arrancado contra `bd_barberia_multitenant_dev`):

```
GET /            → 404
GET /api/docs    → 200
GET /api/docs-json → 200 (84 operaciones)
```

Además, el OpenAPI generado expone **84 operaciones frente a las 85 rutas del código**: la
única diferencia es precisamente `GET /`, porque nunca llega a montarse.

Es decir: el único endpoint de comprobación de vida del servicio **no existe** para el
cliente que lo consulte (monitorización, balanceadores, comprobación de despliegue).

*Corrección*: registrar `AppController` en `AppModule` (`controllers: [AppController]`) y
añadir el `GET /` al documento OpenAPI, o eliminar el controlador si no se quiere exponer.

**Corrección aplicada (REQ-009)** — la causa raíz eran **dos** registros que faltaban en
`src/app.module.ts`: el controlador (`controllers: [AppController]`) **y** su servicio
(`providers: [AppService]`). Con el primero solo, la aplicación arrancaba pero fallaba
la resolución de dependencias de `AppService`.

Verificación: `test/app.e2e-spec.ts` arranca la aplicación real (contra un contenedor
MySQL efímero) y comprueba `GET /` → **200** con el cuerpo `Hello World!`. En ejecución,
el backend arrancado devuelve `200 Hello World!` y el OpenAPI pasa de 84 a **85
operaciones**, con la ruta ya incluida.

## H-10 — `npm run test:e2e` está roto: 4 suites no llegan a ejecutarse · Media · CORREGIDO (REQ-009)

El repositorio tiene tres comandos de prueba:

| Comando | Config | Resultado |
|---------|--------|-----------|
| `npm test` | `package.json` (`rootDir: src`) | 83 suites / 996 tests, **en verde** |
| `npm run test:multitenant` | `test/jest-multitenant.json` | 17 suites / 150 tests, **en verde** |
| `npm run test:e2e` | `test/jest-e2e.json` | 19 suites → **4 no cargan** |

Salida real de `npm run test:e2e`:

```
Test Suites: 4 failed, 15 passed, 19 total
Tests:       106 passed, 106 total
```

Fallan **al cargar**, no al ejecutar: `The file contains ESM syntax (import/export) that
could not be executed as CommonJS`, en `src/modules/whatsapp/whatsapp.service.ts:8`
(`@whiskeysockets/baileys`). La causa es que `test/jest-e2e.json` **no incluye** el
`moduleNameMapper` que sí tienen las otras dos configuraciones:

```json
// falta en test/jest-e2e.json, sí está en test/jest-multitenant.json
"^@whiskeysockets/baileys$": "<rootDir>/test/__mocks__/@whiskeysockets-baileys.js"
```

Suites afectadas: `test/app.e2e-spec.ts`,
`test/multitenant-aislamiento-negativo.e2e-spec.ts`,
`test/multitenant-reservas-concurrencia.e2e-spec.ts` y
`test/multitenant-superadmin-tenant.e2e-spec.ts`.

Las tres multitenant **sí se ejecutan** (y pasan) bajo `npm run test:multitenant`, porque
esa configuración sí tiene el *mock*. La pérdida real es `test/app.e2e-spec.ts`: es la
única prueba que verifica `GET /` → `Hello World!`, y es precisamente la que **fallaría**
con H-09. Es decir, el único test capaz de detectar el defecto está en la suite que no
arranca.

*Corrección*: añadir el `moduleNameMapper` de baileys a `test/jest-e2e.json` (y el mismo
`testTimeout` que el resto de configuraciones). Al repararlo, `app.e2e-spec.ts` fallará
hasta que se registre `AppController` (H-09).

**Corrección aplicada (REQ-009)** — hubo **dos** causas, no una:

1. `test/jest-e2e.json` no tenía el `moduleNameMapper` de `@whiskeysockets/baileys` (ni el
   `testTimeout` de 300 s). Añadidos ambos.
2. Al repararlo, `test/app.e2e-spec.ts` —la única suite que importa `AppModule`— reveló una
   segunda causa: `@nestjs/schedule` (v12) es **ESM puro** y no estaba en la lista de
   paquetes transformados, por lo que fallaba con «Must use import to load ES Module». Se
   añadió `@nestjs/schedule` al `transformIgnorePatterns` (el `tsconfig.e2e.json` ya tiene
   `allowJs: true`, de modo que `ts-jest` lo compila a CommonJS).

Además se corrigió un riesgo que la auditoría de H-10 destapó: `test/app.e2e-spec.ts`
arrancaba la aplicación **contra la base de datos del entorno** (`bd_barberia`, puerto
3307 del `.env` por defecto). Como `PrismaService.onModuleInit` abre conexión y el
servicio de arranque escribe la configuración operativa de los negocios, esa suite podía
**escribir en la base compartida**. Ahora arranca contra un contenedor MySQL efímero, el
mismo patrón que las 17 suites `multitenant*`.

Verificación: `npm run test:e2e` pasa de **4 suites rotas / 15 correctas** a **20 suites
correctas / 168 pruebas** (antes: 106 pruebas). Ninguna suite queda omitida y no se ha
eliminado ninguna aserción. El doble de `baileys` se completa con las funciones `isJid*`
que usa el servicio de WhatsApp: solo lo usan las suites que **no** verifican la
integración real con WhatsApp (imposible sin una cuenta real), y su alcance queda
documentado en el propio doble.

## 2. Comprobaciones adicionales que resultaron conformes

| Comprobación | Resultado |
|--------------|-----------|
| Los 5 roles de las rutas existen en el guard | Conforme (`src/auth/roles/roles.guard.ts`) |
| La resolución del tenant por subdominio y por `X-Negocio-Slug` está documentada y es la implementada | Conforme (`negocio-resolucion.service.ts`) |
| La promesa de `horariosAlternativos` ≤ 3 se cumple en el código | Conforme (`reservas.service.ts:1838`) |
| `details` se propaga a la respuesta HTTP | Conforme (`all-exceptions.filter.ts:100`) |
| El token de gestión **no** viaja en el cuerpo ni en la URL | Conforme (`X-Reservation-Management-Token`) |
| La reserva ajena responde 404 sin revelar su existencia | Conforme (`reservas.service.ts:359`, comentario HU-07) |
| El `ValidationPipe` global rechaza campos no declarados | Conforme (`src/main.ts:59-62`) |
| El contrato de idempotencia coincide con lo implementado | Conforme (`reservas.repository.ts` + §9.3 del contrato) |
| El rol `SUPERADMIN` es por negocio, no de plataforma | Conforme (`negocio-roles.service.ts` + §7 del contrato) |
