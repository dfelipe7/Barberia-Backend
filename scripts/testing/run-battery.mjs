#!/usr/bin/env node
/**
 * Trazabilidad:
 * - REQ: REQ-011
 * - Modelo ejecutor: opencode/big-pickle
 * - Propósito: Orquestador de batería de pruebas con informes visuales.
 * - Responsabilidad: Ejecutar suites, capturar resultados, generar resumen consolidado.
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, '..', '..');
const ARTIFACTS = path.join(ROOT, 'artifacts', 'testing');

function ts() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function runCmd(name, cmd, args, envExtra = {}) {
  const start = new Date().toISOString();
  const startMs = Date.now();
  return new Promise((resolve) => {
    const outPath = path.join(ARTIFACTS, `_tmp_${name.replace(/[^a-zA-Z0-9]/g, '_')}.out`);
    const errPath = path.join(ARTIFACTS, `_tmp_${name.replace(/[^a-zA-Z0-9]/g, '_')}.err`);
    const child = spawn(cmd, args, { cwd: ROOT, shell: true, env: { ...process.env, ...envExtra } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('close', async (code) => {
      const end = new Date().toISOString();
      const dur = Date.now() - startMs;
      try {
        await writeFile(outPath, stdout);
        await writeFile(errPath, stderr);
      } catch {}
      resolve({
        name,
        command: `${cmd} ${args.join(' ')}`,
        start,
        end,
        durationMs: dur,
        code,
        status: code === 0 ? 'OK' : 'FALLIDA',
        stdoutPath: outPath,
        stderrPath: errPath,
        stdoutSnippet: stdout.slice(0, 2000),
        stderrSnippet: stderr.slice(0, 2000)
      });
    });
  });
}

async function main() {
  // Verificar Docker si se usarán contenedores efímeros
  try {
    const d = spawnSync('docker', ['info'], { stdio: 'pipe' });
    if (d.status !== 0) {
      console.error('Docker no disponible; algunas suites pueden fallar.');
    }
  } catch (e) {
    console.error('Docker check failed:', e.message);
  }

  await mkdir(ARTIFACTS, { recursive: true });
  const t = ts();
  const runDir = path.join(ARTIFACTS, t);
  await mkdir(runDir, { recursive: true });

  const suites = [
    { key: 'unit', name: 'Unitarias', cmd: 'npm', args: ['test', '--', '--runInBand', '--json', `--outputFile="${path.join(runDir, 'jest-unit.json')}"`] },
    { key: 'multitenant', name: 'Multitenant', cmd: 'npm', args: ['run', 'test:multitenant', '--', '--runInBand', '--json', `--outputFile="${path.join(runDir, 'jest-multitenant.json')}"`] },
    { key: 'e2e', name: 'E2E', cmd: 'npm', args: ['run', 'test:e2e', '--', '--runInBand', '--json', `--outputFile="${path.join(runDir, 'jest-e2e.json')}"`] },
  ];

  const results = [];
  const total = suites.length;
  for (let i = 0; i < suites.length; i++) {
    const s = suites[i];
    const idx = i + 1;
    console.log(`[BATERÍA] ${idx}/${total} ${s.name}: ejecutando...`);
    const startT = Date.now();
    const timer = setInterval(() => {
      const sec = Math.floor((Date.now() - startT) / 1000);
      const m = String(Math.floor(sec / 60)).padStart(2, '0');
      const ss = String(sec % 60).padStart(2, '0');
      console.log(`[BATERÍA] ${s.name} sigue en ejecución (${m}:${ss})`);
    }, 30000);
    if (s.blocked) {
      clearInterval(timer);
      results.push({ key: s.key, name: s.name, status: 'BLOQUEADA', command: 'NO EJECUTADO', reason: s.reason });
      console.log(`[BATERÍA] ${idx}/${total} ${s.name}: BLOQUEADA - ${s.reason}`);
      continue;
    }
    try {
      const r = await runCmd(s.key || s.name, s.cmd, s.args);
      clearInterval(timer);
      results.push({ key: s.key, name: s.name, ...r });
      console.log(`[BATERÍA] ${idx}/${total} ${s.name}: ${r.status} (${Math.round((r.durationMs||0)/1000)} s)`);
    } catch (e) {
      clearInterval(timer);
      results.push({ key: s.key, name: s.name, status: 'BLOQUEADA', error: String(e), command: `${s.cmd} ${s.args.join(' ')}` });
      console.log(`[BATERÍA] ${idx}/${total} ${s.name}: BLOQUEADA - ${String(e).slice(0, 80)}`);
    }
  }

  const summary = {
    timestamp: t,
    root: ROOT,
    suites: results,
    note: 'Los resultados provienen de ejecuciones reales; fallos no se ocultan.'
  };

  await writeFile(path.join(runDir, 'results.json'), JSON.stringify(summary, null, 2));
  await writeFile(path.join(ARTIFACTS, 'latest.json'), JSON.stringify({ latest: t, ...summary }, null, 2));
  await writeFile(path.join(runDir, 'summary.md'), `# Resumen batería\n\nTimestamp: ${t}\n\nVer results.json para detalles.\n`);

  // Intentar generar reporte
  try {
    const { generate } = await import('./generate-report.mjs');
    await generate(runDir);
  } catch (e) {
    await writeFile(path.join(runDir, 'report-error.txt'), String(e));
  }

  console.log('Batería completada. Ver:', runDir);
  // Limpieza de contenedores barberia-test efímeros
  try {
    spawnSync('docker', ['ps', '-q', '--filter', 'name=barberia'], { stdio: 'pipe' });
    spawnSync('docker', ['rm', '-f', ...(spawnSync('docker', ['ps', '-aq', '--filter', 'name=barberia'], { encoding: 'utf8' }).stdout.trim().split(/\s+/).filter(Boolean))], { stdio: 'pipe' });
  } catch {}

  // Política de códigos de salida
  const okCount = results.filter(r=>r.status==='OK').length;
  const failCount = results.filter(r=>r.status==='FALLIDA').length;
  const blockCount = results.filter(r=>r.status==='BLOQUEADA').length;
  const hasRequired = results.length > 0;
  if (failCount > 0) { process.exitCode = 1; }
  else if (hasRequired && blockCount === results.length && okCount === 0) { process.exitCode = 2; }
  else if (blockCount > 0 && failCount === 0) { process.exitCode = 2; } // incompleta
  else { process.exitCode = 0; }
}

main().catch((e) => { console.error(e); process.exit(3); });
