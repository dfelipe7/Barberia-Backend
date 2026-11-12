# 🛡️ Guía Técnica de Seguridad y Testing de Software
### Ecosistema Barbería VIP SaaS — Plataforma Multi-Tenant

> **Área Disciplinar:** Ingeniería de Software: Seguridad y Documentación  
> **Técnicas Normativas:** SAST, SCA, IAST y DAST  
> **Estándares Articulados:** OWASP Top 10, CWE / SANS Top 25, ISO/IEC 25010  
> **Versión:** 2.0.0 (Edición Multisede)  
> **Fecha de Actualización:** Noviembre 2026  

---

## 📑 Tabla de Contenidos

1. [Fundamentos y Objetivos de Seguridad en el Código](#1-fundamentos-y-objetivos-de-seguridad-en-el-código)
2. [Comparativa Tecnológica de Técnicas de Análisis](#2-comparativa-tecnológica-de-técnicas-de-análisis)
3. [Implementación y Evidencia Técnica en Barbería VIP](#3-implementación-y-evidencia-técnica-en-barbería-vip)
   * [3.1 SAST (Static Application Security Testing)](#31-sast-static-application-security-testing)
   * [3.2 SCA (Software Composition Analysis)](#32-sca-software-composition-analysis)
   * [3.3 IAST (Interactive Application Security Testing)](#33-iast-interactive-application-security-testing)
   * [3.4 DAST (Dynamic Application Security Testing con OWASP ZAP)](#34-dast-dynamic-application-security-testing-con-owasp-zap)
4. [Matriz de Mitigación OWASP Top 10 en el Código Fuente](#4-matriz-de-mitigación-owasp-top-10-en-el-código-fuente)
5. [Procedimiento de Generación y Descarga de Reportes en CI/CD](#5-procedimiento-de-generación-y-descarga-de-reportes-en-cicd)

---

## 1. Fundamentos y Objetivos de Seguridad en el Código

La revisión de seguridad en el código fuente de **Barbería VIP SaaS** tiene como objetivo identificar vulnerabilidades, malas prácticas, fallos de lógica y fugas de información entre inquilinos (*cross-tenant data leakage*) antes de que los artefactos lleguen a entornos de producción.

Para garantizar una defensa en profundidad (*Defense-in-Depth*), el proyecto articula **cuatro técnicas complementarias** que abarcan todo el ciclo de vida del desarrollo seguro (SSDLC):
* **Caja Blanca (White-Box):** Inspección estática del código y librerías externas (SAST y SCA).
* **Inspección Interna en Tiempo de Ejecución:** Monitoreo del flujo de datos y aislamiento multitenant (IAST).
* **Caja Negra (Black-Box):** Simulación de ataques externos sobre endpoints desplegados (DAST).

---

## 2. Comparativa Tecnológica de Técnicas de Análisis

A continuación se detalla la comparativa oficial de las cuatro técnicas de análisis de seguridad y su materialización exacta en el repositorio:

| Técnica | Objeto de Análisis | Acceso a Código | Momento de Aplicación | Herramienta / Implementación en Barbería VIP |
| :--- | :--- | :---: | :--- | :--- |
| **SAST** | Código fuente propio (TypeScript / NestJS / React) | **Sí** (Caja Blanca) | Fase de desarrollo local y pipelines de Pull Request | • TypeScript Compiler (`tsc --noEmit`)<br>• ESLint con reglas de seguridad<br>• **SonarCloud Quality Gate** en `.github/workflows/build.yml` |
| **SCA** | Bibliotecas y paquetes de terceros (`node_modules`) | **Sí** (Archivos `package-lock.json`) | Fase de compilación y auditorías programadas en CI/CD | • **npm audit** (`--audit-level=high`) en `.github/workflows/security-audit.yml`<br>• **Dependabot** en `.github/dependabot.yml`<br>• Bloque `overrides` en `package.json` |
| **IAST** | Código en tiempo de ejecución mientras se ejecutan pruebas funcionales | **Sí** (Agente interno de intercepción) | Entornos de QA / Pruebas de integración E2E | • Middleware `AsyncLocalStorage`<br>• Extensiones Prisma (`prisma-extension-aislamiento.ts`) que auditan queries SQL en runtime |
| **DAST** | Endpoints HTTP de la API web en ejecución | **No** (Caja Negra exterior) | Entornos de Staging y Pre-producción | • **OWASP ZAP (Zed Attack Proxy)** automatizado en `.github/workflows/dast-zap.yml`<br>• Script local `scripts/testing/zap-run.mjs` |

---

## 3. Implementación y Evidencia Técnica en Barbería VIP

### 3.1 SAST (Static Application Security Testing)

El análisis estático examina directamente el árbol de sintaxis abstracta (AST) del código fuente sin ejecutarlo:
1. **Prevención de Inyecciones (SQLi y NoSQLi):**
   * El código no utiliza concatenación directa de cadenas en consultas SQL. Se utiliza **Prisma ORM**, que genera consultas parametrizadas de forma mandatoria.
   * Todos los endpoints de entrada implementan DTOs fuertemente tipados validados con `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })`. Si un atacante inyecta parámetros no autorizados, el framework los descarta antes de llegar a los controladores.
2. **Pipeline Automatizado en GitHub Actions:**
   * Archivo: [`.github/workflows/build.yml`](../.github/workflows/build.yml)
   * Se ejecuta en cada Push y Pull Request. Compila con `tsc` y dispara el escaneo de **SonarCloud / SonarQube**, exigiendo un Quality Gate estricto: cero vulnerabilidades y cobertura de pruebas $\ge 80\%$.
3. **Comando de verificación estática local:**
   ```bash
   npm run typecheck
   ```

---

### 3.2 SCA (Software Composition Analysis)

El análisis de composición audita las bibliotecas de código abierto importadas por el proyecto contra la base de datos pública de vulnerabilidades y exposiciones comunes (CVEs):
1. **Bloqueador de Seguridad en CI/CD (Quality Gate):**
   * Archivo: [`.github/workflows/security-audit.yml`](../.github/workflows/security-audit.yml)
   * Ejecuta `npm audit --audit-level=high`. Si se detecta cualquier vulnerabilidad de nivel Alto o Crítico en una librería de terceros, el pipeline falla de inmediato y bloquea la integración.
2. **Remediación Automatizada con Dependabot:**
   * Archivo: [`.github/dependabot.yml`](../.github/dependabot.yml)
   * Monitorea semanalmente las dependencias de npm y abre Pull Requests automáticos con las versiones parcheadas ante cualquier alerta de seguridad de GitHub.
3. **Parches de Seguridad Forzados (`overrides`):**
   * En `package.json`, el bloque `"overrides"` fuerza versiones seguras para librerías indirectas con CVEs conocidos (`mariadb >= 3.5.4`, `mysql2 >= 3.24.5`, `body-parser >= 2.4.0`, `fast-uri >= 3.1.9`).
4. **Comando de auditoría local:**
   ```bash
   npm audit
   ```

---

### 3.3 IAST (Interactive Application Security Testing)

A diferencia del análisis pasivo, el enfoque IAST utiliza mecanismos internos mientras la aplicación ejecuta sus casos de prueba funcionales y de estrés:
1. **Auditoría de Aislamiento Multitenant en Memoria:**
   * La infraestructura implementa `AsyncLocalStorage` (`negocio-contexto.service.ts`), propagando el identificador del negocio (`negocioId`) de forma inmutable a lo largo de toda la cadena asíncrona.
2. **Agente Interceptor en la Capa de Datos:**
   * El archivo `prisma-extension-aislamiento.ts` actúa como un agente de inspección interactivo: ante cada lectura, escritura o eliminación en la base de datos, intercepta la operación y valida en tiempo de ejecución que el filtro `WHERE negocioId = context.negocioId` esté presente.
3. **Pruebas E2E Negativas de Intrusión:**
   * Las suites de prueba `multitenant-aislamiento-negativo` intentan forzar lecturas cruzadas entre diferentes barberías; el agente interactivo detecta el intento de intrusión y aborta la transacción con `403 Forbidden` o `404 Not Found`.

---

### 3.4 DAST (Dynamic Application Security Testing con OWASP ZAP)

El análisis dinámico ataca la aplicación desde el exterior a través de la red simulando un atacante real sin credenciales privilegiadas:
1. **Herramienta Estándar de la Industria:**
   * **OWASP ZAP (Zed Attack Proxy):** Escáner dinámico de aplicaciones web de la fundación OWASP.
2. **Workflow Integrado en GitHub Actions:**
   * Archivo: [`.github/workflows/dast-zap.yml`](../.github/workflows/dast-zap.yml)
   * Levanta el servidor backend en el runner de GitHub, espera a que responda el endpoint `/health` y lanza el contenedor oficial `zaproxy/action-baseline` contra `http://localhost:3000/api/docs`.
3. **Superficie de Ataque Evaluada:**
   * **Cabeceras HTTP de Seguridad (Helmet):** Valida la presencia de `Content-Security-Policy`, `X-Frame-Options: DENY` (anti-clickjacking) y `X-Content-Type-Options: nosniff`.
   * **Protección contra Fuerza Bruta:** Comprueba que peticiones masivas en ráfaga sean bloqueadas con código `429 Too Many Requests` mediante **NestJS Throttler** (límite: 100 peticiones / minuto).
   * **CORS Restringido:** Verifica que solicitudes con orígenes no autorizados sean rechazadas sin revelar cabeceras de autorización.
   * **Ocultación de Traza de Errores:** Comprueba que peticiones corruptas devuelvan mensajes genéricos sanitizados y nunca revelen errores de compilación de SQL ni la estructura interna de tablas MariaDB.

---

## 4. Matriz de Mitigación OWASP Top 10 en el Código Fuente

| Categoría OWASP | Riesgo Asociado | Mitigación Técnica en Barbería VIP |
| :--- | :--- | :--- |
| **A01:2021 — Broken Access Control** | Acceso no autorizado a recursos de otra barbería. | Guards JWT diferenciados (`JwtAuthGuard`, `ClienteJwtGuard`), verificación estricta de roles RBAC y extensión de aislamiento multitenant. |
| **A02:2021 — Cryptographic Failures** | Exposición o uso de contraseñas y tokens débiles. | Autenticación Google OAuth2 con verificación criptográfica asimétrica, firmas JWT con algoritmo seguro y secretos aislados en variables de entorno. |
| **A03:2021 — Injection** | Inyecciones SQL, NoSQL o de comandos del sistema operativo. | Consultas parametrizadas en Prisma ORM, sanitización de SVGs con `sanitize-html` y DTOs estrictos con `ValidationPipe`. |
| **A04:2021 — Insecure Design** | Solapamiento de turnos y doble reserva concurrente. | Transacciones atómicas en base de datos e índice único generado: `UNIQUE (barberoId, date, startTime, slotActivo)`. |
| **A05:2021 — Security Misconfiguration** | Cabeceras por defecto inseguras o Swagger expuesto. | Cabeceras HTTP endurecidas con **Helmet**, Swagger desactivado en producción por defecto y CORS restringido a orígenes explícitos. |
| **A06:2021 — Vulnerable and Outdated Components** | Librerías con vulnerabilidades conocidas (CVEs). | Pipeline SCA automatizado (`npm audit --audit-level=high`), Dependabot semanal y bloque `overrides` en `package.json`. |
| **A07:2021 — Identification and Authentication Failures** | Secuestro de sesión o tokens sin expiración. | Tokens JWT con expiración estricta, invalidación inter-pestañas (`barberia_logout_event`) y renovación defensiva en `/auth/refresh`. |
| **A09:2021 — Security Logging and Monitoring Failures** | Ausencia de logs ante ataques o accesos denegados. | Registro centralizado con **Winston** y `AllExceptionsFilter` con rotación diaria de logs de auditoría. |

---

## 5. Procedimiento de Generación y Descarga de Reportes en CI/CD

### 5.1 Cómo Descargar el Reporte DAST (OWASP ZAP) en GitHub
1. Ingrese al repositorio en **GitHub**.
2. Diríjase a la pestaña **Actions**.
3. En el menú lateral izquierdo, seleccione el workflow **"DAST Security Audit (OWASP ZAP)"**.
4. Haga clic sobre la última ejecución completada.
5. Al final de la página, en la sección **Artifacts**, haga clic en **`reporte-dast-owasp-zap`**.
6. Se descargará un archivo comprimido conteniendo `zap_report.html`, el cual puede abrir en cualquier navegador web para consultar el informe visual de auditoría dinámica.

### 5.2 Cómo Consultar el Reporte SCA (Auditoría de Dependencias)
1. En la pestaña **Actions**, seleccione **"Security Audit Pipeline"**.
2. Haga clic en el job **OWASP A03 Dependency Audit** para revisar el registro en tiempo real de `npm audit`.
3. Adicionalmente, en la pestaña **Security > Dependabot alerts**, puede revisar el estado de vulnerabilidades resueltas y parches aplicados automáticamente.

---

> **Aprobación de Seguridad:**  
> Este marco de testing cumple con las directrices de aseguramiento de calidad del software y garantiza que el sistema esté protegido de forma proactiva y continua.

