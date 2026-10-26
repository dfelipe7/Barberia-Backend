#!/usr/bin/env node
/**
 * Trazabilidad:
 * - REQ: REQ-011
 * - Modelo ejecutor: opencode/big-pickle
 * - Propósito: Integración opcional OWASP ZAP (no por defecto).
 * - Responsabilidad: Ejecutar solo si habilitado y entorno seguro.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(process.cwd());
const ARTIFACTS = path.join(ROOT, 'artifacts', 'testing');

async function main() {
  await mkdir(ARTIFACTS, { recursive: true });
  const res = {
    status: 'BLOQUEADO',
    motivo: 'ZAP no ejecutado por defecto. Requiere Docker/OWASP ZAP, app de pruebas local, base desechable y habilitación explícita (ZAP_ENABLED=true). No se simula análisis exitoso.',
    timestamp: new Date().toISOString()
  };
  await writeFile(path.join(ARTIFACTS, 'zap-status.json'), JSON.stringify(res, null, 2));
  console.log(JSON.stringify(res));
}

main().catch(e=>{console.error(e);process.exit(1);});
