import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { BloqueosHorarioService } from './bloqueos-horario.service';
import { BloqueosHorarioRepository } from '../repository/bloqueos-horario.repository';
import { CierresGeneralesRepository } from '../repository/cierres-generales.repository';
import { HorariosRepository } from '../repository/horarios.repository';
import { BarberosRepository } from '../../usuarios/repository/barberos.repository';
import { FranjaFactory } from '../factory/franja.factory';
import { FechaBogotaService } from '../common/fecha-bogota.service';
import {
  PROVEEDOR_RESERVAS_ACTIVAS,
  ReservasNoDisponiblesError,
} from '../ports/proveedor-reservas-activas.port';
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
}));

import {
  ScheduleBlockReason,
  ScheduleBlockStatus,
} from '../../../../generated/prisma/enums';

describe('BloqueosHorarioService', () => {
  let service: BloqueosHorarioService;
  let bloqueosRepository: jest.Mocked<BloqueosHorarioRepository>;
  let cierresRepository: jest.Mocked<CierresGeneralesRepository>;
  let horariosRepository: jest.Mocked<HorariosRepository>;
  let barberosRepository: jest.Mocked<BarberosRepository>;
  let proveedorReservas: { existeReservaNoCanceladaEnFranja: jest.Mock };

  const usuarioAutenticado = { id: 10, sub: '10', email: 'barbero@test.com' };
  const fecha = new Date('2026-10-20T00:00:00.000Z');

  const crearRegistro = (overrides: Record<string, unknown> = {}) => ({
    id: 1,
    barberoId: 7,
    date: fecha,
    startTime: '15:00',
    endTime: '16:00',
    reason: ScheduleBlockReason.PERSONAL,
    notes: 'Cita personal',
    status: ScheduleBlockStatus.ACTIVE,
    reactivatedAt: null,
    createdAt: new Date('2026-10-18T14:00:00.000Z'),
    updatedAt: new Date('2026-10-18T14:00:00.000Z'),
    ...overrides,
  });

  beforeEach(async () => {
    const mockBloqueosRepository = {
      crear: jest.fn(),
      obtenerPorId: jest.fn(),
      listarPorBarbero: jest.fn().mockResolvedValue([]),
      listarActivosPorBarberoYFecha: jest.fn().mockResolvedValue([]),
      actualizar: jest.fn(),
    };

    const mockCierresRepository = {
      obtenerActivosEnFecha: jest.fn().mockResolvedValue([]),
    };

    const mockHorariosRepository = {
      obtenerFranjasActivasPorBarberoYDia: jest
        .fn()
        .mockResolvedValue([{ startTime: '15:00' }]),
    };

    const mockBarberosRepository = {
      obtenerBarberoPorUsuarioId: jest
        .fn()
        .mockResolvedValue({ id: 7, usuarioId: 10 }),
      obtenerBarberoActivoPorId: jest
        .fn()
        .mockResolvedValue({ id: 7, usuarioId: 10, estaActivo: true }),
    };

    proveedorReservas = {
      existeReservaNoCanceladaEnFranja: jest.fn().mockResolvedValue(false),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BloqueosHorarioService,
        {
          provide: BloqueosHorarioRepository,
          useValue: mockBloqueosRepository,
        },
        {
          provide: CierresGeneralesRepository,
          useValue: mockCierresRepository,
        },
        { provide: HorariosRepository, useValue: mockHorariosRepository },
        { provide: BarberosRepository, useValue: mockBarberosRepository },
        FranjaFactory,
        FechaBogotaService,
        { provide: PROVEEDOR_RESERVAS_ACTIVAS, useValue: proveedorReservas },
      ],
    }).compile();

    service = module.get<BloqueosHorarioService>(BloqueosHorarioService);
    bloqueosRepository = module.get(BloqueosHorarioRepository);
    cierresRepository = module.get(CierresGeneralesRepository);
    horariosRepository = module.get(HorariosRepository);
    barberosRepository = module.get(BarberosRepository);
    jest.clearAllMocks();
  });

  it('debe estar definido', () => {
    expect(service).toBeDefined();
  });

  describe('crearBloqueo', () => {
    const dto = {
      date: '2026-10-20',
      startTime: '15:00',
      endTime: '16:00',
      reason: ScheduleBlockReason.PERSONAL,
      notes: 'Cita personal',
    };

    it('debe crear el bloqueo cuando todas las reglas se cumplen', async () => {
      bloqueosRepository.crear.mockResolvedValue(crearRegistro());

      const resultado = await service.crearBloqueo(usuarioAutenticado, dto);

      expect(
        barberosRepository.obtenerBarberoPorUsuarioId,
      ).toHaveBeenCalledWith(10);
      expect(
        horariosRepository.obtenerFranjasActivasPorBarberoYDia,
      ).toHaveBeenCalledWith(7, expect.any(String));
      expect(
        proveedorReservas.existeReservaNoCanceladaEnFranja,
      ).toHaveBeenCalledWith({
        barberoId: 7,
        fecha: '2026-10-20',
        startTime: '15:00',
        endTime: '16:00',
      });
      expect(bloqueosRepository.crear).toHaveBeenCalledWith({
        barberoId: 7,
        date: fecha,
        startTime: '15:00',
        endTime: '16:00',
        reason: ScheduleBlockReason.PERSONAL,
        notes: 'Cita personal',
      });
      expect(resultado.mensaje).toBe('Bloqueo creado correctamente');
      expect(resultado.block).toEqual({
        id: 1,
        date: '2026-10-20',
        startTime: '15:00',
        endTime: '16:00',
        reason: ScheduleBlockReason.PERSONAL,
        notes: 'Cita personal',
        status: ScheduleBlockStatus.ACTIVE,
        createdAt: '2026-10-18T14:00:00.000Z',
        updatedAt: '2026-10-18T14:00:00.000Z',
        reactivatedAt: null,
      });
    });

    it('debe fallar cerrado con 503 cuando el proveedor HE-04 no está disponible', async () => {
      proveedorReservas.existeReservaNoCanceladaEnFranja.mockRejectedValue(
        new ReservasNoDisponiblesError(),
      );

      await expect(
        service.crearBloqueo(usuarioAutenticado, dto),
      ).rejects.toThrow(ServiceUnavailableException);
      expect(bloqueosRepository.crear).not.toHaveBeenCalled();
    });

    it('debe lanzar 409 con código SCHEDULE_BLOCK_HAS_RESERVATIONS si el rango contiene una reserva no cancelada', async () => {
      proveedorReservas.existeReservaNoCanceladaEnFranja.mockResolvedValue(
        true,
      );

      const capturado: unknown = await service
        .crearBloqueo(usuarioAutenticado, dto)
        .then(() => undefined)
        .catch((e: unknown) => e);

      expect(capturado).toBeInstanceOf(ConflictException);
      const excepcion = capturado as ConflictException;
      expect(excepcion.getStatus()).toBe(409);
      expect(excepcion.getResponse()).toMatchObject({
        code: CODIGOS_CONFLICTO.SCHEDULE_BLOCK_HAS_RESERVATIONS,
      });
      expect(bloqueosRepository.crear).not.toHaveBeenCalled();
    });

    it('debe lanzar 400 si el rango no está dentro del horario semanal del día', async () => {
      horariosRepository.obtenerFranjasActivasPorBarberoYDia.mockResolvedValue(
        [],
      );

      await expect(
        service.crearBloqueo(usuarioAutenticado, dto),
      ).rejects.toThrow(BadRequestException);
      expect(
        proveedorReservas.existeReservaNoCanceladaEnFranja,
      ).not.toHaveBeenCalled();
    });

    it('debe lanzar 400 si el rango se solapa con otro bloqueo activo', async () => {
      bloqueosRepository.listarActivosPorBarberoYFecha.mockResolvedValue([
        crearRegistro({ id: 2 }),
      ]);

      await expect(
        service.crearBloqueo(usuarioAutenticado, dto),
      ).rejects.toThrow(BadRequestException);
    });

    it('debe lanzar 400 si coincide con un cierre general activo', async () => {
      cierresRepository.obtenerActivosEnFecha.mockResolvedValue([
        {
          id: 9,
          date: fecha,
          startTime: null,
          endTime: null,
          allDay: true,
          reason: 'Festivo',
        },
      ]);

      await expect(
        service.crearBloqueo(usuarioAutenticado, dto),
      ).rejects.toThrow(BadRequestException);
    });

    it('debe lanzar 400 si la fecha de calendario es inválida', async () => {
      await expect(
        service.crearBloqueo(usuarioAutenticado, {
          ...dto,
          date: '2026-13-40',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('debe lanzar 400 si el rango no se compone de franjas de 60 minutos alineadas', async () => {
      await expect(
        service.crearBloqueo(usuarioAutenticado, {
          ...dto,
          startTime: '15:30',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('debe lanzar 403 si el usuario no tiene perfil de barbero', async () => {
      barberosRepository.obtenerBarberoPorUsuarioId.mockResolvedValue(null);

      await expect(
        service.crearBloqueo(usuarioAutenticado, dto),
      ).rejects.toThrow(ForbiddenException);
    });

    it('debe lanzar 401 si no se puede identificar al usuario autenticado', async () => {
      await expect(service.crearBloqueo({}, dto)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('listarBloqueos', () => {
    it('debe mapear los bloqueos del barbero aplicando filtros', async () => {
      bloqueosRepository.listarPorBarbero.mockResolvedValue([crearRegistro()]);

      const resultado = await service.listarBloqueos(usuarioAutenticado, {
        fecha: '2026-10-20',
        status: ScheduleBlockStatus.ACTIVE,
      });

      expect(bloqueosRepository.listarPorBarbero).toHaveBeenCalledWith(7, {
        date: fecha,
        status: ScheduleBlockStatus.ACTIVE,
      });
      expect(resultado).toHaveLength(1);
      expect(resultado[0].date).toBe('2026-10-20');
      expect(resultado[0].status).toBe(ScheduleBlockStatus.ACTIVE);
    });

    it('no debe filtrar por fecha cuando no se envía', async () => {
      bloqueosRepository.listarPorBarbero.mockResolvedValue([]);

      await service.listarBloqueos(usuarioAutenticado, {});

      expect(bloqueosRepository.listarPorBarbero).toHaveBeenCalledWith(7, {
        date: undefined,
        status: undefined,
      });
    });
  });

  describe('actualizarBloqueo', () => {
    it('debe lanzar 404 si el bloqueo no existe', async () => {
      bloqueosRepository.obtenerPorId.mockResolvedValue(null);

      await expect(
        service.actualizarBloqueo(usuarioAutenticado, 1, { notes: 'x' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('debe lanzar 404 si el bloqueo pertenece a otro barbero', async () => {
      bloqueosRepository.obtenerPorId.mockResolvedValue(
        crearRegistro({ barberoId: 99 }),
      );

      await expect(
        service.actualizarBloqueo(usuarioAutenticado, 1, { notes: 'x' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('debe lanzar 409 si el bloqueo no está ACTIVE', async () => {
      bloqueosRepository.obtenerPorId.mockResolvedValue(
        crearRegistro({ status: ScheduleBlockStatus.CANCELLED }),
      );

      await expect(
        service.actualizarBloqueo(usuarioAutenticado, 1, { notes: 'x' }),
      ).rejects.toThrow(ConflictException);
    });

    it('debe permitir cambiar solo las notas sin revalidar reservas', async () => {
      bloqueosRepository.obtenerPorId.mockResolvedValue(crearRegistro());
      bloqueosRepository.actualizar.mockResolvedValue(
        crearRegistro({ notes: 'Nueva nota' }),
      );

      const resultado = await service.actualizarBloqueo(usuarioAutenticado, 1, {
        notes: 'Nueva nota',
      });

      expect(
        proveedorReservas.existeReservaNoCanceladaEnFranja,
      ).not.toHaveBeenCalled();
      expect(bloqueosRepository.actualizar).toHaveBeenCalledWith(1, {
        date: fecha,
        startTime: '15:00',
        endTime: '16:00',
        reason: ScheduleBlockReason.PERSONAL,
        notes: 'Nueva nota',
      });
      expect(resultado.block.notes).toBe('Nueva nota');
    });

    it('debe revalidar reservas cuando cambia el horario', async () => {
      bloqueosRepository.obtenerPorId.mockResolvedValue(crearRegistro());
      bloqueosRepository.actualizar.mockResolvedValue(
        crearRegistro({ startTime: '16:00', endTime: '17:00' }),
      );
      horariosRepository.obtenerFranjasActivasPorBarberoYDia.mockResolvedValue([
        { startTime: '16:00' },
      ] as any);

      await service.actualizarBloqueo(usuarioAutenticado, 1, {
        startTime: '16:00',
        endTime: '17:00',
      });

      expect(
        proveedorReservas.existeReservaNoCanceladaEnFranja,
      ).toHaveBeenCalledWith({
        barberoId: 7,
        fecha: '2026-10-20',
        startTime: '16:00',
        endTime: '17:00',
      });
    });

    it('debe fallar cerrado con 503 si cambia el horario y el proveedor no está disponible', async () => {
      bloqueosRepository.obtenerPorId.mockResolvedValue(crearRegistro());
      horariosRepository.obtenerFranjasActivasPorBarberoYDia.mockResolvedValue([
        { startTime: '16:00' },
      ] as any);
      proveedorReservas.existeReservaNoCanceladaEnFranja.mockRejectedValue(
        new ReservasNoDisponiblesError(),
      );

      await expect(
        service.actualizarBloqueo(usuarioAutenticado, 1, {
          startTime: '16:00',
          endTime: '17:00',
        }),
      ).rejects.toThrow(ServiceUnavailableException);
      expect(bloqueosRepository.actualizar).not.toHaveBeenCalled();
    });

    it('debe excluir el propio bloqueo al validar solapamiento al actualizar horario', async () => {
      bloqueosRepository.obtenerPorId.mockResolvedValue(
        crearRegistro({ id: 1 }),
      );
      bloqueosRepository.listarActivosPorBarberoYFecha.mockResolvedValue([
        crearRegistro({ id: 1, startTime: '16:00', endTime: '17:00' }),
      ]);
      horariosRepository.obtenerFranjasActivasPorBarberoYDia.mockResolvedValue([
        { startTime: '16:00' },
      ] as any);
      bloqueosRepository.actualizar.mockResolvedValue(
        crearRegistro({ id: 1, startTime: '16:00', endTime: '17:00' }),
      );

      const resultado = await service.actualizarBloqueo(usuarioAutenticado, 1, {
        startTime: '16:00',
        endTime: '17:00',
      });

      expect(resultado.mensaje).toBe('Bloqueo actualizado correctamente');
    });

    it('debe rechazar si coincide con un cierre general parcial que se solapa', async () => {
      bloqueosRepository.obtenerPorId.mockResolvedValue(crearRegistro());
      horariosRepository.obtenerFranjasActivasPorBarberoYDia.mockResolvedValue([
        { startTime: '16:00' },
      ] as any);
      cierresRepository.obtenerActivosEnFecha.mockResolvedValueOnce([
        { allDay: false, startTime: '16:15', endTime: '16:45' } as any,
      ]);

      await expect(
        service.actualizarBloqueo(usuarioAutenticado, 1, {
          startTime: '16:00',
          endTime: '17:00',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('debe propagar errores no previstos del proveedor de reservas', async () => {
      bloqueosRepository.obtenerPorId.mockResolvedValue(crearRegistro());
      horariosRepository.obtenerFranjasActivasPorBarberoYDia.mockResolvedValue([
        { startTime: '16:00' },
      ] as any);
      proveedorReservas.existeReservaNoCanceladaEnFranja.mockRejectedValue(
        new Error('Fallo inesperado de base de datos'),
      );

      await expect(
        service.actualizarBloqueo(usuarioAutenticado, 1, {
          startTime: '16:00',
          endTime: '17:00',
        }),
      ).rejects.toThrow('Fallo inesperado de base de datos');
    });
  });

  describe('cancelarBloqueo', () => {
    it('debe cambiar el estado a CANCELLED conservando el registro', async () => {
      bloqueosRepository.obtenerPorId.mockResolvedValue(crearRegistro());
      bloqueosRepository.actualizar.mockResolvedValue(
        crearRegistro({ status: ScheduleBlockStatus.CANCELLED }),
      );

      const resultado = await service.cancelarBloqueo(usuarioAutenticado, 1);

      expect(bloqueosRepository.actualizar).toHaveBeenCalledWith(1, {
        status: ScheduleBlockStatus.CANCELLED,
      });
      expect(resultado.block.status).toBe(ScheduleBlockStatus.CANCELLED);
      expect(resultado.mensaje).toBe('Bloqueo cancelado correctamente');
    });

    it('debe lanzar 409 si el bloqueo no está ACTIVE', async () => {
      bloqueosRepository.obtenerPorId.mockResolvedValue(
        crearRegistro({ status: ScheduleBlockStatus.REACTIVATED }),
      );

      await expect(
        service.cancelarBloqueo(usuarioAutenticado, 1),
      ).rejects.toThrow(ConflictException);
    });

    it('debe lanzar 404 si el bloqueo pertenece a otro barbero (sin mutar)', async () => {
      bloqueosRepository.obtenerPorId.mockResolvedValue(
        crearRegistro({ barberoId: 99 }),
      );

      await expect(
        service.cancelarBloqueo(usuarioAutenticado, 1),
      ).rejects.toThrow(NotFoundException);
      expect(bloqueosRepository.actualizar).not.toHaveBeenCalled();
    });

    it('debe lanzar 401 si no se puede identificar al usuario autenticado', async () => {
      await expect(service.cancelarBloqueo({}, 1)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(bloqueosRepository.actualizar).not.toHaveBeenCalled();
    });
  });

  describe('reactivarBloqueo', () => {
    it('debe cambiar ACTIVE a REACTIVATED y registrar auditoría', async () => {
      bloqueosRepository.obtenerPorId.mockResolvedValue(crearRegistro());
      bloqueosRepository.actualizar.mockResolvedValue(
        crearRegistro({
          status: ScheduleBlockStatus.REACTIVATED,
          reactivatedAt: new Date('2026-10-21T15:30:00.000Z'),
        }),
      );

      const resultado = await service.reactivarBloqueo(usuarioAutenticado, 1);

      expect(bloqueosRepository.actualizar).toHaveBeenCalledWith(1, {
        status: ScheduleBlockStatus.REACTIVATED,
        reactivatedAt: expect.any(Date),
        reactivatedBy: 10,
      });
      expect(resultado.block.status).toBe(ScheduleBlockStatus.REACTIVATED);
      expect(resultado.block.reactivatedAt).toBe('2026-10-21T15:30:00.000Z');
      expect(resultado.mensaje).toBe('Bloqueo reactivado correctamente');
    });

    it('debe lanzar 409 si el bloqueo no está ACTIVE', async () => {
      bloqueosRepository.obtenerPorId.mockResolvedValue(
        crearRegistro({ status: ScheduleBlockStatus.CANCELLED }),
      );

      await expect(
        service.reactivarBloqueo(usuarioAutenticado, 1),
      ).rejects.toThrow(ConflictException);
      expect(bloqueosRepository.actualizar).not.toHaveBeenCalled();
    });

    it('debe lanzar 404 si el bloqueo pertenece a otro barbero (sin mutar)', async () => {
      bloqueosRepository.obtenerPorId.mockResolvedValue(
        crearRegistro({ barberoId: 99 }),
      );

      await expect(
        service.reactivarBloqueo(usuarioAutenticado, 1),
      ).rejects.toThrow(NotFoundException);
      expect(bloqueosRepository.actualizar).not.toHaveBeenCalled();
    });

    it('debe lanzar 401 si no se puede identificar al usuario autenticado', async () => {
      await expect(service.reactivarBloqueo({}, 1)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(bloqueosRepository.actualizar).not.toHaveBeenCalled();
    });
  });

  describe('Operaciones administrativas de bloqueos por barberoId (SUPERADMIN)', () => {
    const actorAdmin = { id: 99, sub: '99', email: 'superadmin@test.com' };
    const barberoObjetivoId = 7;

    describe('crearBloqueoDeBarbero', () => {
      const dto = {
        date: '2026-10-20',
        startTime: '15:00',
        endTime: '16:00',
        reason: ScheduleBlockReason.PERSONAL,
        notes: 'Bloqueo asignado por SUPERADMIN',
      };

      it('debe crear un bloqueo para el barbero objetivo exitosamente', async () => {
        bloqueosRepository.crear.mockResolvedValue(
          crearRegistro({
            id: 20,
            barberoId: barberoObjetivoId,
            notes: 'Bloqueo asignado por SUPERADMIN',
          }),
        );

        const resultado = await service.crearBloqueoDeBarbero(
          barberoObjetivoId,
          dto,
        );

        expect(
          barberosRepository.obtenerBarberoActivoPorId,
        ).toHaveBeenCalledWith(barberoObjetivoId);
        expect(bloqueosRepository.crear).toHaveBeenCalledWith({
          barberoId: barberoObjetivoId,
          date: fecha,
          startTime: '15:00',
          endTime: '16:00',
          reason: ScheduleBlockReason.PERSONAL,
          notes: 'Bloqueo asignado por SUPERADMIN',
        });
        expect(resultado.mensaje).toBe('Bloqueo creado correctamente');
        expect(resultado.block.id).toBe(20);
      });

      it('debe lanzar NotFoundException si el barbero objetivo no existe o está inactivo', async () => {
        barberosRepository.obtenerBarberoActivoPorId.mockResolvedValueOnce(
          null,
        );

        await expect(service.crearBloqueoDeBarbero(999, dto)).rejects.toThrow(
          NotFoundException,
        );
        expect(bloqueosRepository.crear).not.toHaveBeenCalled();
      });
    });

    describe('listarBloqueosDeBarbero', () => {
      it('debe listar los bloqueos del barbero objetivo sin filtro de fecha', async () => {
        bloqueosRepository.listarPorBarbero.mockResolvedValue([
          crearRegistro({ id: 10, barberoId: barberoObjetivoId }),
        ]);

        const resultado = await service.listarBloqueosDeBarbero(
          barberoObjetivoId,
          {},
        );

        expect(resultado).toHaveLength(1);
        expect(resultado[0].id).toBe(10);
        expect(bloqueosRepository.listarPorBarbero).toHaveBeenCalledWith(
          barberoObjetivoId,
          { date: undefined, status: undefined },
        );
      });

      it('debe listar los bloqueos del barbero filtrando por fecha válida', async () => {
        bloqueosRepository.listarPorBarbero.mockResolvedValue([
          crearRegistro({ id: 11, barberoId: barberoObjetivoId }),
        ]);

        const resultado = await service.listarBloqueosDeBarbero(
          barberoObjetivoId,
          { fecha: '2026-10-20' },
        );

        expect(resultado).toHaveLength(1);
        expect(resultado[0].id).toBe(11);
        expect(bloqueosRepository.listarPorBarbero).toHaveBeenCalledWith(
          barberoObjetivoId,
          { date: fecha, status: undefined },
        );
      });

      it('debe lanzar NotFoundException si el barbero objetivo no existe', async () => {
        barberosRepository.obtenerBarberoActivoPorId.mockResolvedValueOnce(
          null,
        );

        await expect(service.listarBloqueosDeBarbero(999, {})).rejects.toThrow(
          NotFoundException,
        );
      });
    });

    describe('actualizarBloqueoDeBarbero', () => {
      const dto = {
        date: '2026-10-20',
        startTime: '15:00',
        endTime: '16:00',
        notes: 'Nota actualizada por SUPERADMIN',
      };

      it('debe actualizar el bloqueo del barbero objetivo exitosamente', async () => {
        bloqueosRepository.obtenerPorId.mockResolvedValue(
          crearRegistro({ id: 5, barberoId: barberoObjetivoId }),
        );
        bloqueosRepository.actualizar.mockResolvedValue(
          crearRegistro({
            id: 5,
            barberoId: barberoObjetivoId,
            notes: 'Nota actualizada por SUPERADMIN',
          }),
        );

        const resultado = await service.actualizarBloqueoDeBarbero(
          barberoObjetivoId,
          5,
          dto,
        );

        expect(resultado.mensaje).toBe('Bloqueo actualizado correctamente');
        expect(resultado.block.notes).toBe('Nota actualizada por SUPERADMIN');
        expect(bloqueosRepository.actualizar).toHaveBeenCalledWith(5, {
          date: fecha,
          startTime: '15:00',
          endTime: '16:00',
          reason: ScheduleBlockReason.PERSONAL,
          notes: 'Nota actualizada por SUPERADMIN',
        });
      });

      it('debe lanzar NotFoundException si el bloqueo no pertenece al barbero objetivo', async () => {
        bloqueosRepository.obtenerPorId.mockResolvedValue(
          crearRegistro({ id: 5, barberoId: 999 }),
        );

        await expect(
          service.actualizarBloqueoDeBarbero(barberoObjetivoId, 5, dto),
        ).rejects.toThrow(NotFoundException);
        expect(bloqueosRepository.actualizar).not.toHaveBeenCalled();
      });

      it('debe lanzar NotFoundException si el barbero objetivo no existe', async () => {
        barberosRepository.obtenerBarberoActivoPorId.mockResolvedValueOnce(
          null,
        );

        await expect(
          service.actualizarBloqueoDeBarbero(999, 5, dto),
        ).rejects.toThrow(NotFoundException);
      });
    });

    describe('cancelarBloqueoDeBarbero', () => {
      it('debe cancelar el bloqueo del barbero objetivo exitosamente', async () => {
        bloqueosRepository.obtenerPorId.mockResolvedValue(
          crearRegistro({ id: 5, barberoId: barberoObjetivoId }),
        );
        bloqueosRepository.actualizar.mockResolvedValue(
          crearRegistro({
            id: 5,
            barberoId: barberoObjetivoId,
            status: ScheduleBlockStatus.CANCELLED,
          }),
        );

        const resultado = await service.cancelarBloqueoDeBarbero(
          barberoObjetivoId,
          5,
        );

        expect(resultado.mensaje).toBe('Bloqueo cancelado correctamente');
        expect(resultado.block.status).toBe(ScheduleBlockStatus.CANCELLED);
        expect(bloqueosRepository.actualizar).toHaveBeenCalledWith(
          5,
          expect.objectContaining({
            status: ScheduleBlockStatus.CANCELLED,
          }),
        );
      });

      it('debe lanzar ConflictException si el bloqueo ya estaba cancelado', async () => {
        bloqueosRepository.obtenerPorId.mockResolvedValue(
          crearRegistro({
            id: 5,
            barberoId: barberoObjetivoId,
            status: ScheduleBlockStatus.CANCELLED,
          }),
        );

        await expect(
          service.cancelarBloqueoDeBarbero(barberoObjetivoId, 5),
        ).rejects.toThrow(ConflictException);
        expect(bloqueosRepository.actualizar).not.toHaveBeenCalled();
      });

      it('debe lanzar NotFoundException si el barbero objetivo no existe', async () => {
        barberosRepository.obtenerBarberoActivoPorId.mockResolvedValueOnce(
          null,
        );

        await expect(service.cancelarBloqueoDeBarbero(999, 5)).rejects.toThrow(
          NotFoundException,
        );
      });
    });

    describe('reactivarBloqueoDeBarbero', () => {
      it('debe reactivar un bloqueo ACTIVE del barbero objetivo exitosamente', async () => {
        bloqueosRepository.obtenerPorId.mockResolvedValue(
          crearRegistro({ id: 5, barberoId: barberoObjetivoId }),
        );
        bloqueosRepository.actualizar.mockResolvedValue(
          crearRegistro({
            id: 5,
            barberoId: barberoObjetivoId,
            status: ScheduleBlockStatus.REACTIVATED,
          }),
        );

        const resultado = await service.reactivarBloqueoDeBarbero(
          barberoObjetivoId,
          5,
          actorAdmin,
        );

        expect(resultado.mensaje).toBe('Bloqueo reactivado correctamente');
        expect(resultado.block.status).toBe(ScheduleBlockStatus.REACTIVATED);
        expect(bloqueosRepository.actualizar).toHaveBeenCalledWith(
          5,
          expect.objectContaining({
            status: ScheduleBlockStatus.REACTIVATED,
            reactivatedBy: 99,
          }),
        );
      });

      it('debe lanzar ConflictException si el bloqueo no está ACTIVE', async () => {
        bloqueosRepository.obtenerPorId.mockResolvedValue(
          crearRegistro({
            id: 5,
            barberoId: barberoObjetivoId,
            status: ScheduleBlockStatus.CANCELLED,
          }),
        );

        await expect(
          service.reactivarBloqueoDeBarbero(barberoObjetivoId, 5, actorAdmin),
        ).rejects.toThrow(ConflictException);
        expect(bloqueosRepository.actualizar).not.toHaveBeenCalled();
      });

      it('debe lanzar NotFoundException si el barbero objetivo no existe', async () => {
        barberosRepository.obtenerBarberoActivoPorId.mockResolvedValueOnce(
          null,
        );

        await expect(
          service.reactivarBloqueoDeBarbero(999, 5, actorAdmin),
        ).rejects.toThrow(NotFoundException);
      });
    });
  });
});
