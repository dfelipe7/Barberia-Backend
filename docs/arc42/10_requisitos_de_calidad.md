# 10. Requisitos de Calidad (Arc42 §10)

Los requisitos de calidad establecen criterios medibles para evaluar el cumplimiento de las metas arquitectónicas.

---

## 10.1 Árbol de Calidad

```
Calidad del Sistema Barbería VIP SaaS
├── Seguridad (Confidencialidad e Integridad)
│   ├── Aislamiento Multitenant [Prioridad: Muy Alta]
│   ├── Protección contra Inyecciones (SQLi, XSS) [Prioridad: Muy Alta]
│   ├── Mitigación Anti-Account Takeover [Prioridad: Alta]
│   └── Auditoría de Dependencias de Terceros (SCA) [Prioridad: Alta]
├── Confiabilidad y Concurrencia
│   ├── Integridad de Turnos (Anti Double-Booking) [Prioridad: Muy Alta]
│   └── Resiliencia ante Desconexión de WhatsApp [Prioridad: Alta]
├── Rendimiento y Eficiencia
│   ├── Tiempo de Respuesta en Agendamiento (< 500 ms) [Prioridad: Alta]
│   └── Carga Inicial del Frontend en Móvil (< 2 s) [Prioridad: Media]
├── Mantenibilidad
│   ├── Cobertura de Pruebas Unitarias y e2e (> 80%) [Prioridad: Alta]
│   └── Ausencia de Deuda Técnica Crítica (Quality Gate Verde) [Prioridad: Alta]
└── Usabilidad y Accesibilidad
    ├── Cumplimiento de Contraste WCAG 2.1 AA Dual [Prioridad: Alta]
    └── Flujo de Reserva en Máximo 4 Pasos [Prioridad: Alta]
```

---

## 10.2 Escenarios de Calidad

### Escenario 1 · Intento de Acceso Cruzado entre Sedes (Seguridad Multitenant)
* **Fuente del estímulo:** Usuario malicioso o cliente de la Barbería A.
* **Estímulo:** Envía una solicitud `GET /servicios` o `PATCH /reservas/12` intentando inyectar `negocioId: 2` de la Barbería B en el cuerpo, query o forzando un ID ajeno.
* **Artefacto afectado:** `NegocioContextInterceptor` y capa de servicios.
* **Respuesta del sistema:** La petición se evalúa exclusivamente bajo el `negocioId` resuelto por el slug autorizado. Las consultas SQL llevan la cláusula `WHERE negocioId = context.negocioId`.
* **Medida de respuesta:** La consulta retorna `404 Not Found` o `403 Forbidden`. Cero datos de la Barbería B son transmitidos. Verificado en las suites e2e `multitenant-aislamiento-negativo`.

---

### Escenario 2 · Solicitud Simultánea de la Misma Franja Horaria (Concurrencia)
* **Fuente del estímulo:** Dos clientes distintos intentan reservar al mismo tiempo el turno de las 15:00 del mismo barbero.
* **Estímulo:** Dos peticiones HTTP concurrentes `POST /reservas` llegan al servidor con una diferencia de milisegundos.
* **Artefacto afectado:** `ReservasRepository.crearConBloqueo` y base de datos MySQL.
* **Respuesta del sistema:** La primera transacción obtiene el bloqueo y confirma la cita. La segunda transacción detecta que la franja ya no está disponible dentro del bloque atómico y cancela la operación con rollback.
* **Medida de respuesta:** Un cliente recibe `201 Created` con su cita y el segundo recibe `409 Conflict` con un mensaje indicando que el horario fue ocupado. Se garantiza cero *double-booking*. Verificado en `multitenant-reservas-concurrencia.e2e-spec.ts`.

---

### Escenario 3 · Subida de Archivo Malicioso Disfrazado (Seguridad AppSec)
* **Fuente del estímulo:** Usuario malicioso intentando subir un archivo malicioso disfrazado de imagen o un SVG con scripts.
* **Estímulo:** Envía un ejecutable renombrado a `foto.jpg` o un archivo `logo.svg` que contiene `<script>alert(document.cookie)</script>`.
* **Artefacto afectado:** Módulo de subida de archivos Multer y utilidades de seguridad.
* **Respuesta del sistema:** La utilidad `detectar-tipo-archivo` lee los *Magic Bytes* binarios y rechaza el falso `.jpg` con un error `400 Bad Request`. Para el archivo `.svg`, la utilidad `sanitizar-svg` procesa el contenido con `sanitize-html` eliminando todas las etiquetas ejecutables.
* **Medida de respuesta:** El archivo guardado en el servidor está completamente libre de código malicioso. Verificado en pruebas unitarias `sanitizar-svg.spec.ts`.

---

### Escenario 4 · Verificación de Calidad en Pull Request (Mantenibilidad en CI/CD)
* **Fuente del estímulo:** Desarrollador o agente de IA propone un cambio de código y abre un Pull Request en GitHub.
* **Estímulo:** Se dispara el flujo de GitHub Actions `.github/workflows/build.yml`.
* **Artefacto afectado:** Pipeline de validación de tipos, tests y SonarCloud.
* **Respuesta del sistema:** Se ejecutan los 142 tests unitarios de frontend (o las suites de backend), se genera el informe de cobertura LCOV y se envía a SonarCloud.
* **Medida de respuesta:** El Quality Gate exige $\ge$ 80% de cobertura en código nuevo, 0 vulnerabilidades de seguridad, 0 bugs y complejidad cognitiva $\le$ 15. Si se incumple, el PR queda bloqueado.
