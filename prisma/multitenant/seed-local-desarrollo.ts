import 'dotenv/config';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '../../generated/prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import {
  sembrarDesarrolloLocal,
  verificarDestinoDeSeed,
  verificarHistorialDeMigraciones,
} from '../../src/modules/negocios/seed/seed-local-desarrollo.service';
import {
  DOMINIO_CORREO_PRUEBA_POR_DEFECTO,
  ENV_AUTORIZACION_SEED,
  ENV_DOMINIO_CORREO_PRUEBA,
  VALOR_AUTORIZACION_SEED,
} from '../../src/modules/negocios/seed/seed-local-desarrollo.constants';

/**
 * SEMILLA DE DESARROLLO LOCAL MULTITENANT (Fase 13).
 *
 * Comando EXCLUSIVO del entorno local de desarrollo. Crea las dos barberías
 * del escenario de prueba (`KYRIOS STUDIO` y `BARBERÍA DEMO 2`) con sus
 * superadministradores (membresías), sus barberos, sus servicios, sus
 * relaciones y su horario semanal.
 *
 * NO se ejecuta al arrancar la aplicación ni al levantar Docker Compose: es
 * un paso explícito.
 *
 * SALVAGUARDAS (todas obligatorias, en este orden):
 *   1. Autorización explícita: `SEED_LOCAL_MULTITENANT=1`.
 *   2. La base destino debe ser EXACTAMENTE `bd_barberia_multitenant_dev`.
 *      Se rechazan `bd_barberia` y cualquier otra base.
 *   3. El host debe ser local: se rechazan los hosts de Railway (por patrón)
 *      y cualquier host no local.
 *   4. El historial de migraciones debe estar completo y sano, y debe incluir
 *      la migración que añade `Administrador.superadmin`.
 *
 * Códigos de salida: 0 = correcto; 1 = error (no se escribió nada).
 */

const RUTA_MIGRACIONES = join(process.cwd(), 'prisma', 'migrations');

/** Crea el cliente Prisma con el adaptador MariaDB (compatible con MySQL). */
function crearPrisma(): PrismaClient {
  const url = new URL(process.env.DATABASE_URL!);
  const adapter = new PrismaMariaDb({
    host: url.hostname,
    port: Number(url.port),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.substring(1),
    connectionLimit: 5,
  });

  return new PrismaClient({ adapter });
}

/** Nombres de las migraciones del repositorio (carpetas de `prisma/migrations`). */
function migracionesDelRepositorio(): string[] {
  const entradas = readdirSync(RUTA_MIGRACIONES, { withFileTypes: true });

  return entradas
    .filter((entrada) => entrada.isDirectory())
    .map((entrada) => entrada.name)
    .sort();
}

async function main() {
  console.log('🌱 Semilla de desarrollo local multitenant (Fase 13)...');

  // --- 1. Autorización explícita -----------------------------------------
  const autorizacion = process.env[ENV_AUTORIZACION_SEED];

  if (autorizacion !== VALOR_AUTORIZACION_SEED) {
    throw new Error(
      `Esta semilla es EXCLUSIVA del entorno local y exige autorización explícita. ` +
        `Define ${ENV_AUTORIZACION_SEED}=${VALOR_AUTORIZACION_SEED} para ejecutarla.`,
    );
  }

  // --- 2. Destino ---------------------------------------------------------
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error('Falta la variable DATABASE_URL.');
  }

  const destino = verificarDestinoDeSeed(databaseUrl);

  if (!destino.ok) {
    throw new Error(destino.motivo);
  }

  console.log(
    `🎯 Destino verificado: ${new URL(databaseUrl).pathname.slice(1)}`,
  );

  // --- 3. Historial de migraciones ---------------------------------------
  const esperadas = migracionesDelRepositorio();
  const prisma = crearPrisma();

  try {
    const historial = await verificarHistorialDeMigraciones(prisma, esperadas);

    if (!historial.ok) {
      throw new Error(historial.motivo);
    }

    console.log(
      `✅ Historial verificado: ${historial.aplicadas?.length ?? 0} migraciones aplicadas.`,
    );

    // --- 4. Provisionamiento ----------------------------------------------
    const reporte = await sembrarDesarrolloLocal(prisma, {
      dominioCorreoPrueba:
        process.env[ENV_DOMINIO_CORREO_PRUEBA] ??
        DOMINIO_CORREO_PRUEBA_POR_DEFECTO,
    });

    console.log('');
    console.log('📋 Resultado:');

    for (const negocio of reporte.negocios) {
      console.log(
        `   🏪 ${negocio.slug} (id=${negocio.negocioId}): ${negocio.accion}`,
      );

      for (const admin of negocio.superadmins) {
        console.log(
          `      👑 ${admin.email} -> membresía ${admin.membresiaId} ` +
            `(superadmin=${admin.superadmin}) [${admin.accion}]`,
        );
      }

      for (const barbero of negocio.barberos) {
        console.log(
          `      💈 ${barbero.email} -> barbero ${barbero.barberoId} [${barbero.accion}]`,
        );
      }

      for (const servicio of negocio.servicios) {
        console.log(
          `      ✂️  ${servicio.nombre} -> servicio ${servicio.servicioId} [${servicio.accion}]`,
        );
      }

      console.log(
        `      🔗 relaciones barbero-servicio: ${negocio.relaciones} | franjas semanales: ${negocio.franjas}`,
      );
    }

    console.log('');
    console.log('📊 Conteos verificados contra la base de datos:');
    console.log(
      '   negocio            admins  superadmins  barberos  servicios  relaciones  franjas',
    );

    for (const conteo of reporte.conteos) {
      console.log(
        `   ${conteo.slug.padEnd(18)} ${String(conteo.administradores).padStart(6)} ` +
          `${String(conteo.superadmins).padStart(12)} ${String(conteo.barberos).padStart(9)} ` +
          `${String(conteo.servicios).padStart(10)} ${String(conteo.relaciones).padStart(11)} ` +
          `${String(conteo.franjas).padStart(8)}`,
      );
    }

    if (reporte.avisos.length > 0) {
      console.log('');
      console.log('ℹ️ Avisos:');
      for (const aviso of reporte.avisos) {
        console.log(`   - ${aviso}`);
      }
    }

    console.log('');
    console.log('🎉 Escenario de desarrollo local provisionado.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e: unknown) => {
  const mensaje = e instanceof Error ? e.message : String(e);
  console.error('❌ Error en la semilla de desarrollo local:', mensaje);
  process.exit(1);
});
