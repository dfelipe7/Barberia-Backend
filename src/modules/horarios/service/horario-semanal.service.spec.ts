import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { HorarioSemanalService } from './horario-semanal.service';
import { HorariosRepository } from '../repository/horarios.repository';
import { BarberosRepository } from '../../usuarios/repository/barberos.repository';
import { FranjaFactory } from '../factory/franja.factory';

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
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HorarioSemanalService,
        { provide: HorariosRepository, useValue: mockHorariosRepository },
        { provide: BarberosRepository, useValue: mockBarberosRepository },
        FranjaFactory,
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

    it('debe lanzar ConflictException si la nueva lista elimina una franja existente', async () => {
      horariosRepository.obtenerFranjasActivasPorBarbero.mockResolvedValue([
        { dayOfWeek: WeekDay.MONDAY, startTime: '09:00', endTime: '10:00' },
      ] as any);

      const dto = { franjas: [] };

      await expect(
        service.reemplazarMiHorarioSemanal(usuarioAutenticado, dto),
      ).rejects.toThrow(ConflictException);
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
});
