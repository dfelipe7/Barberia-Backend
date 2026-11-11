# 11. Riesgos y Deuda Técnica (Arc42 §11)

Identifica los riesgos arquitectónicos del sistema y las decisiones técnicas diferidas de manera controlada.

---

## 11.1 Matriz de Riesgos Técnicos

| ID | Riesgo Identificado | Probabilidad | Impacto | Estrategia de Mitigación |
| :---: | :--- | :---: | :---: | :--- |
| **R-01** | **Desconexión o bloqueo de línea en WhatsApp:** Al usar Baileys (emulación de cliente web), Meta puede desconectar la sesión si detecta patrones de spam. | Media | Medio | Se implementó espaciado en reintentos (0s, 4s, 10s), envío exclusivo de notificaciones transaccionales solicitadas por el cliente y colas de reintento por sede. Si la sesión cae, no afecta la creación de citas en la base de datos. |
| **R-02** | **Crecimiento desmedido de archivos multimedia en disco:** Subida de múltiples imágenes de alta resolución sin control de tamaño. | Media | Medio | Multer limita el tamaño máximo de subida a 5 MB por archivo. En el frontend se implementó `ImageCropModal` que recorta a formato cuadrado 1:1 optimizado antes de enviar al servidor. |
| **R-03** | **Degradación de rendimiento por volumen masivo de citas:** Al compartir todas las sedes la misma tabla `reservas`, una consulta no indexada podría ralentizar el sistema. | Baja | Alto | Todas las consultas llevan índices compuestos obligatorios `@@index([negocioId, fecha])` y `@@index([negocioId, estado])`. El plan de ejecución de MySQL realiza búsquedas acotadas sin *full-table scans*. |
| **R-04** | **Actualizaciones del protocolo de WhatsApp Web:** Cambios en los servidores de Meta pueden requerir actualizar la versión de Baileys. | Media | Medio | El módulo `whatsapp/` se encuentra completamente encapsulado detrás de una interfaz de servicio (`WhatsAppService`). Cambiar el motor subyacente no impacta al resto de la aplicación. |

---

## 11.2 Deuda Técnica Registrada

El control de deuda técnica se gestiona en el documento vivo [`TECH_DEBT.md`](../../TECH_DEBT.md):

1. **DT-01 · Ejecución Automatizada de DAST en Pipeline:**
   * *Estado:* El script `scripts/testing/zap-run.mjs` existe como marcador con estado `BLOQUEADO`.
   * *Acción futura:* Configurar un contenedor efímero de OWASP ZAP en un job nocturno de GitHub Actions apuntando a un backend de pruebas desplegado.
2. **DT-02 · Aislamiento de Sockets en Pruebas Unitarias de Backend:**
   * *Estado:* En entornos de ejecución restringidos sin permisos de red local, 7 pruebas de integración fallan por `connect EACCES`.
   * *Acción futura:* Sustituir los servidores HTTP reales en dichas pruebas unitarias por mocks o usar `supertest` con sockets en memoria.
3. **DT-03 · Política de Retención y Purga de Multimedia:**
   * *Estado:* Las imágenes subidas permanecen indefinidamente en el volumen persistente de Railway.
   * *Acción futura:* Implementar una tarea programada (cron) que elimine archivos huérfanos de servicios o barberos eliminados.
