import { Test, TestingModule } from '@nestjs/testing';
import {
  ESTADOS_QUE_OCUPAN_AGENDA,
  ReservasRepository,
} from './reservas.repository';
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
  ReservationStatus: {
    PENDING: 'PENDING',
    CONFIRMED: 'CONFIRMED',
    IN_PROGRESS: 'IN_PROGRESS',
    COMPLETED: 'COMPLETED',
    CANCELLED: 'CANCELLED',
  },
}));

import { ReservationStatus, WeekDay } from '../../../../generated/prisma/enums';

const mockPrismaService = {
  reservation: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  $transaction: jest.fn(),
};

const fecha = new Date('2026-11-01T00:00:00.000Z');

describe('ReservasRepository', () => {
  let repository: ReservasRepository;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReservasRepository,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    repository = module.get<ReservasRepository>(ReservasRepository);
    jest.clearAllMocks();
  });

  it('debe estar definido', () => {
    expect(repository).toBeDefined();
  });

  describe('política de ocupación', () => {
    it('debe ocupar agenda con todos los estados no cancelados y excluir CANCELLED', () => {
      expect(ESTADOS_QUE_OCUPAN_AGENDA).toEqual([
        ReservationStatus.PENDING,
        ReservationStatus.CONFIRMED,
        ReservationStatus.IN_PROGRESS,
        ReservationStatus.COMPLETED,
      ]);
      expect(ESTADOS_QUE_OCUPAN_AGENDA).not.toContain(
        ReservationStatus.CANCELLED,
      );
    });
  });

  describe('existeReservaQueOcupaEnFranja', () => {
    it('debe devolver true y filtrar por barbero, fecha, estados que ocupan y solape', async () => {
      mockPrismaService.reservation.findFirst.mockResolvedValue({ id: 7 });

      const resultado = await repository.existeReservaQueOcupaEnFranja({
        barberoId: 3,
        fecha,
        startTime: '09:00',
        endTime: '10:00',
      });

      expect(resultado).toBe(true);
      expect(mockPrismaService.reservation.findFirst).toHaveBeenCalledWith({
        where: {
          barberoId: 3,
          date: fecha,
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
        },
        select: { id: true },
      });
    });

    it('debe devolver false cuando no hay reservas que ocupen la franja', async () => {
      mockPrismaService.reservation.findFirst.mockResolvedValue(null);

      const resultado = await repository.existeReservaQueOcupaEnFranja({
        barberoId: 3,
        fecha,
        startTime: '09:00',
        endTime: '10:00',
      });

      expect(resultado).toBe(false);
    });
  });

  describe('existeReservaQueOcupaEnFranjaSemanal', () => {
    it('debe filtrar por barbero, día de la semana, estados que ocupan y solape', async () => {
      mockPrismaService.reservation.findFirst.mockResolvedValue({ id: 8 });

      const resultado = await repository.existeReservaQueOcupaEnFranjaSemanal({
        barberoId: 3,
        dayOfWeek: WeekDay.MONDAY,
        startTime: '09:00',
        endTime: '10:00',
      });

      expect(resultado).toBe(true);
      expect(mockPrismaService.reservation.findFirst).toHaveBeenCalledWith({
        where: {
          barberoId: 3,
          dayOfWeek: WeekDay.MONDAY,
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
        },
        select: { id: true },
      });
    });

    it('debe devolver false cuando no hay reservas que ocupen la franja semanal', async () => {
      mockPrismaService.reservation.findFirst.mockResolvedValue(null);

      const resultado = await repository.existeReservaQueOcupaEnFranjaSemanal({
        barberoId: 3,
        dayOfWeek: WeekDay.SUNDAY,
        startTime: '15:00',
        endTime: '16:00',
      });

      expect(resultado).toBe(false);
    });
  });

  describe('obtenerPorId', () => {
    it('debe consultar la reserva por id', async () => {
      mockPrismaService.reservation.findUnique.mockResolvedValue({ id: 5 });

      const resultado = await repository.obtenerPorId(5);

      expect(resultado).toEqual({ id: 5 });
      expect(mockPrismaService.reservation.findUnique).toHaveBeenCalledWith({
        where: { id: 5 },
      });
    });
  });

  describe('crearConBloqueo', () => {
    it('debe bloquear la fila del barbero con FOR UPDATE y crear en la misma transacción', async () => {
      const txMock = {
        $queryRaw: jest.fn().mockResolvedValue([{ id: 3 }]),
        reservation: { create: jest.fn().mockResolvedValue({ id: 99 }) },
      };
      mockPrismaService.$transaction.mockImplementation(
        async (cb: (tx: typeof txMock) => Promise<unknown>) => cb(txMock),
      );

      const resultado = await repository.crearConBloqueo({
        barberoId: 3,
        date: fecha,
        dayOfWeek: WeekDay.MONDAY,
        startTime: '09:00',
        endTime: '10:00',
      });

      expect(mockPrismaService.$transaction).toHaveBeenCalledTimes(1);
      expect(txMock.$queryRaw).toHaveBeenCalledTimes(1);
      const llamadas = txMock.$queryRaw.mock.calls as unknown[][];
      const sql = (llamadas[0][0] as string[]).join('?');
      expect(sql).toContain('FOR UPDATE');
      expect(sql).toContain('Barbero');
      expect(llamadas[0][1]).toBe(3);
      expect(txMock.reservation.create).toHaveBeenCalledWith({
        data: {
          barberoId: 3,
          date: fecha,
          dayOfWeek: WeekDay.MONDAY,
          startTime: '09:00',
          endTime: '10:00',
          status: ReservationStatus.PENDING,
        },
      });
      expect(resultado).toEqual({ id: 99 });
    });
  });

  describe('cancelar', () => {
    it('debe pasar la reserva a CANCELLED sin borrarla', async () => {
      mockPrismaService.reservation.update.mockResolvedValue({
        id: 5,
        status: ReservationStatus.CANCELLED,
      });

      const resultado = await repository.cancelar(5);

      expect(mockPrismaService.reservation.update).toHaveBeenCalledWith({
        where: { id: 5 },
        data: { status: ReservationStatus.CANCELLED },
      });
      expect(resultado).toEqual({
        id: 5,
        status: ReservationStatus.CANCELLED,
      });
    });
  });
});
