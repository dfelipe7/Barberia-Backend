import 'dotenv/config';
import { PrismaClient } from '../../generated/prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import {
  ClienteMigracion,
  inicializarPrimerNegocio,
} from '../../src/modules/negocios/migracion/migracion-negocio.service';
import { VARIABLES_MIGRACION } from '../../src/modules/negocios/migracion/migracion-negocio.constants';

/**
 * INICIALIZACIÓN IDEMPOTENTE DEL PRIMER NEGOCIO (Fase 2 del plan multitenant).
 *
 * 1. Crea el negocio inicial con el nombre y el `slug` indicados por
 *    `NEGOCIO_INICIAL_NOMBRE` y `NEGOCIO_INICIAL_SLUG`. Si ya existe (mismo
 *    `slug`), NO lo duplica ni sobrescribe su nombre o estado.
 * 2. Copia las configuraciones operativas de `configuraciones_sistema` al
 *    ámbito del negocio (`configuraciones_negocio`), RESPETANDO el valor ya
 *    personalizado por los administradores: solo rellena las claves que
 *    falten.
 *
 * NO ejecuta el backfill de `negocioId` de los registros preexistentes: eso
 * es un paso aparte (`backfill-negocio.ts`), porque requiere reconciliación
 * entre ambos.
 *
 * Variables de entorno obligatorias:
 *   NEGOCIO_INICIAL_NOMBRE         Nombre público del negocio.
 *   NEGOCIO_INICIAL_SLUG           Identificador público y estable.
 * Variables de entorno opcionales:
 *   NEGOCIO_INICIAL_ZONA_HORARIA   Zona horaria (por defecto `America/Bogota`).
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
  console.log('🏪 Inicializando el primer negocio (Fase 2)...');

  const nombre = process.env[VARIABLES_MIGRACION.NOMBRE] ?? '';
  const slug = process.env[VARIABLES_MIGRACION.SLUG] ?? '';
  const zonaHoraria = process.env[VARIABLES_MIGRACION.ZONA_HORARIA];

  const prisma = crearPrisma();

  try {
    // El cliente real cumple el contrato del servicio; el cast es seguro
    // porque el servicio solo usa los métodos descritos en `ClienteMigracion`.
    const cliente = prisma as unknown as ClienteMigracion;

    const resultado = await inicializarPrimerNegocio(cliente, {
      nombre,
      slug,
      zonaHoraria,
    });

    if (resultado.creado) {
      console.log(
        `✅ Negocio inicial creado: id=${resultado.negocioId} slug='${resultado.slug}'`,
      );
    } else {
      console.log(
        `ℹ️ El negocio con slug '${resultado.slug}' ya existía (id=${resultado.negocioId}). ` +
          'No se duplica ni se sobrescribe su nombre ni su estado.',
      );
    }

    for (const clave of resultado.configuracionesCopiadas) {
      console.log(`⚙️ Configuración '${clave}' copiada al ámbito del negocio.`);
    }

    for (const clave of resultado.configuracionesConservadas) {
      console.log(
        `🔒 Configuración '${clave}' ya existía en el ámbito del negocio: se conserva su valor.`,
      );
    }

    console.log(
      '🎉 Inicialización completada. El backfill de negocioId de los registros ' +
        'preexistentes es un paso aparte (backfill-negocio.ts).',
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error('❌ Error en la inicialización del primer negocio:', e);
  process.exit(1);
});
