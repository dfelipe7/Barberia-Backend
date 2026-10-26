import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Provider } from '@nestjs/common';
import { DisponibilidadService } from './disponibilidad.service';
import { DisponibilidadMapper } from '../mappers/disponibilidad.mapper';
import { FranjaFactory } from '../factory/franja.factory';
import { FechaBogotaService } from '../common/fecha-bogota.service';
import { EstadoFranja } from '../common/estado-franja';
import type { FranjaEvaluada } from '../common/estado-franja';
import { HorariosRepository } from '../repository/horarios.repository';
import { BloqueosHorarioRepository } from '../repository/bloqueos-horario.repository';
import { CierresGeneralesRepository } from '../repository/cierres-generales.repository';
import { BarberosRepository } from '../../usuarios/repository/barberos.repository';
import { ServiciosRepository } from '../../servicios/repository/servicios.repository';
import {
  PROVEEDOR_RESERVAS_ACTIVAS,
  ReservasNoDisponiblesError,
} from '../ports/proveedor-reservas-activas.port';
import { HorarioSemanalRule } from '../strategies/horario-semanal.rule';
import { CierreGeneralRule } from '../strategies/cierre-general.rule';
import { BloqueoActivoRule } from '../strategies/bloqueo-activo.rule';
import { ReservaActivaRule } from '../strategies/reserva-activa.rule';
import { REGLAS_DISPONIBILIDAD } from '../strategies/regla-disponibilidad.strategy';
import { CODIGOS_CONFLICTO } from '../../../common/exceptions/domain-conflict.exception';

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
  ScheduleBlockStatus: {
    ACTIVE: 'ACTIVE',
    REACTIVATED: 'REACTIVATED',
    CANCELLED: 'CANCELLED',
  },
  ScheduleBlockReason: {
    PERSONAL: 'PERSONAL',
    MEDICAL: 'MEDICAL',
    VACATION: 'VACATION',
    OTHER: 'OTHER',
  },
  EstadoUsuario: { ACTIVO: 'ACTIVO', INACTIVO: 'INACTIVO' },
  EstadoServicio: { ACTIVO: 'ACTIVO', INACTIVO: 'INACTIVO' },
}));

const FECHA = '2026-10-20';
const FECHA_DATE = new Date(`${FECHA}T00:00:00.000Z`);

const aMapa = (franjas: FranjaEvaluada[]) =>
  Object.fromEntries(franjas.map((f) => [f.startTime, f.estado]));

describe('DisponibilidadService', () => {
  let service: DisponibilidadService;
  let barberosRepository: jest.Mocked<BarberosRepository>;
  let serviciosRepository: jest.Mocked<ServiciosRepository>;
  let horariosRepository: jest.Mocked<HorariosRepository>;
  let bloqueosRepository: jest.Mocked<BloqueosHorarioRepository>;
  let cierresRepository: jest.Mocked<CierresGeneralesRepository>;
  let proveedorReservas: { existeReservaNoCanceladaEnFranja: jest.Mock };

  const compilar = async (reglasProvider?: Provider) => {
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
        reglasProvider ?? {
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
        { provide: BarberosRepository, useValue: barberosRepository },
        { provide: ServiciosRepository, useValue: serviciosRepository },
        { provide: HorariosRepository, useValue: horariosRepository },
        { provide: BloqueosHorarioRepository, useValue: bloqueosRepository },
        { provide: CierresGeneralesRepository, useValue: cierresRepository },
        { provide: PROVEEDOR_RESERVAS_ACTIVAS, useValue: proveedorReservas },
      ],
    }).compile();

    return moduleRef.get(DisponibilidadService);
  };

  beforeEach(async () => {
    barberosRepository = {
      obtenerBarberoActivoPorId: jest.fn().mockResolvedValue({ id: 7 }),
      obtenerBarberoPorId: jest
        .fn()
        .mockResolvedValue({ id: 7, estado: 'ACTIVO' }),
      obtenerBarberoPorUsuarioId: jest
        .fn()
        .mockResolvedValue({ id: 7, usuarioId: 10 }),
    } as unknown as jest.Mocked<BarberosRepository>;

    serviciosRepository = {
      obtenerServicioActivoPorId: jest.fn().mockResolvedValue({ id: 2 }),
      obtenerServicioPorId: jest
        .fn()
        .mockResolvedValue({ id: 2, estado: 'ACTIVO' }),
      existeAsignacionBarbero: jest.fn().mockResolvedValue(true),
    } as unknown as jest.Mocked<ServiciosRepository>;

    horariosRepository = {
      obtenerFranjasActivasPorBarberoYDia: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<HorariosRepository>;

    bloqueosRepository = {
      listarActivosPorBarberoYFecha: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<BloqueosHorarioRepository>;

    cierresRepository = {
      obtenerActivosEnFecha: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<CierresGeneralesRepository>;

    proveedorReservas = {
      existeReservaNoCanceladaEnFranja: jest.fn().mockResolvedValue(false),
    };

    service = await compilar();
  });

  it('debe estar definido', () => {
    expect(service).toBeDefined();
  });

  describe('validaciones previas', () => {
    it('lanza 404 y no consulta horario si el barbero no existe', async () => {
      barberosRepository.obtenerBarberoActivoPorId.mockResolvedValue(null);
      barberosRepository.obtenerBarberoPorId.mockResolvedValue(null);

      await expect(
        service.calcularDisponibilidad({ barberoId: 99, fecha: FECHA }),
      ).rejects.toThrow(NotFoundException);
      expect(
        horariosRepository.obtenerFranjasActivasPorBarberoYDia,
      ).not.toHaveBeenCalled();
    });

    it('lanza 409 con BARBER_INACTIVE si el barbero existe pero está inactivo', async () => {
      barberosRepository.obtenerBarberoActivoPorId.mockResolvedValue(null);
      barberosRepository.obtenerBarberoPorId.mockResolvedValue({
        id: 99,
        estado: 'INACTIVO',
      } as never);

      await expect(
        service.calcularDisponibilidad({ barberoId: 99, fecha: FECHA }),
      ).rejects.toMatchObject({
        response: { code: CODIGOS_CONFLICTO.BARBER_INACTIVE },
      });
    });

    it('lanza 404 si el servicio no existe', async () => {
      serviciosRepository.obtenerServicioActivoPorId.mockResolvedValue(null);
      serviciosRepository.obtenerServicioPorId.mockResolvedValue(null);

      await expect(
        service.calcularDisponibilidad({
          barberoId: 7,
          servicioId: 2,
          fecha: FECHA,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('lanza 409 con SERVICE_INACTIVE si el servicio existe pero está inactivo', async () => {
      serviciosRepository.obtenerServicioActivoPorId.mockResolvedValue(null);
      serviciosRepository.obtenerServicioPorId.mockResolvedValue({
        id: 2,
        estado: 'INACTIVO',
      } as never);

      await expect(
        service.calcularDisponibilidad({
          barberoId: 7,
          servicioId: 2,
          fecha: FECHA,
        }),
      ).rejects.toMatchObject({
        response: { code: CODIGOS_CONFLICTO.SERVICE_INACTIVE },
      });
    });

    it('lanza 409 con NO_BARBER_FOR_SERVICE si el servicio no está asignado al barbero', async () => {
      serviciosRepository.existeAsignacionBarbero.mockResolvedValue(false);

      await expect(
        service.calcularDisponibilidad({
          barberoId: 7,
          servicioId: 2,
          fecha: FECHA,
        }),
      ).rejects.toMatchObject({
        response: { code: CODIGOS_CONFLICTO.NO_BARBER_FOR_SERVICE },
      });
    });

    it('lanza 400 si la fecha de calendario es inválida', async () => {
      await expect(
        service.calcularDisponibilidad({ barberoId: 7, fecha: '2026-13-40' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('no valida servicio cuando no se informa servicioId', async () => {
      await service.calcularDisponibilidad({ barberoId: 7, fecha: FECHA });

      expect(
        serviciosRepository.obtenerServicioActivoPorId,
      ).not.toHaveBeenCalled();
      expect(
        serviciosRepository.existeAsignacionBarbero,
      ).not.toHaveBeenCalled();
    });
  });

  describe('calcularDisponibilidad', () => {
    it('resuelve el día de la semana en Bogotá y precarga los datos una sola vez', async () => {
      horariosRepository.obtenerFranjasActivasPorBarberoYDia.mockResolvedValue([
        { startTime: '09:00' },
      ] as any);

      await service.calcularDisponibilidad({ barberoId: 7, fecha: FECHA });

      const diaEsperado = new FechaBogotaService().obtenerDiaSemana(FECHA);
      expect(
        horariosRepository.obtenerFranjasActivasPorBarberoYDia,
      ).toHaveBeenCalledWith(7, diaEsperado);
      expect(
        bloqueosRepository.listarActivosPorBarberoYFecha,
      ).toHaveBeenCalledWith(7, FECHA_DATE);
      expect(cierresRepository.obtenerActivosEnFecha).toHaveBeenCalledWith(
        FECHA_DATE,
      );
    });

    it('devuelve las 11 franjas de la jornada y aplica la prelación completa', async () => {
      horariosRepository.obtenerFranjasActivasPorBarberoYDia.mockResolvedValue([
        { startTime: '09:00' },
        { startTime: '10:00' },
        { startTime: '11:00' },
        { startTime: '12:00' },
      ] as any);
      bloqueosRepository.listarActivosPorBarberoYFecha.mockResolvedValue([
        { startTime: '11:00', endTime: '12:00' },
      ] as any);
      cierresRepository.obtenerActivosEnFecha.mockResolvedValue([
        { allDay: false, startTime: '12:00', endTime: '13:00' },
      ] as any);
      proveedorReservas.existeReservaNoCanceladaEnFranja.mockImplementation(
        (consulta: { startTime: string }) =>
          Promise.resolve(consulta.startTime === '10:00'),
      );

      const franjas = await service.calcularDisponibilidad({
        barberoId: 7,
        fecha: FECHA,
      });
      const mapa = aMapa(franjas);

      expect(franjas).toHaveLength(11);
      expect(mapa['09:00']).toBe(EstadoFranja.AVAILABLE);
      expect(mapa['10:00']).toBe(EstadoFranja.RESERVED);
      expect(mapa['11:00']).toBe(EstadoFranja.BLOCKED);
      expect(mapa['12:00']).toBe(EstadoFranja.GENERAL_CLOSURE);
      expect(mapa['13:00']).toBe(EstadoFranja.OUTSIDE_SCHEDULE);
      expect(mapa['19:00']).toBe(EstadoFranja.OUTSIDE_SCHEDULE);
    });

    it('no consulta reservas en franjas fuera de horario (short-circuit)', async () => {
      horariosRepository.obtenerFranjasActivasPorBarberoYDia.mockResolvedValue([
        { startTime: '09:00' },
      ] as any);

      await service.calcularDisponibilidad({ barberoId: 7, fecha: FECHA });

      const llamadas = proveedorReservas.existeReservaNoCanceladaEnFranja.mock
        .calls as Array<[{ startTime: string }]>;
      expect(
        llamadas.every(([consulta]) => consulta.startTime === '09:00'),
      ).toBe(true);
      expect(
        proveedorReservas.existeReservaNoCanceladaEnFranja,
      ).toHaveBeenCalledTimes(1);
    });

    it('OUTSIDE_SCHEDULE prevalece sobre un cierre general', async () => {
      cierresRepository.obtenerActivosEnFecha.mockResolvedValue([
        { allDay: true, startTime: null, endTime: null },
      ] as any);

      const franjas = await service.calcularDisponibilidad({
        barberoId: 7,
        fecha: FECHA,
      });

      expect(aMapa(franjas)['09:00']).toBe(EstadoFranja.OUTSIDE_SCHEDULE);
      expect(
        proveedorReservas.existeReservaNoCanceladaEnFranja,
      ).not.toHaveBeenCalled();
    });

    it('GENERAL_CLOSURE prevalece sobre bloqueo y reserva', async () => {
      horariosRepository.obtenerFranjasActivasPorBarberoYDia.mockResolvedValue([
        { startTime: '09:00' },
      ] as any);
      bloqueosRepository.listarActivosPorBarberoYFecha.mockResolvedValue([
        { startTime: '09:00', endTime: '10:00' },
      ] as any);
      cierresRepository.obtenerActivosEnFecha.mockResolvedValue([
        { allDay: true, startTime: null, endTime: null },
      ] as any);
      proveedorReservas.existeReservaNoCanceladaEnFranja.mockResolvedValue(
        true,
      );

      const franjas = await service.calcularDisponibilidad({
        barberoId: 7,
        fecha: FECHA,
      });

      expect(aMapa(franjas)['09:00']).toBe(EstadoFranja.GENERAL_CLOSURE);
      expect(
        proveedorReservas.existeReservaNoCanceladaEnFranja,
      ).not.toHaveBeenCalled();
    });

    it('BLOCKED prevalece sobre RESERVED', async () => {
      horariosRepository.obtenerFranjasActivasPorBarberoYDia.mockResolvedValue([
        { startTime: '09:00' },
      ] as any);
      bloqueosRepository.listarActivosPorBarberoYFecha.mockResolvedValue([
        { startTime: '09:00', endTime: '10:00' },
      ] as any);

      const franjas = await service.calcularDisponibilidad({
        barberoId: 7,
        fecha: FECHA,
      });

      expect(aMapa(franjas)['09:00']).toBe(EstadoFranja.BLOCKED);
      expect(
        proveedorReservas.existeReservaNoCanceladaEnFranja,
      ).not.toHaveBeenCalled();
    });

    it('falla cerrado con 503 si el proveedor de reservas no está disponible', async () => {
      horariosRepository.obtenerFranjasActivasPorBarberoYDia.mockResolvedValue([
        { startTime: '09:00' },
      ] as any);
      proveedorReservas.existeReservaNoCanceladaEnFranja.mockRejectedValue(
        new ReservasNoDisponiblesError(),
      );

      await expect(
        service.calcularDisponibilidad({ barberoId: 7, fecha: FECHA }),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('un día sin horario no consulta reservas y no anuncia franjas libres', async () => {
      const resultado = await service.obtenerDisponibilidadPublica({
        barberoId: 7,
        fecha: FECHA,
      });

      expect(
        proveedorReservas.existeReservaNoCanceladaEnFranja,
      ).not.toHaveBeenCalled();
      expect(resultado.slots).toEqual([]);
    });
  });

  describe('obtenerDisponibilidadPublica', () => {
    it('solo expone franjas disponibles y la zona horaria de negocio', async () => {
      horariosRepository.obtenerFranjasActivasPorBarberoYDia.mockResolvedValue([
        { startTime: '09:00' },
        { startTime: '10:00' },
      ] as any);
      proveedorReservas.existeReservaNoCanceladaEnFranja.mockImplementation(
        (consulta: { startTime: string }) =>
          Promise.resolve(consulta.startTime === '10:00'),
      );

      const resultado = await service.obtenerDisponibilidadPublica({
        barberoId: 7,
        fecha: FECHA,
      });

      expect(resultado).toEqual({
        fecha: FECHA,
        timeZone: 'America/Bogota',
        barberoId: 7,
        servicioId: null,
        slots: [{ startTime: '09:00', endTime: '10:00', available: true }],
      });
    });
  });

  describe('obtenerDisponibilidadDetalladaDelBarberoAutenticado', () => {
    it('resuelve el barbero desde el token y devuelve estados detallados', async () => {
      horariosRepository.obtenerFranjasActivasPorBarberoYDia.mockResolvedValue([
        { startTime: '09:00' },
      ] as any);

      const resultado =
        await service.obtenerDisponibilidadDetalladaDelBarberoAutenticado(
          { id: 10, sub: '10' },
          { fecha: FECHA },
        );

      expect(
        barberosRepository.obtenerBarberoPorUsuarioId,
      ).toHaveBeenCalledWith(10);
      expect(resultado.slots[0]).toEqual({
        startTime: '09:00',
        endTime: '10:00',
        status: EstadoFranja.AVAILABLE,
      });
      expect(resultado.slots[4].status).toBe(EstadoFranja.OUTSIDE_SCHEDULE);
    });

    it('lanza 401 si no se puede identificar al usuario', async () => {
      await expect(
        service.obtenerDisponibilidadDetalladaDelBarberoAutenticado(
          {},
          { fecha: FECHA },
        ),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('lanza 403 si el usuario no tiene perfil de barbero', async () => {
      barberosRepository.obtenerBarberoPorUsuarioId.mockResolvedValue(null);

      await expect(
        service.obtenerDisponibilidadDetalladaDelBarberoAutenticado(
          { id: 10 },
          { fecha: FECHA },
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('fachada como orquestador único (orden por prioridad)', () => {
    it('evalúa las reglas por orden y no por su posición en el arreglo', async () => {
      const reglaBaja = {
        orden: 5,
        evaluar: jest.fn().mockResolvedValue(EstadoFranja.OUTSIDE_SCHEDULE),
      };
      const reglaAlta = {
        orden: 99,
        evaluar: jest.fn().mockResolvedValue(EstadoFranja.RESERVED),
      };

      service = await compilar({
        provide: REGLAS_DISPONIBILIDAD,
        useValue: [reglaAlta, reglaBaja],
      });

      const franjas = await service.calcularDisponibilidad({
        barberoId: 7,
        fecha: FECHA,
      });

      expect(reglaBaja.evaluar).toHaveBeenCalled();
      expect(reglaAlta.evaluar).not.toHaveBeenCalled();
      expect(aMapa(franjas)['09:00']).toBe(EstadoFranja.OUTSIDE_SCHEDULE);
    });
  });
});
