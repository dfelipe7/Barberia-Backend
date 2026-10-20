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

## 7. Lo que NO cambió

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
