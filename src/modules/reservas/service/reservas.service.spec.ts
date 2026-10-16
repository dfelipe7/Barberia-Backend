import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  MENSAJE_FRANJA_OCUPADA,
  MENSAJE_RESERVA_CREADA,
  MENSAJE_RESERVA_DUPLICADA,
  MENSAJE_RESERVA_NO_DISPONIBLE,
  MENSAJE_SIN_RESERVAS,
  ReservasService,
} from './reservas.service';
import { ReservasRepository } from '../repository/reservas.repository';
import { ClientesRepository } from '../repository/clientes.repository';
import { DisponibilidadService } from '../../horarios/service/disponibilidad.service';
import { ServiciosRepository } from '../../servicios/repository/servicios.repository';
import { FechaBogotaService } from '../../horarios/common/fecha-bogota.service';
import { EstadoFranja } from '../../horarios/common/estado-franja';
import { BarberosRepository } from '../../usuarios/repository/barberos.repository';
import { EstadoUsuario, ReservationStatus } from '../../../../generated/prisma/enums';

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
    listarReservasDeCliente: jest.fn(),
    obtenerReservaDeCliente: jest.fn(),
    listarReservasDeBarberoEnFecha: jest.fn(),
    listarReservasDeBarberoEnRango: jest.fn(),
  };
  const clientesRepository = {
    obtenerPorId: jest.fn(),
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
    obtenerFechaBogota: jest.fn(),
    obtenerHoraBogota: jest.fn(),
  };
  const barberosRepository = {
    obtenerBarberoPorUsuarioId: jest.fn(),
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
    precioReservado: 50000,
    slotActivo: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const servicioActivo = {
    id: 2,
    nombre: 'Corte de cabello',
    precio: 50000,
    duracionMinutos: 30,
  };

  const crearReservaRelacion = (over: Record<string, unknown> = {}) => ({
    id: 42,
    barberoId: 3,
    servicioId: 2,
    clienteId: 77,
    date: new Date('2026-11-01T00:00:00.000Z'),
    dayOfWeek: 'SUNDAY',
    startTime: '14:00',
    endTime: '15:00',
    status: 'PENDING',
    precioReservado: 50000,
    createdAt: new Date(),
    updatedAt: new Date(),
    servicio: { id: 2, nombre: 'Corte de cabello', precio: 50000 },
    barbero: { id: 3, usuario: { nombre: 'Carlos', apellido: 'Gómez' } },
    ...over,
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReservasService,
        { provide: ReservasRepository, useValue: reservasRepository },
        { provide: ClientesRepository, useValue: clientesRepository },
        { provide: DisponibilidadService, useValue: disponibilidadService },
        { provide: ServiciosRepository, useValue: serviciosRepository },
        { provide: FechaBogotaService, useValue: fechaBogotaService },
        { provide: BarberosRepository, useValue: barberosRepository },
      ],
    }).compile();

    service = module.get<ReservasService>(ReservasService);
    jest.clearAllMocks();

    fechaBogotaService.esFechaCalendarioValida.mockReturnValue(true);
    fechaBogotaService.obtenerDiaSemana.mockReturnValue('SUNDAY');
    fechaBogotaService.obtenerFechaBogota.mockReturnValue('2026-11-01');
    fechaBogotaService.obtenerHoraBogota.mockReturnValue('12:00');
    disponibilidadService.calcularDisponibilidad.mockResolvedValue([
      franjaDisponible,
    ]);
    reservasRepository.crearConBloqueo.mockResolvedValue(reservaCreada);
    serviciosRepository.obtenerServicioActivoPorId.mockResolvedValue(
      servicioActivo,
    );
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
      expect(disponibilidadService.calcularDisponibilidad).toHaveBeenCalledWith(
        {
          barberoId: 3,
          servicioId: 2,
          fecha: FECHA,
        },
      );
      expect(reservasRepository.crearConBloqueo).toHaveBeenCalledWith(
        expect.objectContaining({
          barberoId: 3,
          servicioId: 2,
          startTime: HORA,
          endTime: '15:00',
          dayOfWeek: 'SUNDAY',
          precioReservado: 50000,
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

      expect(
        disponibilidadService.calcularDisponibilidad,
      ).not.toHaveBeenCalled();
      expect(reservasRepository.crearConBloqueo).not.toHaveBeenCalled();
    });
  });

  describe('Modalidad B (cliente autenticado)', () => {
    const identidad = { clienteId: 55 };

    it('reutiliza el Cliente existente y verifica el duplicado del propio cliente', async () => {
      clientesRepository.obtenerPorId.mockResolvedValue({ id: 55 });
      reservasRepository.existeReservaActivaDeClienteEnFranja.mockResolvedValue(
        false,
      );

      await service.crearReserva(dtoBase, identidad);

      expect(clientesRepository.obtenerPorId).toHaveBeenCalledWith(55);
      expect(
        reservasRepository.existeReservaActivaDeClienteEnFranja,
      ).toHaveBeenCalledWith({
        clienteId: 55,
        barberoId: 3,
        fecha: new Date(`${FECHA}T00:00:00.000Z`),
        startTime: HORA,
      });
      expect(reservasRepository.crearConBloqueo).toHaveBeenCalledWith(
        expect.objectContaining({
          cliente: { clienteId: 55 },
          precioReservado: 50000,
        }),
      );
    });

    it('rechaza la sesión si el cliente ya no existe (401)', async () => {
      clientesRepository.obtenerPorId.mockResolvedValue(null);

      await expect(
        service.crearReserva(dtoBase, identidad),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      expect(
        disponibilidadService.calcularDisponibilidad,
      ).not.toHaveBeenCalled();
    });

    it('rechaza el duplicado del propio cliente con el mensaje de CA-04 (409)', async () => {
      clientesRepository.obtenerPorId.mockResolvedValue({ id: 55 });
      reservasRepository.existeReservaActivaDeClienteEnFranja.mockResolvedValue(
        true,
      );

      await expect(service.crearReserva(dtoBase, identidad)).rejects.toThrow(
        MENSAJE_RESERVA_DUPLICADA,
      );

      expect(
        disponibilidadService.calcularDisponibilidad,
      ).not.toHaveBeenCalled();
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

    it('falla con 404 si el servicio desaparece antes de crear la reserva', async () => {
      serviciosRepository.obtenerServicioActivoPorId.mockResolvedValue(null);

      await expect(
        service.crearReserva({
          ...dtoBase,
          nombre: 'Ana',
          telefono: '3001234567',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(reservasRepository.crearConBloqueo).not.toHaveBeenCalled();
    });
  });

  describe('HU-06 listarMisReservas', () => {
    const identidad = { clienteId: 55 };

    it('devuelve lista vacía con el mensaje exacto cuando no hay reservas', async () => {
      clientesRepository.obtenerPorId.mockResolvedValue({ id: 55 });
      reservasRepository.listarReservasDeCliente.mockResolvedValue([]);

      await expect(service.listarMisReservas(identidad)).resolves.toEqual({
        mensaje: MENSAJE_SIN_RESERVAS,
        reservas: [],
      });
      expect(reservasRepository.listarReservasDeCliente).toHaveBeenCalledWith(
        55,
      );
    });

    it('ordena próximas primero y mapea el DTO del cliente', async () => {
      clientesRepository.obtenerPorId.mockResolvedValue({ id: 55 });
      reservasRepository.listarReservasDeCliente.mockResolvedValue([
        crearReservaRelacion({
          id: 1,
          date: new Date('2026-10-01T00:00:00.000Z'),
          startTime: '10:00',
        }),
        crearReservaRelacion({
          id: 2,
          date: new Date('2026-12-01T00:00:00.000Z'),
          startTime: '14:00',
        }),
        crearReservaRelacion({
          id: 3,
          date: new Date('2026-11-01T00:00:00.000Z'),
          startTime: '09:00',
        }),
        crearReservaRelacion({
          id: 4,
          date: new Date('2026-11-01T00:00:00.000Z'),
          startTime: '16:00',
        }),
      ]);

      const resultado = await service.listarMisReservas(identidad);

      expect(resultado.mensaje).toBeUndefined();
      expect(resultado.reservas.map((r) => r.id)).toEqual([4, 2, 3, 1]);
      expect(resultado.reservas[0]).toEqual({
        id: 4,
        estado: 'PENDING',
        fecha: '2026-11-01',
        hora: '16:00',
        horaFin: '15:00',
        precio: 50000,
        barbero: { id: 3, nombre: 'Carlos', apellido: 'Gómez' },
        servicio: { id: 2, nombre: 'Corte de cabello' },
      });
    });

    it('usa el precio vigente del servicio cuando no hay precio histórico', async () => {
      clientesRepository.obtenerPorId.mockResolvedValue({ id: 55 });
      reservasRepository.listarReservasDeCliente.mockResolvedValue([
        crearReservaRelacion({ precioReservado: null }),
      ]);

      const resultado = await service.listarMisReservas(identidad);

      expect(resultado.reservas[0].precio).toBe(50000);
    });

    it('rechaza (401) si el cliente de la sesión ya no existe', async () => {
      clientesRepository.obtenerPorId.mockResolvedValue(null);

      await expect(service.listarMisReservas(identidad)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(reservasRepository.listarReservasDeCliente).not.toHaveBeenCalled();
    });
  });

  describe('HU-07 obtenerMiReserva', () => {
    const identidad = { clienteId: 55 };

    it('devuelve el detalle de una reserva propia', async () => {
      clientesRepository.obtenerPorId.mockResolvedValue({ id: 55 });
      reservasRepository.obtenerReservaDeCliente.mockResolvedValue(
        crearReservaRelacion({ id: 42 }),
      );

      await expect(service.obtenerMiReserva(identidad, 42)).resolves.toEqual({
        id: 42,
        estado: 'PENDING',
        fecha: '2026-11-01',
        hora: '14:00',
        horaFin: '15:00',
        precio: 50000,
        barbero: { id: 3, nombre: 'Carlos', apellido: 'Gómez' },
        servicio: { id: 2, nombre: 'Corte de cabello' },
      });

      expect(reservasRepository.obtenerReservaDeCliente).toHaveBeenCalledWith(
        55,
        42,
      );
    });

    it('responde 404 con el mensaje exacto si no existe o no es propia', async () => {
      clientesRepository.obtenerPorId.mockResolvedValue({ id: 55 });
      reservasRepository.obtenerReservaDeCliente.mockResolvedValue(null);

      await expect(service.obtenerMiReserva(identidad, 99)).rejects.toThrow(
        MENSAJE_RESERVA_NO_DISPONIBLE,
      );
    });
  });

  describe('Agenda del barbero (obtenerAgendaBarbero)', () => {
    const usuarioBarbero = { id: 7, rol: 'BARBERO' };
    const barberoActivo = {
      id: 3,
      usuarioId: 7,
      telefono: '3110000000',
      porcentajeComision: 50,
      estado: EstadoUsuario.ACTIVO,
    };

    const citaMock = {
      id: 101,
      barberoId: 3,
      servicioId: 2,
      clienteId: 55,
      date: new Date('2026-11-01T00:00:00.000Z'),
      dayOfWeek: 'SUNDAY',
      startTime: '09:00',
      endTime: '10:00',
      status: ReservationStatus.CONFIRMED,
      precioReservado: 45000,
      createdAt: new Date(),
      updatedAt: new Date(),
      cliente: {
        nombre: 'Carlos',
        apellido: 'Pérez',
        telefono: '3009876543',
      },
      servicio: {
        id: 2,
        nombre: 'Corte clásico',
        duracionMinutos: 60,
        precio: 50000,
      },
    };

    beforeEach(() => {
      barberosRepository.obtenerBarberoPorUsuarioId.mockResolvedValue(barberoActivo);
      reservasRepository.listarReservasDeBarberoEnFecha = jest.fn();
    });

    it('devuelve las reservas del barbero para la fecha solicitada con datos de cliente y servicio', async () => {
      reservasRepository.listarReservasDeBarberoEnFecha.mockResolvedValue([citaMock]);

      const resultado = await service.obtenerAgendaBarbero(usuarioBarbero, {
        fecha: '2026-11-01',
      });

      expect(resultado).toEqual({
        fecha: '2026-11-01',
        reservas: [
          {
            id: 101,
            fecha: '2026-11-01',
            hora: '09:00',
            horaFin: '10:00',
            estado: ReservationStatus.CONFIRMED,
            precio: 45000,
            cliente: {
              nombre: 'Carlos',
              apellido: 'Pérez',
              telefono: '3009876543',
            },
            servicio: {
              id: 2,
              nombre: 'Corte clásico',
              duracionMinutos: 60,
            },
          },
        ],
      });

      expect(barberosRepository.obtenerBarberoPorUsuarioId).toHaveBeenCalledWith(7);
      expect(reservasRepository.listarReservasDeBarberoEnFecha).toHaveBeenCalledWith(
        3,
        new Date('2026-11-01T00:00:00.000Z'),
      );
    });

    it('resuelve reservas de cliente invitado con datos opcionales en null', async () => {
      const citaInvitado = {
        ...citaMock,
        id: 102,
        startTime: '10:00',
        endTime: '10:30',
        precioReservado: null,
        cliente: {
          nombre: 'Juan Invitado',
          apellido: null,
          telefono: '3151234567',
        },
      };

      reservasRepository.listarReservasDeBarberoEnFecha.mockResolvedValue([citaInvitado]);

      const resultado = await service.obtenerAgendaBarbero(usuarioBarbero, {
        fecha: '2026-11-01',
      });

      expect(resultado.reservas[0]).toEqual({
        id: 102,
        fecha: '2026-11-01',
        hora: '10:00',
        horaFin: '10:30',
        estado: ReservationStatus.CONFIRMED,
        precio: 50000,
        cliente: {
          nombre: 'Juan Invitado',
          apellido: null,
          telefono: '3151234567',
        },
        servicio: {
          id: 2,
          nombre: 'Corte clásico',
          duracionMinutos: 60,
        },
      });
    });

    it('devuelve lista vacía cuando no hay reservas para la fecha', async () => {
      reservasRepository.listarReservasDeBarberoEnFecha.mockResolvedValue([]);

      const resultado = await service.obtenerAgendaBarbero(usuarioBarbero, {
        fecha: '2026-11-01',
      });

      expect(resultado).toEqual({
        fecha: '2026-11-01',
        reservas: [],
      });
    });

    it('rechaza una fecha inválida con 400 Bad Request', async () => {
      fechaBogotaService.esFechaCalendarioValida.mockReturnValue(false);

      await expect(
        service.obtenerAgendaBarbero(usuarioBarbero, { fecha: 'invalida' }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(barberosRepository.obtenerBarberoPorUsuarioId).not.toHaveBeenCalled();
    });

    it('rechaza si no se puede identificar al usuario autenticado (401)', async () => {
      await expect(
        service.obtenerAgendaBarbero({}, { fecha: '2026-11-01' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      await expect(
        service.obtenerAgendaBarbero({ id: -1 }, { fecha: '2026-11-01' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rechaza a un usuario que no tiene perfil de barbero asociado (403)', async () => {
      barberosRepository.obtenerBarberoPorUsuarioId.mockResolvedValue(null);

      await expect(
        service.obtenerAgendaBarbero({ id: 99 }, { fecha: '2026-11-01' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rechaza a un barbero con perfil inactivo (403)', async () => {
      barberosRepository.obtenerBarberoPorUsuarioId.mockResolvedValue({
        ...barberoActivo,
        estado: EstadoUsuario.INACTIVO,
      });

      await expect(
        service.obtenerAgendaBarbero(usuarioBarbero, { fecha: '2026-11-01' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('soporta resolver el id de usuario desde la propiedad sub del token', async () => {
      reservasRepository.listarReservasDeBarberoEnFecha.mockResolvedValue([]);

      await service.obtenerAgendaBarbero(
        { sub: '7' },
        { fecha: '2026-11-01' },
      );

      expect(barberosRepository.obtenerBarberoPorUsuarioId).toHaveBeenCalledWith(7);
    });
  });

  describe('Agenda semanal del barbero (obtenerAgendaSemanalBarbero)', () => {
    const usuarioBarbero = { id: 7, rol: 'BARBERO' };
    const barberoActivo = {
      id: 3,
      usuarioId: 7,
      telefono: '3110000000',
      porcentajeComision: 50,
      estado: EstadoUsuario.ACTIVO,
    };

    const citaLunes = {
      id: 201,
      barberoId: 3,
      servicioId: 2,
      clienteId: 55,
      date: new Date('2026-11-02T00:00:00.000Z'),
      dayOfWeek: 'MONDAY',
      startTime: '09:00',
      endTime: '10:00',
      status: ReservationStatus.CONFIRMED,
      precioReservado: 50000,
      createdAt: new Date(),
      updatedAt: new Date(),
      cliente: {
        nombre: 'Carlos',
        apellido: 'Pérez',
        telefono: '3001234567',
      },
      servicio: {
        id: 2,
        nombre: 'Corte clásico',
        duracionMinutos: 45,
        precio: 50000,
      },
    };

    const citaMiercoles = {
      id: 202,
      barberoId: 3,
      servicioId: 5,
      clienteId: 88,
      date: new Date('2026-11-04T00:00:00.000Z'),
      dayOfWeek: 'WEDNESDAY',
      startTime: '14:00',
      endTime: '15:00',
      status: ReservationStatus.PENDING,
      precioReservado: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      cliente: {
        nombre: 'Invitado',
        apellido: null,
        telefono: '3119876543',
      },
      servicio: {
        id: 5,
        nombre: 'Barba',
        duracionMinutos: 30,
        precio: 25000,
      },
    };

    beforeEach(() => {
      barberosRepository.obtenerBarberoPorUsuarioId.mockResolvedValue(barberoActivo);
      reservasRepository.listarReservasDeBarberoEnRango = jest.fn();
    });

    it('devuelve las reservas del rango semanal ordenadas cronológicamente', async () => {
      reservasRepository.listarReservasDeBarberoEnRango.mockResolvedValue([
        citaLunes,
        citaMiercoles,
      ]);

      const resultado = await service.obtenerAgendaSemanalBarbero(usuarioBarbero, {
        desde: '2026-11-02',
        hasta: '2026-11-08',
      });

      expect(resultado).toEqual({
        desde: '2026-11-02',
        hasta: '2026-11-08',
        reservas: [
          {
            id: 201,
            fecha: '2026-11-02',
            hora: '09:00',
            horaFin: '10:00',
            estado: ReservationStatus.CONFIRMED,
            precio: 50000,
            cliente: {
              nombre: 'Carlos',
              apellido: 'Pérez',
              telefono: '3001234567',
            },
            servicio: {
              id: 2,
              nombre: 'Corte clásico',
              duracionMinutos: 45,
            },
          },
          {
            id: 202,
            fecha: '2026-11-04',
            hora: '14:00',
            horaFin: '15:00',
            estado: ReservationStatus.PENDING,
            precio: 25000,
            cliente: {
              nombre: 'Invitado',
              apellido: null,
              telefono: '3119876543',
            },
            servicio: {
              id: 5,
              nombre: 'Barba',
              duracionMinutos: 30,
            },
          },
        ],
      });

      expect(barberosRepository.obtenerBarberoPorUsuarioId).toHaveBeenCalledWith(7);
      expect(reservasRepository.listarReservasDeBarberoEnRango).toHaveBeenCalledWith(
        3,
        new Date('2026-11-02T00:00:00.000Z'),
        new Date('2026-11-08T00:00:00.000Z'),
      );
    });

    it('devuelve lista vacía cuando no hay reservas en el rango', async () => {
      reservasRepository.listarReservasDeBarberoEnRango.mockResolvedValue([]);

      const resultado = await service.obtenerAgendaSemanalBarbero(usuarioBarbero, {
        desde: '2026-11-02',
        hasta: '2026-11-08',
      });

      expect(resultado).toEqual({
        desde: '2026-11-02',
        hasta: '2026-11-08',
        reservas: [],
      });
    });

    it('rechaza si la fecha "desde" es inválida con 400', async () => {
      fechaBogotaService.esFechaCalendarioValida.mockImplementation((f) => f !== 'invalida');

      await expect(
        service.obtenerAgendaSemanalBarbero(usuarioBarbero, {
          desde: 'invalida',
          hasta: '2026-11-08',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rechaza si la fecha "hasta" es inválida con 400', async () => {
      fechaBogotaService.esFechaCalendarioValida.mockImplementation((f) => f !== 'invalida');

      await expect(
        service.obtenerAgendaSemanalBarbero(usuarioBarbero, {
          desde: '2026-11-02',
          hasta: 'invalida',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rechaza si "desde" es posterior a "hasta" con 400', async () => {
      fechaBogotaService.esFechaCalendarioValida.mockReturnValue(true);

      await expect(
        service.obtenerAgendaSemanalBarbero(usuarioBarbero, {
          desde: '2026-11-08',
          hasta: '2026-11-02',
        }),
      ).rejects.toThrow('La fecha inicial ("desde") no puede ser posterior a la fecha final ("hasta")');
    });

    it('rechaza un rango superior a 7 días consecutivos con 400', async () => {
      fechaBogotaService.esFechaCalendarioValida.mockReturnValue(true);

      // Del 2 de noviembre al 10 de noviembre son 9 días
      await expect(
        service.obtenerAgendaSemanalBarbero(usuarioBarbero, {
          desde: '2026-11-02',
          hasta: '2026-11-10',
        }),
      ).rejects.toThrow('El rango de consulta no puede superar los 7 días consecutivos');
    });

    it('rechaza a un usuario que no tiene perfil de barbero asociado (403)', async () => {
      fechaBogotaService.esFechaCalendarioValida.mockReturnValue(true);
      barberosRepository.obtenerBarberoPorUsuarioId.mockResolvedValue(null);

      await expect(
        service.obtenerAgendaSemanalBarbero({ id: 99 }, {
          desde: '2026-11-02',
          hasta: '2026-11-08',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rechaza a un barbero con perfil inactivo (403)', async () => {
      fechaBogotaService.esFechaCalendarioValida.mockReturnValue(true);
      barberosRepository.obtenerBarberoPorUsuarioId.mockResolvedValue({
        ...barberoActivo,
        estado: EstadoUsuario.INACTIVO,
      });

      await expect(
        service.obtenerAgendaSemanalBarbero(usuarioBarbero, {
          desde: '2026-11-02',
          hasta: '2026-11-08',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
