# 09. Decisiones Arquitectónicas Registradas - ADRs (Arc42 §9)

Los Registros de Decisiones de Arquitectura (ADRs) documentan las elecciones clave de diseño, su contexto y las consecuencias asumidas.

---

## ADR-001 · Multitenancy con Esquema Compartido y Discriminador Lógico

* **Estado:** Aceptado.
* **Contexto:** Se requería soportar cientos de barberías con bajo costo operacional y despliegue ágil. Crear una base de datos física por cada sede complicaba las migraciones de esquema y elevaba los costos de infraestructura.
* **Decisión:** Adoptar una base de datos MySQL compartida donde cada entidad lleve un campo indexado `negocioId`. El contexto se deduce a nivel de middleware/interceptor mediante el slug de la URL o el encabezado HTTP `X-Negocio-Slug`.
* **Consecuencias:**
  * *Positivas:* Menor costo de infraestructura, migraciones de base de datos inmediatas para todas las sedes con un solo comando `prisma migrate deploy`, y arranque instantáneo de nuevas sedes.
  * *Mitigación:* Se implementó `NegocioContextInterceptor` que valida rigurosamente el tenant en cada solicitud para impedir acceso cruzado entre sedes.

---

## ADR-002 · Mitigación Anti-Account Takeover en Google OAuth2

* **Estado:** Aceptado.
* **Contexto:** Un atacante podría registrar una cuenta local con el correo de una víctima y luego intentar vincular una cuenta de Google maliciosa para secuestrar el acceso.
* **Decisión:** Validar criptográficamente el identificador federado `sub` de Google. Si un usuario ya tiene asociado un `googleId` y se intenta autenticar con otro `googleId` para el mismo correo, el sistema arroja `401 Unauthorized` bloqueando el inicio de sesión.
* **Consecuencias:**
  * *Positivas:* Protección total contra secuestro de cuentas en flujos federados.

---

## ADR-003 · Desacoplamiento de Identidad Global y Membresías por Sede

* **Estado:** Aceptado.
* **Contexto:** Un barbero o administrador puede trabajar en más de una barbería dentro de la misma plataforma.
* **Decisión:** Separar la tabla `Usuario` (credenciales globales) de las tablas de membresía `Administrador` y `Barbero` (vinculadas a `negocioId`).
* **Consecuencias:**
  * *Positivas:* Si el dueño de la Barbería A desactiva al barbero en su negocio, no altera su cuenta global ni sus turnos en la Barbería B.

---

## ADR-004 · Inmutabilidad del Correo Electrónico en Paneles de Sede

* **Estado:** Aceptado.
* **Contexto:** Si un administrador de sede pudiera cambiar el correo de un colaborador, podría modificarlo hacia un correo bajo su control y tomar control de su cuenta global.
* **Decisión:** El campo `email` es inmutable una vez creado y no puede ser editado desde ningún endpoint administrativo de sede.
* **Consecuencias:**
  * *Positivas:* Garantiza la separación de privilegios y previene escalamiento lateral.

---

## ADR-005 · Pool de Sesiones Independientes de WhatsApp con Baileys

* **Estado:** Aceptado.
* **Contexto:** La API Cloud oficial de WhatsApp cobra por conversación y requería que la plataforma centralizara el número de teléfono, lo que generaba desconfianza en los barberos que deseaban notificar desde su propia línea comercial.
* **Decisión:** Integrar `@whiskeysockets/baileys` gestionando un pool en memoria (`Map<number, SesionWhatsAppNegocio>`) donde cada sede conecta su propia línea mediante escaneo de código QR.
* **Consecuencias:**
  * *Positivas:* Cero costo por mensaje, personalización del remitente con el número oficial de la barbería y autonomía total para cada dueño de negocio.
  * *Mitigación:* Se crearon colas en memoria por sede para retener mensajes si la sesión se desconecta puntualmente, evitando fallos en cascada.

---

## ADR-006 · Aislamiento Físico y Sanitización de Archivos Multimedia

* **Estado:** Aceptado.
* **Contexto:** Los usuarios pueden subir logos, fotos de perfil de barberos y banners. Existía riesgo de sobreescritura accidental entre sedes y ataques mediante inyección de scripts en archivos SVG (Cross-Site Scripting).
* **Decisión:** Particionar el almacenamiento físico en `uploads/negocios/{negocioId}/{carpeta}/`. Validar la firma binaria de los archivos (*magic bytes*) y sanitizar los archivos SVG mediante `sanitize-html`.
* **Consecuencias:**
  * *Positivas:* Aislamiento físico garantizado y neutralización completa de vectores XSS embebidos en gráficos vectoriales.

---

## ADR-F01 · Inyección Automática de Contexto Multitenant en Frontend

* **Estado:** Aceptado.
* **Contexto:** Pasar manualmente el `slug` en los parámetros de cada componente frontend resultaba propenso a errores y aumentaba el acoplamiento.
* **Decisión:** Un interceptor de Axios extrae automáticamente el `slug` de la URL activa (`window.location.pathname`) o del almacenamiento local e inyecta el encabezado `X-Negocio-Slug` en todas las peticiones salientes.
* **Consecuencias:**
  * *Positivas:* Los componentes y hooks de React consumen los servicios sin preocuparse por la inyección manual de la sede.

---

## ADR-F02 · Gestión de Estado del Servidor con React Query

* **Estado:** Aceptado.
* **Contexto:** Múltiples componentes requerían datos compartidos (como el perfil de la sede o la lista de barberos), provocando peticiones duplicadas y estados desincronizados.
* **Decisión:** Utilizar TanStack Query 5 para centralizar el cacheo, revalidación y sincronización de eventos mediante `window.dispatchEvent`.
* **Consecuencias:**
  * *Positivas:* Reducción drástica del tráfico de red, actualización instantánea de la UI tras mutaciones y simplificación del código de componentes.

---

## ADR-F03 · Componentes de Interacción Puros y Eliminación de Confirmaciones Nativas

* **Estado:** Aceptado.
* **Contexto:** El uso de funciones bloqueantes del navegador (`window.confirm`, `window.alert`) degradaba la experiencia de usuario en dispositivos móviles y rompía la consistencia estética de los temas.
* **Decisión:** Crear componentes reactivos accesibles como `ConfirmDialog` para confirmaciones críticas y diseñar controles interactivos en CSS puro (`.redes-switch`) para eliminar dependencias externas frágiles.
* **Consecuencias:**
  * *Positivas:* Experiencia de usuario uniforme, fluida y totalmente responsiva.
