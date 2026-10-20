import 'dotenv/config';
import { PrismaClient } from '../../generated/prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import {
  CLAVES_CONFIGURACION_OPERATIVA,
  MODELOS_CON_NEGOCIO,
  VARIABLES_MIGRACION,
} from '../../src/modules/negocios/migracion/migracion-negocio.constants';

/**
 * VERIFICACIÓN DE RECONCILIACIÓN (Fase 2).
 *
 * Compara el estado de la base de datos con lo esperado tras el backfill y
 * comprueba que NO se ha perdido ni mezclado información. Es de solo lectura:
 * no modifica ningún dato.
 *
 * Qué comprueba:
 *  1. Coherencia de conteos: en cada modelo por negocio, el total de filas
 *     debe ser la suma de "asignadas al negocio" + "sin negocio" + "asignadas
 *     a otro negocio".
 *  2. Ausencia de huérfanos: toda reserva debe apuntar a registros del
 *     MISMO negocio. Es la comprobación que detecta una mezcla de negocios.
 *  3. Integridad de las relaciones: ningún vínculo barbero-servicio puede
 *     cruzar negocios.
 *  4. Configuraciones: las claves operativas existen en el ámbito del
 *     negocio y su valor coincide con el que tenía en el ámbito global, salvo
 *     que un administrador lo haya personalizado.
 *
 * Sale con código 1 si alguna comprobación falla, de modo que pueda usarse
 * como puerta en un pipeline.
 *
 * Variables de entorno obligatorias:
 *   NEGOCIO_INICIAL_SLUG  Slug del negocio a verificar.
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
  console.log('🔍 Verificación de reconciliación (solo lectura)...');

  const slug = (process.env[VARIABLES_MIGRACION.SLUG] ?? '')
    .trim()
    .toLowerCase();

  if (!slug) {
    throw new Error('NEGOCIO_INICIAL_SLUG es obligatoria');
  }

  const prisma = crearPrisma();
  const fallos: string[] = [];
  const avisos: string[] = [];

  try {
    const negocio = await prisma.negocio.findUnique({
      where: { slug },
      select: { id: true, slug: true, nombre: true },
    });

    if (!negocio) {
      throw new Error(
        `No existe un negocio con el slug '${slug}': ejecuta antes la inicialización.`,
      );
    }

    console.log(
      `🎯 Negocio verificado: id=${negocio.id} slug='${negocio.slug}' nombre='${negocio.nombre}'`,
    );
    console.log('');

    // --- 1. Coherencia de conteos -----------------------------------------
    console.log('📊 Conteos por modelo:');
    console.log(
      `   ${'modelo'.padEnd(22)}${'total'.padStart(9)}${'negocio'.padStart(9)}${'sin negocio'.padStart(13)}${'otros'.padStart(7)}`,
    );

    for (const modelo of MODELOS_CON_NEGOCIO) {
      const filas = await prisma.$queryRawUnsafe<
        Array<{
          total: number;
          delNegocio: number;
          sinNegocio: number;
          otros: number;
        }>
      >(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN \`negocioId\` = ? THEN 1 ELSE 0 END) AS delNegocio,
                SUM(CASE WHEN \`negocioId\` IS NULL THEN 1 ELSE 0 END) AS sinNegocio,
                SUM(CASE WHEN \`negocioId\` IS NOT NULL AND \`negocioId\` <> ? THEN 1 ELSE 0 END) AS otros
           FROM \`${modelo.tabla}\``,
        negocio.id,
        negocio.id,
      );

      const conteo = filas[0];
      const total = Number(conteo?.total ?? 0);
      const delNegocio = Number(conteo?.delNegocio ?? 0);
      const sinNegocio = Number(conteo?.sinNegocio ?? 0);
      const otros = Number(conteo?.otros ?? 0);

      console.log(
        `   ${modelo.etiqueta.padEnd(22)}${String(total).padStart(9)}${String(delNegocio).padStart(9)}${String(sinNegocio).padStart(13)}${String(otros).padStart(7)}`,
      );

      if (delNegocio + sinNegocio + otros !== total) {
        fallos.push(
          `${modelo.etiqueta}: los conteos no suman el total (${delNegocio} + ${sinNegocio} + ${otros} != ${total})`,
        );
      }

      if (sinNegocio > 0) {
        fallos.push(
          `${modelo.etiqueta}: ${sinNegocio} registro(s) sin negocio asignado`,
        );
      }

      if (otros > 0) {
        avisos.push(
          `${modelo.etiqueta}: ${otros} registro(s) asignados a un negocio distinto`,
        );
      }
    }

    // --- 2. Integridad de relaciones (reservas) ----------------------------
    console.log('');
    console.log('🔗 Integridad de relaciones de reservas:');

    const relaciones = [
      { nombre: 'cliente', columna: 'clienteId', tabla: 'Cliente' },
      { nombre: 'servicio', columna: 'servicioId', tabla: 'Servicio' },
      { nombre: 'barbero', columna: 'barberoId', tabla: 'Barbero' },
    ];

    for (const relacion of relaciones) {
      // Reserva cuyo negocio NO coincide con el de su entidad relacionada.
      const mezcladas = await prisma.$queryRawUnsafe<Array<{ total: number }>>(
        `SELECT COUNT(*) AS total
           FROM \`reservations\` r
           JOIN \`${relacion.tabla}\` t ON t.\`id\` = r.\`${relacion.columna}\`
          WHERE r.\`negocioId\` IS NOT NULL
            AND t.\`negocioId\` IS NOT NULL
            AND r.\`negocioId\` <> t.\`negocioId\``,
      );

      // Reserva cuya entidad relacionada todavía no tiene negocio asignado.
      const huerfanas = await prisma.$queryRawUnsafe<Array<{ total: number }>>(
        `SELECT COUNT(*) AS total
           FROM \`reservations\` r
           JOIN \`${relacion.tabla}\` t ON t.\`id\` = r.\`${relacion.columna}\`
          WHERE r.\`negocioId\` IS NOT NULL
            AND t.\`negocioId\` IS NULL`,
      );

      const totalMezcladas = Number(mezcladas[0]?.total ?? 0);
      const totalHuerfanas = Number(huerfanas[0]?.total ?? 0);

      console.log(
        `   ${relacion.nombre.padEnd(10)} mezcladas=${totalMezcladas}  sin negocio=${totalHuerfanas}`,
      );

      if (totalMezcladas > 0) {
        fallos.push(
          `reservas: ${totalMezcladas} reserva(s) conectan con un ${relacion.nombre} de otro negocio`,
        );
      }

      if (totalHuerfanas > 0) {
        fallos.push(
          `reservas: ${totalHuerfanas} reserva(s) conectan con un ${relacion.nombre} sin negocio asignado`,
        );
      }
    }

    // --- 3. Vínculos barbero-servicio --------------------------------------
    const vinculosMezclados = await prisma.$queryRawUnsafe<
      Array<{ total: number }>
    >(
      `SELECT COUNT(*) AS total
         FROM \`BarberoServicio\` bs
         JOIN \`Barbero\` b ON b.\`id\` = bs.\`barberoId\`
         JOIN \`Servicio\` s ON s.\`id\` = bs.\`servicioId\`
        WHERE b.\`negocioId\` IS NOT NULL
          AND s.\`negocioId\` IS NOT NULL
          AND b.\`negocioId\` <> s.\`negocioId\``,
    );

    const totalVinculos = Number(vinculosMezclados[0]?.total ?? 0);
    console.log(
      `   ${'vínculos'.padEnd(10)} barbero-servicio entre negocios=${totalVinculos}`,
    );

    if (totalVinculos > 0) {
      fallos.push(
        `BarberoServicio: ${totalVinculos} vínculo(s) conectan un barbero y un servicio de negocios distintos`,
      );
    }

    // --- 4. Configuraciones operativas ------------------------------------
    console.log('');
    console.log('⚙️ Configuraciones operativas en el ámbito del negocio:');

    for (const config of CLAVES_CONFIGURACION_OPERATIVA) {
      const enNegocio = await prisma.configuracionNegocio.findUnique({
        where: {
          negocioId_clave: { negocioId: negocio.id, clave: config.clave },
        },
        select: { valor: true, tipo: true },
      });

      const global = await prisma.configuracionSistema.findUnique({
        where: { clave: config.clave },
        select: { valor: true },
      });

      if (!enNegocio) {
        fallos.push(
          `configuraciones_negocio: falta la clave '${config.clave}' para el negocio ${negocio.id}`,
        );
        console.log(`   ${config.clave.padEnd(42)} AUSENTE`);
        continue;
      }

      const coincide = global?.valor === enNegocio.valor;
      console.log(
        `   ${config.clave.padEnd(42)} valor='${enNegocio.valor}'${
          coincide ? '' : ' (personalizado)'
        }`,
      );

      if (!coincide) {
        avisos.push(
          `configuraciones_negocio: '${config.clave}' tiene un valor distinto al global (posible personalización)`,
        );
      }
    }

    // --- 5. Negocios duplicados --------------------------------------------
    const totalNegocios = await prisma.negocio.count();
    const negociosConMismoSlug = await prisma.negocio.count({
      where: { slug },
    });

    console.log('');
    console.log(`🏪 Negocios en la plataforma: ${totalNegocios}`);

    if (negociosConMismoSlug > 1) {
      fallos.push(
        `existen ${negociosConMismoSlug} negocios con el slug '${slug}' (debería haber como máximo 1)`,
      );
    }

    // --- Resultado ----------------------------------------------------------
    console.log('');

    for (const aviso of avisos) {
      console.log(`⚠️  ${aviso}`);
    }

    if (fallos.length > 0) {
      console.error('❌ La reconciliación ha encontrado inconsistencias:');
      for (const fallo of fallos) {
        console.error(`   - ${fallo}`);
      }
      process.exitCode = 1;
      return;
    }

    console.log(
      '✅ Reconciliación correcta: los conteos cuadran y no hay mezcla de negocios.',
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error('❌ Error en la verificación de reconciliación:', e);
  process.exit(1);
});
