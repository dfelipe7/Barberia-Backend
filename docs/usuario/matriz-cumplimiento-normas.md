# 📊 Matriz de Cumplimiento de Estándares Documentales — Barbería VIP SaaS
### Evaluación contra ISO/IEC/IEEE 26514:2022 e IEEE Std 1063-2001

> **Documento Evaluado:** `docs/MANUAL_DE_USUARIO.md` (Versión 2.1.0)  
> **Estándar Principal:** **ISO/IEC/IEEE 26514:2022** *(Systems and software engineering — Requirements for designers and developers of user documentation)*  
> **Estándar Antecedente:** **IEEE Std 1063-2001** *(IEEE Standard for Software User Documentation)*  
> **Fecha de Evaluación:** Noviembre 2026

---

## 📑 Matriz de Componentes Normativos

| Componente Normativo Requerido | Cláusula ISO 26514 / IEEE 1063 | Sección del Manual que lo cubre | Estado de Cumplimiento | Observaciones / Dependencia |
| :--- | :--- | :--- | :---: | :--- |
| **1. Datos de Identificación** | ISO Cl. 7.2 / IEEE Cl. 5.1 | Portada y bloque de metadatos inicial | ✅ **Cubierto** | Versión de backend (`0.0.1`), versión de frontend (`0.0.0`), fecha, referencias normativas y estado "En revisión". |
| **2. Tabla de Contenidos** | ISO Cl. 7.3 / IEEE Cl. 5.2 | Índice al inicio del documento | ✅ **Cubierto** | 48 anclajes hipervinculados probados con resolución 100% libre de enlaces rotos. |
| **3. Introducción y Objetivos** | ISO Cl. 7.4 / IEEE Cl. 5.3 | Capítulo 1 | ✅ **Cubierto** | Propósito del sistema, problema resuelto y concepto de arquitectura multisede (Multi-Tenant). |
| **4. Información para usar el manual** | ISO Cl. 7.5 / IEEE Cl. 5.4 | Sección 1.1 | ✅ **Cubierto** | Tabla orientativa por rol de usuario (*user personas*), convenciones tipográficas e indicación de idioma. |
| **5. Concepto de Operaciones** | ISO Cl. 7.6 / IEEE Cl. 5.5 | Capítulos 3, 4, 5 y 6 | ✅ **Cubierto** | Diagramas Mermaid de los 4 flujos principales (reserva online, login Google, panel admin y superadmin). |
| **6. Uso General de la Interfaz** | ISO Cl. 7.7 / IEEE Cl. 5.6 | Sección 2.3 | ✅ **Cubierto** | Encabezado, menú hamburguesa, cambio de tema (claro/oscuro), indicador "WhatsApp offline" y cierre de sesión. |
| **7. Procedimientos Orientados a Tareas** | ISO Cl. 7.8 / IEEE Cl. 5.7 | Secciones 3.3, 3.5, 3.6, 4.1, 4.3, 4.4, 5.2, 5.3, 5.4, 5.5, 5.7, 6.1, 6.3 | ✅ **Cubierto** | Plantilla uniforme en 13 tareas clave: *Quién*, *Antes de empezar*, *Pasos con nombres de botones*, *Resultado* y *Si algo falla*. |
| **8. Referencia de Pantallas / Comandos** | ISO Cl. 7.9 / IEEE Cl. 5.8 | Secciones 3.1 a 3.7, 4.2, 5.1 y 5.8 | ✅ **Cubierto** | Detalle de las pantallas operativas y sus componentes interactivos. |
| **9. Explicación de Campos de Formularios** | ISO Cl. 7.10 / IEEE Cl. 5.9 | Secciones 3.3, 4.4, 5.1, 5.2, 5.3, 5.4, 5.7 y 6.1 | ✅ **Cubierto** | 8 tablas de campos con columnas: Campo, Obligatorio, Formato o Límite de código y Ejemplo. |
| **10. Mensajes de Error y Solución** | ISO Cl. 7.11 / IEEE Cl. 5.10 | Capítulo 7 (Sección 7.1 y 7.2) | ✅ **Cubierto** | Tabla con 15 mensajes exactos de la interfaz y backend (`mapApiError.ts`, excepciones HTTP y DTOs) y FAQ. |
| **11. Terminología y Glosario** | ISO Cl. 7.12 / IEEE Cl. 5.11 | Capítulo 8 | ✅ **Cubierto** | 10 términos definidos: Sede, Slug, Enlace de gestión, Token de gestión, No-Show, Superadmin, etc. |
| **12. Fuentes Relacionadas** | ISO Cl. 7.13 / IEEE Cl. 5.12 | Capítulo 9 | ✅ **Cubierto** | Enlaces relativos a `docs/arc42/`, `/api/docs` (Swagger) y `README.md`. |
| **13. Ubicación de Información Crítica** | ISO Cl. 8.3 / IEEE Cl. 4.3 | Secciones 1.1 y todo el manual | ✅ **Cubierto** | Las advertencias (⚠️) y notas (ℹ️) aparecen situadas **estrictamente antes del paso al que afectan**. |
| **14. Ilustraciones y Capturas de Pantalla** | ISO Cl. 8.4 / IEEE Cl. 4.4 | Todo el manual y `docs/usuario/img/` | 🟡 **Pendiente** | Referencias `![alt](img/...)` insertadas; el inventario de tomas pendientes está registrado en `docs/usuario/img/LEEME.md`. |
| **15. Control de Versiones** | ISO Cl. 6.4 / IEEE Cl. 5.13 | Capítulo 10 | ✅ **Cubierto** | Tabla formal de historial de cambios con registro de versiones 1.0.0, 2.0.0 y 2.1.0. |
| **16. Proceso de Revisión y Prueba** | ISO Cl. 6.5 / IEEE Cl. 6.1 | Capítulo 11 | 🟡 **Pendiente** | Tabla estructural creada con dos filas de ejemplo en blanco, pendiente de ejecución y firma por revisores humanos. |

---

## 📈 Resumen Estadístico de Cumplimiento

* **Componentes Cubiertos (Aprobados):** **14 / 16** (87.5%)
* **Componentes Parciales / En Progreso:** **0 / 16** (0%)
* **Componentes Pendientes (Dependencia Externa Humana):** **2 / 16** (12.5%)
  1. *Capturas de pantalla reales:* Requieren ser tomadas en el navegador y guardadas en `docs/usuario/img/`.
  2. *Firmas del registro de revisión:* Requieren ser completadas tras la sesión de prueba con lectores externos.
