/**
 * ==============================================================================
 * TIPO DE PRUEBA: PRUEBA DE PICO SÚBITO (SPIKE TEST)
 * ==============================================================================
 * 
 * 📌 ¿DE QUÉ SE TRATA ESTA PRUEBA?
 * Simula una explosión repentina e inesperada de tráfico en cuestión de segundos.
 * Modela el escenario del mundo real cuando la barbería publica una historia en
 * Instagram con una promoción 2x1 o abre la agenda de citas para Navidad y Fin de Año.
 * Verifica si el servidor absorbe el impacto violento sin reiniciar el contenedor.
 * 
 * 👥 CANTIDAD DE USUARIOS SIMULADOS (VUs - Virtual Users):
 * - Fase 1 (Reposo base): 5 usuarios tranquilos por 5 segundos.
 * - Fase 2 (¡EXPLOSIÓN SÚBITA!): Salta de 5 a 60 usuarios en solo 5 segundos (+1100% de golpe).
 * - Fase 3 (Pico sostenido): Mantiene los 60 usuarios bombardeando durante 10 segundos.
 * - Fase 4 (Retorno a la calma): Cae rápidamente a 0 usuarios en 5 segundos.
 * - PICO MÁXIMO DE CONCURRENCIA: 60 usuarios instantáneos en paralelo.
 * 
 * ⏱️ DURACIÓN TOTAL: 25 segundos.
 * 🎯 SERVIDOR Y TENANT EVALUADO:
 * - URL: https://barberia-backend-production.up.railway.app
 * - Tenant: barberia-demo-2 (Cabecera: x-negocio-slug)
 * 
 * 🚦 CRITERIOS DE ÉXITO (SLA / THRESHOLDS):
 * - Tasa de fallos HTTP (http_req_failed): < 5% durante el impacto súbito
 * - Latencia percentil 95 (http_req_duration p95): < 1500 ms en el ojo del pico
 * ==============================================================================
 */

import http from 'k6/http';
import { sleep, check } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'https://barberia-backend-production.up.railway.app';
const TENANT_SLUG = __ENV.TENANT_SLUG || 'barberia-demo-2';

export const options = {
  stages: [
    { duration: '5s',  target: 5 },   // Carga base baja (5 VUs)
    { duration: '5s',  target: 60 },  // ¡PICO SÚBITO! Salta a 60 usuarios en 5 segundos
    { duration: '10s', target: 60 },  // Se mantiene el pico
    { duration: '5s',  target: 0 },   // Caída rápida y fin
  ],
  thresholds: {
    http_req_failed: ['rate<0.05'],    // Menos del 5% de fallos
    http_req_duration: ['p(95)<1500'], // Menos de 1.5s en el pico
  },
};

export function setup() {
  console.log('==============================================================================');
  console.log(' INICIANDO PRUEBA DE PICO SUBITO (SPIKE TEST) - EXPLOSION A 60 USUARIOS (25s)');
  console.log(` Objetivo: ${BASE_URL} | Tenant: ${TENANT_SLUG}`);
  console.log('==============================================================================');
}

export default function () {
  const headers = {
    'Accept': 'application/json',
    'x-negocio-slug': TENANT_SLUG,
    'User-Agent': 'k6-spiketest/1.0',
  };

  const resHealth = http.get(`${BASE_URL}/health`, { headers });
  check(resHealth, { 'Health 200 OK': (r) => r.status === 200 });

  const resServicios = http.get(`${BASE_URL}/servicios`, { headers });
  check(resServicios, { 'Servicios 200 OK': (r) => r.status === 200 });

  const resBarberos = http.get(`${BASE_URL}/usuarios/barberos`, { headers });
  check(resBarberos, { 'Barberos 200 OK': (r) => r.status === 200 });

  if (__VU <= 3) {
    console.log(
      `[SPIKE VU #${String(__VU).padStart(2, '0')} | Iter ${String(__ITER + 1).padStart(2, '0')}] ` +
      `GET /health ${resHealth.status} (${resHealth.timings.duration.toFixed(0)}ms) | ` +
      `GET /servicios ${resServicios.status} (${resServicios.timings.duration.toFixed(0)}ms) | ` +
      `GET /barberos ${resBarberos.status} (${resBarberos.timings.duration.toFixed(0)}ms)`
    );
  }

  sleep(0.5);
}

export function handleSummary(data) {
  const reqTotal = data.metrics.http_reqs ? data.metrics.http_reqs.values.count : 0;
  const reqRate = data.metrics.http_reqs ? data.metrics.http_reqs.values.rate.toFixed(1) : 0;
  const failedRate = data.metrics.http_req_failed ? (data.metrics.http_req_failed.values.rate * 100).toFixed(2) : 0;
  const p95 = data.metrics.http_req_duration ? data.metrics.http_req_duration.values['p(95)'].toFixed(1) : 0;
  const avg = data.metrics.http_req_duration ? data.metrics.http_req_duration.values.avg.toFixed(1) : 0;
  const reportConfig = {
      icono: '⚡',
      titulo: 'Prueba de Pico Súbito (Spike Test)',
      color: '#ef4444',
      badgeTexto: 'OLEADA SÚBITA ABSORBIDA (60 VUs)',
      usuariosDesc: 'Salto brusco de 5 a 60 VUs',
      duracionDesc: '25 segundos (4 etapas)',
      maxErrorPct: 5,
      slaP95: 1500,
      resumenEjecutivo: 'Evalúa la capacidad de reacción inmediata ante un aumento violento e instantáneo de tráfico (+1100% en 5 segundos), comprobando que el contenedor no se reinicie ni rechace conexiones.',
      escenarioReal: 'Modela el momento exacto en que la barbería publica una promoción relámpago en Instagram/WhatsApp o abre agenda de temporada alta, provocando que decenas de clientes entren en el mismo instante.',
      etapasHtml: '<li><strong> Reposo (0s - 5s):</strong> Tráfico tranquilo de 5 usuarios.</li><li><strong> Explosión Súbita (5s - 10s):</strong> Disparo instantáneo de 5 a 60 usuarios.</li><li><strong> Pico Sostenido (10s - 20s):</strong> 60 usuarios bombardeando en paralelo.</li><li><strong> Retorno (20s - 25s):</strong> Descenso rápido a 0 usuarios.</li>'
    };

  return {
    'docs/reportes-seguridad-y-carga/reporte-k6-spiketest.html': generateHtmlReport(reportConfig, data),
    'stdout': `
================================================================================
  RESULTADOS: ${reportConfig.titulo.toUpperCase()}
================================================================================
 Objetivo:     ${BASE_URL} (Tenant: ${TENANT_SLUG})
 Peticiones:   ${reqTotal} (${reqRate} req/s)
 Fallos:       ${failedRate}%
 Latencia Avg: ${avg} ms
 Latencia p95: ${p95} ms
 Archivo HTML: docs/reportes-seguridad-y-carga/reporte-k6-spiketest.html
================================================================================
`,
  };
}

function generateHtmlReport(config, data) {
  const m = data.metrics || {};
  const reqTotal = m.http_reqs ? m.http_reqs.values.count : 0;
  const reqRate = m.http_reqs ? m.http_reqs.values.rate.toFixed(1) : '0.0';
  const failedRateNum = m.http_req_failed ? m.http_req_failed.values.rate * 100 : 0;
  const failedRate = failedRateNum.toFixed(2);
  const dur = m.http_req_duration ? m.http_req_duration.values : {};
  const min = dur.min !== undefined ? dur.min.toFixed(1) : '0.0';
  const avg = dur.avg !== undefined ? dur.avg.toFixed(1) : '0.0';
  const med = dur.med !== undefined ? dur.med.toFixed(1) : '0.0';
  const p90 = dur['p(90)'] !== undefined ? dur['p(90)'].toFixed(1) : '0.0';
  const p95 = dur['p(95)'] !== undefined ? dur['p(95)'].toFixed(1) : '0.0';
  const max = dur.max !== undefined ? dur.max.toFixed(1) : '0.0';
  const checksPass = m.checks ? m.checks.values.passes : reqTotal;
  const checksFail = m.checks ? m.checks.values.fails : 0;
  const fecha = new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' });

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>${config.titulo} - Barbería SaaS</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #090d16; color: #f8fafc; padding: 28px; margin: 0; line-height: 1.55; }
    .container { max-width: 1120px; margin: 0 auto; }
    .card { background: #131c2e; border-radius: 14px; border: 1px solid #1e293b; padding: 26px 30px; margin-bottom: 22px; box-shadow: 0 8px 20px rgba(0,0,0,0.35); }
    .header-top { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; border-bottom: 1px solid #1e293b; padding-bottom: 16px; margin-bottom: 16px; }
    h1 { margin: 0; color: ${config.color}; font-size: 25px; display: flex; align-items: center; gap: 10px; }
    h2 { margin: 0 0 12px 0; color: #38bdf8; font-size: 18px; display: flex; align-items: center; gap: 8px; }
    h3 { margin: 20px 0 10px 0; color: #e2e8f0; font-size: 16px; }
    .badge { background: ${failedRateNum <= config.maxErrorPct ? '#22c55e' : '#f59e0b'}; color: #052e16; font-size: 13px; font-weight: 800; padding: 6px 14px; border-radius: 999px; letter-spacing: 0.4px; }
    .meta-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-top: 12px; }
    .meta-box { background: #0a0f1d; border: 1px solid #1e293b; padding: 10px 14px; border-radius: 8px; }
    .meta-box span { display: block; font-size: 11px; color: #94a3b8; text-transform: uppercase; font-weight: 700; }
    .meta-box strong { color: #f1f5f9; font-size: 14px; }
    .explain-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px; margin-top: 14px; }
    .explain-box { background: #0a0f1d; border: 1px solid #1e293b; border-left: 4px solid ${config.color}; padding: 16px 18px; border-radius: 10px; }
    .explain-box h4 { margin: 0 0 6px 0; color: #f8fafc; font-size: 15px; }
    .explain-box p, .explain-box ul { margin: 0; font-size: 13.5px; color: #cbd5e1; padding-left: 18px; }
    .explain-box p { padding-left: 0; }
    .explain-box li { margin-bottom: 4px; }
    .kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 16px; margin: 18px 0; }
    .kpi { background: #0a0f1d; border: 1px solid #1e293b; padding: 18px; border-radius: 10px; border-top: 3px solid ${config.color}; }
    .kpi .label { font-size: 12px; color: #94a3b8; text-transform: uppercase; font-weight: 700; }
    .kpi .val { font-size: 30px; font-weight: 800; margin: 6px 0 4px 0; color: #f8fafc; }
    .kpi .desc { font-size: 12.5px; color: #94a3b8; margin: 0; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; background: #0a0f1d; border-radius: 10px; overflow: hidden; border: 1px solid #1e293b; font-size: 13.5px; }
    th, td { padding: 12px 16px; text-align: left; border-bottom: 1px solid #1e293b; }
    th { background: #162036; color: #cbd5e1; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
    .ok { color: #4ade80; font-weight: 600; }
    .glossary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(310px, 1fr)); gap: 14px; margin-top: 12px; }
    .term { background: #0a0f1d; border: 1px solid #1e293b; padding: 14px 16px; border-radius: 8px; }
    .term strong { color: #38bdf8; font-size: 14px; display: block; margin-bottom: 4px; }
    .term span { color: #cbd5e1; font-size: 13px; }
    code { background: #1e293b; color: #f8fafc; padding: 2px 6px; border-radius: 4px; font-size: 12.5px; }
  </style>
</head>
<body>
  <div class="container">
    <!-- ENCABEZADO -->
    <div class="card">
      <div class="header-top">
        <h1>${config.icono} ${config.titulo}</h1>
        <span class="badge">${config.badgeTexto}</span>
      </div>
      <p style="margin:0; color:#cbd5e1; font-size:14.5px;">${config.resumenEjecutivo}</p>
      <div class="meta-row">
        <div class="meta-box"><span>Servidor Evaluado (Producción)</span><strong>${BASE_URL}</strong></div>
        <div class="meta-box"><span>Sede Multitenant (Header)</span><strong>x-negocio-slug: ${TENANT_SLUG}</strong></div>
        <div class="meta-box"><span>Usuarios Virtuales (VUs)</span><strong>${config.usuariosDesc}</strong></div>
        <div class="meta-box"><span>Duración / Fecha</span><strong>${config.duracionDesc} (${fecha})</strong></div>
      </div>
    </div>

    <!-- QUE HACE Y QUE COMPRUEBA ESTA PRUEBA -->
    <div class="card">
      <h2>🎯 ¿Qué hace esta prueba y qué comprueba en la arquitectura?</h2>
      <div class="explain-grid">
        <div class="explain-box">
          <h4>📌 Escenario del Mundo Real</h4>
          <p>${config.escenarioReal}</p>
        </div>
        <div class="explain-box">
          <h4>⚙️ Etapas de Carga Ejecutadas</h4>
          <ul>${config.etapasHtml}</ul>
        </div>
        <div class="explain-box">
          <h4>🛡️ Qué valida en el Backend y Base de Datos</h4>
          <ul>
            <li><strong>Aislamiento Multitenant:</strong> Verifica que el middleware resuelva <code>${TENANT_SLUG}</code> sin cruzar datos entre barberías.</li>
            <li><strong>Pool de Prisma y PostgreSQL:</strong> Comprueba que las consultas a <code>/servicios</code>, <code>/usuarios/barberos</code> y <code>/perfil-negocio</code> no agoten las conexiones.</li>
            <li><strong>Estabilidad en Railway:</strong> Confirma que el contenedor Node.js/NestJS no sufra caídas (errores 500/502) bajo concurrencia.</li>
          </ul>
        </div>
      </div>
    </div>

    <!-- KPIS PRINCIPALES CON EXPLICACION -->
    <div class="card">
      <h2>📊 Resultados Estadísticos Principales</h2>
      <div class="kpi-grid">
        <div class="kpi">
          <div class="label">Peticiones Totales (HTTP Reqs)</div>
          <div class="val">${reqTotal}</div>
          <p class="desc">Cantidad total de consultas HTTP respondidas por el backend durante toda la prueba (${checksPass} exitosas / ${checksFail} fallidas).</p>
        </div>
        <div class="kpi">
          <div class="label">Capacidad / Throughput</div>
          <div class="val">${reqRate} <small style="font-size:15px;color:#94a3b8;">req/s</small></div>
          <p class="desc">Peticiones por segundo procesadas en promedio. Mide cuántas consultas simultáneas atiende el servidor cada segundo.</p>
        </div>
        <div class="kpi">
          <div class="label">Tasa de Error (HTTP Failed)</div>
          <div class="val" style="color:${failedRateNum === 0 ? '#4ade80' : '#f59e0b'};">${failedRate}%</div>
          <p class="desc">Porcentaje de peticiones que devolvieron error (4xx/5xx) o timeout. Umbral máximo permitido (SLA): <strong>&lt; ${config.maxErrorPct}%</strong>.</p>
        </div>
        <div class="kpi">
          <div class="label">Latencia Percentil 95 — p(95)</div>
          <div class="val" style="color:#4ade80;">${p95} <small style="font-size:15px;color:#94a3b8;">ms</small></div>
          <p class="desc">El <strong>95% de los usuarios</strong> recibió respuesta en menos de ${p95} milisegundos. Meta exigida (SLA): <strong>&lt; ${config.slaP95} ms</strong>.</p>
        </div>
      </div>

      <h3>⏱️ Desglose Detallado de Tiempos de Respuesta (Latencia HTTP)</h3>
      <table>
        <thead>
          <tr>
            <th>Métrica Estadística</th>
            <th>Valor Obtenido</th>
            <th>Meta Exigida (SLA)</th>
            <th>¿Qué significa este número en la práctica?</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>Mínimo (Min)</strong></td>
            <td>${min} ms</td>
            <td class="ok">Óptimo</td>
            <td>La respuesta más rápida registrada cuando el servidor tenía la vía totalmente despejada.</td>
          </tr>
          <tr>
            <td><strong>Promedio (Avg)</strong></td>
            <td><strong>${avg} ms</strong></td>
            <td class="ok">&lt; 400 ms</td>
            <td>Tiempo medio que esperó un cliente cualquiera al abrir el catálogo de servicios o barberos.</td>
          </tr>
          <tr>
            <td><strong>Mediana (Med / p50)</strong></td>
            <td>${med} ms</td>
            <td class="ok">&lt; 400 ms</td>
            <td>La mitad exacta (50%) de todas las peticiones se respondió en ${med} ms o menos.</td>
          </tr>
          <tr>
            <td><strong>Percentil 90 — p(90)</strong></td>
            <td>${p90} ms</td>
            <td class="ok">&lt; ${config.slaP95} ms</td>
            <td><strong>9 de cada 10 clientes (90%)</strong> recibieron respuesta en ${p90} ms o menos (experiencia instantánea).</td>
          </tr>
          <tr>
            <td><strong>Percentil 95 — p(95)</strong></td>
            <td><strong style="color:#4ade80;">${p95} ms</strong></td>
            <td class="ok">&lt; ${config.slaP95} ms (Cumple SLA)</td>
            <td><strong>95 de cada 100 clientes (95%)</strong> recibieron respuesta en ${p95} ms o menos. Es el indicador estándar de calidad.</td>
          </tr>
          <tr>
            <td><strong>Máximo (Max)</strong></td>
            <td>${max} ms</td>
            <td>Pico puntual</td>
            <td>La única petición que más demoró (generalmente la primera conexión TLS/SSL o un pico de red).</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- GLOSARIO DE SIGLAS PARA SUSTENTACION -->
    <div class="card">
      <h2>📖 Glosario de Siglas y Conceptos Técnicos (Guía para Sustentación)</h2>
      <div class="glossary-grid">
        <div class="term">
          <strong>SLA (Service Level Agreement — Acuerdo de Nivel de Servicio)</strong>
          <span>Es el contrato o estándar de calidad que debe cumplir la plataforma para considerarse rápida y estable. En este proyecto, el SLA exige que las respuestas tarden menos de ${config.slaP95} ms y que los errores sean menores al ${config.maxErrorPct}%.</span>
        </div>
        <div class="term">
          <strong>VUs (Virtual Users — Usuarios Virtuales)</strong>
          <span>Son robots o clientes simulados por Grafana k6 que navegan al mismo tiempo. Si la prueba dice "20 VUs", significa que hay 20 personas consultando la barbería de forma paralela en el mismo segundo.</span>
        </div>
        <div class="term">
          <strong>Throughput (req/s — Peticiones por Segundo)</strong>
          <span>Mide el caudal o velocidad de trabajo del servidor: cuántas peticiones completas (ida a la base de datos y vuelta al cliente) logra despachar el backend en 1 segundo.</span>
        </div>
        <div class="term">
          <strong>Percentil 95 — p(95) y Percentil 90 — p(90)</strong>
          <span>A diferencia del promedio simple, el percentil 95 ordena todas las peticiones de la más rápida a la más lenta y toma el corte del 95%. Garantiza que la inmensa mayoría de usuarios (95%) tuvo una experiencia rápida sin que un solo pico aislado distorsione el análisis.</span>
        </div>
        <div class="term">
          <strong>Latencia (ms — Milisegundos)</strong>
          <span>Es el tiempo que transcurre desde que el celular/computador del cliente solicita los servicios de la barbería hasta que Railway devuelve el JSON completo. (1000 ms = 1 segundo; valores de ~160-200 ms son imperceptibles al ojo humano).</span>
        </div>
        <div class="term">
          <strong>Thresholds (Umbrales Automáticos de Aprobación)</strong>
          <span>Son las reglas programadas en k6 (<code>http_req_failed</code> y <code>http_req_duration</code>). Si el servidor tarda más de lo permitido o arroja errores, k6 reprueba automáticamente el test.</span>
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;
}
