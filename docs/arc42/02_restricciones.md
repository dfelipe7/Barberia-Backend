# 02. Restricciones de la Arquitectura (Arc42 §2)

Las restricciones delimitan el espacio de diseño arquitectónico y deben cumplirse en todas las decisiones de implementación.

---

## 2.1 Restricciones Técnicas

| Categoría | Restricción | Justificación |
| :--- | :--- | :--- |
| **Entorno de Ejecución** | Node.js `>= 20.x` (LTS actual) | Soporte de APIs modernas de JavaScript, compatibilidad con Baileys v7 y rendimiento de V8. |
| **Lenguaje de Programación** | TypeScript `>= 5.7` en modo estricto (`strict: true`) | Prevenir errores en tiempo de compilación, garantizar tipado estricto de DTOs y evitar tipos `any`. |
| **Framework Backend** | NestJS 11 | Inyección de dependencias modular, interceptores de contexto multitenant y filtros de excepciones estándar. |
| **Capa de Persistencia (ORM)** | Prisma Client 7 | Consultas SQL fuertemente tipadas y parametrizadas que mitigan inyección SQL por diseño. |
| **Motor de Base de Datos** | MySQL 8.0 | Soporte transaccional ACID (`READ COMMITTED`), índices compuestos y amplia disponibilidad en hosting cloud. |
| **Framework Frontend** | React 19 + Vite 8 | Single Page Application rápida, modularidad orientada a dominios (*Feature-Sliced*) y empaquetado optimizado. |
| **Manejo de Estado del Servidor** | TanStack Query 5 (React Query) | Cacheo inteligente, reintentos automáticos, sincronización reactiva y mitigación de llamadas redundantes. |
| **Seguridad de Cabeceras HTTP** | Helmet y CORS Estricto | Protección contra XSS, clickjacking, MIME sniffing y restricción de orígenes cruzados no autorizados. |
| **Almacenamiento Local de Archivos** | Sistema de archivos particionado | Rutas aisladas por negocio (`uploads/negocios/{negocioId}/...`) con validación de firma mágica binaria. |

---

## 2.2 Restricciones Organizacionales y de Proceso

* **Control de Versiones y Git Flow:** Todo el código fuente reside en repositorios GitHub versionados (`Barberia-Backend` y `Barberia-Frontend`).
* **Integración Continua (CI):** Ningún pull request puede fusionarse sin superar la suite de pruebas unitarias (`npm run test:coverage`), la compilación (`npm run build`) y el análisis de calidad de SonarCloud.
* **Gobernanza Asistida por IA (HITL - Human-in-the-Loop):** Todo commit generado o asistido por herramientas de IA debe incluir obligatoriamente los trailers de auditoría estipulados en `AGENTS.md` (`AI-Assisted-By`, `AI-Model`, `AI-Session`) y contar con aprobación humana previa.
* **Prohibición de Modificaciones Cruzadas Involuntarias:** Los cambios en frontend no deben modificar código backend a menos que sea explícitamente requerido, preservando contratos inmutables.

---

## 2.3 Restricciones de Convenciones y Estándares

* **Estructura Documental:** Conforme al estándar internacional **Arc42 v7.0** y manuales técnicos **IEEE 1063**.
* **Contratos de API RESTful:** Especificación **OpenAPI 3.0** generada mediante `@nestjs/swagger`.
* **Accesibilidad Web:** Contraste de colores y diseño visual conforme a las pautas **WCAG 2.1 Nivel AA** en los 6 temas de marca.
