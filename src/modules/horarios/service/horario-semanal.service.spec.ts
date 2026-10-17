import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { HorarioSemanalService } from './horario-semanal.service';
import { HorariosRepository } from '../repository/horarios.repository';
import { BarberosRepository } from '../../usuarios/repository/barberos.repository';
import { FranjaFactory } from '../factory/franja.factory';
import {
  PROVEEDOR_RESERVAS_ACTIVAS,
  ReservasNoDisponiblesError,
} from '../ports/proveedor-reservas-activas.port';
import {
  CODIGOS_CONFLICTO,
  DomainConflictException,
} from '../../../common/exceptions/domain-conflict.exception';

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
}));

import { WeekDay } from '../../../../generated/prisma/enums';

describe('HorarioSemanalService', () => {
  let service: HorarioSemanalService;
  let horariosRepository: jest.Mocked<HorariosRepository>;
  let barberosRepository: jest.Mocked<BarberosRepository>;
  let proveedorReservas: {
    existeReservaNoCanceladaEnFranjaSemanal: jest.Mock;
  };

  const usuarioAutenticado = { id: 10, sub: '10', email: 'barbero@test.com' };

  beforeEach(async () => {
    const mockHorariosRepository = {
      obtenerFranjasActivasPorBarbero: jest.fn().mockResolvedValue([]),
      reemplazarFranjas: jest.fn().mockResolvedValue([]),
    };

    const mockBarberosRepository = {
      obtenerBarberoPorUsuarioId: jest
        .fn()
        .mockResolvedValue({ id: 7, usuarioId: 10 }),
      obtenerBarberoActivoPorId: jest
        .fn()
        .mockResolvedValue({ id: 7, usuarioId: 10 }),
    };

    proveedorReservas = {
      existeReservaNoCanceladaEnFranjaSemanal: jest
        .fn()
        .mockResolvedValue(false),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HorarioSemanalService,
        { provide: HorariosRepository, useValue: mockHorariosRepository },
        { provide: BarberosRepository, useValue: mockBarberosRepository },
        FranjaFactory,
        { provide: PROVEEDOR_RESERVAS_ACTIVAS, useValue: proveedorReservas },
      ],
    }).compile();

    service = module.get<HorarioSemanalService>(HorarioSemanalService);
    horariosRepository = module.get(HorariosRepository);
    barberosRepository = module.get(BarberosRepository);
    jest.clearAllMocks();
  });

  it('debe estar definido', () => {
    expect(service).toBeDefined();
  });

  describe('obtenerMiHorarioSemanal', () => {
    it('debe resolver el barbero desde el usuario autenticado y mapear sus franjas', async () => {
      horariosRepository.obtenerFranjasActivasPorBarbero.mockResolvedValue([
        { dayOfWeek: WeekDay.MONDAY, startTime: '09:00', endTime: '10:00' },
      ] as any);

      const resultado =
        await service.obtenerMiHorarioSemanal(usuarioAutenticado);

      expect(
        barberosRepository.obtenerBarberoPorUsuarioId,
      ).toHaveBeenCalledWith(10);
      expect(
        horariosRepository.obtenerFranjasActivasPorBarbero,
      ).toHaveBeenCalledWith(7);
      expect(resultado).toEqual({
        barberoId: 7,
        franjas: [
          { dayOfWeek: WeekDay.MONDAY, startTime: '09:00', endTime: '10:00' },
        ],
      });
    });

    it('debe lanzar ForbiddenException si el usuario no tiene perfil de barbero', async () => {
      barberosRepository.obtenerBarberoPorUsuarioId.mockResolvedValue(null);

      await expect(
        service.obtenerMiHorarioSemanal(usuarioAutenticado),
      ).rejects.toThrow(ForbiddenException);
    });

    it('debe lanzar UnauthorizedException si no se puede identificar el usuario', async () => {
      await expect(service.obtenerMiHorarioSemanal({})).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('reemplazarMiHorarioSemanal', () => {
    it('debe reemplazar el horario cuando solo se agregan franjas', async () => {
      const dto = {
        franjas: [
          { dayOfWeek: WeekDay.MONDAY, startTime: '09:00', endTime: '10:00' },
        ],
      };
      horariosRepository.reemplazarFranjas.mockResolvedValue(
        dto.franjas as any,
      );

      const resultado = await service.reemplazarMiHorarioSemanal(
        usuarioAutenticado,
        dto,
      );

      expect(horariosRepository.reemplazarFranjas).toHaveBeenCalledWith(
        7,
        dto.franjas,
      );
      expect(resultado).toEqual({
        barberoId: 7,
        franjas: [
          { dayOfWeek: WeekDay.MONDAY, startTime: '09:00', endTime: '10:00' },
        ],
      });
    });

    it('debe reemplazar el horario cuando solo se agregan franjas sin consultar reservas', async () => {
      horariosRepository.obtenerFranjasActivasPorBarbero.mockResolvedValue([
        { dayOfWeek: WeekDay.MONDAY, startTime: '09:00', endTime: '10:00' },
      ] as any);
      const dto = {
        franjas: [
          { dayOfWeek: WeekDay.MONDAY, startTime: '09:00', endTime: '10:00' },
          { dayOfWeek: WeekDay.TUESDAY, startTime: '09:00', endTime: '10:00' },
        ],
      };
      horariosRepository.reemplazarFranjas.mockResolvedValue(
        dto.franjas as any,
      );

      await service.reemplazarMiHorarioSemanal(usuarioAutenticado, dto);

      expect(
        proveedorReservas.existeReservaNoCanceladaEnFranjaSemanal,
      ).not.toHaveBeenCalled();
      expect(horariosRepository.reemplazarFranjas).toHaveBeenCalledWith(
        7,
        dto.franjas,
      );
    });

    it('debe permitir eliminar una franja cuando no tiene reservas no canceladas', async () => {
      horariosRepository.obtenerFranjasActivasPorBarbero.mockResolvedValue([
        { dayOfWeek: WeekDay.MONDAY, startTime: '09:00', endTime: '10:00' },
      ] as any);
      proveedorReservas.existeReservaNoCanceladaEnFranjaSemanal.mockResolvedValue(
        false,
      );

      const dto = { franjas: [] };

      await service.reemplazarMiHorarioSemanal(usuarioAutenticado, dto);

      expect(
        proveedorReservas.existeReservaNoCanceladaEnFranjaSemanal,
      ).toHaveBeenCalledWith({
        barberoId: 7,
        dayOfWeek: WeekDay.MONDAY,
        startTime: '09:00',
        endTime: '10:00',
      });
      expect(horariosRepository.reemplazarFranjas).toHaveBeenCalledWith(7, []);
    });

    it('debe lanzar 409 con código SCHEDULE_CHANGE_AFFECTS_RESERVATIONS si la franja eliminada tiene reservas', async () => {
      horariosRepository.obtenerFranjasActivasPorBarbero.mockResolvedValue([
        { dayOfWeek: WeekDay.MONDAY, startTime: '09:00', endTime: '10:00' },
      ] as any);
      proveedorReservas.existeReservaNoCanceladaEnFranjaSemanal.mockResolvedValue(
        true,
      );

      const dto = { franjas: [] };

      const capturado: unknown = await service
        .reemplazarMiHorarioSemanal(usuarioAutenticado, dto)
        .then(() => undefined)
        .catch((e: unknown) => e);

      expect(capturado).toBeInstanceOf(DomainConflictException);
      const excepcion = capturado as DomainConflictException;
      expect(excepcion.getStatus()).toBe(409);
      expect(excepcion.getResponse()).toMatchObject({
        code: CODIGOS_CONFLICTO.SCHEDULE_CHANGE_AFFECTS_RESERVATIONS,
        details: {
          dayOfWeek: WeekDay.MONDAY,
          startTime: '09:00',
          endTime: '10:00',
        },
      });
      expect(horariosRepository.reemplazarFranjas).not.toHaveBeenCalled();
    });

    it('debe fallar cerrado con 503 si HE-04 no está disponible y hay franjas afectadas', async () => {
      horariosRepository.obtenerFranjasActivasPorBarbero.mockResolvedValue([
        { dayOfWeek: WeekDay.MONDAY, startTime: '09:00', endTime: '10:00' },
      ] as any);
      proveedorReservas.existeReservaNoCanceladaEnFranjaSemanal.mockRejectedValue(
        new ReservasNoDisponiblesError(),
      );

      const dto = { franjas: [] };

      await expect(
        service.reemplazarMiHorarioSemanal(usuarioAutenticado, dto),
      ).rejects.toThrow(ServiceUnavailableException);
      expect(horariosRepository.reemplazarFranjas).not.toHaveBeenCalled();
    });

    it('debe lanzar BadRequestException con una franja fuera de la jornada', async () => {
      const dto = {
        franjas: [
          { dayOfWeek: WeekDay.MONDAY, startTime: '08:00', endTime: '09:00' },
        ],
      };

      await expect(
        service.reemplazarMiHorarioSemanal(usuarioAutenticado, dto),
      ).rejects.toThrow(BadRequestException);
    });

    it('debe lanzar BadRequestException con una duración distinta de 60 minutos', async () => {
      const dto = {
        franjas: [
          { dayOfWeek: WeekDay.MONDAY, startTime: '09:00', endTime: '11:00' },
        ],
      };

      await expect(
        service.reemplazarMiHorarioSemanal(usuarioAutenticado, dto),
      ).rejects.toThrow(BadRequestException);
    });

    it('debe lanzar BadRequestException con franjas solapadas el mismo día', async () => {
      const dto = {
        franjas: [
          { dayOfWeek: WeekDay.MONDAY, startTime: '09:00', endTime: '10:00' },
          { dayOfWeek: WeekDay.MONDAY, startTime: '09:00', endTime: '10:00' },
        ],
      };

      await expect(
        service.reemplazarMiHorarioSemanal(usuarioAutenticado, dto),
      ).rejects.toThrow(BadRequestException);
    });

    it('debe lanzar ForbiddenException si el usuario no tiene perfil de barbero', async () => {
      barberosRepository.obtenerBarberoPorUsuarioId.mockResolvedValue(null);

      const dto = { franjas: [] };

      await expect(
        service.reemplazarMiHorarioSemanal(usuarioAutenticado, dto),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('SUPERADMIN: Operaciones de Horario Semanal de Terceros', () => {
    describe('obtenerHorarioSemanalDeBarbero', () => {
      it('debe lanzar NotFoundException si el barbero objetivo no existe o no está activo', async () => {
        barberosRepository.obtenerBarberoActivoPorId.mockResolvedValue(null);

        await expect(
          service.obtenerHorarioSemanalDeBarbero(999),
        ).rejects.toThrow(NotFoundException);
      });

      it('debe retornar el horario semanal de cualquier barbero cuando existe', async () => {
        const franjas = [
          {
            id: 1,
            barberoId: 7,
            dayOfWeek: WeekDay.MONDAY,
            startTime: '09:00',
            endTime: '10:00',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ];
        horariosRepository.obtenerFranjasActivasPorBarbero.mockResolvedValue(
          franjas as any,
        );

        const resultado = await service.obtenerHorarioSemanalDeBarbero(7);

        expect(resultado.barberoId).toBe(7);
        expect(resultado.franjas).toHaveLength(1);
        expect(resultado.franjas[0].startTime).toBe('09:00');
      });
    });

    describe('reemplazarHorarioSemanalDeBarbero', () => {
      it('debe lanzar NotFoundException si el barbero objetivo no existe o no está activo', async () => {
        barberosRepository.obtenerBarberoActivoPorId.mockResolvedValue(null);

        await expect(
          service.reemplazarHorarioSemanalDeBarbero(999, { franjas: [] }),
        ).rejects.toThrow(NotFoundException);
      });

      it('debe reemplazar el horario semanal de cualquier barbero si las franjas son válidas y no colisionan', async () => {
        const dto = {
          franjas: [
            { dayOfWeek: WeekDay.MONDAY, startTime: '10:00', endTime: '11:00' },
          ],
        };
        horariosRepository.obtenerFranjasActivasPorBarbero.mockResolvedValue(
          [],
        );
        horariosRepository.reemplazarFranjas.mockResolvedValue([
          {
            id: 10,
            barberoId: 7,
            dayOfWeek: WeekDay.MONDAY,
            startTime: '10:00',
            endTime: '11:00',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ] as any);

        const resultado = await service.reemplazarHorarioSemanalDeBarbero(
          7,
          dto,
        );

        expect(resultado.barberoId).toBe(7);
        expect(resultado.franjas).toHaveLength(1);
        expect(resultado.franjas[0].startTime).toBe('10:00');
      });

      it('debe rechazar con 409 si se intenta eliminar una franja que tiene reservas activas', async () => {
        const existentes = [
          {
            id: 1,
            barberoId: 7,
            dayOfWeek: WeekDay.MONDAY,
            startTime: '09:00',
            endTime: '10:00',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ];
        horariosRepository.obtenerFranjasActivasPorBarbero.mockResolvedValue(
          existentes as any,
        );
        proveedorReservas.existeReservaNoCanceladaEnFranjaSemanal.mockResolvedValue(
          true,
        );

        const dto = { franjas: [] }; // Intenta eliminar la franja existente

        await expect(
          service.reemplazarHorarioSemanalDeBarbero(7, dto),
        ).rejects.toThrow(ConflictException);
      });
    });
  });
});
