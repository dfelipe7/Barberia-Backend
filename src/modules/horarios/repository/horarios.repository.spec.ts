import { Test, TestingModule } from '@nestjs/testing';
import { HorariosRepository } from './horarios.repository';
import { PrismaService } from '../../../prisma/prisma.service';

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

const mockPrismaService = {
  barberWeeklySlot: {
    findMany: jest.fn(),
    upsert: jest.fn(),
  },
  $transaction: jest.fn(),
};

describe('HorariosRepository', () => {
  let repository: HorariosRepository;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HorariosRepository,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    repository = module.get<HorariosRepository>(HorariosRepository);
    jest.clearAllMocks();
  });

  it('debe estar definido', () => {
    expect(repository).toBeDefined();
  });

  describe('obtenerFranjasActivasPorBarbero', () => {
    it('debe consultar solo las franjas activas ordenadas por día y hora', async () => {
      mockPrismaService.barberWeeklySlot.findMany.mockResolvedValue([
        { id: 1 },
      ]);

      const resultado = await repository.obtenerFranjasActivasPorBarbero(5);

      expect(mockPrismaService.barberWeeklySlot.findMany).toHaveBeenCalledWith({
        where: { barberoId: 5, active: true },
        orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
      });
      expect(resultado).toEqual([{ id: 1 }]);
    });
  });

  describe('reemplazarFranjas', () => {
    it('debe hacer upsert por cada franja en una transacción y retornar las activas', async () => {
      mockPrismaService.$transaction.mockResolvedValue([]);
      mockPrismaService.barberWeeklySlot.findMany.mockResolvedValue([
        { id: 9 },
      ]);

      const franjas = [
        { dayOfWeek: WeekDay.MONDAY, startTime: '09:00', endTime: '10:00' },
      ];

      const resultado = await repository.reemplazarFranjas(3, franjas);

      expect(mockPrismaService.$transaction).toHaveBeenCalledTimes(1);
      const operaciones = mockPrismaService.$transaction.mock
        .calls[0][0] as unknown[];
      expect(operaciones).toHaveLength(1);
      expect(mockPrismaService.barberWeeklySlot.upsert).toHaveBeenCalledWith({
        where: {
          barberoId_dayOfWeek_startTime: {
            barberoId: 3,
            dayOfWeek: WeekDay.MONDAY,
            startTime: '09:00',
          },
        },
        update: { endTime: '10:00', active: true },
        create: {
          barberoId: 3,
          dayOfWeek: WeekDay.MONDAY,
          startTime: '09:00',
          endTime: '10:00',
          active: true,
        },
      });
      expect(resultado).toEqual([{ id: 9 }]);
    });

    it('no debe abrir transacción cuando la lista está vacía y retorna las activas', async () => {
      mockPrismaService.barberWeeklySlot.findMany.mockResolvedValue([]);

      const resultado = await repository.reemplazarFranjas(3, []);

      expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
      expect(resultado).toEqual([]);
    });
  });
});
