# Contratos de API para operación por negocio (multitenant)

> Documento técnico **versionado** (Fase 6). Describe los contratos públicos
> que el frontend debe adoptar para operar por barbería y los cambios de
> identificadores introducidos en esta fase.
>
> Contexto de plataforma: [MULTITENANT.md](MULTITENANT.md) no está versionado
> (es una bitácora local). Este documento sí lo está.

## 1. Cómo se selecciona la barbería (contexto de negocio)

Toda ruta que lee datos de una barbería (catálogos, disponibilidad, reservas)
necesita un **contexto de negocio**, que el servidor obtiene de:

1. **Subdominio** (mecanismo principal): `acme.barberia.com` → slug `acme`.
   Requiere `NEGOCIO_DOMINIO_BASE` configurado.
2. **Cabecera `X-Negocio-Slug`** (alternativa admitida): `X-Negocio-Slug: kyrios-studio`.

Si el negocio no existe o está inactivo, la API responde **404** y **no**
consulta ningún dato de negocio. No existe ningún parámetro `negocioId` en el
cuerpo, la query ni otra cabecera que sirva para autorizar.

| Elemento | Valor |
|---|---|
| Subdominio de ejemplo | `kyrios-studio.<NEGOCIO_DOMINIO_BASE>` |
| Cabecera de ejemplo | `X-Negocio-Slug: kyrios-studio` |
| Cabecera de la reserva de invitado | `X-Reservation-Management-Token: <token entregado al crear la reserva>` |

## 2. Tabla de cambios de contrato

| # | Endpoint | Identificador anterior | Identificador nuevo | Encabezados requeridos | ¿Rompe compatibilidad? | Acción del frontend |
|---|---|---|---|---|---|---|
| 0 | `GET /usuarios/me`, `GET /usuarios/:usuarioId`, `POST /auth/google` (campo `usuario.rol`) | `rol` = `ADMINISTRADOR` \| `BARBERO` \| `SUPERADMIN` | `rol` = `PERSONAL` \| `SUPERADMIN` | `X-Negocio-Slug` (login) | **Sí** (solo el campo informativo `rol`) | Dejar de usar `usuario.rol` para decidir permisos: usar `usuario.roles` (roles efectivos del negocio). `SUPERADMIN` se mantiene igual. |
| 1 | `GET /servicios` | `barberos[].id` = `Usuario.id` | `barberos[].id` = **`Barbero.id`** | `X-Negocio-Slug` (o subdominio) | **Sí** | Dejar de traducir el id: usar `barberos[].id` tal cual en disponibilidad y reserva |
| 2 | `GET /servicios/gestion` | `barberos[].id` = `Usuario.id` | `barberos[].id` = **`Barbero.id`** | `X-Negocio-Slug` | **Sí** | Igual que #1 |
| 3 | `GET /servicios/:id` | `barberos[].id` = `Usuario.id` | `barberos[].id` = **`Barbero.id`** | `X-Negocio-Slug` | **Sí** | Igual que #1 |
| 4 | `GET /servicios/barbero/:barberoId` | `:barberoId` = `Usuario.id` | `:barberoId` = **`Barbero.id`** | `X-Negocio-Slug` | **Sí** | Enviar el `Barbero.id` que devuelve el catálogo. Un barbero de otra barbería responde 404 |
| 5 | `POST /servicios` (cuerpo `barberoIds[]`) | `Usuario.id[]` | **`Barbero.id[]`** | `X-Negocio-Slug` | **Sí** | Enviar `barberoId` (nuevo campo del catálogo de gestión), no `id` |
| 6 | `PATCH /servicios/:id` (cuerpo `barberoIds[]`) | `Usuario.id[]` | **`Barbero.id[]`** | `X-Negocio-Slug` | **Sí** | Igual que #5 |
| 7 | `GET /servicios/:servicioId/barberos` | `id` = `Barbero.id` | Sin cambio | `X-Negocio-Slug` | No | — |
| 8 | `GET /usuarios/barberos` (catálogo público) | `id` = `Barbero.id` | Sin cambio | `X-Negocio-Slug` | No | — |
| 9 | `GET /usuarios/barberos/:barberoId/disponibilidad` | `:barberoId` = `Barbero.id` | Sin cambio | `X-Negocio-Slug` | No | — |
| 10 | `GET /usuarios/barberos/gestion` | `id` = `Usuario.id` | `id` = `Usuario.id` (sin cambio) **+ campo nuevo `barberoId` = `Barbero.id`** | `X-Negocio-Slug` | No (campo nuevo) | Leer `barberoId` para construir `barberoIds[]` de los servicios |
| 11 | `PATCH /usuarios/barberos/:usuarioId/comision` | `:id` = `Usuario.id` | `:usuarioId` = `Usuario.id` (mismo valor) | `Authorization` | No (solo cambia el nombre del parámetro) | Ninguna: la URL es idéntica |
| 12 | `PATCH /usuarios/barberos/:usuarioId/estado` | `:id` = `Usuario.id` | `:usuarioId` = `Usuario.id` (mismo valor) | `Authorization` | No | Ninguna |
| 13 | `POST /usuarios/barberos/:usuarioId/foto` | `:id` = `Usuario.id` | `:usuarioId` = `Usuario.id` (mismo valor) | `Authorization` | No | Ninguna |
| 14 | `GET /usuarios/:usuarioId` | `:id` = `Usuario.id` | `:usuarioId` = `Usuario.id` (mismo valor) | `Authorization` | No | Ninguna |
| 15 | `PATCH /usuarios/:usuarioId` y `PATCH /usuarios/:usuarioId/estado` | `:id` = `Usuario.id` | `:usuarioId` = `Usuario.id` (mismo valor) | `Authorization` | No | Ninguna |
| 16 | `POST /usuarios/:usuarioId/barbero` | `:id` = `Usuario.id` | `:usuarioId` = `Usuario.id` (mismo valor) | `Authorization` | No | Ninguna |
| 17 | `GET /perfil-negocio` | (no existía) | `negocio.nombre` y `negocio.slug` del negocio del contexto | `X-Negocio-Slug` (o subdominio) | No (endpoint nuevo) | Leer la marca y la ubicación de la barbería desde la API en lugar de `brand.ts` |
| 18 | `GET /perfil-negocio/gestion` | (no existía) | `negocio.nombre` y `negocio.slug` del negocio del contexto | `Authorization` + `X-Negocio-Slug` | No (endpoint nuevo) | Ninguna |
| 19 | `PUT /perfil-negocio` | (no existía) | — | `Authorization` + `X-Negocio-Slug` | No (endpoint nuevo) | Ninguna |
| 20 | `PUT /perfil-negocio/referencias` | (no existía) | — | `Authorization` + `X-Negocio-Slug` | No (endpoint nuevo) | Ninguna |

### Regla general

- Un recurso de **barbero** (perfil dentro de la barbería) se identifica con
  **`Barbero.id`**: catálogo de barberos, catálogo de servicios, disponibilidad,
  horario, bloqueos y reservas.
- Una **persona** (identidad global de la plataforma) se identifica con
  **`Usuario.id`**: gestión de usuarios, estado de la cuenta, comisión, foto del
  perfil de barbero y creación de perfiles.
- No hay conversiones por coincidencia numérica: un `Usuario.id` NO se
  interpreta como `Barbero.id` en ningún endpoint.

## 3. Ejemplos de petición y respuesta

### 3.1 Catálogo de servicios (público)

```http
GET /servicios
X-Negocio-Slug: kyrios-studio
```

```json
[
  {
    "id": 1,
    "nombre": "Corte clásico",
    "descripcion": "Corte con tijera y máquina",
    "precio": 20000,
    "duracionMinutos": 30,
    "fotoUrl": "/uploads/servicios/corte.jpg",
    "estado": "ACTIVO",
    "barberos": [
      {
        "id": 7,
        "nombre": "Ana",
        "apellido": "Ruiz",
        "fotoUrl": "/uploads/barberos/ana.jpg"
      }
    ]
  }
]
```

`barberos[].id = 7` es el **`Barbero.id`**: el mismo valor que se envía a
`GET /usuarios/barberos/7/disponibilidad` y a `POST /reservas`.

### 3.2 Servicios de un barbero (público)

```http
GET /servicios/barbero/7
X-Negocio-Slug: kyrios-studio
```

Respuesta: `200` con el mismo esquema de servicio. Si el barbero no pertenece a
la barbería de la petición: `404` (mensaje genérico, sin revelar existencia).

### 3.3 Disponibilidad de un barbero (público)

```http
GET /usuarios/barberos/7/disponibilidad?servicioId=1&fecha=2026-11-02
X-Negocio-Slug: kyrios-studio
```

```json
{
  "fecha": "2026-11-02",
  "timeZone": "America/Bogota",
  "barberoId": 7,
  "servicioId": 1,
  "slots": [
    { "startTime": "09:00", "endTime": "10:00", "available": true },
    { "startTime": "10:00", "endTime": "11:00", "available": true }
  ]
}
```

### 3.4 Alta de servicio con barberos asignados (administración)

```http
POST /servicios
Authorization: Bearer <token de administrador>
Content-Type: application/json
X-Negocio-Slug: kyrios-studio

{
  "nombre": "Barba perfilada",
  "precio": 18000,
  "duracionMinutos": 30,
  "barberoIds": [7, 9]
}
```

`barberoIds` contiene **`Barbero.id`**. Un id que no sea un barbero activo de la
barbería produce `400` ("Uno o más barberos seleccionados no existen o no se
encuentran en estado ACTIVO"): no se puede asignar un barbero de otra barbería.

## 4. CORS

Cabeceras admitidas en las peticiones del navegador:

```
Content-Type
Authorization
X-Negocio-Slug
X-Reservation-Management-Token
```

- `X-Reservation-Management-Token` es el **único** canal autorizado para la
  credencial de gestión de la reserva de invitado: no se admite por query string
  ni por un campo del cuerpo.
- Los orígenes permitidos son una **lista explícita** (`FRONTEND_URL` +
  los orígenes de despliegue conocidos). No hay comodín `*` porque la API sirve
  con credenciales.
- El preflight (`OPTIONS`) está admitido para todos los métodos del catálogo,
  autenticación, disponibilidad y reservas.

## 5. Documentación OpenAPI (Swagger)

- En desarrollo y en cualquier entorno distinto de `production`, la
  documentación se publica en `/api/docs`.
- En `production` **no** se publica por defecto. Para publicarla hay que
  declararlo explícitamente: `SWAGGER_HABILITADO=true`.
- `SWAGGER_HABILITADO=false` la desactiva en cualquier entorno.

## 6. WhatsApp y recordatorios por negocio (Fase 9)

Las plantillas, la dirección y la anticipación del recordatorio son **de cada
barbería**: el texto que un administrador personaliza para su negocio no altera
los mensajes de los demás.

### 6.1 Plantillas de mensajes

| Endpoint | Ámbito |
|---|---|
| `GET /whatsapp/plantillas` | devuelve la plantilla **efectiva** del negocio del contexto |
| `PUT /whatsapp/plantillas` | guarda la plantilla **de ese negocio** |
| `POST /whatsapp/plantillas/reset` | borra la plantilla **de ese negocio** (las globales de plataforma se conservan) |

La respuesta mantiene la forma actual:

```json
{
  "confirmacion": "💈 *{negocio}*\n¡Hola {cliente}! ...",
  "recordatorio": "💈 *{negocio}*\nHola {cliente}, tu cita es el {fecha} a las {hora} ...",
  "minutosAnticipacion": 120
}
```

Resolución de cada campo:

1. la plantilla **del negocio** (si existe);
2. la plantilla **global de plataforma**;
3. el texto **por defecto** del backend.

Variables disponibles en los textos: `{negocio}`, `{cliente}`,
`{servicio}`, `{barbero}`, `{fecha}`, `{hora}`, `{precio}` y
`{ubicacion}` (la dirección del negocio; si no está configurada, la línea de
ubicación **no** se envía). `{negocio}` es el nombre comercial del negocio del
contexto: nunca el de otra barbería.

> Estos endpoints **siempre** operan sobre el negocio del contexto: el
> guard de autenticación del personal exige un contexto de negocio
> autorizado (sin él, la respuesta es `403`), así que una petición sin
> `X-Negocio-Slug` no llega al servicio. Las plantillas **GLOBALES** de
> plataforma no se editan por esta vía: son el valor por defecto que hereda
> el negocio que no tiene plantilla propia.

### 6.2 Dirección y anticipación del recordatorio

Dos claves de la configuración operativa del negocio
(`configuraciones_negocio`), sin cambio de esquema:

| Clave | Tipo | Efecto |
|---|---|---|
| `negocio_direccion` | TEXTO | dirección que aparece en `{ubicacion}` |
| `recordatorio_minutos_anticipacion` | NUMERO | ventana de aviso previo del recordatorio (defecto: 120 min) |

Se inicializan de forma idempotente al crear el negocio: si ya existen (valor
personalizado), **no se sobrescriben**.

### 6.3 Proceso de fondo

El recordatorio automático lo dispara un proceso programado (cada 10 minutos)
que **no pasa por el middleware**: fija él mismo el contexto de cada negocio
activo y envía los mensajes de uno en uno. Un fallo en una barbería no detiene
a las demás.

## 7. Roles y sesiones POR NEGOCIO (Fase 10)

En este SaaS **no existe un SUPERADMIN global de plataforma**. El rol
`SUPERADMIN` pertenece a UNA barbería concreta y su alcance es esa barbería.

### 7.1 De dónde salen los roles

| Rol | Origen | Alcance |
|---|---|---|
| `ADMINISTRADOR` | membresía `Administrador` (`negocioId`, `estado = ACTIVO`) | el negocio de la membresía |
| `SUPERADMIN` | membresía `Administrador` con `superadmin = true` | el negocio de la membresía |
| `BARBERO` | membresía `Barbero` (`negocioId`, `estado = ACTIVO`) | el negocio de la membresía |

El campo `usuario.rol` (valores heredados `SUPERADMIN` | `PERSONAL`) **no
concede ningún privilegio**: es informativo. El frontend **debe** decidir con
`usuario.roles` (los roles efectivos de la sesión) y **nunca** con
`usuario.rol`.

### 7.2 Sesiones

- Toda sesión de personal está **ligada a un negocio** (`negocio.negocioId`).
  **No existe sesión de plataforma**: un login sin contexto de barbería se
  rechaza con `403`.
- El claim `superadmin` del token se **deriva** de `roles`; no sustituye a
  la comprobación de roles.
- `POST /auth/tenant/:slug` exige una **membresía activa en el negocio de
  destino**, también para el `SUPERADMIN` de otra barbería (`403` si no la
  tiene). El cambio queda registrado en la auditoría.

### 7.3 Endpoint retirado

| Endpoint | Motivo | Alternativa |
|---|---|---|
| `POST /usuarios/sincronizar-superadmin` | Solo tenía sentido con un superadmin de plataforma; su respuesta era un mensaje estático y **no tenía consumidores** (frontend ni otros clientes) | La pertenencia a una barbería se configura con el comando explícito `npm run multitenant:fundadores` |

### 7.4 Dependencia del frontend (breaking)

El frontend debe dejar de leer `usuario.rol` para decidir permisos:

- `AuthContext.tsx`: no añadir `SUPERADMIN` a los roles a partir de
  `usuarioDb.rol`; usar solo `usuario.roles`.
- `MiPerfilPage.tsx` y `EditarUsuarioPage.tsx`: el indicador de "superadmin"
  debe salir de `usuario.roles`, no del `rol` global.

Mientras el frontend use `usuario.rol`, una persona con el valor heredado
`SUPERADMIN` en la base (sin membresía superadmin) **parecería** tener
poderes que el backend no le concede.

## 8. Perfil de marca y ubicación POR NEGOCIO (Fase 14)

La identidad visual y la ubicación de cada barbería viven en la base de
datos, para que la personalización se pueda cambiar **sin tocar código ni volver
a desplegar la aplicación**. Hasta ahora esos datos vivían hardcodeados en
el frontend (`brand.ts`).

### 8.1 Modelo de datos

Tabla `perfiles_negocio`, en relación **1:1** con `negocios`
(`negocioId` único: como máximo un perfil por barbería).

| Campo | Tipo | Nulo | Notas |
|---|---|---|---|
| `negocioId` | `INT` | no | Único. No se duplica el nombre ni el slug del negocio: se leen de `negocios`. |
| `frasePrincipal` | `VARCHAR(200)` | sí | Lema o descriptor corto de la marca. |
| `faviconUrl` | `VARCHAR(500)` | sí | **Referencia** a archivo (ruta o URL). |
| `bannerUrl` | `VARCHAR(500)` | sí | **Referencia** a archivo. |
| `logoBlancoUrl` | `VARCHAR(500)` | sí | **Referencia** a archivo (logo para fondos oscuros). |
| `logoNegroUrl` | `VARCHAR(500)` | sí | **Referencia** a archivo (logo para fondos claros). |
| `direccion` | `VARCHAR(200)` | sí | |
| `ciudad` | `VARCHAR(120)` | sí | |
| `departamento` | `VARCHAR(120)` | sí | |
| `referencia` | `VARCHAR(200)` | sí | Referencia opcional para orientarse. |
| `latitud` | `DECIMAL(10,7)` | sí | Grados decimales. Precisión ~1 cm. |
| `longitud` | `DECIMAL(10,7)` | sí | Grados decimales. |
| `createdAt` | `DATETIME(3)` | no | Auditoría. |
| `updatedAt` | `DATETIME(3)` | no | Auditoría. |

Decisiones:

- **Es un modelo propio, no `ConfiguracionNegocio`.** `ConfiguracionNegocio`
  es un almacén clave/valor de políticas **operativas** (antelación, `NO_SHOW`)
  con un valor textual y un discriminador de tipo. La marca y la ubicación son
  contenido público **estructurado**, con tipado, longitudes y coordenadas
  propias.
- **Todos los campos son nulos**: una barbería puede existir sin perfil
  completo. La tabla solo nace cuando alguien configura algo.
- **Las imágenes son REFERENCIAS, no archivos**: en la base de datos no se
  almacenan bytes, base64 ni archivos completos. La **carga física de
  imágenes es una fase posterior**.
- **La URL del mapa NO se guarda**: se deriva de `latitud`/`longitud`, que son
  la única fuente de verdad, para que no pueda desincronizarse.

### 8.2 Rutas

| Método | Ruta | Acceso | Descripción |
|---|---|---|---|
| `GET` | `/perfil-negocio` | **Público** | Marca y ubicación del negocio del contexto. |
| `GET` | `/perfil-negocio/gestion` | `SUPERADMIN`, `ADMINISTRADOR` | Vista de gestión: bloques + auditoría. |
| `PUT` | `/perfil-negocio` | `SUPERADMIN`, `ADMINISTRADOR` | Reemplaza frase principal y ubicación. |
| `PUT` | `/perfil-negocio/referencias` | `SUPERADMIN`, `ADMINISTRADOR` | Reemplaza las referencias de archivo. |

### 8.3 Resolución del negocio

- Las cuatro rutas obtienen el negocio del **contexto de la petición**
  (subdominio o `X-Negocio-Slug`), igual que el resto de rutas de negocio
  (§1). **Ninguna acepta un `negocioId`**: mandarlo en el cuerpo se rechaza
  con `400` (`forbidNonWhitelisted`).
- Una petición **sin contexto** de negocio se rechaza con `403`: sin saber a
  qué barbería pertenece el perfil, devolver el de otra sería una fuga.
- El `SUPERADMIN` de A **no** puede ver ni cambiar el perfil de B: su sesión
  está ligada a A y el guard rechaza la operación si el contexto es otra
  barbería (`403`).
- `BARBERO` y los clientes **no** pueden modificar el perfil (`403`): solo
  `SUPERADMIN` y `ADMINISTRADOR` del negocio.

### 8.4 Validaciones de ubicación

| Campo | Regla |
|---|---|
| `latitud` | Número en `[-90, 90]`. |
| `longitud` | Número en `[-180, 180]`. |
| `latitud` y `longitud` | **Siempre juntas**: una sin la otra se rechaza (`400`). |
| `direccion` | Texto, hasta 200 caracteres. |
| `ciudad` | Texto, hasta 120 caracteres. |
| `departamento` | Texto, hasta 120 caracteres. |
| `referencia` | Opcional, hasta 200 caracteres. |
| Referencias de archivo | Ruta relativa (`/...`) o URL `http`/`https`. Se rechazan los esquemas ejecutables (`javascript:`, `data:`). |

La URL del mapa **no se recibe del cliente**: se calcula en el servidor a
partir de las coordenadas.

```
GET /perfil-negocio   ->   "mapsUrl": "https://www.google.com/maps/search/?api=1&query=2.4839891,-76.5807622"
```

Es un enlace de búsqueda **sin API key** y sin facturación. Si el frontend
usa Leaflet con OpenStreetMap, basta con consumir `latitud` y `longitud` (y
construir el tile URL a partir de ellas); **no** es obligatorio usar la Google
Maps Embed API. Si algún día se quisiera incrustar un iframe de Google Maps,
haría falta configurar una API key de la Embed API (con su coste y sus
límites): en esta fase **no** se inventa ninguna clave ni se implementa esa
integración.

### 8.5 Respuestas

**Perfil no configurado** (la barbería todavía no ha configurado nada):
`200` con los campos a `null` y `configurado: false`. **No** es un `404`: la
ausencia de perfil es un estado legítimo de una barbería recién dada de alta.

```json
{
  "negocio": { "nombre": "KYRIOS STUDIO", "slug": "kyrios-studio" },
  "configurado": false,
  "frasePrincipal": null,
  "faviconUrl": null, "bannerUrl": null,
  "logoBlancoUrl": null, "logoNegroUrl": null,
  "direccion": null, "ciudad": null,
  "departamento": null, "referencia": null,
  "latitud": null, "longitud": null,
  "mapsUrl": null
}
```

**Vista pública** (`GET /perfil-negocio`): campos planos, sin datos de gestión
ni de auditoría.

**Vista de gestión** (`GET /perfil-negocio/gestion`): agrupa el contenido por
los bloques que gestiona la API e incluye la auditoría.

```json
{
  "negocio": { "nombre": "KYRIOS STUDIO", "slug": "kyrios-studio" },
  "configurado": true,
  "contenido": { "frasePrincipal": "Barbería de alto estándar" },
  "ubicacion": {
    "direccion": "Vía al Bosque, Tv 9A Norte",
    "ciudad": "Popayán", "departamento": "Cauca",
    "referencia": null,
    "latitud": 2.4839891, "longitud": -76.5807622,
    "mapsUrl": "https://www.google.com/maps/search/?api=1&query=2.4839891,-76.5807622"
  },
  "referenciasArchivo": {
    "faviconUrl": "/uploads/negocios/kyrios-studio/favicon.png",
    "bannerUrl": null, "logoBlancoUrl": null, "logoNegroUrl": null
  },
  "creadoEn": "2026-10-24T12:00:00.000Z",
  "actualizadoEn": "2026-10-24T12:00:00.000Z"
}
```

### 8.6 Semántica de `PUT`

Los dos `PUT` **reemplazan** el bloque que gobiernan: un campo omitido se
guarda como `null` (se limpia). Es deliberado: el comportamiento no depende de
un estado previo y no hay sorpresas al actualizar solo la frase principal.

### 8.7 Almacenamiento de los recursos de marca (Fase 15)

Los cuatro recursos de marca (`favicon`, `banner`, `logoBlancoUrl`,
`logoNegroUrl`) se gestionan como **archivos** en el espacio de cada negocio.

| Recurso | Ruta de carga | Formato | Tamaño máximo | Campo del perfil |
|---|---|---|---|---|
| Favicon | `POST /perfil-negocio/favicon` | SVG | 256 KB | `faviconUrl` |
| Banner | `POST /perfil-negocio/banner` | PNG | 2 MB | `bannerUrl` |
| Logo para fondos oscuros | `POST /perfil-negocio/logo-blanco` | SVG | 256 KB | `logoBlancoUrl` |
| Logo para fondos claros | `POST /perfil-negocio/logo-negro` | SVG | 256 KB | `logoNegroUrl` |

Y para retirarlos:

```
DELETE /perfil-negocio/favicon
DELETE /perfil-negocio/banner
DELETE /perfil-negocio/logo-blanco
DELETE /perfil-negocio/logo-negro
```

Todos exigen `SUPERADMIN` o `ADMINISTRADOR` **del negocio del contexto**, con
`Authorization` y `X-Negocio-Slug` (o subdominio). `BARBERO` y los clientes
reciben `403`.

Contrato de la carga:

- `multipart/form-data` con el campo **`archivo`**.
- El tipo se deduce del **CONTENIDO REAL** del archivo (firma binaria), no
  del nombre ni del `Content-Type` declarado por el cliente. Un PNG en el
  favicon o un SVG en el banner se rechazan con `400`.
- Un SVG con `script`, manejadores de evento (`on*`), marcos
  (`foreignObject`, `iframe`, `object`), `javascript:` o `DOCTYPE`/`ENTITY`
  se **RECHAZA** con `400`: no se almacena "limpiado" en silencio.
- El **nombre del archivo lo genera el servidor**
  (`<recurso>-<marca>-<aleatorio>.<ext>`) en
  `<UPLOADS_DIR>/negocios/{negocioId}/perfil/`. El cliente no elige ni la
  ruta ni el nombre.
- El `negocioId` sale del **contexto autorizado**; nunca de una ruta
  arbitraria.
- Lo que se guarda en la base de datos es una ruta **pública** relativa
  (`/uploads/negocios/{id}/perfil/...`). Nunca se publica una ruta absoluta
  del sistema de ficheros.
- **Orden de las operaciones**: se valida, se guarda el archivo nuevo, se
  actualiza el perfil y **después** se borra el anterior. Si la actualización
  del perfil falla, el archivo nuevo se retira y la referencia anterior sigue
  siendo válida: nunca queda una referencia rota.

`PUT /perfil-negocio/referencias` **sigue disponible** (compatibilidad) pero
su alcance se ha acotado: admite URLs externas `http`/`https` y rutas
propias del negocio (`/uploads/negocios/{miNegocioId}/perfil/...`). Cualquier
otra ruta interna se rechaza con `400`: el cliente no puede apropiarse de un
recurso de otra barbería.

### 8.8 Configuración del almacenamiento

| Variable | Por defecto | Descripción |
|---|---|---|
| `UPLOADS_DIR` | `<cwd>/uploads` | Directorio raíz de los archivos subidos. |

Los archivos se sirven en `/uploads` con el tipo MIME de su extensión
(`image/svg+xml`, `image/png`) y con cabeceras de seguridad:
`X-Content-Type-Options: nosniff` y
`Content-Security-Policy: default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox`.

**PERSISTENCIA EN DOCKER (local)**

El directorio cuelga de un volumen: el sistema de ficheros del contenedor es
efímero y los recursos se perderían en cada reinicio.

```yaml
# docker-compose.multitenant-dev.yml
services:
  backend:
    environment:
      UPLOADS_DIR: /app/uploads
    volumes:
      - barberia_multitenant_dev_uploads:/app/uploads
volumes:
  barberia_multitenant_dev_uploads:
    name: barberia_multitenant_dev_uploads
```

**REQUISITOS DE DESPLIEGUE EN RAILWAY**

> **No verificado en Railway.** Lo siguiente es el requisito de configuración,
> no una validación hecha en ese entorno.

- El sistema de ficheros del contenedor de Railway es **efímero**: lo que se
  escriba dentro se pierde en cada redeploy.
- Hay que montar un **volumen persistente** en `UPLOADS_DIR` (Railway ofrece
  volúmenes en los servicios con plan de pago) o migrar a un **adaptador de
  almacenamiento de objetos** (S3, R2, etc.). Con la implementación actual,
  que escribe en el sistema de ficheros, la opción de Railway es el volumen.
- `UPLOADS_DIR` debe apuntar a ese volumen (por ejemplo `/data/uploads`).
- Si se usara un volumen, `UPLOADS_DIR` debe ser el MISMO punto de montaje en
  todas las réplicas: los recursos de un negocio tienen que ser visibles
  desde cualquiera de ellas.

**LIMITACIONES CON VARIAS RÉPLICAS**

- Un volumen de Railway está **ligado a un servicio**: con varias réplicas
  habría que compartir el almacenamiento (un volumen de red o un bucket de
  objetos). Dos réplicas con volúmenes distintos NO comparten los recursos:
  una barbería vería su logo en una réplica y no en la otra.
- La base de datos es lo único compartido de forma fiable. Si el volumen no
  es compartible, la alternativa es un **adaptador de almacenamiento de
  objetos** (el modelo de `PerfilNegocio` guarda solo la ruta, de modo que
  cambiar el almacenamiento no obliga a cambiar los datos).
- Los recursos son INMUTABLES en la base de datos: al reemplazar un logo se
  genera un archivo nuevo y se actualiza la referencia, de modo que un
  despliegue gradual no deja referencias rotas.

**PROCEDIMIENTO DE RESPALDO DE LOS RECURSOS DE MARCA**

Los archivos **no** están en la base de datos: solo están sus rutas. Por eso
el respaldo tiene dos partes y deben conservarse juntas:

1. **Base de datos**: `perfiles_negocio` (referencias) y `negocios`.
2. **Volumen de archivos**: `<UPLOADS_DIR>/negocios/`.

Procedimiento:

```bash
# 1. Volumen de archivos (contenedor auxiliar): copia del árbol completo
docker run --rm -v <volumen-uploads>:/datos -v $PWD:/respaldo alpine \
  tar czf /respaldo/uploads-$(date +%F).tar.gz -C /datos .

# 2. Base de datos: volcado con la herramienta de respaldo de MySQL
mysqldump -h <host> -u <usuario> -p <base> \
  | gzip > respaldos/db-$(date +%F).sql.gz
```

Al restaurar, el volumen y el volcado deben volver a la MISMA fecha: si el
volumen es más antiguo que la base, las referencias apuntarán a archivos que
todavía no existen.

### 8.9 Nombre y dirección comercial en los mensajes de WhatsApp

| Dato | Fuente canónica | Compatibilidad |
|---|---|---|
| Nombre comercial | `Negocio.nombre` del negocio del contexto | — |
| Dirección comercial | `PerfilNegocio.direccion` del negocio del contexto | Mientras existan valores históricos en la clave `negocio_direccion`, se usan como RESPALDO (solo si el perfil no tiene dirección), con aviso en el log. |

- **No existe un nombre comercial por defecto**: sin contexto de negocio, el
  nombre queda vacío. No se inventa la identidad de una barbería.
- Si el negocio no tiene dirección en ninguna de las dos fuentes, la
  dirección queda **vacía** y el mensaje sale sin la línea de ubicación: no
  se recurre a los datos de otra barbería.
- El respaldo se lee **exclusivamente del ámbito del negocio del contexto**
  (`obtenerTextoDelNegocio`): nunca consulta el ámbito global de plataforma.

**PROCEDIMIENTO PARA RETIRAR EL RESPALDO**

1. Trasladar los valores heredados al perfil, sin sobrescribir nada:

   ```bash
   # Solo informa (no escribe): muestra qué negocios dependen del respaldo
   VERIFICAR_DIRECCION=1 DIRECCION_MIGRACION_AUTORIZADA=1 \
     npm run multitenant:migrar-direccion

   # Traslada el valor heredado al perfil (idempotente, no borra el original)
   DIRECCION_MIGRACION_AUTORIZADA=1 npm run multitenant:migrar-direccion
   ```

   El comando **no** sobrescribe un perfil que ya tenga dirección, **no**
   inventa direcciones y **no** borra el valor heredado.

2. Repetir la comprobación en TODOS los entornos (base de desarrollo y base
   legada). Solo si la lista de negocios dependientes queda VACÍA se puede
   retirar la clave.

3. Retirar la clave de forma MANUAL y con la aplicación parada:

   - borrar las filas `negocio_direccion` de `configuraciones_negocio`;
   - eliminar `CLAVES_CONFIGURACION.NEGOCIO_DIRECCION` de
     `CLAVES_CONFIGURACION_OPERATIVA`;
   - eliminar el respaldo del servicio de WhatsApp.

   Mientras no se complete el paso 3, la clave se conserva a propósito.

## 9. Consistencia del flujo de reservas (Fase 16)

### 9.1 Qué se revalida y cuándo

La disponibilidad se consulta ANTES de la transacción para responder rápido.
Entre esa consulta y la confirmación el estado puede cambiar, así que la
creación vuelve a comprobarlo TODO DENTRO de la transacción de creación, con
los mismos datos que usará la inserción:

1. El barbero existe, es `ACTIVO` y es de este negocio.
2. El servicio existe, es `ACTIVO` y es de este negocio.
3. El barbero **sigue** prestando el servicio.
4. El barbero tiene una franja semanal que **cubre** la hora y la duración.
5. No hay un bloqueo activo que solape la franja.
6. No hay un cierre general que cubra la franja.
7. La franja no está ocupada por otra reserva que ocupa agenda.

Los predicados son los MISMOS que usa la fachada de disponibilidad
(`reglas-disponibilidad-puras`): no hay dos criterios de disponibilidad.

La transacción es **corta**: bloqueo de fila → revalidación → inserción. No
incluye el envío de WhatsApp (se dispara después, desacoplado).

### 9.2 Cómo se protege la franja concurrente

- **Bloqueo pesimista**: `SELECT id FROM Barbero WHERE id = ? AND negocioId = ? FOR UPDATE`
  serializa las reservas del mismo barbero (y solo del negocio del contexto).
- **Restricción UNIQUE en la base**: `(barberoId, date, startTime, slotActivo)`.
  Es la última línea de defensa y la que resuelve la carrera. `barberoId` es
  la clave primaria de `Barbero`, por lo que es globalmente único: el índice
  ya impide que dos negocios distintos entren en conflicto, y **no** necesita
  `negocioId` (añadirlo no aportaría nada y rompería la re-reserva).
- `slotActivo` es una columna GENERATED: `CANCELLED` la pone a `NULL` (libera la
  franja) y `NO_SHOW` la mantiene en `1` (la sigue ocupando).

### 9.3 Idempotencia del POST de reservas

`POST /reservas` admite la cabecera opcional **`Idempotency-Key`** (UUID v4).

| Situación | Resultado |
|---|---|
| Primera petición con la clave | `201` con la reserva creada |
| Reintento con la misma clave y el mismo intento | `201` con la **misma** reserva (no se crea otra) |
| Reintento con la misma clave y un intento DISTINTO | `409` `IDEMPOTENCY_KEY_CONFLICT` |
| Dos peticiones simultáneas con la misma clave | Una reserva; la otra recibe la misma (o `409` si el intento difiere) |
| Clave con formato que no es UUID v4 | `400` |

- La clave se guarda en `reservations.idempotencyKey` y la restricción es
  **compuesta por negocio** (`(negocioId, idempotencyKey)`): la misma clave en
  dos barberías son dos intentos distintos, y una clave **nunca** permite
  leer ni escribir la reserva de otra barbería.
- La protección REAL frente a dos peticiones concurrentes es el índice único,
  no una comprobación previa en la aplicación.
- El replay **no crea otra reserva** ni otro cliente, y **no cambia el estado**
  de la reserva existente (ni su franja, ni su precio, ni su estado).

### 9.3.1 Token de gestión de un invitado en el reintento

Una reserva de **invitado** se gestiona con un token opaco que viaja en la
cabecera `X-Reservation-Management-Token`. En la base de datos **no se guarda
el token en texto claro**: se guardan

- `gestionTokenHash`: su hash SHA-256, que es la vía de **validación**
  (comparación en tiempo constante, sin descifrar nada), y
- `gestionTokenCifrado`: una copia cifrada (AES-256-GCM, clave derivada con
  HKDF de `JWT_SECRET`) que permite **reproducir la respuesta original**.

Al repetir el mismo intento con la misma `Idempotency-Key`, el servidor
devuelve **exactamente la misma respuesta** que la original: la misma
reserva y **el mismo token**. No se rota nada.

| Token | Estado tras el reintento |
|---|---|
| El de la primera respuesta | **VÁLIDO** (es el mismo token) |
| El emitido en el reintento | **VÁLIDO** (es el mismo token) |
| El de otra reserva | Inválido (404 `MENSAJE_RESERVA_NO_DISPONIBLE`) |

Motivo: invalidar en silencio una credencial que el cliente ya tiene —por
ejemplo, tras un doble clic o un reintento cuya primera respuesta sí
llegó— rompería la gestión de la reserva sin que el cliente pudiera
distinguir "token caducado" de "la reserva no existe" (ambos responden 404).

El reintento **no escribe nada**: solo lee. Por eso no hay carreras entre
reintentos simultáneos y ningún token emitido puede quedar invalidado.

Decisión de diseño (alternativas evaluadas):

- **Rotar el token en cada reintento** (descartada): el token anterior
  quedaba invalidado en silencio y, con dos reintentos SIMULTÁNEOS, ambos
  escribían el mismo hueco del hash anterior, de modo que el token del
  primero invalidaba al del segundo. Además, el cliente podía recibir un
  token que nunca se había almacenado.
- **No rotar el token** (descartada): el reintento devolvería la reserva
  sin token. El cliente que perdió la respuesta se quedaría sin poder
  gestionar su reserva y una respuesta sin token podría sobrescribir el
  token guardado por el cliente.
- **Guardar el token en claro** (descartada): resolvería los casos, pero es
  una regresión de seguridad: un volcado de la base entregaría
  credenciales usables.
- **Conservar los hashes de los dos últimos tokens** (descartada): no
  invalida en serie, pero con reintentos simultáneos el hueco es único y
  uno de los tokens emitidos queda invalidado igualmente.
- **Guardar el hash y una copia cifrada para reproducir la respuesta**
  (elegida): el reintento devuelve la MISMA respuesta, no invalida nada y
  no escribe (sin carreras). El token nunca está en texto claro: un
  volcado de la base sin la clave del entorno no entrega credenciales
  usables. La clave de cifrado se deriva con HKDF de `JWT_SECRET`, que ya
  es un secreto del despliegue: quien lo tiene ya puede falsificar
  sesiones de personal, de modo que no se abre una clase de exposición
  nueva.

Consecuencias asumidas y documentadas:

- Rotar `JWT_SECRET` deja descifrables los tokens antiguos: el reintento
  devuelve la reserva **sin token** (el token original sigue siendo válido
  para gestionarla) y las credenciales de invitado ya emitidas deben
  reemitirse. Es el mismo efecto que tiene sobre las sesiones.
- Las reservas creadas **antes** de esta columna no tienen copia cifrada: su
  reintento devuelve la reserva sin token y su token original sigue siendo
  válido. Es una degradación segura, no una pérdida de acceso.

### 9.4 Códigos de dominio (HTTP 409)

Los conflictos de negocio responden **409** con un `code` estable (no 500):

| `code` | Significado |
|---|---|
| `SERVICE_INACTIVE` | El servicio existe pero está inactivo. |
| `BARBER_INACTIVE` | El perfil de barbero está inactivo. |
| `BARBER_NO_SCHEDULE` | El barbero no tiene franja semanal para esa hora. |
| `NO_BARBER_FOR_SERVICE` | El barbero no presta el servicio. |
| `SLOT_TAKEN` | La franja está ocupada (reserva, bloqueo o cierre). |
| `DUPLICATE_OWN_RESERVATION` | El mismo cliente ya tiene una reserva activa en esa franja. |
| `IDEMPOTENCY_KEY_CONFLICT` | La clave de idempotencia se reutilizó con otra petición. |

`SLOT_TAKEN` incluye, cuando se puede calcular, hasta **tres horarios
alternativos libres** del mismo barbero y la misma fecha en
`details.horariosAlternativos`. No se inventan horarios: si la disponibilidad
no se puede calcular, la lista va vacía.

El conflicto de franja **nunca** revela datos del cliente que consiguió la
reserva.

### 9.5 Reintentos ante deadlock

Los errores transitorios de concurrencia (`P2034` de Prisma, `1213` deadlock y
`1205` lock wait timeout del motor) se reintentan **fuera** de la
transacción, con backoff de 50 ms, 100 ms y 200 ms (tres reintentos como
máximo). Cada reintento ejecuta la transacción COMPLETA.

No se reintentan los `404`, los `409` ni los fallos de validación: una
violación de unicidad es una carrera perdida, no un fallo transitorio.

### 9.6 La disponibilidad es informativa

`GET /usuarios/barberos/:barberoId/disponibilidad` (público) y
`GET /usuarios/me/barbero/disponibilidad` devuelven las franjas del negocio
del contexto. **No crean ni mantienen reservas**: no hay holds ni reservas
temporales mientras el usuario elige servicio, barbero y hora. La creación
definitiva revalida todo con independencia de esa consulta.

## 10. Lo que NO cambió

- Las reglas de reservas (antelación de cancelación, tolerancia de `NO_SHOW`,
  estados, concurrencia y ocupación de franjas) siguen siendo las de la Fase 4
  y la Fase 5, y se configuran **por negocio**.
- La autenticación de personal (token con `negocioId` y roles efectivos) y la
  de clientes (token con `negocioId` y secreto propio) no cambian.
- Las rutas de horario semanal y bloqueos siguen operan sobre el barbero
  **autenticado** (`/usuarios/me/barbero/...`): no aceptan un `barberoId`.
- Los identificadores de negocio (`negocioId`, `Barbero.id`, `Usuario.id`,
  `Servicio.id`, `Cliente.id`) no cambian de valor: lo que cambia es qué
  identificador ACEPTA cada ruta (fila 0 y filas 1-6 de la tabla).
- La autenticación de personal (token con `negocioId` y roles efectivos) y la
  de clientes (token con `negocioId` y secreto propio) no cambian.
- `POST /usuarios/sincronizar-superadmin` se retira (ver §7.3).
- La marca y la ubicación **sí** cambian: pasan de estar hardcodeadas en el
  frontend a la base de datos, por negocio (ver §8). El frontend puede seguir
  usando sus valores por defecto hasta que adopte los nuevos endpoints.
