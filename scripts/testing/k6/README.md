# ⚡ Suite de Pruebas de Carga, Rendimiento y Concurrencia (Grafana k6)

Este directorio contiene la batería automatizada de pruebas de rendimiento, saturación y consistencia transaccional para **Barbería VIP SaaS**, validada bajo el **Escenario 5 de Calidad de Arc42 §10**.

---

## 🛠️ 1. Guía Paso a Paso para un Nuevo Desarrollador (Setup Inicial)

Si acabas de clonar este repositorio en una máquina nueva, sigue estos sencillos pasos para tener k6 listo en 1 minuto:

### Paso 1: Obtener el ejecutable oficial de Grafana k6

Tienes **dos opciones** rápidas para obtener `k6`:

#### Opción A (Recomendada en Windows — 1 solo comando):
Abre una terminal (PowerShell o CMD) y ejecuta:
```powershell
winget install k6
```
*(O si utilizas Chocolatey: `choco install k6`)*.  
Al instalarlo por este comando, `k6` queda registrado automáticamente en las variables de entorno de tu sistema (`PATH`) y podrás invocarlo desde cualquier carpeta simplemente escribiendo `k6`.

#### Opción B (Descarga manual del `.exe` portable sin instalación):
1. Ingresa a la sección oficial de descargas de Grafana en GitHub:  
   👉 [https://github.com/grafana/k6/releases](https://github.com/grafana/k6/releases)
2. En la última versión disponible (o v0.50+), localiza en la sección **Assets** el archivo para Windows de 64 bits:  
   `k6-vX.Y.Z-windows-amd64.zip`
3. Descarga y descomprime el archivo `.zip`.
4. Copia el archivo ejecutable `k6.exe` y colócalo en la carpeta:  
   `tools/k6/k6.exe` (en la raíz del proyecto).

> 💡 **Nota:** Si estás en **macOS**, ejecuta `brew install k6`. Si estás en **Linux (Ubuntu/Debian)**, ejecuta `sudo apt-get install k6`.

---

### Paso 2: Verificar que k6 responde correctamente
Abre una consola y confirma que k6 esté operativo:
```bash
k6 version
# Salida esperada: k6 v0.50.0 (o similar)
```

---

## 🚀 2. Ejecución Rápida Asistida (Menú Interactivo)

Una vez colocado el `k6.exe` en `tools/k6/` o instalado en el sistema, ejecuta desde la raíz del proyecto:

```bat
Ejecutar-Prueba-Carga-K6.bat
```

El script por lotes:
1. Detecta automáticamente si tienes `k6.exe` en `tools/k6/` o en el `PATH` global del sistema.
2. Te pregunta a qué entorno deseas apuntar:
   * **[1] Local:** `http://localhost:3000` (con tu Docker o MySQL local).
   * **[2] Staging Cloud:** `https://barberia-backend-staging.up.railway.app` (entorno en Railway).
3. Te muestra el menú para lanzar cualquiera de los 7 escenarios con solo presionar un número.

---

## 🎯 3. Catálogo de Escenarios de Prueba Disponibles

| # | Archivo | Tipo de Prueba | Carga de Usuarios (VUs) | Qué evalúa exactamente |
| :-: | :--- | :--- | :---: | :--- |
| **1** | `test1.js` | **Smoke Test** | 1 - 5 VUs | Verificación de salud (*healthcheck*) de los endpoints públicos y catálogo. |
| **2** | `loadtest.js` | **Load Test** | 50 VUs (10 min) | Operación normal bajo flujo continuo de clientes explorando y cotizando. |
| **3** | `stresstest.js` | **Stress Test** | 100 - 300 VUs | Evalúa el punto de saturación y degradación controlada del backend. |
| **4** | `spiketest.js` | **Spike Test** | 0 $\rightarrow$ 500 VUs | Evalúa la resiliencia ante ráfagas repentinas de clientes en pocos segundos. |
| **5** | `soaktest.js` | **Resistencia (Soak)** | 30 VUs sostenidos | Detecta posibles fugas de memoria (*memory leaks*) o bloqueos en el pool MySQL. |
| **6** | `concurrencia-reservas.js` | **Anti-Doble Reserva** | 20 VUs simultáneos | **Consistencia Transaccional:** 20 clientes compiten exactamente por el mismo sillón y minuto. Solo 1 debe tener éxito y 19 deben recibir rechazo 409 controlado. |
| **7** | `jornada-reservas.js` | **Jornada Completa** | 50 VUs concurrentes | Simula un día de trabajo completo agendando citas en múltiples barberos a la vez. |

---

## 💻 4. Ejecución Manual por Línea de Comandos (CLI)

Si prefieres ejecutar una prueba directamente sin el menú interactivo, utiliza el comando `k6 run`:

### A. Pruebas en Entorno Local (`localhost:3000`)
```bash
# Prueba básica de salud (Smoke)
k6 run scripts/testing/k6/test1.js

# Prueba de concurrencia y prevención de doble reserva
k6 run -e BASE_URL=http://localhost:3000 -e TENANT_SLUG=kyrios-studio scripts/testing/k6/concurrencia-reservas.js
```

### B. Pruebas en Entorno Staging Cloud (Railway)
```bash
# Simulación de jornada con múltiples citas concurrentes
k6 run -e BASE_URL=https://barberia-backend-staging.up.railway.app -e TENANT_SLUG=kyrios-studio scripts/testing/k6/jornada-reservas.js

# Prueba de estrés en Staging
k6 run -e BASE_URL=https://barberia-backend-staging.up.railway.app scripts/testing/k6/stresstest.js
```

---

## 📊 5. Criterios de Aceptación y Puertas de Calidad (Quality Gates)

Cada prueba define umbrales estrictos (*Thresholds*) que determinan si pasa o falla:
* **Latencia $p_{95}$:** El 95% de las peticiones debe responder en **menos de 500 ms**.
* **Tasa de error HTTP:** Menor al **1%** en peticiones generales.
* **Integridad transaccional:** **0% de doble reserva** (nunca dos citas ocupando el mismo sillón en la misma franja).
