# 01. Introducción y Objetivos (Arc42 §1)

El sistema **Barbería VIP SaaS** resuelve la necesidad operativa y comercial de las barberías modernas de digitalizar su operación sin incurrir en costos individuales de desarrollo, hosting o mantenimiento. Ofrece un modelo Software as a Service (SaaS) donde cada sede opera como un espacio privado y personalizado.

---

## 1.1 Vista de Requerimientos

El sistema cubre los siguientes requisitos funcionales de alto nivel:
* **Autoservicio de reservas para clientes:** Agendamiento rápido en 4 pasos, selección de servicio, profesional y franja horaria disponible en tiempo real.
* **Gestión de citas sin contraseña forzada:** Mecanismo de gestión para invitados mediante enlaces con tokens criptográficos seguros (`/:slug/c/:id/:token`).
* **Operación diaria del barbero:** Agenda personal, cambio de estados de turno (*Pendiente*, *Confirmada*, *En progreso*, *Completada*, *Cancelada*, *No asistió*) y seguimiento de ingresos.
* **Control administrativo de sede:** Gestión de catálogo de servicios, comisiones por profesional, horarios semanales, bloqueos por días festivos o descansos.
* **Notificaciones por mensajería instantánea:** Envío automático de confirmaciones, recordatorios y cambios de estado por WhatsApp con plantillas personalizadas.
* **Personalización de marca (Branding):** Subida de isotipo, logotipo claro/oscuro, banner, favicon, ubicación GPS y selección de tema visual.

---

## 1.2 Metas de Calidad

| Prioridad | Meta de Calidad | Motivación y Criterio de Aceptación |
| :---: | :--- | :--- |
| **1** | **Aislamiento Multitenant Estricto** | Ningún negocio puede consultar, modificar o inferir información de otro. Cada transacción SQL y archivo en disco debe estar acotado a `negocioId`. |
| **2** | **Concurrencia Determinista (Anti Doble Reserva)** | Garantizar que dos clientes no puedan reservar la misma franja horaria con el mismo barbero en simultáneo, utilizando transacciones con bloqueo pesimista/atómico en base de datos. |
| **3** | **Seguridad e Integridad de Identidad** | Prevención de secuestro de cuentas (*Anti-Account Takeover*) desacoplando la identidad de usuario de las membresías locales de sede y verificando federación Google OAuth. |
| **4** | **Rendimiento y Usabilidad Mobile-First** | Tiempos de carga iniciales menores a 2 segundos en redes móviles y flujos de reserva táctiles intuitivos sin recargas de página. |
| **5** | **Mantenibilidad y Documentación Viva** | Contratos de API tipados, TSDoc exhaustivo, OpenAPI interactivo y cobertura de pruebas unitarias y e2e continua. |

---

## 1.3 Partes Interesadas (Stakeholders)

| Rol / Nombre | Contacto / Representación | Expectativas Principales |
| :--- | :--- | :--- |
| **Cliente Final (VIP / Invitado)** | Clientes de las barberías que acceden vía web o móvil | Agendar citas de forma rápida, recibir confirmación por WhatsApp y reprogramar o cancelar sin fricciones. |
| **Barbero (Personal Operativo)** | Profesionales de corte y estilistas | Visualizar su agenda diaria actualizada en tiempo real, evitar cruces de citas y llevar control claro de sus turnos. |
| **Administrador de Sede** | Dueños y encargados de cada barbería | Controlar precios, comisiones, horarios de trabajo, personal y ver métricas operativas de su negocio. |
| **Superadministrador de Plataforma** | Equipo técnico y operador del SaaS | Dar de alta nuevas barberías, auditar el estado global de servicios, métricas consolidadas y garantizar el uptime. |
| **Equipo de Desarrollo y DevOps** | Ingenieros de software y arquitectura | Código modular, pruebas automatizadas en CI/CD, análisis estático de seguridad y despliegues sin interrupciones. |
| **Auditoría y Seguridad (AppSec)** | Evaluadores de calidad de software | Cumplimiento de estándares de codificación, ausencia de vulnerabilidades OWASP Top 10 y trazabilidad de cambios. |
