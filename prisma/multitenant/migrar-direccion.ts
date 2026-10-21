import 'dotenv/config';
import { PrismaClient } from '../../generated/prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import {
  CLAVE_DIRECCION_HEREDADA,
  decidirTransferenciaDireccion,
  dependeDelRespaldoHeredado,
  EstadoDireccionNegocio,
} from '../../src/modules/negocios/migracion/migracion-direccion.service';

/**
 * MIGRACIÓN CONTROLADA DE LA DIRECCIÓN COMERCIAL (Fase 16).
 *
 * Traslada el valor heredado de la clave `negocio_direccion` al campo
 * `PerfilNegocio.direccion`, que pasa a ser la fuente canónica.
 *
 * GARANTÍAS
 * ---------
 * - IDEMPOTENTE: se puede ejecutar tantas veces como se quiera; la segunda
 *   vez no hace nada (el perfil ya tiene dirección).
 * - NUNCA SOBRESCRIBE: si el perfil ya tiene una dirección, se conserva. La
 *   fuente canónica siempre gana.
 * - NO INVENTA: un valor heredado vacío (o sin texto) no es una dirección: no
 *   se copia nada. Un valor vacío puede ser el valor por defecto de la
 *   siembra, no una decisión del propietario.
 * - NO BORRA NADA: el valor heredado se CONSERVA. La retirada de la clave es
 *   un paso posterior, explícito y manual, una vez comprobada la evidencia
 *   que imprime este comando (`--verificar`).
 * - NO ES AMBIGUO: si un negocio tiene las dos direcciones distintas, gana la
 *   del perfil y se informa.
 *
 * Variables de entorno:
 *   DIRECCION_MIGRACION_AUTORIZADA=1  Autorización explícita (obligatoria).
 *   PERMITIR_BASE_LEGADA=1            Permite actuar sobre `bd_barberia`.
 *   VERIFICAR_DIRECCION=1             Solo informa: NO escribe nada.
 *
 * Por defecto solo actúa sobre `bd_barberia_multitenant_dev`.
 *
 * Códigos de salida: 0 = correcto (con o sin transferencias); 1 = error.
 */

const ENV_AUTORIZACION = 'DIRECCION_MIGRACION_AUTORIZADA';
const ENV_PERMITIR_BASE_LEGADA = 'PERMITIR_BASE_LEGADA';
const ENV_SOLO_VERIFICAR = 'VERIFICAR_DIRECCION';

const BASE_PERMITIDA = 'bd_barberia_multitenant_dev';
const BASE_LEGADA = 'bd_barberia';

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

async function main() {
  console.log('📍 Migración controlada de la dirección comercial (Fase 16)...');

  if (process.env[ENV_AUTORIZACION] !== '1') {
    throw new Error(
      `Esta migración es explícita y exige autorización. Define ` +
        `${ENV_AUTORIZACION}=1 para ejecutarla.`,
    );
  }

  const url = new URL(process.env.DATABASE_URL!);
  const base = decodeURIComponent(url.pathname.substring(1));

  if (base === BASE_LEGADA && process.env[ENV_PERMITIR_BASE_LEGADA] !== '1') {
    throw new Error(
      `Este comando no se ejecuta sobre "${BASE_LEGADA}" sin autorización ` +
        `explícita (${ENV_PERMITIR_BASE_LEGADA}=1).`,
    );
  }

  if (base !== BASE_PERMITIDA && base !== BASE_LEGADA) {
    throw new Error(
      `Este comando solo actúa sobre "${BASE_PERMITIDA}" (o "${BASE_LEGADA}" con ` +
        `autorización explícita). La base actual es "${base}".`,
    );
  }

  const soloVerificar = process.env[ENV_SOLO_VERIFICAR] === '1';
  const prisma = crearPrisma();

  try {
    // El modelo `PerfilNegocio` debe existir: sin él no hay destino.
    const existePerfil = await prisma.$queryRawUnsafe<
      Array<{ total: number }>
    >(
      `SELECT COUNT(*) AS total FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'perfiles_negocio'`,
    );

    if (Number(existePerfil[0]?.total ?? 0) === 0) {
      throw new Error(
        'La base no tiene la tabla `perfiles_negocio`: aplica primero las ' +
          'migraciones (npm run db:migrate:dev).',
      );
    }

    const negocios = await prisma.negocio.findMany({
      orderBy: { id: 'asc' },
      select: { id: true, slug: true, nombre: true, estado: true },
    });

    const estados: EstadoDireccionNegocio[] = [];

    for (const negocio of negocios) {
      const [perfil, heredada] = await Promise.all([
        prisma.perfilNegocio.findUnique({
          where: { negocioId: negocio.id },
          select: { direccion: true },
        }),
        prisma.configuracionNegocio.findUnique({
          where: {
            negocioId_clave: {
              negocioId: negocio.id,
              clave: CLAVE_DIRECCION_HEREDADA,
            },
          },
          select: { valor: true },
        }),
      ]);

      estados.push({
        slug: negocio.slug,
        nombre: negocio.nombre,
        estado: negocio.estado,
        direccionPerfil: perfil?.direccion ?? null,
        direccionHeredada: heredada?.valor ?? null,
        tienePerfil: perfil !== null,
      });
    }

    let transferidas = 0;
    let conservadas = 0;
    let omitidas = 0;

    console.log('');
    console.log('📋 Decisión por negocio:');

    for (const [indice, estado] of estados.entries()) {
      const negocio = negocios[indice];
      const decision = decidirTransferenciaDireccion(estado);

      if (decision.accion === 'conservar') {
        conservadas += 1;
        console.log(`   🔒 ${estado.slug}: ${decision.motivo}`);
        continue;
      }

      if (decision.accion === 'omitir') {
        omitidas += 1;
        console.log(`   ⏭️  ${estado.slug}: ${decision.motivo}`);
        continue;
      }

      if (soloVerificar) {
        console.log(
          `   🔍 ${estado.slug}: se transferiria la dirección heredada ` +
            `('${decision.direccion}'). ${decision.motivo}`,
        );
        continue;
      }

      // Solo se escribe el campo `direccion`: el resto del perfil no se toca.
      await prisma.perfilNegocio.upsert({
        where: { negocioId: negocio.id },
        update: { direccion: decision.direccion },
        create: {
          negocioId: negocio.id,
          direccion: decision.direccion,
        },
      });

      transferidas += 1;
      console.log(
        `   ✅ ${estado.slug}: dirección transferida al perfil. ${decision.motivo}`,
      );
    }

    const dependientes = estados.filter((estado) =>
      dependeDelRespaldoHeredado(estado),
    );

    console.log('');
    console.log(
      `   Transferidas: ${transferidas} | Conservadas: ${conservadas} | Omitidas: ${omitidas}`,
    );
    console.log(
      `   El valor heredado (${CLAVE_DIRECCION_HEREDADA}) NO se ha eliminado: ` +
        'se conserva hasta verificar la transferencia.',
    );

    if (dependientes.length > 0) {
      console.log('');
      console.log(
        `⏳ Negocios que SIGUEN dependiendo del respaldo heredado (${dependientes.length}): ` +
          dependientes.map((n) => n.slug).join(', '),
      );
      console.log(
        '   No se puede retirar la clave heredada hasta que esta lista esté vacía.',
      );
    } else {
      console.log('');
      console.log(
        '✅ En ESTA base ningún negocio depende del respaldo heredado. Antes de ' +
          'retirar la clave hay que repetir esta comprobación en el resto de ' +
          'entornos (por ejemplo, la base legada) y eliminar sus filas a mano.',
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e: unknown) => {
  const mensaje = e instanceof Error ? e.message : String(e);
  console.error('❌ Error en la migración de la dirección:', mensaje);
  process.exit(1);
});
