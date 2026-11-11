# 08. Conceptos Transversales (Arc42 §8)

Los conceptos transversales representan decisiones técnicas y patrones de diseño aplicados uniformemente en todo el sistema.

---

## 8.1 Seguridad y Aislamiento Multitenant

* **Resolución de Contexto Obligatoria:** El interceptor `NegocioContextInterceptor` evalúa cada petición HTTP. Si una ruta pertenece a la operativa de una barbería y no se provee el encabezado `X-Negocio-Slug` (o el subdominio correspondiente), la petición se rechaza con `403 Forbidden`.
* **Prohibición de Inyección de Tenant:** Ningún endpoint confía en parámetros de body o query como `negocioId` para identificar la sede. El identificador siempre proviene del contexto validado en el interceptor.
* **Indexación Compuesta de Base de Datos:** Toda tabla perteneciente a un negocio cuenta con índices que inician por `negocioId` (`@@index([negocioId, ...])`), optimizando las búsquedas y garantizando que el plan de ejecución de MySQL no realice escaneos cruzados entre sedes.

---

## 8.2 Autenticación, Autorización y Modelo RBAC

* **Jerarquía de Roles:**
  1. `SUPERADMIN`: Control global de plataforma y auditoría de todas las sedes.
  2. `ADMINISTRADOR`: Gestión operativa, financiera y de personal dentro de su barbería.
  3. `BARBERO`: Acceso restringido a su agenda personal y cambio de estados de sus turnos.
  4. `CLIENTE`: Acceso a su portal de citas personalizadas e historial.
* **Desacoplamiento Contractual:** Un usuario puede ser desactivado como barbero en una sede específica sin que su cuenta global ni sus membresías en otros negocios se vean afectadas (`PATCH /usuarios/:id/estado?tipo=...`).
* **Protección Anti-Account Takeover:** Verificación estricta de la firma y el `sub` de Google OAuth. No se permite asociar una cuenta de Google con un `googleId` distinto al original para un mismo correo electrónico.

---

## 8.3 Seguridad Defensiva y Protección Perimetral

* **Cabeceras HTTP con Helmet:** Configuración de cabeceras de seguridad para mitigar ataques comunes:
  * `Content-Security-Policy` (CSP).
  * `Strict-Transport-Security` (HSTS).
  * `X-Content-Type-Options: nosniff`.
  * `X-Frame-Options: SAMEORIGIN` (prevención de Clickjacking).
* **CORS Dinámico Restrictivo:** Solo se permiten peticiones originadas desde los dominios del frontend oficial y localhost en desarrollo (`src/common/config/cors.config.ts`).
* **Validación Binaria y Sanitización de Archivos:**
  * Inspección de *Magic Bytes* (primeros 4-8 bytes del archivo) para asegurar que un archivo `.png` o `.jpg` sea genuinamente una imagen y no un ejecutable renombrado.
  * Sanitización estricta de archivos `.svg` mediante `sanitize-html`, eliminando cualquier etiqueta `<script>`, atributos `onload`, `onerror` o código JavaScript embebido antes de almacenar en disco.
* **Validación de Payloads:** `ValidationPipe` global con `whitelist: true` y `forbidNonWhitelisted: true`, arrojando `400 Bad Request` si la solicitud incluye atributos no definidos en el DTO.

---

## 8.4 Gestión de Concurrencia y Transacciones Atómicas

* Las reservas de citas se procesan mediante `Prisma.$transaction` con comprobación de solapamiento de horarios.
* Se garantiza que la confirmación de disponibilidad y la reserva se ejecuten como una única unidad atómica. Si dos clientes intentan reservar la misma franja de 60 minutos con el mismo barbero en simultáneo, el motor de base de datos asegura que solo una prospere, rechazando la colisión.

---

## 8.5 Resiliencia y Desacoplamiento en Mensajería (WhatsApp)

* **Ejecución Asíncrona:** La notificación por WhatsApp nunca bloquea la respuesta HTTP al cliente. La cita se confirma de inmediato en el navegador del usuario y el mensaje se despacha en segundo plano.
* **Estrategia de Reintentos:** Se aplican reintentos con pausas escalonadas (0 ms, 4 000 ms y 10 000 ms) en caso de congestión de red.
* **Colas por Sede:** Si el socket de una barbería se encuentra desconectado, los mensajes se retienen en una cola en memoria exclusiva para esa sede (`colasPendientes.get(negocioId)`), sin degradar el rendimiento de los demás negocios.

---

## 8.6 Normalización y Manejo Global de Errores

* **Backend (`HttpExceptionFilter`):** Normaliza las respuestas de error capturando excepciones de validación de NestJS (arrays de mensajes) y errores de base de datos, estructurando siempre un JSON estándar con código de estado, marca temporal y mensaje comprensible.
* **Frontend (Interceptor Axios):** Intercepta respuestas de error 4xx/5xx y extrae automáticamente un `userMessage` amigable para el usuario final, limpiando sesiones expiradas en caso de error 401.

---

## 8.7 Theming Dinámico y Accesibilidad (WCAG AA Dual)

* El frontend inyecta atributos en el elemento raíz del DOM:
  ```html
  <html data-tenant-theme="cyber-lime" data-theme="dark">
  ```
* Se definen 6 personalidades de marca con paletas de color y tipografías específicas (`clasico-azul`, `cyber-lime`, `sunset-amber`, `midnight-cyan`, `crimson-velvet`, `monochrome-noir`).
* Se garantiza una relación de contraste superior a 4.5:1 en todos los botones, badges, modales y tablas, tanto en modo oscuro como en modo claro sobre fondos claros.
