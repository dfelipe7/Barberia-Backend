import { Test, TestingModule } from '@nestjs/testing';
import { DisponibilidadService } from '../../horarios/service/disponibilidad.service';
import { DisponibilidadMapper } from '../../horarios/mappers/disponibilidad.mapper';
import { FranjaFactory } from '../../horarios/factory/franja.factory';
import { FechaBogotaService } from '../../horarios/common/fecha-bogota.service';
import { HorariosRepository } from '../../horarios/repository/horarios.repository';
import { BloqueosHorarioRepository } from '../../horarios/repository/bloqueos-horario.repository';
import { CierresGeneralesRepository } from '../../horarios/repository/cierres-generales.repository';
import { HorarioSemanalRule } from '../../horarios/strategies/horario-semanal.rule';
import { CierreGeneralRule } from '../../horarios/strategies/cierre-general.rule';
import { BloqueoActivoRule } from '../../horarios/strategies/bloqueo-activo.rule';
import { ReservaActivaRule } from '../../horarios/strategies/reserva-activa.rule';
import { REGLAS_DISPONIBILIDAD } from '../../horarios/strategies/regla-disponibilidad.strategy';
import { PROVEEDOR_RESERVAS_ACTIVAS } from '../../horarios/ports/proveedor-reservas-activas.port';
import { BarberosRepository } from '../../usuarios/repository/barberos.repository';
import { ServiciosRepository } from '../../servicios/repository/servicios.repository';
import { ReservasRepository } from '../repository/reservas.repository';
import { PrismaProveedorReservasActivas } from '../adapters/prisma-proveedor-reservas-activas.adapter';
import { PrismaService } from '../../../prisma/prisma.service';
import { NegocioAislamientoService } from '../../negocios/negocio-aislamiento.service';
import { crearAislamientoNegocio } from '../../negocios/negocio-aislamiento.test-helpers';

jest.mock('../../../../generated/prisma/enums', () => ({
  WeekDay: {
    MONDAY: 'MONDAY',
    TUESDAY: 'TUESDAY',
    WEDNESDAY: 'WEDNESDAY',
    THURSDAY: 'THURSDAY',
    FRIDAY: 'FRIDAY',
    SATURDAY: 'SATURDAY',
    SUNDAY: 'SUNDAY',
  },
  ReservationStatus: {
    PENDING: 'PENDING',
    CONFIRMED: 'CONFIRMED',
    IN_PROGRESS: 'IN_PROGRESS',
    COMPLETED: 'COMPLETED',
    CANCELLED: 'CANCELLED',
  },
  ScheduleBlockStatus: {
    ACTIVE: 'ACTIVE',
    REACTIVATED: 'REACTIVATED',
    CANCELLED: 'CANCELLED',
  },
  EstadoUsuario: {
    ACTIVO: 'ACTIVO',
    INACTIVO: 'INACTIVO',
  },
  EstadoServicio: {
    ACTIVO: 'ACTIVO',
    INACTIVO: 'INACTIVO',
  },
  RolUsuario: {
    SUPERADMIN: 'SUPERADMIN',
    ADMINISTRADOR: 'ADMINISTRADOR',
    BARBERO: 'BARBERO',
  },
}));

import { ReservationStatus } from '../../../../generated/prisma/enums';

const FECHA = '2026-10-20';

/**
 * Prueba de integración REAL (sin base de datos viva) entre HE-08 y HE-04:
 * `DisponibilidadService` consume el puerto `PROVEEDOR_RESERVAS_ACTIVAS`
 * resuelto por el adaptador Prisma y el `ReservasRepository` reales, con
 * `PrismaService` simulado. Verifica que:
 * - una franja con reserva no cancelada se excluye de la vista pública;
 * - una franja cuya única reserva está cancelada vuelve a estar disponible;
 * - la consulta de ocupación filtra por estados que ocupan agenda (excluye
 *   CANCELLED);
 * - un fallo del repositorio no se degrada a franja libre.
 */
describe('Integración HE-08 ↔ HE-04 (disponibilidad sobre reservas reales)', () => {
  let service: DisponibilidadService;
  let prisma: { reservation: { findFirst: jest.Mock } };

  const compilar = async () => {
    prisma = { reservation: { findFirst: jest.fn() } };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        DisponibilidadService,
        DisponibilidadMapper,
        FranjaFactory,
        FechaBogotaService,
        HorarioSemanalRule,
        CierreGeneralRule,
        BloqueoActivoRule,
        ReservaActivaRule,
        {
          provide: REGLAS_DISPONIBILIDAD,
          useFactory: (
            horario: HorarioSemanalRule,
            cierre: CierreGeneralRule,
            bloqueo: BloqueoActivoRule,
            reserva: ReservaActivaRule,
          ) => [horario, cierre, bloqueo, reserva],
          inject: [
            HorarioSemanalRule,
            CierreGeneralRule,
            BloqueoActivoRule,
            ReservaActivaRule,
          ],
        },
        {
          provide: BarberosRepository,
          useValue: {
            obtenerBarberoActivoPorId: jest.fn().mockResolvedValue({ id: 7 }),
          },
        },
        {
          provide: ServiciosRepository,
          useValue: {
            obtenerServicioActivoPorId: jest.fn().mockResolvedValue({ id: 2 }),
            existeAsignacionBarbero: jest.fn().mockResolvedValue(true),
          },
        },
        {
          provide: HorariosRepository,
          useValue: {
            obtenerFranjasActivasPorBarberoYDia: jest
              .fn()
              .mockResolvedValue([
                { startTime: '09:00' },
                { startTime: '10:00' },
              ]),
          },
        },
        {
          provide: BloqueosHorarioRepository,
          useValue: {
            listarActivosPorBarberoYFecha: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: CierresGeneralesRepository,
          useValue: { obtenerActivosEnFecha: jest.fn().mockResolvedValue([]) },
        },
        ReservasRepository,
        PrismaProveedorReservasActivas,
        { provide: PrismaService, useValue: prisma },
        {
          provide: NegocioAislamientoService,
          useValue: crearAislamientoNegocio(),
        },
        {
          provide: PROVEEDOR_RESERVAS_ACTIVAS,
          useExisting: PrismaProveedorReservasActivas,
        },
      ],
    }).compile();

    return moduleRef.get(DisponibilidadService);
  };

  beforeEach(async () => {
    service = await compilar();
  });

  it('excluye de la vista pública la franja con reserva no cancelada', async () => {
    prisma.reservation.findFirst.mockImplementation(
      (args: { where: { startTime: { lt: string } } }) =>
        Promise.resolve(args.where.startTime.lt === '11:00' ? { id: 1 } : null),
    );

    const resultado = await service.obtenerDisponibilidadPublica({
      barberoId: 7,
      fecha: FECHA,
    });

    expect(resultado.slots).toEqual([
      { startTime: '09:00', endTime: '10:00', available: true },
    ]);
    expect(prisma.reservation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          barberoId: 7,
          status: {
            in: [
              ReservationStatus.PENDING,
              ReservationStatus.CONFIRMED,
              ReservationStatus.IN_PROGRESS,
              ReservationStatus.COMPLETED,
            ],
          },
          startTime: { lt: '10:00' },
          endTime: { gt: '09:00' },
        }),
      }),
    );
  });

  it('vuelve a ofrecer la franja cuando la única reserva está cancelada', async () => {
    // El repositorio filtra por estados que ocupan agenda; una reserva
    // CANCELLED no coincide, por lo que no hay fila que ocupar.
    prisma.reservation.findFirst.mockResolvedValue(null);

    const resultado = await service.obtenerDisponibilidadPublica({
      barberoId: 7,
      fecha: FECHA,
    });

    expect(resultado.slots).toEqual([
      { startTime: '09:00', endTime: '10:00', available: true },
      { startTime: '10:00', endTime: '11:00', available: true },
    ]);
  });

  it('no degrada a franja libre si la consulta de reservas falla (fail-closed)', async () => {
    prisma.reservation.findFirst.mockRejectedValue(
      new Error('DB connection lost'),
    );

    await expect(
      service.obtenerDisponibilidadPublica({ barberoId: 7, fecha: FECHA }),
    ).rejects.toThrow('DB connection lost');
  });

  it('permite consultar disponibilidad excluyendo una reserva (revalidación para modificación HU-08)', async () => {
    prisma.reservation.findFirst.mockImplementation(
      (args: {
        where: { startTime: { lt: string }; id?: { not: number } };
      }) => {
        if (args.where.id?.not === 42) {
          return Promise.resolve(null);
        }
        return Promise.resolve({ id: 42 });
      },
    );

    const resultado = await service.calcularDisponibilidad({
      barberoId: 7,
      fecha: FECHA,
      excluirReservaId: 42,
    });

    const franjaDiez = resultado.find((f) => f.startTime === '10:00');
    expect(franjaDiez?.estado).toBe('AVAILABLE');
    expect(prisma.reservation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { not: 42 },
        }),
      }),
    );
  });
});
