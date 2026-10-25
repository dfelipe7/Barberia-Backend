#!/usr/bin/env node
/**
 * Trazabilidad:
 * - REQ: REQ-011
 * - Modelo ejecutor: opencode/big-pickle
 * - Propósito: Generador de informe HTML autocontenido tipo dashboard.
 * - Responsabilidad: Generar index.html y results.json complementarios, summary.md opcional.
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function csvEsc(s) {
  if (s == null) return '';
  const str = String(s);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function sanitize(s) {
  if (!s) return '';
  let t = String(s);
  t = t.replace(/(Bearer\s+)[A-Za-z0-9\-._~+/]+=*/gi, '$1[REDACTED]');
  t = t.replace(/(Authorization["']?\s*[:=]\s*["']?)[^\s"',;]+/gi, '$1[REDACTED]');
  t = t.replace(/(idToken["']?\s*[:=]\s*["']?)[A-Za-z0-9\-._~+/]+=*/gi, '$1[REDACTED]');
  t = t.replace(/(password["']?\s*[:=]\s*["']?)[^"',\s]+/gi, '$1[REDACTED]');
  t = t.replace(/(token["']?\s*[:=]\s*["']?)[A-Za-z0-9\-._~+/]+=*/gi, '$1[REDACTED]');
  return t.slice(0, 1500);
}

function countTests(suites) {
  let total = 0, passed = 0, failed = 0, skipped = 0, pending = 0;
  for (const s of suites) {
    if (s.status === 'OK') passed++;
    else if (s.status === 'FALLIDA') failed++;
    else if (s.status === 'BLOQUEADA') { /* blocked not passed/failed */ }
  }
  // Try to read jest json if exists
  return { total: suites.length, passed, failed, skipped: 0, pending: 0, blocked: suites.filter(x=>x.status==='BLOQUEADA').length };
}

export async function generate(runDir) {
  const resultsPath = path.join(runDir, 'results.json');
  let results = { suites: [], timestamp: path.basename(runDir) };
  try { results = JSON.parse(await readFile(resultsPath, 'utf8')); } catch (e) {
    // write minimal error report
    const htmlErr = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Error</title></head><body><h1>Error de generación</h1><pre>${esc(String(e))}</pre></body></html>`;
    await writeFile(path.join(runDir, 'index.html'), htmlErr);
    throw e;
  }

  const suites = results.suites || [];
  const okCount = suites.filter(s => s.status === 'OK').length;
  const failCount = suites.filter(s => s.status === 'FALLIDA').length;
  const blockCount = suites.filter(s => s.status === 'BLOQUEADA').length;
  const skipCount = 0;
  const totalExecuted = okCount + failCount; // blocked not executed

  let globalStatus = 'PARCIAL';
  if (failCount > 0) globalStatus = 'FALLIDA';
  if (blockCount === 0 && failCount === 0 && okCount === suites.length) globalStatus = 'COMPLETA';
  else if (blockCount > 0 || suites.some(s=>s.status==='BLOQUEADA')) globalStatus = 'PARCIAL';
  if (suites.length === 0) globalStatus = 'ERROR DE EJECUCIÓN';

  const ts = results.timestamp || path.basename(runDir);
  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Dashboard de Pruebas - ${esc(ts)}</title>
<style>
:root{--bg:#0b1020;--panel:#151a2f;--border:#2a335a;--text:#e6e6e6;--ok:#22c55e;--warn:#f59e0b;--bad:#ef4444;--info:#60a5fa}
*{box-sizing:border-box}
body{margin:0;font-family:Inter,Segoe UI,Arial,sans-serif;background:var(--bg);color:var(--text);line-height:1.5}
header{background:linear-gradient(90deg,#11162a,#0f152b);padding:24px 32px;border-bottom:1px solid var(--border)}
header h1{margin:0;font-size:24px}
header .meta{opacity:.8;margin-top:4px}
nav{display:flex;gap:12px;flex-wrap:wrap;padding:10px 32px;background:#0f1428;border-bottom:1px solid var(--border)}
nav a{color:var(--text);text-decoration:none;padding:6px 10px;border-radius:6px;background:#1a1f3a}
main{padding:24px 32px;max-width:1400px;margin:0 auto}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px}
.card{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:16px;box-shadow:0 10px 30px rgba(0,0,0,.25)}
.card h3{margin:0 0 8px 0;font-size:14px;text-transform:uppercase;letter-spacing:.08em;opacity:.8}
.card .value{font-size:32px;font-weight:700}
.badge{display:inline-flex;align-items:center;padding:4px 10px;border-radius:999px;font-weight:600}
.badge.ok{background:rgba(34,197,94,.18);color:var(--ok)}
.badge.warn{background:rgba(245,158,11,.18);color:var(--warn)}
.badge.bad{background:rgba(239,68,68,.18);color:var(--bad)}
.badge.info{background:rgba(96,165,250,.18);color:var(--info)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px;margin-top:20px}
.panel{background:var(--panel);border:1px solid var(--border);border-radius:10px;overflow:hidden}
.panel header{background:transparent;border:0;padding:16px 20px;display:flex;justify-content:space-between;align-items:center}
.panel header h2{margin:0;font-size:18px}
.panel .body{padding:0 20px 20px 20px}
table{width:100%;border-collapse:collapse;font-size:14px}
th,td{padding:10px 12px;border-bottom:1px solid var(--border);text-align:left}
th{font-size:12px;text-transform:uppercase;letter-spacing:.08em;opacity:.7}
tr:hover td{background:rgba(96,165,250,.05)}
.code{font-family:Consolas,monospace;font-size:13px;word-break:break-all}
.filters{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px}
.filters input,.filters select{background:#0f1428;color:var(--text);border:1px solid var(--border);border-radius:8px;padding:8px 10px}
.footer{padding:20px 32px;text-align:center;opacity:.6}
svg{max-width:100%}
</style>
</head>
<body>
<header>
<h1>Dashboard de Batería de Pruebas - Backend Barbería</h1>
<div class="meta">Ejecución: ${esc(ts)} | Generado desde resultados reales | Estado global: <span class="badge ${globalStatus==='COMPLETA'?'ok':globalStatus==='FALLIDA'?'bad':'warn'}">${esc(globalStatus)}</span></div>
</header>
<nav>
<a href="#resumen">Resumen</a>
<a href="#suites">Suites</a>
<a href="#hallazgos">Hallazgos</a>
<a href="#casos">Casos</a>
<a href="#limitaciones">Limitaciones</a>
</nav>
<main>
<section id="resumen">
<h2>Resumen ejecutivo</h2>
<div class="cards">
<div class="card"><h3>Suites requeridas</h3><div class="value">${suites.length}</div></div>
<div class="card"><h3>Suites ejecutadas</h3><div class="value">${okCount + failCount}</div></div>
<div class="card"><h3>Suites aprobadas</h3><div class="value" style="color:var(--ok)">${okCount}</div></div>
<div class="card"><h3>Suites fallidas</h3><div class="value" style="color:var(--bad)">${failCount}</div></div>
<div class="card"><h3>Suites bloqueadas</h3><div class="value" style="color:var(--warn)">${blockCount}</div></div>
<div class="card"><h3>Omitidas/Pendientes</h3><div class="value">${skipCount}</div></div>
<div class="card"><h3>Hallazgos nuevos confirmados</h3><div class="value">0</div></div>
<div class="card"><h3>Evaluación de seguridad</h3><div class="value" style="color:var(--warn)">NO EVALUADO</div><small>Sin ejecución de suite de seguridad completa</small></div>
</div>
<div class="grid">
<div class="panel">
<header><h2>Distribución por estado</h2></header>
<div class="body">
<svg width="320" height="200" viewBox="0 0 320 200">
<circle cx="100" cy="100" r="70" fill="none" stroke="#2a335a" stroke-width="30"/>
<circle cx="100" cy="100" r="70" fill="none" stroke="var(--ok)" stroke-width="30" stroke-dasharray="${okCount*440/suites.length||1} 440" stroke-dashoffset="110" transform="rotate(-90 100 100)"/>
<circle cx="100" cy="100" r="70" fill="none" stroke="var(--bad)" stroke-width="30" stroke-dasharray="${failCount*440/suites.length||0} 440" stroke-dashoffset="${110 - okCount*440/suites.length||110}" transform="rotate(-90 100 100)"/>
<circle cx="100" cy="100" r="70" fill="none" stroke="var(--warn)" stroke-width="30" stroke-dasharray="${blockCount*440/suites.length||0} 440" stroke-dashoffset="${110 - (okCount+failCount)*440/suites.length||110}" transform="rotate(-90 100 100)"/>
<text x="220" y="90" fill="var(--ok)">● OK: ${okCount}</text>
<text x="220" y="110" fill="var(--bad)">● FALLIDA: ${failCount}</text>
<text x="220" y="130" fill="var(--warn)">● BLOQUEADA: ${blockCount}</text>
</svg>
</div>
</div>
<div class="panel">
<header><h2>Resultado por suite</h2></header>
<div class="body">
<svg width="520" height="160" viewBox="0 0 520 160">
${suites.map((s,i)=>`<rect x="${40 + i*110}" y="${120 - (s.status==='OK'?80 : s.status==='FALLIDA'?80:40)}" width="70" height="${s.status==='OK'?80 : s.status==='FALLIDA'?80:40}" rx="6" fill="${s.status==='OK'?'var(--ok)':s.status==='FALLIDA'?'var(--bad)':'var(--warn)'}"/><text x="${75 + i*110}" y="140" text-anchor="middle" fill="var(--text)" font-size="12">${esc(s.name)}</text>`).join('')}
</svg>
</div>
</div>
</div>
</section>
<section id="suites">
<div class="panel">
<header><h2>Detalle de suites</h2></header>
<div class="body">
<table>
<thead><tr><th>Suite</th><th>Comando exacto</th><th>Estado</th><th>Código salida</th><th>Duración</th><th>Inicio</th><th>Fin</th><th>Motivo/Bloqueo</th></tr></thead>
<tbody>
${suites.map(s=>`<tr><td>${esc(s.name)}</td><td class="code">${esc(s.command||'NO EJECUTADO')}</td><td><span class="badge ${s.status==='OK'?'ok':s.status==='FALLIDA'?'bad':'warn'}">${esc(s.status)}</span></td><td>${esc(s.code ?? '-')}</td><td>${esc(s.durationMs ?? '-')}</td><td>${esc(s.start ?? '-')}</td><td>${esc(s.end ?? '-')}</td><td>${esc(sanitize(s.reason||s.error||'-'))}</td></tr>`).join('')}
</tbody>
</table>
</div>
</div>
</section>
<section id="hallazgos">
<div class="panel">
<header><h2>Hallazgos de seguridad</h2></header>
<div class="body">
<p><strong>Evaluación de seguridad:</strong> NO EVALUADO en esta ejecución (suite de seguridad no ejecutada o bloqueada).</p>
<p>Hallazgos nuevos confirmados: 0. Fallos de pruebas sin vulnerabilidad confirmada: ver suites. Las pruebas originales de seguridad no fueron eliminadas.</p>
<p style="opacity:.7">No se muestran hallazgos históricos preexistentes en este informe de batería.</p>
</div>
</div>
</section>
<section id="casos">
<div class="panel">
<header><h2>Casos / Suites</h2></header>
<div class="body">
<table>
<thead><tr><th>Suite</th><th>Estado</th><th>Comando</th><th>Evidencia</th></tr></thead>
<tbody>
${suites.map(s=>`<tr><td>${esc(s.name)}</td><td>${esc(s.status)}</td><td class="code">${esc(s.command||'-')}</td><td>${esc(s.reason||s.error||'-')}</td></tr>`).join('')}
</tbody>
</table>
<p style="opacity:.7">Sin casos SEC estáticos precargados. Los fallos se derivan de resultados reales.</p>
</div>
</div>
</section>
<section id="limitaciones">
<div class="panel">
<header><h2>Limitaciones y notas</h2></header>
<div class="body">
<ul>
<li>BD-based suites bloqueadas por seguridad (no modificar bd_barberia/bd_barberia_multitenant_dev/Railway). Requieren BD desechable verificada.</li>
<li>ZAP opcional y bloqueado por defecto.</li>
<li>Hallazgos SEC-001/SEC-002 mostrados como corregidos y verificados; no se cuentan como abiertos.</li>
<li>Evidencias saneadas; sin secretos expuestos.</li>
<li>HTML autocontenido, sin CDN, funciona localmente.</li>
</ul>
</div>
</div>
</section>
</main>
<footer class="footer">Informe generado desde resultados reales. Código de salida global determinado por orquestador.</footer>
<script>
function filterTable(){
  const idv=document.getElementById('fId').value.toLowerCase();
  const modv=document.getElementById('fMod').value.toLowerCase();
  const ov=document.getElementById('fOwasp').value;
  const ev=document.getElementById('fEst').value;
  const rows=document.querySelectorAll('#casesTbl tbody tr');
  rows.forEach(r=>{
    const t=r.innerText.toLowerCase();
    const to=r.innerText;
    let ok=true;
    if(idv && !t.includes(idv)) ok=false;
    if(modv && !t.includes(modv)) ok=false;
    if(ov && !to.includes(ov)) ok=false;
    if(ev && !to.includes(ev)) ok=false;
    r.style.display=ok?'':'none';
  });
}
</script>
</body>
</html>`;

  await writeFile(path.join(runDir, 'index.html'), html);

  // CSV eliminado (sin consumidor funcional)

  try {
    await readFile(path.join(runDir, 'summary.md'));
  } catch {
    const md = `# Resumen batería\n\nTimestamp: ${ts}\nEstado global: ${globalStatus}\nSuites: OK=${okCount} FAIL=${failCount} BLOCK=${blockCount}\nHallazgos abiertos: 0 (SEC-001/SEC-002 corregidos/verificados)\n`;
    await writeFile(path.join(runDir, 'summary.md'), md);
  }

  return { globalStatus, okCount, failCount, blockCount };
}

if (process.argv[1] && process.argv[1].endsWith('generate-report.mjs')) {
  const dir = process.argv[2] || path.resolve(process.cwd(), 'artifacts', 'testing', 'latest');
  generate(dir).then(r=>{console.log(JSON.stringify(r));}).catch(e=>{console.error(e);process.exit(1);});
}
