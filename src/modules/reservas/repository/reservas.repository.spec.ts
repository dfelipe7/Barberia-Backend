import { Test, TestingModule } from '@nestjs/testing';
import {
  ESTADOS_QUE_OCUPAN_AGENDA,
  ReservasRepository,
  esErrorReintentableTransaccion,
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
    findMany: jest.fn(),
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
    it('debe bloquear la fila del barbero y crear la reserva sobre un cliente existente', async () => {
      const txMock = {
        $queryRaw: jest.fn().mockResolvedValue([{ id: 3 }]),
        cliente: { create: jest.fn() },
        reservation: { create: jest.fn().mockResolvedValue({ id: 99 }) },
      };
      mockPrismaService.$transaction.mockImplementation(
        async (cb: (tx: typeof txMock) => Promise<unknown>) => cb(txMock),
      );

      const resultado = await repository.crearConBloqueo({
        barberoId: 3,
        servicioId: 2,
        date: fecha,
        dayOfWeek: WeekDay.MONDAY,
        startTime: '09:00',
        endTime: '10:00',
        cliente: { clienteId: 55 },
      });

      expect(mockPrismaService.$transaction).toHaveBeenCalledTimes(1);
      expect(txMock.$queryRaw).toHaveBeenCalledTimes(1);
      const llamadas = txMock.$queryRaw.mock.calls as unknown[][];
      const sql = (llamadas[0][0] as string[]).join('?');
      expect(sql).toContain('FOR UPDATE');
      expect(sql).toContain('Barbero');
      expect(llamadas[0][1]).toBe(3);
      expect(txMock.cliente.create).not.toHaveBeenCalled();
      expect(txMock.reservation.create).toHaveBeenCalledWith({
        data: {
          barberoId: 3,
          servicioId: 2,
          clienteId: 55,
          date: fecha,
          dayOfWeek: WeekDay.MONDAY,
          startTime: '09:00',
          endTime: '10:00',
          status: ReservationStatus.PENDING,
          precioReservado: null,
        },
      });
      expect(resultado).toEqual({ id: 99 });
    });

    it('debe persistir el precio histórico calculado en el servidor', async () => {
      const txMock = {
        $queryRaw: jest.fn().mockResolvedValue([{ id: 3 }]),
        cliente: { create: jest.fn() },
        reservation: { create: jest.fn().mockResolvedValue({ id: 101 }) },
      };
      mockPrismaService.$transaction.mockImplementation(
        async (cb: (tx: typeof txMock) => Promise<unknown>) => cb(txMock),
      );

      await repository.crearConBloqueo({
        barberoId: 3,
        servicioId: 2,
        date: fecha,
        dayOfWeek: WeekDay.MONDAY,
        startTime: '09:00',
        endTime: '10:00',
        precioReservado: 50000,
        cliente: { clienteId: 55 },
      });

      expect(txMock.reservation.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ precioReservado: 50000 }),
      });
    });

    it('debe crear el cliente dentro de la misma transacción cuando no existe', async () => {
      const txMock = {
        $queryRaw: jest.fn().mockResolvedValue([{ id: 3 }]),
        cliente: {
          create: jest.fn().mockResolvedValue({ id: 77 }),
        },
        reservation: { create: jest.fn().mockResolvedValue({ id: 100 }) },
      };
      mockPrismaService.$transaction.mockImplementation(
        async (cb: (tx: typeof txMock) => Promise<unknown>) => cb(txMock),
      );

      await repository.crearConBloqueo({
        barberoId: 3,
        servicioId: 2,
        date: fecha,
        dayOfWeek: WeekDay.MONDAY,
        startTime: '09:00',
        endTime: '10:00',
        cliente: {
          crear: { nombre: 'Ana', telefono: '3001234567' },
        },
      });

      expect(txMock.cliente.create).toHaveBeenCalledWith({
        data: {
          nombre: 'Ana',
          apellido: null,
          telefono: '3001234567',
          usuarioId: null,
        },
      });
      expect(txMock.reservation.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ clienteId: 77, servicioId: 2 }),
      });
    });

    it('debe reintentar ante un deadlock transitorio y no reintentar ante P2002', async () => {
      const deadlock = Object.assign(new Error('deadlock'), { code: 'P2034' });
      const unicidad = Object.assign(new Error('dup'), { code: 'P2002' });

      mockPrismaService.$transaction
        .mockRejectedValueOnce(deadlock)
        .mockResolvedValueOnce({ id: 1 });

      const resultado = await repository.crearConBloqueo({
        barberoId: 3,
        servicioId: 2,
        date: fecha,
        dayOfWeek: WeekDay.MONDAY,
        startTime: '09:00',
        endTime: '10:00',
        cliente: { clienteId: 55 },
      });

      expect(resultado).toEqual({ id: 1 });
      expect(mockPrismaService.$transaction).toHaveBeenCalledTimes(2);

      mockPrismaService.$transaction.mockReset();
      mockPrismaService.$transaction.mockRejectedValue(unicidad);

      await expect(
        repository.crearConBloqueo({
          barberoId: 3,
          servicioId: 2,
          date: fecha,
          dayOfWeek: WeekDay.MONDAY,
          startTime: '09:00',
          endTime: '10:00',
          cliente: { clienteId: 55 },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
      expect(mockPrismaService.$transaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('esErrorReintentableTransaccion', () => {
    it('debe reconocer deadlock/timeout y rechazar la violación de unicidad', () => {
      expect(esErrorReintentableTransaccion({ code: 'P2034' })).toBe(true);
      expect(esErrorReintentableTransaccion({ errno: 1213 })).toBe(true);
      expect(esErrorReintentableTransaccion({ errno: 1205 })).toBe(true);
      expect(esErrorReintentableTransaccion({ code: 'P2002' })).toBe(false);
      expect(esErrorReintentableTransaccion(new Error('x'))).toBe(false);
    });
  });

  describe('existeReservaActivaDeClienteEnFranja', () => {
    it('debe filtrar por cliente, barbero, fecha, hora y estados que ocupan', async () => {
      mockPrismaService.reservation.findFirst.mockResolvedValue({ id: 12 });

      const resultado = await repository.existeReservaActivaDeClienteEnFranja({
        clienteId: 55,
        barberoId: 3,
        fecha,
        startTime: '09:00',
      });

      expect(resultado).toBe(true);
      expect(mockPrismaService.reservation.findFirst).toHaveBeenCalledWith({
        where: {
          clienteId: 55,
          barberoId: 3,
          date: fecha,
          startTime: '09:00',
          status: {
            in: [
              ReservationStatus.PENDING,
              ReservationStatus.CONFIRMED,
              ReservationStatus.IN_PROGRESS,
              ReservationStatus.COMPLETED,
            ],
          },
        },
        select: { id: true },
      });
    });

    it('debe devolver false cuando el cliente no tiene reserva en la franja', async () => {
      mockPrismaService.reservation.findFirst.mockResolvedValue(null);

      const resultado = await repository.existeReservaActivaDeClienteEnFranja({
        clienteId: 55,
        barberoId: 3,
        fecha,
        startTime: '09:00',
      });

      expect(resultado).toBe(false);
    });
  });

  describe('listarReservasDeCliente', () => {
    it('filtra por cliente y ordena cronológicamente ascendente', async () => {
      mockPrismaService.reservation.findMany.mockResolvedValue([{ id: 1 }]);

      const resultado = await repository.listarReservasDeCliente(55);

      expect(resultado).toEqual([{ id: 1 }]);
      expect(mockPrismaService.reservation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { clienteId: 55 },
          orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
        }),
      );
    });
  });

  describe('obtenerReservaDeCliente', () => {
    it('filtra por id y clienteId simultáneamente', async () => {
      mockPrismaService.reservation.findFirst.mockResolvedValue({ id: 42 });

      const resultado = await repository.obtenerReservaDeCliente(55, 42);

      expect(resultado).toEqual({ id: 42 });
      expect(mockPrismaService.reservation.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 42, clienteId: 55 },
        }),
      );
    });

    it('devuelve null si la reserva no es del cliente', async () => {
      mockPrismaService.reservation.findFirst.mockResolvedValue(null);

      await expect(
        repository.obtenerReservaDeCliente(55, 42),
      ).resolves.toBeNull();
    });
  });

  describe('listarReservasDeBarberoEnFecha', () => {
    it('filtra por barberoId, fecha y estados que ocupan agenda, ordenando por hora de inicio', async () => {
      const mockReservas = [
        {
          id: 10,
          barberoId: 3,
          date: fecha,
          startTime: '09:00',
          endTime: '10:00',
          status: ReservationStatus.CONFIRMED,
          cliente: { nombre: 'Pedro', apellido: 'Gómez', telefono: '3001112233' },
          servicio: { id: 1, nombre: 'Corte', duracionMinutos: 60, precio: 30000 },
        },
      ];
      mockPrismaService.reservation.findMany.mockResolvedValue(mockReservas);

      const resultado = await repository.listarReservasDeBarberoEnFecha(3, fecha);

      expect(resultado).toEqual(mockReservas);
      expect(mockPrismaService.reservation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            barberoId: 3,
            date: fecha,
            status: { in: [...ESTADOS_QUE_OCUPAN_AGENDA] },
          },
          orderBy: { startTime: 'asc' },
        }),
      );
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
