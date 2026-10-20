import 'dotenv/config';
import { PrismaClient } from '../../generated/prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { ejecutarBackfillNegocio } from '../../src/modules/negocios/migracion/migracion-negocio.service';
import { VARIABLES_MIGRACION } from '../../src/modules/negocios/migracion/migracion-negocio.constants';

/**
 * BACKFILL DE `negocioId` PARA LOS REGISTROS PREEXISTENTES (Fase 2).
 *
 * Asigna el negocio inicial a TODOS los registros que ya existían antes del
 * despliegue multitenant. Hasta ahora todas esas filas tienen `negocioId =
 * NULL` (la columna se añadió nula en la migración aditiva).
 *
 * Por qué SQL y no el ORM: son UPDATE masivos sobre tablas que pueden tener
 * miles de filas, y hace falta que se apliquen por LOTES para no bloquear
 * la tabla entera ni degradar el servicio. Se usa `UPDATE ... WHERE negocioId
 * IS NULL LIMIT n`, que además es IDEMPOTENTE por construcción: la segunda
 * ejecución no encuentra filas y no cambia nada.
 *
 * El nombre de tabla proviene de una lista cerrada y el tamaño de lote se
 * valida como entero; el ÚNICO valor que llega desde fuera (el id del
 * negocio) se envía como PARÁMETRO, nunca interpolado en el texto SQL.
 *
 * Requisitos previos (ver `MULTITENANT.md` §4):
 *   1. La migración aditiva de la Fase 1 está aplicada.
 *   2. El negocio inicial ya existe (script `inicializar-primer-negocio.ts`).
 *   3. Hay un respaldo verificado y restaurable de la base de datos.
 *
 * Variables de entorno obligatorias:
 *   NEGOCIO_INICIAL_SLUG  Slug del negocio inicial al que asignar.
 * Variables de entorno opcionales:
 *   NEGOCIO_BACKFILL_LOTE  Filas por lote (por defecto 1000).
 */

/** Crea el cliente Prisma con el adaptador MariaDB, igual que el seed. */
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

async function main() {
  console.log('🔄 Backfill de negocioId para los registros preexistentes...');

  const slug = (process.env[VARIABLES_MIGRACION.SLUG] ?? '')
    .trim()
    .toLowerCase();
  const lote = Number(process.env[VARIABLES_MIGRACION.LOTE] ?? 1000);

  if (!slug) {
    throw new Error(
      'NEGOCIO_INICIAL_SLUG es obligatoria: identifica el negocio al que asignar los registros',
    );
  }

  const prisma = crearPrisma();

  try {
    const negocio = await prisma.negocio.findUnique({
      where: { slug },
      select: { id: true, slug: true, nombre: true },
    });

    if (!negocio) {
      throw new Error(
        `No existe un negocio con el slug '${slug}'. Ejecuta antes la inicialización del primer negocio.`,
      );
    }

    console.log(
      `🎯 Negocio destino: id=${negocio.id} slug='${negocio.slug}' nombre='${negocio.nombre}'`,
    );
    console.log(`📦 Tamaño de lote: ${lote} filas.`);

    const resultado = await ejecutarBackfillNegocio(
      async (tabla, tamanoLote, negocioId) =>
        prisma.$executeRawUnsafe(
          `UPDATE \`${tabla}\` SET \`negocioId\` = ? WHERE \`negocioId\` IS NULL LIMIT ${tamanoLote}`,
          negocioId,
        ),
      async (tabla, negocioId) => {
        const filas = await prisma.$queryRawUnsafe<
          Array<{ total: number; delNegocio: number; sinNegocio: number }>
        >(
          `SELECT COUNT(*) AS total,
                  SUM(CASE WHEN \`negocioId\` = ? THEN 1 ELSE 0 END) AS delNegocio,
                  SUM(CASE WHEN \`negocioId\` IS NULL THEN 1 ELSE 0 END) AS sinNegocio
             FROM \`${tabla}\``,
          negocioId,
        );

        const conteo = filas[0];

        return {
          total: Number(conteo?.total ?? 0),
          delNegocio: Number(conteo?.delNegocio ?? 0),
          sinNegocio: Number(conteo?.sinNegocio ?? 0),
        };
      },
      negocio.id,
      lote,
    );

    console.log('');
    console.log('📊 Resumen del backfill:');
    for (const conteo of resultado.conteos) {
      console.log(
        `   - ${conteo.etiqueta.padEnd(22)} total=${String(conteo.total).padStart(7)} ` +
          `asignadas=${String(conteo.delNegocio).padStart(7)} ` +
          `sin negocio=${String(conteo.sinNegocio).padStart(7)}`,
      );
    }

    const pendientes = resultado.conteos.filter(
      (conteo) => conteo.sinNegocio > 0,
    );

    if (pendientes.length > 0) {
      throw new Error(
        `El backfill dejó registros sin negocio: ${pendientes
          .map((conteo) => `${conteo.etiqueta}: ${conteo.sinNegocio}`)
          .join(', ')}`,
      );
    }

    console.log(
      '🎉 Backfill completado: no queda ningún registro sin negocio en los modelos por negocio.',
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error('❌ Error en el backfill de negocioId:', e);
  process.exit(1);
});
