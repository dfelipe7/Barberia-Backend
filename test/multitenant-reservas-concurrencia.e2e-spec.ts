import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { MariaDbConnection } from './helpers/mariadb-test-container';
import { PrismaClient } from '../generated/prisma/client';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuthModule } from '../src/auth/auth.module';
import { NegociosModule } from '../src/modules/negocios/negocios.module';
import { NegocioContextoService } from '../src/modules/negocios/negocio-contexto.service';
import { ConfiguracionModule } from '../src/modules/configuracion/configuracion.module';
import { ServiciosModule } from '../src/modules/servicios/servicios.module';
import { UsuariosModule } from '../src/modules/usuarios/usuarios.module';
import { HorariosModule } from '../src/modules/horarios/horarios.module';
import { ReservasInfraModule } from '../src/modules/reservas/reservas-infra.module';
import { ReservasService } from '../src/modules/reservas/service/reservas.service';
import { DisponibilidadService } from '../src/modules/horarios/service/disponibilidad.service';
import { CODIGOS_CONFLICTO } from '../src/common/exceptions/domain-conflict.exception';
import { WeekDay } from '../generated/prisma/enums';

/**
 * CONSISTENCIA DEL FLUJO DE RESERVAS FRENTE A CONCURRENCIA (MySQL 8.0 real).
 *
 * Levanta un contenedor **MySQL 8.0.46 efÃ­mero**, aplica las migraciones
 * REALES y ejecuta el `ReservasService` REAL (con sus repositorios, la
 * extensiÃ³n de aislamiento de Prisma y las reglas de disponibilidad) contra
 * ese motor. No se simula la concurrencia con promesas de mocks: las
 * peticiones realmente compiten por el bloqueo de fila y por el Ã­ndice Ãºnico.
 *
 * Escenarios:
 *  1. Dos solicitudes concurrentes por la misma franja: gana una.
 *  2. La perdedora recibe 409 SLOT_TAKEN.
 *  3. Reintentar con la misma Idempotency-Key recupera la misma reserva.
 *  4. Dos solicitudes simultÃ¡neas con la misma clave NO duplican.
 *  5. Reutilizar la clave con otra peticiÃ³n produce conflicto.
 *  6. Servicio desactivado antes de confirmar: no se crea.
 *  7. Barbero desactivado antes de confirmar: no se crea.
 *  8. Barbero sin franja horaria vÃ¡lida: no se crea.
 *  9. Servicio sin barbero asignado: no se crea.
 * 10. El mismo cliente no duplica su reserva activa con otra clave.
 * 11. CANCELLED libera la franja.
 * 12. NO_SHOW mantiene la franja ocupada.
 * 13. Una reserva de A no bloquea la franja equivalente de B.
 * 14. Sin contexto de negocio: fallo cerrado.
 * 15. La consulta de disponibilidad no crea ni mantiene reservas.
 */

const OMITIR_SIN_DOCKER = process.env.MARIADB_TEST_SKIP === '1';

const SLUG_A = 'negocio-a';
const SLUG_B = 'negocio-b';

const FECHA = '2026-11-02';
const HORA = '09:00';
const HORA_FIN = '10:00';

const DIAS: WeekDay[] = [
  WeekDay.MONDAY,
  WeekDay.TUESDAY,
  WeekDay.WEDNESDAY,
  WeekDay.THURSDAY,
  WeekDay.FRIDAY,
  WeekDay.SATURDAY,
  WeekDay.SUNDAY,
];

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    AuthModule,
    NegociosModule,
    PrismaModule,
    ConfiguracionModule,
    ServiciosModule,
    UsuariosModule,
    ReservasInfraModule,
    HorariosModule,
  ],
  providers: [ReservasService],
})
class PruebaReservasModule {}

describe('Consistencia del flujo de reservas (MySQL 8.0 real)', () => {
  let conexion: MariaDbConnection | undefined;
  let prisma: PrismaClient;
  let reservasService: ReservasService;
  let contextoService: NegocioContextoService;
  let disponibilidadService: DisponibilidadService;
  let moduleRef: TestingModule;

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

    process.env.DATABASE_URL = conexion.urlBase;
    process.env.GOOGLE_CLIENT_ID ??= 'pruebas-reservas';
    process.env.JWT_SECRET ??= 'secreto-pruebas-reservas';
    process.env.JWT_CLIENTE_SECRET ??= 'secreto-cliente-pruebas-reservas';

    const url = new URL(conexion.urlBase);
    prisma = new PrismaClient({
      adapter: new PrismaMariaDb({
        host: url.hostname,
        port: Number(url.port),
        user: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
        database: url.pathname.substring(1),
        connectionLimit: 10,
      }),
    });

    moduleRef = await Test.createTestingModule({
      imports: [PruebaReservasModule],
    }).compile();

    reservasService = moduleRef.get(ReservasService);
    contextoService = moduleRef.get(NegocioContextoService);
    disponibilidadService = moduleRef.get(DisponibilidadService);
  }, 300000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await moduleRef?.get(PrismaService)?.$disconnect();
    conexion?.stop();
  });

  /** Datos de los dos negocios: barbero, servicio, asignaciÃ³n y horario. */
  let contador = 0;

  const sembrar = async () => {
    contador += 1;
    const sufijo = String(contador);
    const slugA = `${SLUG_A}-${sufijo}`;
    const slugB = `${SLUG_B}-${sufijo}`;

    const negocioA = await prisma.negocio.create({
      data: { slug: slugA, nombre: 'Negocio A' },
    });
    const negocioB = await prisma.negocio.create({
      data: { slug: slugB, nombre: 'Negocio B' },
    });

    const crearBarbero = async (negocioId: number, sufijo: string) => {
      const usuario = await prisma.usuario.create({
        data: {
          email: `barbero-${sufijo}-${contador}@test.local`,
          nombre: 'Barbero',
          apellido: sufijo,
          rol: 'PERSONAL',
        },
      });

      const barbero = await prisma.barbero.create({
        data: {
          usuarioId: usuario.id,
          negocioId,
          telefono: '3000000000',
          porcentajeComision: 40,
        },
      });

      for (const dayOfWeek of DIAS) {
        await prisma.barberWeeklySlot.create({
          data: {
            barberoId: barbero.id,
            negocioId: barbero.negocioId,
            dayOfWeek,
            startTime: HORA,
            endTime: HORA_FIN,
            active: true,
          },
        });
      }

      return barbero;
    };

    const barberoA = await crearBarbero(negocioA.id, 'a');
    const barberoB = await crearBarbero(negocioB.id, 'b');
    // Segundo barbero de A: permite comprobar que una clave de idempotencia
    // reutilizada con OTRO barbero (misma franja, libre para Ã©l) es un
    // conflicto y no una reserva nueva.
    const barberoA2 = await crearBarbero(negocioA.id, 'a2');

    const crearServicio = async (negocioId: number, nombre: string) =>
      prisma.servicio.create({
        data: {
          nombre,
          precio: 25000,
          duracionMinutos: 60,
          negocioId,
        },
      });

    const servicioA = await crearServicio(negocioA.id, 'Servicio A');
    const servicioB = await crearServicio(negocioB.id, 'Servicio B');

    await prisma.barberoServicio.create({
      data: {
        barberoId: barberoA.id,
        servicioId: servicioA.id,
        negocioId: negocioA.id,
      },
    });
    await prisma.barberoServicio.create({
      data: {
        barberoId: barberoB.id,
        servicioId: servicioB.id,
        negocioId: negocioB.id,
      },
    });

    await prisma.barberoServicio.create({
      data: {
        barberoId: barberoA2.id,
        servicioId: servicioA.id,
        negocioId: negocioA.id,
      },
    });

    const clienteA = await prisma.cliente.create({
      data: { nombre: 'Cliente', negocioId: negocioA.id },
    });
    // Segundo cliente de A: permite comprobar que la franja ocupada por otro
    // cliente produce SLOT_TAKEN (y no DUPLICATE_OWN_RESERVATION).
    const clienteA2 = await prisma.cliente.create({
      data: { nombre: 'Cliente 2', negocioId: negocioA.id },
    });
    const clienteB = await prisma.cliente.create({
      data: { nombre: 'Cliente B', negocioId: negocioB.id },
    });

    return {
      slugA,
      slugB,
      negocioA,
      negocioB,
      barberoA,
      barberoA2,
      barberoB,
      servicioA,
      servicioB,
      clienteA,
      clienteA2,
      clienteB,
    };
  };

  /** Ejecuta la creaciÃ³n dentro del contexto del negocio indicado. */
  const crearEn = (
    slug: string,
    negocioId: number,
    datos: {
      barberoId: number;
      servicioId: number;
      clienteId: number;
    },
    idempotencyKey?: string,
  ) =>
    contextoService.ejecutarEnContexto({ id: negocioId, slug }, () =>
      reservasService.crearReserva(
        {
          barberoId: datos.barberoId,
          servicioId: datos.servicioId,
          fecha: FECHA,
          hora: HORA,
        },
        { clienteId: datos.clienteId },
        idempotencyKey,
      ),
    );

  /** CÃ³digo de dominio de un error de reserva. */
  const codigoDe = (error: unknown): string | undefined => {
    const respuesta = (
      error as { getResponse?: () => unknown }
    ).getResponse?.();
    return (respuesta as { code?: string } | undefined)?.code;
  };

  it('1. dos solicitudes concurrentes por la misma franja: gana una y la otra recibe SLOT_TAKEN', async () => {
    if (OMITIR_SIN_DOCKER) return;

    const datos = await sembrar();

    const resultados = await Promise.allSettled([
      crearEn(datos.slugA, datos.negocioA.id, {
        barberoId: datos.barberoA.id,
        servicioId: datos.servicioA.id,
        clienteId: datos.clienteA.id,
      }),
      crearEn(datos.slugA, datos.negocioA.id, {
        barberoId: datos.barberoA.id,
        servicioId: datos.servicioA.id,
        clienteId: datos.clienteA.id,
      }),
    ]);

    const exitosos = resultados.filter((r) => r.status === 'fulfilled');
    const fallidos = resultados.filter((r) => r.status === 'rejected');

    expect(exitosos).toHaveLength(1);
    expect(fallidos).toHaveLength(1);
    expect(codigoDe(fallidos[0].reason)).toBe(CODIGOS_CONFLICTO.SLOT_TAKEN);

    const reservas = await prisma.reservation.count({
      where: { negocioId: datos.negocioA.id },
    });
    expect(reservas).toBe(1);
  });

  it('2. reintentar con la misma Idempotency-Key recupera la misma reserva', async () => {
    if (OMITIR_SIN_DOCKER) return;

    const datos = await sembrar();
    const clave = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

    const primera = await crearEn(
      datos.slugA,
      datos.negocioA.id,
      {
        barberoId: datos.barberoA.id,
        servicioId: datos.servicioA.id,
        clienteId: datos.clienteA.id,
      },
      clave,
    );

    const segunda = await crearEn(
      datos.slugA,
      datos.negocioA.id,
      {
        barberoId: datos.barberoA.id,
        servicioId: datos.servicioA.id,
        clienteId: datos.clienteA.id,
      },
      clave,
    );

    expect(segunda.id).toBe(primera.id);

    const reservas = await prisma.reservation.count({
      where: { negocioId: datos.negocioA.id },
    });
    expect(reservas).toBe(1);
  });

  it('3. dos solicitudes simultÃ¡neas con la misma clave NO duplican la reserva', async () => {
    if (OMITIR_SIN_DOCKER) return;

    const datos = await sembrar();
    const clave = '9c858901-8a57-4791-81fe-4c455b099bc9';

    const resultados = await Promise.allSettled([
      crearEn(
        datos.slugA,
        datos.negocioA.id,
        {
          barberoId: datos.barberoA.id,
          servicioId: datos.servicioA.id,
          clienteId: datos.clienteA.id,
        },
        clave,
      ),
      crearEn(
        datos.slugA,
        datos.negocioA.id,
        {
          barberoId: datos.barberoA.id,
          servicioId: datos.servicioA.id,
          clienteId: datos.clienteA.id,
        },
        clave,
      ),
    ]);

    const exitosos = resultados.filter(
      (r) => r.status === 'fulfilled',
    ) as PromiseFulfilledResult<{ id: number }>[];

    // Ninguna de las dos puede fallar: la perdedora recupera la original.

    expect(exitosos).toHaveLength(2);
    expect(exitosos[0].value.id).toBe(exitosos[1].value.id);

    const reservas = await prisma.reservation.count({
      where: { negocioId: datos.negocioA.id },
    });
    expect(reservas).toBe(1);
  });

  it('4. reutilizar la clave con una peticiÃ³n distinta produce conflicto', async () => {
    if (OMITIR_SIN_DOCKER) return;

    const datos = await sembrar();
    const clave = '2b1e0a1c-3e4d-4a5b-8c9d-0e1f2a3b4c5d';

    await crearEn(
      datos.slugA,
      datos.negocioA.id,
      {
        barberoId: datos.barberoA.id,
        servicioId: datos.servicioA.id,
        clienteId: datos.clienteA.id,
      },
      clave,
    );

    // Misma clave, OTRO barbero (misma franja, libre para Ã©l): es un intento
    // DISTINTO y la clave se ha reutilizado con una peticiÃ³n incompatible.
    await expect(
      crearEn(
        datos.slugA,
        datos.negocioA.id,
        {
          barberoId: datos.barberoA2.id,
          servicioId: datos.servicioA.id,
          clienteId: datos.clienteA.id,
        },
        clave,
      ),
    ).rejects.toMatchObject({
      response: { code: CODIGOS_CONFLICTO.IDEMPOTENCY_KEY_CONFLICT },
    });

    // Y no se ha creado una segunda reserva.
    expect(
      await prisma.reservation.count({
        where: { negocioId: datos.negocioA.id },
      }),
    ).toBe(1);
  });

  it('5. un servicio desactivado antes de confirmar no crea la reserva', async () => {
    if (OMITIR_SIN_DOCKER) return;

    const datos = await sembrar();

    await prisma.servicio.update({
      where: { id: datos.servicioA.id },
      data: { estado: 'INACTIVO' },
    });

    await expect(
      crearEn(datos.slugA, datos.negocioA.id, {
        barberoId: datos.barberoA.id,
        servicioId: datos.servicioA.id,
        clienteId: datos.clienteA.id,
      }),
    ).rejects.toMatchObject({
      response: { code: CODIGOS_CONFLICTO.SERVICE_INACTIVE },
    });

    expect(
      await prisma.reservation.count({
        where: { negocioId: datos.negocioA.id },
      }),
    ).toBe(0);
  });

  it('6. un barbero desactivado antes de confirmar no crea la reserva', async () => {
    if (OMITIR_SIN_DOCKER) return;

    const datos = await sembrar();

    await prisma.barbero.update({
      where: { id: datos.barberoA.id },
      data: { estado: 'INACTIVO' },
    });

    await expect(
      crearEn(datos.slugA, datos.negocioA.id, {
        barberoId: datos.barberoA.id,
        servicioId: datos.servicioA.id,
        clienteId: datos.clienteA.id,
      }),
    ).rejects.toMatchObject({
      response: { code: CODIGOS_CONFLICTO.BARBER_INACTIVE },
    });

    expect(
      await prisma.reservation.count({
        where: { negocioId: datos.negocioA.id },
      }),
    ).toBe(0);
  });

  it('7. un barbero sin franja horaria vÃ¡lida no crea la reserva', async () => {
    if (OMITIR_SIN_DOCKER) return;

    const datos = await sembrar();

    await prisma.barberWeeklySlot.deleteMany({
      where: { barberoId: datos.barberoA.id },
    });

    await expect(
      crearEn(datos.slugA, datos.negocioA.id, {
        barberoId: datos.barberoA.id,
        servicioId: datos.servicioA.id,
        clienteId: datos.clienteA.id,
      }),
    ).rejects.toMatchObject({
      response: { code: CODIGOS_CONFLICTO.BARBER_NO_SCHEDULE },
    });

    expect(
      await prisma.reservation.count({
        where: { negocioId: datos.negocioA.id },
      }),
    ).toBe(0);
  });

  it('8. un servicio sin barbero asignado no crea la reserva', async () => {
    if (OMITIR_SIN_DOCKER) return;

    const datos = await sembrar();

    await prisma.barberoServicio.deleteMany({
      where: { barberoId: datos.barberoA.id },
    });

    await expect(
      crearEn(datos.slugA, datos.negocioA.id, {
        barberoId: datos.barberoA.id,
        servicioId: datos.servicioA.id,
        clienteId: datos.clienteA.id,
      }),
    ).rejects.toMatchObject({
      response: { code: CODIGOS_CONFLICTO.NO_BARBER_FOR_SERVICE },
    });

    expect(
      await prisma.reservation.count({
        where: { negocioId: datos.negocioA.id },
      }),
    ).toBe(0);
  });

  it('9. el mismo cliente no duplica su reserva activa con otra clave', async () => {
    if (OMITIR_SIN_DOCKER) return;

    const datos = await sembrar();

    await crearEn(
      datos.slugA,
      datos.negocioA.id,
      {
        barberoId: datos.barberoA.id,
        servicioId: datos.servicioA.id,
        clienteId: datos.clienteA.id,
      },
      '11111111-1111-4111-8111-111111111111',
    );

    await expect(
      crearEn(
        datos.slugA,
        datos.negocioA.id,
        {
          barberoId: datos.barberoA.id,
          servicioId: datos.servicioA.id,
          clienteId: datos.clienteA.id,
        },
        '22222222-2222-4222-8222-222222222222',
      ),
    ).rejects.toMatchObject({
      response: { code: CODIGOS_CONFLICTO.DUPLICATE_OWN_RESERVATION },
    });

    expect(
      await prisma.reservation.count({
        where: { negocioId: datos.negocioA.id },
      }),
    ).toBe(1);
  });

  it('10. CANCELLED libera la franja y NO_SHOW la mantiene ocupada', async () => {
    if (OMITIR_SIN_DOCKER) return;

    const datos = await sembrar();

    const primera = await crearEn(datos.slugA, datos.negocioA.id, {
      barberoId: datos.barberoA.id,
      servicioId: datos.servicioA.id,
      clienteId: datos.clienteA.id,
    });

    // NO_SHOW ocupa la franja: otro cliente NO puede reservarla.
    await prisma.reservation.update({
      where: { id: primera.id },
      data: { status: 'NO_SHOW' },
    });

    await expect(
      crearEn(datos.slugA, datos.negocioA.id, {
        barberoId: datos.barberoA.id,
        servicioId: datos.servicioA.id,
        clienteId: datos.clienteA2.id,
      }),
    ).rejects.toMatchObject({
      response: { code: CODIGOS_CONFLICTO.SLOT_TAKEN },
    });

    // CANCELLED la libera (slotActivo = NULL).
    await prisma.reservation.update({
      where: { id: primera.id },
      data: { status: 'CANCELLED' },
    });

    const segunda = await crearEn(datos.slugA, datos.negocioA.id, {
      barberoId: datos.barberoA.id,
      servicioId: datos.servicioA.id,
      clienteId: datos.clienteA.id,
    });

    expect(segunda.id).not.toBe(primera.id);
  });

  it('11. una reserva de A no bloquea la franja equivalente de B', async () => {
    if (OMITIR_SIN_DOCKER) return;

    const datos = await sembrar();

    const enA = await crearEn(datos.slugA, datos.negocioA.id, {
      barberoId: datos.barberoA.id,
      servicioId: datos.servicioA.id,
      clienteId: datos.clienteA.id,
    });

    const enB = await crearEn(datos.slugB, datos.negocioB.id, {
      barberoId: datos.barberoB.id,
      servicioId: datos.servicioB.id,
      clienteId: datos.clienteB.id,
    });

    expect(enB.id).not.toBe(enA.id);
    expect(
      await prisma.reservation.count({
        where: { barberoId: { in: [datos.barberoA.id, datos.barberoB.id] } },
      }),
    ).toBe(2);
  });

  it('12. sin contexto de negocio el flujo falla cerrado', async () => {
    if (OMITIR_SIN_DOCKER) return;

    const datos = await sembrar();

    await expect(
      reservasService.crearReserva(
        {
          barberoId: datos.barberoA.id,
          servicioId: datos.servicioA.id,
          fecha: FECHA,
          hora: HORA,
        },
        { clienteId: datos.clienteA.id },
      ),
    ).rejects.toBeDefined();

    expect(
      await prisma.reservation.count({
        where: { negocioId: datos.negocioA.id },
      }),
    ).toBe(0);
  });

  it('la consulta de disponibilidad no crea ni mantiene reservas', async () => {
    if (OMITIR_SIN_DOCKER) return;

    const datos = await sembrar();

    const antes = await prisma.reservation.count();

    const franjas = await contextoService.ejecutarEnContexto(
      { id: datos.negocioA.id, slug: datos.slugA },
      () =>
        disponibilidadService.calcularDisponibilidad({
          barberoId: datos.barberoA.id,
          servicioId: datos.servicioA.id,
          fecha: FECHA,
        }),
    );

    expect(franjas.length).toBeGreaterThan(0);
    expect(await prisma.reservation.count()).toBe(antes);
  });

  it('el replay de un INVITADO devuelve SIEMPRE el mismo token y no invalida nada', async () => {
    if (OMITIR_SIN_DOCKER) return;

    const datos = await sembrar();
    const clave = '5b8c1f2a-3d4e-4f60-8a1b-2c3d4e5f6071';

    const peticion = {
      barberoId: datos.barberoA.id,
      servicioId: datos.servicioA.id,
      fecha: FECHA,
      hora: HORA,
      nombre: 'Invitado',
      telefono: '3001112222',
    };

    const crearInvitado = () =>
      contextoService.ejecutarEnContexto(
        { id: datos.negocioA.id, slug: datos.slugA },
        () => reservasService.crearReserva(peticion, undefined, clave),
      );

    // 1) Primera peticion de un INVITADO.
    const primera = await crearInvitado();

    expect(primera.tokenGestion).toBeDefined();

    const tokenOriginal = primera.tokenGestion as string;

    // La primera peticion crea el cliente invitado; los replays NO deben
    // crear otro.
    const clientesTrasPrimera = await prisma.cliente.count({
      where: { negocioId: datos.negocioA.id },
    });

    // 2) Varias repeticiones SECUENCIALES de la misma clave.
    for (let repeticion = 0; repeticion < 3; repeticion += 1) {
      const replay = await crearInvitado();

      expect(replay.id).toBe(primera.id);
      expect(replay.tokenGestion).toBe(tokenOriginal);
    }

    // 3) Varios replays SIMULTANEOS de la misma clave.
    const simultaneos = await Promise.all([
      crearInvitado(),
      crearInvitado(),
      crearInvitado(),
    ]);

    for (const replay of simultaneos) {
      expect(replay.id).toBe(primera.id);
      expect(replay.tokenGestion).toBe(tokenOriginal);
    }

    // 4) El replay NO crea otra reserva NI otro cliente.
    expect(
      await prisma.reservation.count({
        where: { negocioId: datos.negocioA.id },
      }),
    ).toBe(1);
    expect(
      await prisma.cliente.count({ where: { negocioId: datos.negocioA.id } }),
    ).toBe(clientesTrasPrimera);

    // 5) El token sigue siendo valido: la idempotencia no ha invalidado en
    //    silencio la credencial ya entregada.
    const conToken = await contextoService.ejecutarEnContexto(
      { id: datos.negocioA.id, slug: datos.slugA },
      () =>
        reservasService.validarReservaParaGestionInvitado(
          primera.id,
          tokenOriginal,
        ),
    );
    expect(conToken.id).toBe(primera.id);

    // 6) Un token ajeno NO vale.
    await expect(
      contextoService.ejecutarEnContexto(
        { id: datos.negocioA.id, slug: datos.slugA },
        () =>
          reservasService.validarReservaParaGestionInvitado(
            primera.id,
            'f'.repeat(64),
          ),
      ),
    ).rejects.toBeDefined();

    // 7) El estado de la reserva original NO ha cambiado.
    const fila = await prisma.reservation.findUnique({
      where: { id: primera.id },
      select: {
        status: true,
        startTime: true,
        endTime: true,
        gestionTokenHash: true,
        gestionTokenCifrado: true,
      },
    });

    expect(fila?.status).toBe('PENDING');
    expect(fila?.startTime).toBe(HORA);
    expect(fila?.endTime).toBe(HORA_FIN);
    expect(fila?.gestionTokenHash).not.toBeNull();
    expect(fila?.gestionTokenCifrado).not.toBeNull();
  });

  it('el token de una reserva NO sirve para gestionar otra', async () => {
    if (OMITIR_SIN_DOCKER) return;

    const datos = await sembrar();

    // Dos reservas de invitado distintas (mismo negocio, barbero distinto).
    const primera = await contextoService.ejecutarEnContexto(
      { id: datos.negocioA.id, slug: datos.slugA },
      () =>
        reservasService.crearReserva(
          {
            barberoId: datos.barberoA.id,
            servicioId: datos.servicioA.id,
            fecha: FECHA,
            hora: HORA,
            nombre: 'Invitado Uno',
            telefono: '3001111111',
          },
          undefined,
          'aaaaaaaa-1111-4111-8111-111111111111',
        ),
    );

    const segunda = await contextoService.ejecutarEnContexto(
      { id: datos.negocioA.id, slug: datos.slugA },
      () =>
        reservasService.crearReserva(
          {
            barberoId: datos.barberoA2.id,
            servicioId: datos.servicioA.id,
            fecha: FECHA,
            hora: HORA,
            nombre: 'Invitado Dos',
            telefono: '3002222222',
          },
          undefined,
          'bbbbbbbb-2222-4222-8222-222222222222',
        ),
    );

    expect(segunda.id).not.toBe(primera.id);

    // El token de la segunda NO abre la primera (ni al reves).
    await expect(
      contextoService.ejecutarEnContexto(
        { id: datos.negocioA.id, slug: datos.slugA },
        () =>
          reservasService.validarReservaParaGestionInvitado(
            primera.id,
            segunda.tokenGestion as string,
          ),
      ),
    ).rejects.toBeDefined();

    await expect(
      contextoService.ejecutarEnContexto(
        { id: datos.negocioA.id, slug: datos.slugA },
        () =>
          reservasService.validarReservaParaGestionInvitado(
            segunda.id,
            primera.tokenGestion as string,
          ),
      ),
    ).rejects.toBeDefined();
  });
});
