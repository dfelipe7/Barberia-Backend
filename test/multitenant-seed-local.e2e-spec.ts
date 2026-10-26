import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { MariaDbConnection } from './helpers/mariadb-test-container';
import { PrismaClient } from '../generated/prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaService } from '../src/prisma/prisma.service';
import { NegocioContextoService } from '../src/modules/negocios/negocio-contexto.service';
import { NegocioAislamientoService } from '../src/modules/negocios/negocio-aislamiento.service';
import { NegocioRolesService } from '../src/modules/negocios/service/negocio-roles.service';
import {
  sembrarDesarrolloLocal,
  verificarDestinoDeSeed,
} from '../src/modules/negocios/seed/seed-local-desarrollo.service';

/**
 * SEMILLA DE DESARROLLO LOCAL MULTITENANT CONTRA MYSQL 8.0 REAL (Fase 13).
 *
 * Levanta un contenedor **MySQL 8.0.46 efímero** (el motor del entorno local
 * de desarrollo), aplica las migraciones REALES del proyecto y ejecuta la
 * semilla contra el motor de base de datos. No se usan mocks para las
 * comprobaciones de integridad: todo se verifica con SQL real.
 *
 * Comprueba:
 *  1. Los dos negocios con los slugs previstos.
 *  2. Dos membresías SUPERADMIN por negocio (y solo en su negocio).
 *  3. Dos barberos y tres servicios por negocio.
 *  4. Relaciones BarberoServicio aisladas por negocio (la clave foránea
 *     compuesta lo impide).
 *  5. Horario semanal válido de cada barbero.
 *  6. Ningún usuario obtiene privilegios globales (`Usuario.rol`).
 *  7. Un SUPERADMIN de A NO tiene roles efectivos en B (derivación real de
 *     roles, con la extensión de aislamiento de Prisma).
 *  8. Una segunda ejecución no duplica ni sobrescribe nada.
 *  9. Un conflicto de identidad se detecta y NO se corrige en silencio.
 *
 * Se omite (no falla) si no hay Docker disponible.
 */

const OMITIR_SIN_DOCKER = process.env.MARIADB_TEST_SKIP === '1';

const SLUG_A = 'kyrios-studio';
const SLUG_B = 'barberia-demo-2';

describe('Semilla de desarrollo local multitenant (MySQL 8.0 real)', () => {
  let conexion: MariaDbConnection | undefined;
  let prisma: PrismaClient;
  let prismaServicio: PrismaService;
  let roles: NegocioRolesService;

  beforeAll(async () => {
    if (OMITIR_SIN_DOCKER) {
      return;
    }

    conexion = await MariaDbConnection.start({
      motor: 'mysql',
      lowerCaseTableNames: false,
    });

    execFileSync(
      process.execPath,
      [
        join(__dirname, '..', 'node_modules', 'prisma', 'build', 'index.js'),
        'migrate',
        'deploy',
      ],
      {
        cwd: join(__dirname, '..'),
        env: { ...process.env, DATABASE_URL: conexion.urlBase },
        stdio: 'pipe',
        encoding: 'utf8',
      },
    );

    const url = new URL(conexion.urlBase);
    const adapter = new PrismaMariaDb({
      host: url.hostname,
      port: Number(url.port),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: url.pathname.substring(1),
      connectionLimit: 5,
    });

    prisma = new PrismaClient({ adapter });

    // Cadena REAL de derivación de roles (con la extensión de aislamiento).
    prismaServicio = new PrismaService(
      new ConfigService({ DATABASE_URL: conexion.urlBase }),
    );
    roles = new NegocioRolesService(
      prismaServicio,
      new NegocioAislamientoService(new NegocioContextoService()),
    );
  }, 300000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await prismaServicio?.$disconnect();
    conexion?.stop();
  });

  it('rechaza destinos que no sean la base de desarrollo local', () => {
    expect(
      verificarDestinoDeSeed('mysql://root:root@localhost:3307/bd_barberia').ok,
    ).toBe(false);

    expect(
      verificarDestinoDeSeed(
        'mysql://root:root@prod.up.railway.app:3306/bd_barberia_multitenant_dev',
      ).ok,
    ).toBe(false);

    expect(
      verificarDestinoDeSeed(
        'mysql://root:root@localhost:3308/bd_barberia_multitenant_dev',
      ).ok,
    ).toBe(true);
  });

  it('provisiona las dos barberias con el escenario completo', async () => {
    if (OMITIR_SIN_DOCKER) return;

    const reporte = await sembrarDesarrolloLocal(prisma);

    expect(reporte.negocios).toHaveLength(2);

    const negocios = await prisma.negocio.findMany({
      select: { slug: true, nombre: true, estado: true },
      orderBy: { slug: 'asc' },
    });

    expect(negocios.map((n) => n.slug).sort()).toEqual([SLUG_A, SLUG_B].sort());
    expect(negocios.every((n) => n.estado === 'ACTIVO')).toBe(true);

    for (const conteo of reporte.conteos) {
      expect(conteo.superadmins).toBe(2);
      expect(conteo.barberos).toBe(2);
      expect(conteo.servicios).toBe(3);
      expect(conteo.relaciones).toBe(6);
      expect(conteo.franjas).toBe(40);
    }
  });

  it('guarda el caracter SUPERADMIN en la membresia, no en el rol global', async () => {
    if (OMITIR_SIN_DOCKER) return;

    const negocioA = await prisma.negocio.findUniqueOrThrow({
      where: { slug: SLUG_A },
      select: { id: true },
    });
    const negocioB = await prisma.negocio.findUniqueOrThrow({
      where: { slug: SLUG_B },
      select: { id: true },
    });

    const adminsA = await prisma.administrador.findMany({
      where: { negocioId: negocioA.id },
      select: {
        superadmin: true,
        estado: true,
        usuario: { select: { email: true, rol: true } },
      },
    });

    const adminsB = await prisma.administrador.findMany({
      where: { negocioId: negocioB.id },
      select: {
        superadmin: true,
        estado: true,
        usuario: { select: { email: true, rol: true } },
      },
    });

    expect(adminsA).toHaveLength(2);
    expect(adminsB).toHaveLength(2);
    expect(adminsA.every((a) => a.superadmin)).toBe(true);
    expect(adminsB.every((a) => a.superadmin)).toBe(true);
    expect(adminsA.every((a) => a.estado === 'ACTIVO')).toBe(true);

    // Ningún usuario tiene SUPERADMIN global.
    const globales = await prisma.usuario.count({
      where: { rol: 'SUPERADMIN' },
    });
    expect(globales).toBe(0);

    const conRolGlobal = [...adminsA, ...adminsB].filter(
      (a) => a.usuario.rol !== 'PERSONAL',
    );
    expect(conRolGlobal).toHaveLength(0);

    // Las membresías NO se cruzan entre negocios.
    const usuariosA = adminsA.map((a) => a.usuario.email);
    const usuariosB = adminsB.map((a) => a.usuario.email);
    expect(usuariosA.filter((e) => usuariosB.includes(e))).toHaveLength(0);

    for (const email of usuariosA) {
      const membresias = await prisma.administrador.findMany({
        where: { usuario: { email } },
        select: { negocio: { select: { slug: true } } },
      });
      expect(membresias.map((m) => m.negocio.slug)).toEqual([SLUG_A]);
    }
  });

  it('un SUPERADMIN de A no tiene roles efectivos en B', async () => {
    if (OMITIR_SIN_DOCKER) return;

    const negocioA = await prisma.negocio.findUniqueOrThrow({
      where: { slug: SLUG_A },
      select: { id: true, slug: true },
    });
    const negocioB = await prisma.negocio.findUniqueOrThrow({
      where: { slug: SLUG_B },
      select: { id: true, slug: true },
    });

    const adminA = await prisma.administrador.findFirstOrThrow({
      where: { negocioId: negocioA.id },
      select: { usuarioId: true },
    });

    const rolesEnA = await roles.rolesEfectivos(adminA.usuarioId, negocioA);
    const rolesEnB = await roles.rolesEfectivos(adminA.usuarioId, negocioB);

    expect(rolesEnA).toContain('SUPERADMIN');
    expect(rolesEnB).toEqual([]);
    expect(await roles.perteneceActivo(adminA.usuarioId, negocioB)).toBe(false);
  });

  it('crea barberos, servicios, relaciones y horario dentro de su negocio', async () => {
    if (OMITIR_SIN_DOCKER) return;

    const negocioA = await prisma.negocio.findUniqueOrThrow({
      where: { slug: SLUG_A },
      select: { id: true },
    });

    const barberos = await prisma.barbero.findMany({
      where: { negocioId: negocioA.id },
      select: { id: true, negocioId: true },
    });
    expect(barberos).toHaveLength(2);

    const servicios = await prisma.servicio.findMany({
      where: { negocioId: negocioA.id },
      select: { id: true, nombre: true, negocioId: true },
    });
    expect(servicios.map((s) => s.nombre).sort()).toEqual([
      'Arreglo de barba',
      'Corte clásico',
      'Degradado',
    ]);

    // Cada barbero tiene los 3 servicios de SU negocio.
    for (const barbero of barberos) {
      const relaciones = await prisma.barberoServicio.findMany({
        where: { barberoId: barbero.id },
        select: { servicioId: true, negocioId: true },
      });
      expect(relaciones).toHaveLength(3);
      expect(relaciones.every((r) => r.negocioId === negocioA.id)).toBe(true);
      expect(relaciones.map((r) => r.servicioId).sort()).toEqual(
        servicios.map((s) => s.id).sort(),
      );
    }

    // Horario semanal válido: 5 días x 4 franjas de 60 minutos por barbero.
    for (const barbero of barberos) {
      const franjas = await prisma.barberWeeklySlot.findMany({
        where: { barberoId: barbero.id },
        select: {
          dayOfWeek: true,
          startTime: true,
          endTime: true,
          active: true,
        },
      });
      expect(franjas).toHaveLength(20);
      expect(franjas.every((f) => f.active)).toBe(true);
      expect(new Set(franjas.map((f) => f.dayOfWeek)).size).toBe(5);
      expect(
        franjas.every((f) => {
          const [hI, mI] = f.startTime.split(':').map(Number);
          const [hF, mF] = f.endTime.split(':').map(Number);
          return hF * 60 + mF - (hI * 60 + mI) === 60;
        }),
      ).toBe(true);
    }

    // Configuración operativa PROPIA de cada negocio (no la global).
    const configuraciones = await prisma.configuracionNegocio.findMany({
      where: { negocioId: negocioA.id },
      select: { clave: true, valor: true },
    });
    expect(configuraciones.length).toBeGreaterThan(0);
    expect(
      configuraciones.find(
        (c) => c.clave === 'reserva_cancelacion_antelacion_minutos',
      )?.valor,
    ).toBe('120');
  });

  it('una segunda ejecucion no duplica ni sobrescribe nada', async () => {
    if (OMITIR_SIN_DOCKER) return;

    const negocioA = await prisma.negocio.findUniqueOrThrow({
      where: { slug: SLUG_A },
      select: { id: true },
    });

    // Personalización previa: NO debe sobrescribirse.
    await prisma.servicio.update({
      where: {
        negocioId_nombre: { negocioId: negocioA.id, nombre: 'Corte clásico' },
      },
      data: { precio: 99999 },
    });

    const antes = {
      negocios: await prisma.negocio.count(),
      usuarios: await prisma.usuario.count(),
      administradores: await prisma.administrador.count(),
      barberos: await prisma.barbero.count(),
      servicios: await prisma.servicio.count(),
      relaciones: await prisma.barberoServicio.count(),
      franjas: await prisma.barberWeeklySlot.count(),
    };

    const reporte = await sembrarDesarrolloLocal(prisma);

    const despues = {
      negocios: await prisma.negocio.count(),
      usuarios: await prisma.usuario.count(),
      administradores: await prisma.administrador.count(),
      barberos: await prisma.barbero.count(),
      servicios: await prisma.servicio.count(),
      relaciones: await prisma.barberoServicio.count(),
      franjas: await prisma.barberWeeklySlot.count(),
    };

    expect(despues).toEqual(antes);
    expect(reporte.negocios.every((n) => n.accion === 'reutilizado')).toBe(
      true,
    );

    // El precio personalizado se conserva.
    const servicio = await prisma.servicio.findUniqueOrThrow({
      where: {
        negocioId_nombre: { negocioId: negocioA.id, nombre: 'Corte clásico' },
      },
      select: { precio: true },
    });
    expect(Number(servicio.precio)).toBe(99999);
  });

  it('detecta el conflicto de identidad y no corrige nada en silencio', async () => {
    if (OMITIR_SIN_DOCKER) return;

    // Simula la cuenta con el dominio histórico: el correo canónico deja de
    // existir, pero queda una cuenta "parecida" con el mismo alias local.
    await prisma.usuario.update({
      where: { email: 'armeroduvan8@gmail.com' },
      data: { email: 'armeroduvan8@cuenta-historica.com' },
    });

    const antes = await prisma.usuario.count();

    await expect(sembrarDesarrolloLocal(prisma)).rejects.toThrow(
      /Conflicto de identidad/,
    );

    // No se creó ni se modificó nada: la transacción se revirtió.
    expect(await prisma.usuario.count()).toBe(antes);

    const cuenta = await prisma.usuario.findUniqueOrThrow({
      where: { email: 'armeroduvan8@cuenta-historica.com' },
      select: { id: true, rol: true, googleId: true },
    });
    expect(cuenta.rol).toBe('PERSONAL');
    expect(cuenta.googleId).toBeNull();

    // Sigue teniendo SOLO su membresía original: no se crean perfiles nuevos.
    const membresias = await prisma.administrador.findMany({
      where: { usuarioId: cuenta.id },
      select: { negocio: { select: { slug: true } } },
    });
    expect(membresias.map((m) => m.negocio.slug)).toEqual([SLUG_A]);
  });
});
