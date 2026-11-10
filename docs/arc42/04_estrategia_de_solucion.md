# 04. Estrategia de Solución (Arc42 §4)

La estrategia de solución sintetiza las decisiones arquitectónicas fundamentales que permiten cumplir con las metas de calidad y restricciones del sistema.

---

## 4.1 Estrategia de Multitenancy: Esquema Compartido con Discriminador Lógico

Se adoptó un modelo de **Base de Datos Compartida con Discriminador de Columna (`negocioId`)**:
* **Motivación:** Minimizar el consumo de recursos de infraestructura, facilitar el aprovisionamiento instantáneo de nuevas sedes y simplificar las migraciones de esquema mediante una única base de datos MySQL.
* **Mecanismo de Aislamiento:**
  1. Cada tabla perteneciente a un dominio de sede (`servicios`, `barberos`, `horarios`, `reservas`, `perfil_negocio`, `redes_sociales`) contiene una columna obligatoria `negocioId`.
  2. Todas las consultas llevan un índice compuesto que incluye `negocioId` como prefijo (por ejemplo `@@index([negocioId, estado])`).
  3. El interceptor `NegocioContextInterceptor` extrae el `slug` del encabezado `X-Negocio-Slug` o subdominio, consulta el `negocioId` correspondiente y lo inyecta en el objeto `request`.
  4. Ningún endpoint acepta que el cliente proporcione `negocioId` manualmente a través del cuerpo o query, previniendo inyecciones de tenant no autorizadas.

---

## 4.2 Desacoplamiento de Identidad y Membresías Locales

Para resolver la relación contractual entre personas y barberías:
* **Identidad Global (`Usuario`):** Representa a la persona física en la plataforma (`email`, `passwordHash`, `googleId`).
* **Membresías Locales (`Administrador`, `Barbero`):** Representan el rol laboral dentro de una sede específica (`negocioId`).
* **Beneficio:** Una misma persona puede laborar como barbero en la Sede A y tener perfil de administrador en la Sede B. Si la Sede A desactiva a su barbero, la cuenta global de la persona y su acceso a la Sede B permanecen intactos.

---

## 4.3 Control de Concurrencia y Transacciones Atómicas en Reservas

Para evitar el problema de doble reserva (*double-booking*):
* El método `crearConBloqueo` ejecuta una transacción en base de datos que:
  1. Verifica el horario laboral del barbero y los bloqueos activos para la fecha solicitada.
  2. Comprueba que no exista ninguna cita activa en esa misma hora y fecha con el mismo profesional.
  3. Inserta la reserva y retorna el comprobante garantizando consistencia ACID.
* La confirmación por WhatsApp se dispara en segundo plano de forma no bloqueante tras el commit exitoso de la transacción.

---

## 4.4 Pool de Sesiones Independientes de WhatsApp (Baileys)

En lugar de centralizar la mensajería en un único número de teléfono de la plataforma:
* Cada sede vincula su propio número de WhatsApp escaneando un código QR desde su panel administrativo.
* El backend gestiona un pool en memoria (`Map<number, SesionWhatsAppNegocio>`) donde cada instancia de socket es independiente.
* Si la sesión de una sede se desconecta o sufre un bloqueo temporal de red, no impacta el funcionamiento ni la cola de mensajes de las demás sedes.
* Cada sede cuenta con su propia cola de reintentos (`colasPendientes`).

---

## 4.5 Aislamiento de Almacenamiento Físico de Archivos

Para evitar que una barbería sobreescriba o visualice recursos de otra:
* Los archivos subidos se distribuyen físicamente en `<uploads>/negocios/{negocioId}/{carpeta}/`.
* La librería Multer resuelve dinámicamente la ruta en disco a partir del `negocioId` del contexto de la petición.
* Antes de persistir, se verifica el tipo de archivo real mediante inspección binaria de los primeros bytes (*magic bytes*) y se sanitizan los archivos SVG contra vectores XSS mediante `sanitize-html`.

---

## 4.6 Theming Dinámico y Aislamiento en el Frontend

* El frontend opera como una SPA única que adapta su apariencia inyectando atributos en el nodo raíz: `<html data-tenant-theme="..." data-theme="...">`.
* Soporta 6 personalidades de diseño predefinidas (`clasico-azul`, `cyber-lime`, `sunset-amber`, `midnight-cyan`, `crimson-velvet`, `monochrome-noir`) garantizando contraste WCAG AA dual.
* Las rutas de la plataforma SaaS (`/`, `/plataforma`, `/explorar`) limpian el estado de tenant para no mostrar residuos visuales de barberías visitadas con anterioridad.
