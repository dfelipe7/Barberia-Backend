import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  MENSAJE_FRANJA_OCUPADA,
  MENSAJE_RESERVA_CREADA,
  MENSAJE_RESERVA_DUPLICADA,
  ReservasService,
} from './reservas.service';
import { ReservasRepository } from '../repository/reservas.repository';
import { ClientesRepository } from '../repository/clientes.repository';
import { DisponibilidadService } from '../../horarios/service/disponibilidad.service';
import { ServiciosRepository } from '../../servicios/repository/servicios.repository';
import { FechaBogotaService } from '../../horarios/common/fecha-bogota.service';
import { EstadoFranja } from '../../horarios/common/estado-franja';

const FECHA = '2026-11-01';
const HORA = '14:00';

const dtoBase = {
  barberoId: 3,
  servicioId: 2,
  fecha: FECHA,
  hora: HORA,
};

describe('ReservasService', () => {
  let service: ReservasService;

  const reservasRepository = {
    existeReservaActivaDeClienteEnFranja: jest.fn(),
    crearConBloqueo: jest.fn(),
  };
  const clientesRepository = {
    buscarPorUsuarioId: jest.fn(),
  };
  const disponibilidadService = {
    calcularDisponibilidad: jest.fn(),
  };
  const serviciosRepository = {
    obtenerServicioActivoPorId: jest.fn(),
    listarBarberosActivosPorServicio: jest.fn(),
  };
  const fechaBogotaService = {
    esFechaCalendarioValida: jest.fn(),
    obtenerDiaSemana: jest.fn(),
  };

  const franjaDisponible = {
    startTime: HORA,
    endTime: '15:00',
    estado: EstadoFranja.AVAILABLE,
  };

  const reservaCreada = {
    id: 42,
    barberoId: 3,
    servicioId: 2,
    clienteId: 77,
    date: new Date(`${FECHA}T00:00:00.000Z`),
    dayOfWeek: 'SUNDAY',
    startTime: HORA,
    endTime: '15:00',
    status: 'PENDING',
    slotActivo: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReservasService,
        { provide: ReservasRepository, useValue: reservasRepository },
        { provide: ClientesRepository, useValue: clientesRepository },
        { provide: DisponibilidadService, useValue: disponibilidadService },
        { provide: ServiciosRepository, useValue: serviciosRepository },
        { provide: FechaBogotaService, useValue: fechaBogotaService },
      ],
    }).compile();

    service = module.get<ReservasService>(ReservasService);
    jest.clearAllMocks();

    fechaBogotaService.esFechaCalendarioValida.mockReturnValue(true);
    fechaBogotaService.obtenerDiaSemana.mockReturnValue('SUNDAY');
    disponibilidadService.calcularDisponibilidad.mockResolvedValue([
      franjaDisponible,
    ]);
    reservasRepository.crearConBloqueo.mockResolvedValue(reservaCreada);
    serviciosRepository.obtenerServicioActivoPorId.mockResolvedValue({
      id: 2,
      nombre: 'Corte de cabello',
      precio: 50000,
      duracionMinutos: 30,
    });
    serviciosRepository.listarBarberosActivosPorServicio.mockResolvedValue([
      { id: 3, usuario: { id: 9, nombre: 'Carlos', apellido: 'Gómez' } },
    ]);
  });

  it('debe estar definido', () => {
    expect(service).toBeDefined();
  });

  describe('Modalidad A (invitado)', () => {
    it('crea la reserva, da de alta al cliente invitado y devuelve la confirmación', async () => {
      const resultado = await service.crearReserva({
        ...dtoBase,
        nombre: 'Ana',
        apellido: 'Pérez',
        telefono: '3001234567',
      });

      expect(resultado).toEqual({
        mensaje: MENSAJE_RESERVA_CREADA,
        id: 42,
        estado: 'PENDING',
        fecha: FECHA,
        hora: HORA,
        horaFin: '15:00',
        barbero: { id: 3, nombre: 'Carlos', apellido: 'Gómez' },
        servicio: {
          id: 2,
          nombre: 'Corte de cabello',
          precio: 50000,
          duracionMinutos: 30,
        },
      });

      expect(
        reservasRepository.existeReservaActivaDeClienteEnFranja,
      ).not.toHaveBeenCalled();
      expect(disponibilidadService.calcularDisponibilidad).toHaveBeenCalledWith({
        barberoId: 3,
        servicioId: 2,
        fecha: FECHA,
      });
      expect(reservasRepository.crearConBloqueo).toHaveBeenCalledWith(
        expect.objectContaining({
          barberoId: 3,
          servicioId: 2,
          startTime: HORA,
          endTime: '15:00',
          dayOfWeek: 'SUNDAY',
          cliente: {
            crear: {
              nombre: 'Ana',
              apellido: 'Pérez',
              telefono: '3001234567',
            },
          },
        }),
      );
    });

    it('rechaza al invitado sin nombre o sin teléfono (400) y no consulta disponibilidad', async () => {
      await expect(
        service.crearReserva({ ...dtoBase, nombre: 'Ana' }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(disponibilidadService.calcularDisponibilidad).not.toHaveBeenCalled();
      expect(reservasRepository.crearConBloqueo).not.toHaveBeenCalled();
    });
  });

  describe('Modalidad B (cliente autenticado)', () => {
    const identidad = {
      usuarioId: 9,
      nombre: 'Carlos',
      apellido: 'Gómez',
    };

    it('reutiliza el Cliente existente y verifica el duplicado del propio cliente', async () => {
      clientesRepository.buscarPorUsuarioId.mockResolvedValue({ id: 55 });
      reservasRepository.existeReservaActivaDeClienteEnFranja.mockResolvedValue(
        false,
      );

      await service.crearReserva(dtoBase, identidad);

      expect(
        reservasRepository.existeReservaActivaDeClienteEnFranja,
      ).toHaveBeenCalledWith({
        clienteId: 55,
        barberoId: 3,
        fecha: new Date(`${FECHA}T00:00:00.000Z`),
        startTime: HORA,
      });
      expect(reservasRepository.crearConBloqueo).toHaveBeenCalledWith(
        expect.objectContaining({ cliente: { clienteId: 55 } }),
      );
    });

    it('crea el Cliente vinculado al Usuario cuando aún no existe', async () => {
      clientesRepository.buscarPorUsuarioId.mockResolvedValue(null);

      await service.crearReserva({ ...dtoBase, telefono: '3000000000' }, identidad);

      expect(reservasRepository.crearConBloqueo).toHaveBeenCalledWith(
        expect.objectContaining({
          cliente: {
            crear: {
              nombre: 'Carlos',
              apellido: 'Gómez',
              telefono: '3000000000',
              usuarioId: 9,
            },
          },
        }),
      );
    });

    it('rechaza el duplicado del propio cliente con el mensaje de CA-04 (409)', async () => {
      clientesRepository.buscarPorUsuarioId.mockResolvedValue({ id: 55 });
      reservasRepository.existeReservaActivaDeClienteEnFranja.mockResolvedValue(
        true,
      );

      await expect(
        service.crearReserva(dtoBase, identidad),
      ).rejects.toThrow(MENSAJE_RESERVA_DUPLICADA);

      expect(disponibilidadService.calcularDisponibilidad).not.toHaveBeenCalled();
      expect(reservasRepository.crearConBloqueo).not.toHaveBeenCalled();
    });
  });

  describe('validaciones y conflictos', () => {
    it('rechaza una fecha con formato inválido (400)', async () => {
      fechaBogotaService.esFechaCalendarioValida.mockReturnValue(false);

      await expect(
        service.crearReserva({
          ...dtoBase,
          fecha: '2026-13-40',
          nombre: 'Ana',
          telefono: '3001234567',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rechaza una franja ocupada con el mensaje de CA-03 (409)', async () => {
      disponibilidadService.calcularDisponibilidad.mockResolvedValue([
        { startTime: HORA, endTime: '15:00', estado: EstadoFranja.RESERVED },
      ]);

      await expect(
        service.crearReserva({
          ...dtoBase,
          nombre: 'Ana',
          telefono: '3001234567',
        }),
      ).rejects.toThrow(MENSAJE_FRANJA_OCUPADA);

      expect(reservasRepository.crearConBloqueo).not.toHaveBeenCalled();
    });

    it('rechaza una hora que no corresponde a una franja del catálogo (400)', async () => {
      disponibilidadService.calcularDisponibilidad.mockResolvedValue([]);

      await expect(
        service.crearReserva({
          ...dtoBase,
          hora: '14:30',
          nombre: 'Ana',
          telefono: '3001234567',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('traduce la violación de unicidad P2002 a un 409 de CA-03', async () => {
      reservasRepository.crearConBloqueo.mockRejectedValue(
        Object.assign(new Error('dup'), { code: 'P2002' }),
      );

      await expect(
        service.crearReserva({
          ...dtoBase,
          nombre: 'Ana',
          telefono: '3001234567',
        }),
      ).rejects.toThrow(MENSAJE_FRANJA_OCUPADA);
    });

    it('propaga el 404 de servicio/barbero inexistente desde la disponibilidad', async () => {
      disponibilidadService.calcularDisponibilidad.mockRejectedValue(
        new NotFoundException('El barbero 3 no existe o no está activo'),
      );

      await expect(
        service.crearReserva({
          ...dtoBase,
          nombre: 'Ana',
          telefono: '3001234567',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('propaga el 503 fail-closed de la disponibilidad sin crear reserva', async () => {
      disponibilidadService.calcularDisponibilidad.mockRejectedValue(
        new ServiceUnavailableException('disponibilidad no disponible'),
      );

      await expect(
        service.crearReserva({
          ...dtoBase,
          nombre: 'Ana',
          telefono: '3001234567',
        }),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);

      expect(reservasRepository.crearConBloqueo).not.toHaveBeenCalled();
    });

    it('falla con 404 si el servicio desaparece al construir la confirmación', async () => {
      serviciosRepository.obtenerServicioActivoPorId.mockResolvedValue(null);

      await expect(
        service.crearReserva({
          ...dtoBase,
          nombre: 'Ana',
          telefono: '3001234567',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
