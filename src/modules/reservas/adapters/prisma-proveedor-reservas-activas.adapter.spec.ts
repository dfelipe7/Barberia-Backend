import { Test, TestingModule } from '@nestjs/testing';
import { PrismaProveedorReservasActivas } from './prisma-proveedor-reservas-activas.adapter';
import { ReservasRepository } from '../repository/reservas.repository';

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
  EstadoUsuario: {
    ACTIVO: 'ACTIVO',
    INACTIVO: 'INACTIVO',
  },
  EstadoServicio: {
    ACTIVO: 'ACTIVO',
    INACTIVO: 'INACTIVO',
  },
}));

import { WeekDay } from '../../../../generated/prisma/enums';

describe('PrismaProveedorReservasActivas (adaptador del puerto HE-08)', () => {
  let adaptador: PrismaProveedorReservasActivas;
  let repository: jest.Mocked<ReservasRepository>;

  beforeEach(async () => {
    repository = {
      existeReservaQueOcupaEnFranja: jest.fn(),
      existeReservaQueOcupaEnFranjaSemanal: jest.fn(),
    } as unknown as jest.Mocked<ReservasRepository>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PrismaProveedorReservasActivas,
        { provide: ReservasRepository, useValue: repository },
      ],
    }).compile();

    adaptador = module.get(PrismaProveedorReservasActivas);
    jest.clearAllMocks();
  });

  it('debe estar definido', () => {
    expect(adaptador).toBeDefined();
  });

  describe('existeReservaNoCanceladaEnFranja', () => {
    it('traduce la fecha YYYY-MM-DD a Date UTC y delega en el repositorio', async () => {
      repository.existeReservaQueOcupaEnFranja.mockResolvedValue(true);

      const resultado = await adaptador.existeReservaNoCanceladaEnFranja({
        barberoId: 3,
        fecha: '2026-11-01',
        startTime: '09:00',
        endTime: '10:00',
      });

      expect(resultado).toBe(true);
      expect(repository.existeReservaQueOcupaEnFranja).toHaveBeenCalledWith({
        barberoId: 3,
        fecha: new Date('2026-11-01T00:00:00.000Z'),
        startTime: '09:00',
        endTime: '10:00',
      });
    });

    it('propaga excluirReservaId al repositorio cuando se proporciona', async () => {
      repository.existeReservaQueOcupaEnFranja.mockResolvedValue(false);

      const resultado = await adaptador.existeReservaNoCanceladaEnFranja({
        barberoId: 3,
        fecha: '2026-11-01',
        startTime: '09:00',
        endTime: '10:00',
        excluirReservaId: 42,
      });

      expect(resultado).toBe(false);
      expect(repository.existeReservaQueOcupaEnFranja).toHaveBeenCalledWith({
        barberoId: 3,
        fecha: new Date('2026-11-01T00:00:00.000Z'),
        startTime: '09:00',
        endTime: '10:00',
        excluirReservaId: 42,
      });
    });

    it('devuelve false cuando no hay reserva que ocupe la franja (incluye CANCELLED)', async () => {
      repository.existeReservaQueOcupaEnFranja.mockResolvedValue(false);

      const resultado = await adaptador.existeReservaNoCanceladaEnFranja({
        barberoId: 3,
        fecha: '2026-11-01',
        startTime: '09:00',
        endTime: '10:00',
      });

      expect(resultado).toBe(false);
    });

    it('propaga el error del repositorio (no degrada a "libre" de forma silenciosa)', async () => {
      repository.existeReservaQueOcupaEnFranja.mockRejectedValue(
        new Error('DB connection lost'),
      );

      await expect(
        adaptador.existeReservaNoCanceladaEnFranja({
          barberoId: 3,
          fecha: '2026-11-01',
          startTime: '09:00',
          endTime: '10:00',
        }),
      ).rejects.toThrow('DB connection lost');
    });
  });

  describe('existeReservaNoCanceladaEnFranjaSemanal', () => {
    it('traduce el día de la semana al enum WeekDay y delega en el repositorio', async () => {
      repository.existeReservaQueOcupaEnFranjaSemanal.mockResolvedValue(true);

      const resultado = await adaptador.existeReservaNoCanceladaEnFranjaSemanal(
        {
          barberoId: 3,
          dayOfWeek: 'MONDAY',
          startTime: '09:00',
          endTime: '10:00',
        },
      );

      expect(resultado).toBe(true);
      expect(
        repository.existeReservaQueOcupaEnFranjaSemanal,
      ).toHaveBeenCalledWith({
        barberoId: 3,
        dayOfWeek: WeekDay.MONDAY,
        startTime: '09:00',
        endTime: '10:00',
      });
    });

    it('lanza si el día de la semana no es válido en lugar de asumir franja libre', async () => {
      await expect(
        adaptador.existeReservaNoCanceladaEnFranjaSemanal({
          barberoId: 3,
          dayOfWeek: 'FUNDAY',
          startTime: '09:00',
          endTime: '10:00',
        }),
      ).rejects.toThrow('Día de la semana inválido');

      expect(
        repository.existeReservaQueOcupaEnFranjaSemanal,
      ).not.toHaveBeenCalled();
    });

    it('propaga el error del repositorio', async () => {
      repository.existeReservaQueOcupaEnFranjaSemanal.mockRejectedValue(
        new Error('DB down'),
      );

      await expect(
        adaptador.existeReservaNoCanceladaEnFranjaSemanal({
          barberoId: 3,
          dayOfWeek: 'MONDAY',
          startTime: '09:00',
          endTime: '10:00',
        }),
      ).rejects.toThrow('DB down');
    });
  });
});
