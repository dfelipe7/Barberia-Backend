import 'dotenv/config';
import { PrismaClient } from '../../generated/prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { EstadoNegocio, TipoConfiguracion } from '../../generated/prisma/enums';
import {
  CLAVES_CONFIGURACION_OPERATIVA,
  MODELOS_CON_NEGOCIO,
  NEGOCIO_BACKFILL_LOTE_ENV,
  NEGOCIO_INICIAL_NOMBRE_ENV,
  NEGOCIO_INICIAL_SLUG_ENV,
} from '../../src/modules/negocios/migracion/migracion-negocio.constants';
import {
  decidirConfiguracionOperativa,
  decidirInicializacion,
  ejecutarBackfill,
  reconciliar,
} from '../../src/modules/negocios/migracion/migracion-negocio.service';

/**
 * MIGRACIÓN DE DATOS AL MODELO MULTITENANT (Fase 2).
 *
 * Script IDEMPOTENTE que realiza los tres pasos de la migración de los datos
 * preexistentes al modelo de negocios:
 *
 *   1. INICIALIZACIÓN: crea el primer negocio con el nombre y el `slug`
 *      indicados por el operador. Si ya existe (mismo `slug`), NO lo duplica
 *      ni sobrescribe su nombre o estado. Si ya hay negocios con OTRO slug, se
 *      detiene: este mecanismo es solo para el primer negocio de una
 *      plataforma nueva.
 *   2. CONFIGURACIONES: copia las configuraciones operativas de
 *      `configuraciones_sistema` a `configuraciones_negocio`, RESPETANDO el
 *      valor que un administrador haya personalizado en el ámbito del
 *      negocio: solo rellena las claves que falten.
 *   3. BACKFILL: asigna el negocio a todos los registros preexistentes que
 *      aún no lo tienen, por lotes.
 *
 * Al final imprime la RECONCILIACIÓN: conteos por modelo y comprobación de
 * que no queda ninguna fila sin negocio.
 *
 * Variables de entorno obligatorias:
 *   NEGOCIO_INICIAL_NOMBRE  Nombre público del primer negocio.
 *   NEGOCIO_INICIAL_SLUG    Slug público y estable (a-z, 0-9 y guiones).
 * Variables de entorno opcionales:
 *   NEGOCIO_BACKFILL_LOTE   Filas por lote del backfill (por defecto 1000).
 *
 * Requisitos previos (ver `MULTITENANT.md` §4):
 *   1. Las migraciones de la Fase 1 están aplicadas.
 *   2. Hay un respaldo verificado y restaurable de la base de datos.
 *
 * NO se ejecuta automáticamente: se invoca de forma explícita por una persona
 * autorizada, con la aplicación en ventana de mantenimiento.
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
  console.log('🏪 Migración de datos al modelo multitenant (Fase 2)...');

  const nombre = process.env[NEGOCIO_INICIAL_NOMBRE_ENV] ?? '';
  const slug = process.env[NEGOCIO_INICIAL_SLUG_ENV] ?? '';
  const lote = Number(process.env[NEGOCIO_BACKFILL_LOTE_ENV] ?? 1000);

  const prisma = crearPrisma();

  try {
    // --- 1. INICIALIZACIÓN (idempotente) --------------------------------
    const negocioConSlug = await prisma.negocio.findUnique({
      where: { slug: slug.trim().toLowerCase() },
      select: { id: true, slug: true, nombre: true },
    });

    const totalNegocios = await prisma.negocio.count();

    const decision = decidirInicializacion(
      { nombre, slug },
      { negocioConSlug: negocioConSlug ?? undefined, totalNegocios },
    );

    if (decision.accion === 'rechazar') {
      throw new Error(decision.motivo);
    }

    let negocioId: number;

    if (decision.accion === 'reutilizar') {
      negocioId = decision.negocioId;
      console.log(
        `ℹ️ El negocio con slug '${decision.slug}' ya existe (id=${negocioId}). ` +
          'No se duplica ni se sobrescribe su nombre ni su estado.',
      );
    } else {
      const creado = await prisma.negocio.create({
        data: {
          slug: decision.slug,
          nombre: decision.nombre,
          estado: EstadoNegocio.ACTIVO,
        },
        select: { id: true },
      });

      negocioId = creado.id;
      console.log(
        `✅ Negocio inicial creado: id=${negocioId} slug='${decision.slug}' nombre='${decision.nombre}'`,
      );
    }

    // --- 2. CONFIGURACIONES OPERATIVAS AL ÁMBITO DEL NEGOCIO ------------
    for (const config of CLAVES_CONFIGURACION_OPERATIVA) {
      const [global, enNegocio] = await Promise.all([
        prisma.configuracionSistema.findUnique({
          where: { clave: config.clave },
          select: { valor: true, tipo: true, descripcion: true },
        }),
        prisma.configuracionNegocio.findUnique({
          where: { negocioId_clave: { negocioId, clave: config.clave } },
          select: { valor: true },
        }),
      ]);

      const decisionConfig = decidirConfiguracionOperativa(config, {
        valorEnNegocio: enNegocio ?? undefined,
        valorGlobal: global ?? undefined,
      });

      if (decisionConfig.accion === 'conservar') {
        // Se conserva el valor: puede estar personalizado por un
        // administrador y no debe sobrescribirse.
        console.log(
          `🔒 Configuración '${config.clave}' ya existe en el negocio (valor='${decisionConfig.valor}'): se conserva.`,
        );
        continue;
      }

      await prisma.configuracionNegocio.create({
        data: {
          negocioId,
          clave: config.clave,
          valor: decisionConfig.valor,
          tipo:
            (decisionConfig.tipo as
              | (typeof TipoConfiguracion)[keyof typeof TipoConfiguracion]
              | undefined) ?? TipoConfiguracion.NUMERO,
          descripcion: decisionConfig.descripcion,
          editable: true,
        },
      });

      console.log(
        `⚙️ Configuración '${config.clave}' copiada al ámbito del negocio (valor='${decisionConfig.valor}').`,
      );
    }

    // --- 3. BACKFILL DE `negocioId` (por lotes, idempotente) ------------
    console.log(`📦 Backfill por lotes de ${lote} filas.`);

    const resultado = await ejecutarBackfill(
      async (tabla, tamanoLote, id) =>
        prisma.$executeRawUnsafe(
          `UPDATE \`${tabla}\` SET \`negocioId\` = ? WHERE \`negocioId\` IS NULL LIMIT ${tamanoLote}`,
          id,
        ),
      async (tabla) => {
        const filas = await prisma.$queryRawUnsafe<Array<{ total: number }>>(
          `SELECT COUNT(*) AS total FROM \`${tabla}\` WHERE \`negocioId\` IS NULL`,
        );
        return Number(filas[0]?.total ?? 0);
      },
      negocioId,
      lote,
    );

    for (const linea of resultado.actualizadasPorModelo) {
      console.log(
        `✅ ${linea.tabla.padEnd(24)} ${linea.actualizadas} registro(s) asignado(s) al negocio ${negocioId}.`,
      );
    }

    // --- 4. RECONCILIACIÓN -----------------------------------------------
    console.log('');
    console.log('📊 Reconciliación:');

    for (const modelo of MODELOS_CON_NEGOCIO) {
      const filas = await prisma.$queryRawUnsafe<
        Array<{ total: number; delNegocio: number; sinNegocio: number }>
      >(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN \`negocioId\` = ? THEN 1 ELSE 0 END) AS delNegocio,
                SUM(CASE WHEN \`negocioId\` IS NULL THEN 1 ELSE 0 END) AS sinNegocio
           FROM \`${modelo.tabla}\``,
        negocioId,
      );

      const conteo = filas[0];
      console.log(
        `   ${modelo.tabla.padEnd(24)} total=${String(Number(conteo?.total ?? 0)).padStart(7)} asignadas=${String(Number(conteo?.delNegocio ?? 0)).padStart(7)} sin negocio=${String(Number(conteo?.sinNegocio ?? 0)).padStart(7)}`,
      );
    }

    const reconciliacion = reconciliar(resultado);

    console.log('');
    console.log(
      `   Total de registros asignados al negocio ${negocioId}: ${resultado.total}`,
    );

    if (!reconciliacion.correcto) {
      throw new Error(reconciliacion.mensaje);
    }

    console.log(`🎉 ${reconciliacion.mensaje}.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error('❌ Error en la migración de datos al modelo multitenant:', e);
  process.exit(1);
});
