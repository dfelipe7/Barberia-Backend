import 'dotenv/config';
import { PrismaClient } from '../../generated/prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';

/**
 * ASIGNACIÓN EXPLÍCITA DE LOS FUNDADORES DE UNA BARBERÍA (Fase 10).
 *
 * Comando IDEMPOTENTE y VERIFICABLE que configura las MEMBRESÍAS
 * administrativas de las barberías, en particular el carácter SUPERADMIN de
 * un negocio.
 *
 * Por qué es un COMANDO y no el arranque de la aplicación:
 *   - el SUPERADMIN es un rol de NEGOCIO (la membresía
 *     `Administrador.superadmin`): concederlo es una decisión explícita, no
 *     un efecto secundario de arrancar el servidor;
 *   - el arranque no debe crear personas ni promover a nadie.
 *
 * Qué hace (y qué NO hace):
 *   - Comprueba que el negocio de destino EXISTE y está ACTIVO.
 *   - Identifica a cada persona por su CORREO CANÓNICO, de forma
 *     inequívoca: si no hay coincidencia exacta pero existe una cuenta con el
 *     mismo alias local en otro dominio, la asignación queda PENDIENTE (no se
 *     adivina y no se modifica nada).
 *   - NO cambia correos, nombres, apellidos, `googleId` ni el `rol` global de
 *     una persona existente.
 *   - NO otorga membresías en negocios que no se indiquen de forma expresa.
 *   - NO elimina ni revoca membresías existentes.
 *
 * Configuración (variable de entorno, formato `correo:slug:rol`):
 *   FUNDADORES="duvan@correo.com:kyrios-studio:superadmin,javier@correo.com:kyrios-studio:superadmin"
 *
 * Roles admitidos: `superadmin` (SUPERADMIN de ese negocio) y
 * `administrador` (ADMINISTRADOR de ese negocio).
 *
 * Códigos de salida: 0 = todo aplicado; 2 = aplicado con PENDIENTES;
 * 1 = error (no se aplicó nada).
 */

const ENV_FUNDADORES = 'FUNDADORES';
const ENV_PERMITIR_BASE_LEGADA = 'PERMITIR_BASE_LEGADA';
const BASE_LEGADA = 'bd_barberia';

type RolFundador = 'superadmin' | 'administrador';

interface Asignacion {
  email: string;
  slug: string;
  rol: RolFundador;
}

type Resultado =
  | { estado: 'aplicada'; email: string; slug: string; detalle: string }
  | { estado: 'pendiente'; email: string; slug: string; detalle: string }
  | { estado: 'error'; email: string; slug: string; detalle: string };

/** Crea el cliente Prisma con el adaptador MariaDB, igual que el seed. */
function crearPrisma(): PrismaClient {
  const url = new URL(process.env.DATABASE_URL!);
  const adapter = new PrismaMariaDb({
    host: url.hostname,
    port: Number(url.port),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.substring(1),
    connectionLimit: 2,
  });

  return new PrismaClient({ adapter });
}

/** Lee y valida la variable `FUNDADORES`. */
function leerAsignaciones(): Asignacion[] {
  const bruto = process.env[ENV_FUNDADORES]?.trim() ?? '';

  if (!bruto) {
    throw new Error(
      `Define ${ENV_FUNDADORES} con el formato "correo:slug:rol" (ejemplo: "duvan@correo.com:kyrios-studio:superadmin").`,
    );
  }

  return bruto
    .split(',')
    .map((parte) => parte.trim())
    .filter(Boolean)
    .map((parte) => {
      const [email, slug, rol] = parte.split(':').map((v) => v.trim());

      if (!email || !slug || !rol) {
        throw new Error(
          `Asignación inválida "${parte}". El formato es "correo:slug:rol".`,
        );
      }

      if (rol !== 'superadmin' && rol !== 'administrador') {
        throw new Error(
          `Rol inválido "${rol}" para ${email}. Admite "superadmin" o "administrador".`,
        );
      }

      return { email: email.toLowerCase(), slug, rol };
    });
}

/**
 * Alias local de un correo (la parte anterior a `@`).
 *
 * Sirve para detectar cuentas "casi idénticas" (por ejemplo, el correo
 * histórico con el dominio equivocado): en ese caso la asignación queda
 * PENDIENTE en lugar de crear una identidad duplicada.
 */
function aliasLocal(email: string): string {
  return email.split('@')[0]?.trim().toLowerCase() ?? '';
}

async function main() {
  const url = new URL(process.env.DATABASE_URL!);
  const base = url.pathname.substring(1);

  // SALVAGUARDA: la base legada `bd_barberia` no es destino de este comando
  // (no tiene historial de migraciones). Se puede forzar de forma explícita.
  if (base === BASE_LEGADA && process.env[ENV_PERMITIR_BASE_LEGADA] !== '1') {
    throw new Error(
      `Este comando no se ejecuta sobre "${BASE_LEGADA}" (base legada, sin historial de migraciones). ` +
        `Usa la base multitenant de desarrollo o define ${ENV_PERMITIR_BASE_LEGADA}=1 si es deliberado.`,
    );
  }

  const asignaciones = leerAsignaciones();
  const prisma = crearPrisma();
  const resultados: Resultado[] = [];

  try {
    for (const asignacion of asignaciones) {
      const { email, slug, rol } = asignacion;

      // 1) El negocio de destino debe existir y estar ACTIVO.
      const negocio = await prisma.negocio.findUnique({
        where: { slug },
        select: { id: true, slug: true, nombre: true, estado: true },
      });

      if (!negocio) {
        resultados.push({
          estado: 'error',
          email,
          slug,
          detalle: `El negocio '${slug}' no existe.`,
        });
        continue;
      }

      if (negocio.estado !== 'ACTIVO') {
        resultados.push({
          estado: 'error',
          email,
          slug,
          detalle: `El negocio '${slug}' no está ACTIVO (${negocio.estado}).`,
        });
        continue;
      }

      // 2) Identificación INEQUÍVOCA de la persona por su correo.
      const usuario = await prisma.usuario.findUnique({
        where: { email },
        select: { id: true, email: true, rol: true, estado: true },
      });

      if (!usuario) {
        const alias = aliasLocal(email);
        const candidatos = await prisma.usuario.findMany({
          where: { email: { contains: alias } },
          select: { email: true },
        });

        if (candidatos.length > 0) {
          // Hay una cuenta parecida pero NO idéntica: no se adivina.
          resultados.push({
            estado: 'pendiente',
            email,
            slug,
            detalle:
              `No hay coincidencia exacta con '${email}', pero existen cuentas similares ` +
              `(${candidatos.map((c) => c.email).join(', ')}). No se crea ni se modifica nada: ` +
              'confirma la identidad y repite la asignación.',
          });
          continue;
        }

        resultados.push({
          estado: 'pendiente',
          email,
          slug,
          detalle:
            `La persona '${email}' no está registrada. No se crea automáticamente: ` +
            'regístrala (por ejemplo, con su primer acceso autorizado) y repite la asignación.',
        });
        continue;
      }

      // 3) Membresía: se crea o se ajusta SOLO en el negocio indicado.
      const membresia = await prisma.administrador.findUnique({
        where: {
          negocioId_usuarioId: { negocioId: negocio.id, usuarioId: usuario.id },
        },
        select: { id: true, superadmin: true, estado: true },
      });

      const superadmin = rol === 'superadmin';

      if (membresia) {
        if (membresia.superadmin !== superadmin) {
          await prisma.administrador.update({
            where: { id: membresia.id },
            data: { superadmin },
          });
          resultados.push({
            estado: 'aplicada',
            email,
            slug,
            detalle: `Membresía actualizada a ${rol.toUpperCase()} en '${slug}'.`,
          });
        } else {
          await prisma.administrador.update({
            where: { id: membresia.id },
            data: { estado: 'ACTIVO' },
          });
          resultados.push({
            estado: 'aplicada',
            email,
            slug,
            detalle: `Membresía ya correcta (${rol.toUpperCase()} en '${slug}'): no se cambió nada.`,
          });
        }
      } else {
        await prisma.administrador.create({
          data: {
            usuarioId: usuario.id,
            negocioId: negocio.id,
            estado: 'ACTIVO',
            superadmin,
          },
        });
        resultados.push({
          estado: 'aplicada',
          email,
          slug,
          detalle: `Membresía creada como ${rol.toUpperCase()} de '${slug}'.`,
        });
      }

      // 4) INFORMACIÓN: otras membresías del persona. No se tocan.
      const otras = await prisma.administrador.findMany({
        where: { usuarioId: usuario.id, negocioId: { not: negocio.id } },
        select: { negocio: { select: { slug: true } } },
      });

      if (otras.length > 0) {
        resultados.push({
          estado: 'aplicada',
          email,
          slug,
          detalle: `La persona ya tiene membresía en ${otras
            .map((o) => `'${o.negocio.slug}'`)
            .join(', ')}: no se ha modificado nada allí.`,
        });
      }
    }
  } finally {
    await prisma.$disconnect();
  }

  console.log('');
  console.log('📋 Resultado de la asignación de fundadores:');
  for (const resultado of resultados) {
    const marca =
      resultado.estado === 'aplicada'
        ? '✅'
        : resultado.estado === 'pendiente'
          ? '⏳'
          : '❌';
    console.log(
      `   ${marca} [${resultado.estado.toUpperCase()}] ${resultado.email} -> ${resultado.slug}: ${resultado.detalle}`,
    );
  }

  const errores = resultados.filter((r) => r.estado === 'error');
  const pendientes = resultados.filter((r) => r.estado === 'pendiente');
  const aplicadas = resultados.filter((r) => r.estado === 'aplicada');

  console.log('');
  console.log(
    `   Aplicadas: ${aplicadas.length} | Pendientes: ${pendientes.length} | Errores: ${errores.length}`,
  );

  if (errores.length > 0) {
    console.log('❌ Hay errores: revisa las asignaciones antes de continuar.');
    process.exit(1);
  }

  if (pendientes.length > 0) {
    console.log(
      '⏳ Hay asignaciones PENDIENTES: no se ha adivinado ninguna identidad ni se ha modificado ninguna fila por ellas.',
    );
    process.exit(2);
  }

  console.log('🎉 Todas las membresías quedaron configuradas.');
}

main().catch((e: unknown) => {
  const mensaje = e instanceof Error ? e.message : String(e);
  console.error('❌ Error en la asignación de fundadores:', mensaje);
  process.exit(1);
});
