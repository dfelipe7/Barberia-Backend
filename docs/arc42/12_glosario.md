# 12. Glosario de Términos (Arc42 §12)

Define los conceptos técnicos y de dominio utilizados a lo largo de la arquitectura del sistema.

---

| Término | Definición |
| :--- | :--- |
| **Tenant / Sede / Negocio** | Una barbería independiente registrada en la plataforma SaaS, identificada por un `negocioId` numérico y un `slug` único. |
| **Slug** | Cadena de texto alfanumérica y legible que identifica unívocamente a una barbería en la URL (`/:slug`) o en el encabezado `X-Negocio-Slug` (ejemplo: `kyrios-studio`, `barberia-elite`). |
| **Multitenancy Lógico** | Modelo de arquitectura de software donde múltiples clientes comparten la misma aplicación y base de datos física, pero sus datos se aíslan lógicamente mediante un discriminador (`negocioId`). |
| **Double-Booking** | Fallo de concurrencia donde dos clientes reservan simultáneamente el mismo barbero en la misma fecha y hora. El sistema lo previene con transacciones atómicas. |
| **Baileys** | Biblioteca TypeScript de código abierto (`@whiskeysockets/baileys`) que implementa el protocolo WebSocket de WhatsApp Web sin depender de navegadores pesados tipo Puppeteer. |
| **Pool de Sesiones** | Estructura en memoria (`Map<number, SesionWhatsAppNegocio>`) que gestiona múltiples conexiones activas de WhatsApp en paralelo, asignando una por cada sede registrada. |
| **Anti-Account Takeover** | Mecanismo de seguridad que impide que un atacante suplante una cuenta registrada verificando la inmutabilidad del identificador federado `sub` de Google OAuth. |
| **Magic Bytes** | Primeros bytes binarios de un archivo que identifican de forma certera su tipo MIME real, independientemente de la extensión con la que fue nombrado. |
| **Token de Gestión** | Token criptográfico único generado al crear una cita que permite al cliente invitado visualizar, reprogramar o cancelar su reserva sin obligarlo a crear una contraseña. |
| **SAST (Static Application Security Testing)** | Análisis estático de código fuente de caja blanca sin ejecutar el programa (implementado con SonarCloud y TypeScript estricto). |
| **SCA (Software Composition Analysis)** | Análisis automatizado de dependencias y bibliotecas externas de terceros para detectar vulnerabilidades y CVEs conocidos (implementado con `npm audit`). |
| **DAST (Dynamic Application Security Testing)** | Pruebas dinámicas de seguridad de caja negra ejecutadas sobre la aplicación desplegada en un servidor (proyectado con OWASP ZAP). |
| **HITL (Human-in-the-Loop)** | Principio de gobernanza asistida por IA que exige la aprobación y supervisión humana previa antes de confirmar cambios en el código o arquitectura. |
| **WCAG 2.1 AA** | Pautas internacionales de accesibilidad web que exigen una relación de contraste mínima de 4.5:1 entre el texto y el fondo para garantizar legibilidad. |
| **Theming Reactivo** | Capacidad del frontend de cambiar colores, tipografías y bordes en caliente inyectando atributos en el nodo raíz del HTML (`data-tenant-theme`). |
| **Rutas Reservadas** | Segmentos de URL globales del sistema (`/login`, `/dashboard`, `/reservas`, `/plataforma`, etc.) que el enrutador nunca interpreta como slugs de barberías. |
