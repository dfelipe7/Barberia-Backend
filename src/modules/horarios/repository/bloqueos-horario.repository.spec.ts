import { Test, TestingModule } from '@nestjs/testing';
import { BloqueosHorarioRepository } from './bloqueos-horario.repository';
import { PrismaService } from '../../../prisma/prisma.service';

jest.mock('../../../../generated/prisma/enums', () => ({
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

const mockPrismaService = {
  barberScheduleBlock: {
    create: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  },
};

describe('BloqueosHorarioRepository', () => {
  let repository: BloqueosHorarioRepository;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BloqueosHorarioRepository,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    repository = module.get<BloqueosHorarioRepository>(
      BloqueosHorarioRepository,
    );
    jest.clearAllMocks();
  });

  it('debe estar definido', () => {
    expect(repository).toBeDefined();
  });

  describe('crear', () => {
    it('debe crear un bloqueo ACTIVE con los datos recibidos', async () => {
      const fecha = new Date('2026-10-20T00:00:00.000Z');
      mockPrismaService.barberScheduleBlock.create.mockResolvedValue({ id: 1 });

      const resultado = await repository.crear({
        barberoId: 7,
        date: fecha,
        startTime: '15:00',
        endTime: '16:00',
        reason: ScheduleBlockReason.PERSONAL,
        notes: 'Cita personal',
      });

      expect(mockPrismaService.barberScheduleBlock.create).toHaveBeenCalledWith(
        {
          data: {
            barberoId: 7,
            date: fecha,
            startTime: '15:00',
            endTime: '16:00',
            reason: ScheduleBlockReason.PERSONAL,
            notes: 'Cita personal',
            status: ScheduleBlockStatus.ACTIVE,
          },
        },
      );
      expect(resultado).toEqual({ id: 1 });
    });
  });

  describe('obtenerPorId', () => {
    it('debe consultar un bloqueo por id', async () => {
      mockPrismaService.barberScheduleBlock.findUnique.mockResolvedValue({
        id: 3,
      });

      const resultado = await repository.obtenerPorId(3);

      expect(
        mockPrismaService.barberScheduleBlock.findUnique,
      ).toHaveBeenCalledWith({ where: { id: 3 } });
      expect(resultado).toEqual({ id: 3 });
    });
  });

  describe('listarPorBarbero', () => {
    it('debe filtrar por fecha y estado cuando se envían, ordenando por fecha y hora', async () => {
      const fecha = new Date('2026-10-20T00:00:00.000Z');
      mockPrismaService.barberScheduleBlock.findMany.mockResolvedValue([]);

      await repository.listarPorBarbero(7, {
        date: fecha,
        status: ScheduleBlockStatus.ACTIVE,
      });

      expect(
        mockPrismaService.barberScheduleBlock.findMany,
      ).toHaveBeenCalledWith({
        where: {
          barberoId: 7,
          date: fecha,
          status: ScheduleBlockStatus.ACTIVE,
        },
        orderBy: [{ date: 'desc' }, { startTime: 'asc' }],
      });
    });

    it('no debe incluir filtros cuando no se envían', async () => {
      mockPrismaService.barberScheduleBlock.findMany.mockResolvedValue([]);

      await repository.listarPorBarbero(7);

      expect(
        mockPrismaService.barberScheduleBlock.findMany,
      ).toHaveBeenCalledWith({
        where: { barberoId: 7 },
        orderBy: [{ date: 'desc' }, { startTime: 'asc' }],
      });
    });
  });

  describe('listarActivosPorBarberoYFecha', () => {
    it('debe consultar solo bloqueos ACTIVE del barbero en la fecha', async () => {
      const fecha = new Date('2026-10-20T00:00:00.000Z');
      mockPrismaService.barberScheduleBlock.findMany.mockResolvedValue([]);

      await repository.listarActivosPorBarberoYFecha(7, fecha);

      expect(
        mockPrismaService.barberScheduleBlock.findMany,
      ).toHaveBeenCalledWith({
        where: {
          barberoId: 7,
          date: fecha,
          status: ScheduleBlockStatus.ACTIVE,
        },
      });
    });
  });

  describe('actualizar', () => {
    it('debe actualizar el bloqueo con los datos recibidos', async () => {
      mockPrismaService.barberScheduleBlock.update.mockResolvedValue({ id: 3 });

      const resultado = await repository.actualizar(3, {
        status: ScheduleBlockStatus.CANCELLED,
      });

      expect(mockPrismaService.barberScheduleBlock.update).toHaveBeenCalledWith(
        {
          where: { id: 3 },
          data: { status: ScheduleBlockStatus.CANCELLED },
        },
      );
      expect(resultado).toEqual({ id: 3 });
    });
  });
});
