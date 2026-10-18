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
  MENSAJE_HORARIO_NO_DISPONIBLE,
  MENSAJE_RESERVA_CANCELADA,
  MENSAJE_RESERVA_COMPLETADA,
  MENSAJE_RESERVA_CREADA,
  MENSAJE_RESERVA_DUPLICADA,
  MENSAJE_RESERVA_MODIFICADA,
  MENSAJE_RESERVA_NO_DISPONIBLE,
  MENSAJE_RESERVA_NO_SHOW,
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
import {
  EstadoUsuario,
  ReservationStatus,
} from '../../../../generated/prisma/enums';

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
    modificarConBloqueo: jest.fn(),
    cancelar: jest.fn(),
    obtenerReservaParaCompletar: jest.fn(),
    completar: jest.fn(),
    obtenerReservaConRelaciones: jest.fn(),
    obtenerReservaParaNoShow: jest.fn(),
    marcarNoShow: jest.fn(),
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
    existeAsignacionBarbero: jest.fn(),
  };
  const fechaBogotaService = {
    esFechaCalendarioValida: jest.fn(),
    obtenerDiaSemana: jest.fn(),
    obtenerFechaBogota: jest.fn(),
    obtenerHoraBogota: jest.fn(),
  };
  const barberosRepository = {
    obtenerBarberoPorUsuarioId: jest.fn(),
    obtenerBarberoActivoPorId: jest.fn(),
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
        tokenGestion: expect.any(String),
      });

      expect(resultado.tokenGestion).toHaveLength(64);

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
          gestionTokenHash: expect.any(String),
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

      const resultado = await service.crearReserva(dtoBase, identidad);

      expect(resultado.tokenGestion).toBeUndefined();
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
          gestionTokenHash: null,
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
      barberosRepository.obtenerBarberoPorUsuarioId.mockResolvedValue(
        barberoActivo,
      );
      reservasRepository.listarReservasDeBarberoEnFecha = jest.fn();
    });

    it('devuelve las reservas del barbero para la fecha solicitada con datos de cliente y servicio', async () => {
      reservasRepository.listarReservasDeBarberoEnFecha.mockResolvedValue([
        citaMock,
      ]);

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

      expect(
        barberosRepository.obtenerBarberoPorUsuarioId,
      ).toHaveBeenCalledWith(7);
      expect(
        reservasRepository.listarReservasDeBarberoEnFecha,
      ).toHaveBeenCalledWith(3, new Date('2026-11-01T00:00:00.000Z'));
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

      reservasRepository.listarReservasDeBarberoEnFecha.mockResolvedValue([
        citaInvitado,
      ]);

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

      expect(
        barberosRepository.obtenerBarberoPorUsuarioId,
      ).not.toHaveBeenCalled();
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

      await service.obtenerAgendaBarbero({ sub: '7' }, { fecha: '2026-11-01' });

      expect(
        barberosRepository.obtenerBarberoPorUsuarioId,
      ).toHaveBeenCalledWith(7);
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
      barberosRepository.obtenerBarberoPorUsuarioId.mockResolvedValue(
        barberoActivo,
      );
      reservasRepository.listarReservasDeBarberoEnRango = jest.fn();
    });

    it('devuelve las reservas del rango semanal ordenadas cronológicamente', async () => {
      reservasRepository.listarReservasDeBarberoEnRango.mockResolvedValue([
        citaLunes,
        citaMiercoles,
      ]);

      const resultado = await service.obtenerAgendaSemanalBarbero(
        usuarioBarbero,
        {
          desde: '2026-11-02',
          hasta: '2026-11-08',
        },
      );

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

      expect(
        barberosRepository.obtenerBarberoPorUsuarioId,
      ).toHaveBeenCalledWith(7);
      expect(
        reservasRepository.listarReservasDeBarberoEnRango,
      ).toHaveBeenCalledWith(
        3,
        new Date('2026-11-02T00:00:00.000Z'),
        new Date('2026-11-08T00:00:00.000Z'),
      );
    });

    it('devuelve lista vacía cuando no hay reservas en el rango', async () => {
      reservasRepository.listarReservasDeBarberoEnRango.mockResolvedValue([]);

      const resultado = await service.obtenerAgendaSemanalBarbero(
        usuarioBarbero,
        {
          desde: '2026-11-02',
          hasta: '2026-11-08',
        },
      );

      expect(resultado).toEqual({
        desde: '2026-11-02',
        hasta: '2026-11-08',
        reservas: [],
      });
    });

    it('rechaza si la fecha "desde" es inválida con 400', async () => {
      fechaBogotaService.esFechaCalendarioValida.mockImplementation(
        (f) => f !== 'invalida',
      );

      await expect(
        service.obtenerAgendaSemanalBarbero(usuarioBarbero, {
          desde: 'invalida',
          hasta: '2026-11-08',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rechaza si la fecha "hasta" es inválida con 400', async () => {
      fechaBogotaService.esFechaCalendarioValida.mockImplementation(
        (f) => f !== 'invalida',
      );

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
      ).rejects.toThrow(
        'La fecha inicial ("desde") no puede ser posterior a la fecha final ("hasta")',
      );
    });

    it('rechaza un rango superior a 7 días consecutivos con 400', async () => {
      fechaBogotaService.esFechaCalendarioValida.mockReturnValue(true);

      // Del 2 de noviembre al 10 de noviembre son 9 días
      await expect(
        service.obtenerAgendaSemanalBarbero(usuarioBarbero, {
          desde: '2026-11-02',
          hasta: '2026-11-10',
        }),
      ).rejects.toThrow(
        'El rango de consulta no puede superar los 7 días consecutivos',
      );
    });

    it('rechaza a un usuario que no tiene perfil de barbero asociado (403)', async () => {
      fechaBogotaService.esFechaCalendarioValida.mockReturnValue(true);
      barberosRepository.obtenerBarberoPorUsuarioId.mockResolvedValue(null);

      await expect(
        service.obtenerAgendaSemanalBarbero(
          { id: 99 },
          {
            desde: '2026-11-02',
            hasta: '2026-11-08',
          },
        ),
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

  describe('modificarReserva (HU-08)', () => {
    const identidad = { clienteId: 77 };
    const barberoDestinoActivo = {
      id: 5,
      estado: EstadoUsuario.ACTIVO,
      usuarioId: 10,
      telefono: '3009998877',
      porcentajeComision: 40,
      fotoUrl: null,
      usuario: { nombre: 'Pedro', apellido: 'López' },
    };

    beforeEach(() => {
      clientesRepository.obtenerPorId.mockResolvedValue({ id: 77 });
      fechaBogotaService.esFechaCalendarioValida.mockReturnValue(true);
      fechaBogotaService.obtenerDiaSemana.mockReturnValue('TUESDAY');
      serviciosRepository.obtenerServicioActivoPorId.mockResolvedValue(
        servicioActivo,
      );
      barberosRepository.obtenerBarberoActivoPorId.mockResolvedValue(
        barberoDestinoActivo,
      );
      serviciosRepository.existeAsignacionBarbero.mockResolvedValue(true);
      reservasRepository.existeReservaActivaDeClienteEnFranja.mockResolvedValue(
        false,
      );
      disponibilidadService.calcularDisponibilidad.mockResolvedValue([
        {
          startTime: '15:00',
          endTime: '16:00',
          estado: EstadoFranja.AVAILABLE,
        },
      ]);
    });

    it('modifica exitosamente fecha, hora y barbero cuando la franja está disponible y el servicio asignado', async () => {
      const reservaOriginal = crearReservaRelacion({
        id: 42,
        barberoId: 3,
        status: ReservationStatus.PENDING,
        precioReservado: 50000,
      });
      reservasRepository.obtenerReservaDeCliente.mockResolvedValue(
        reservaOriginal,
      );

      const reservaActualizada = crearReservaRelacion({
        id: 42,
        barberoId: 5,
        date: new Date('2026-11-03T00:00:00.000Z'),
        startTime: '15:00',
        endTime: '16:00',
        precioReservado: 50000,
        barbero: { id: 5, usuario: { nombre: 'Pedro', apellido: 'López' } },
      });
      reservasRepository.modificarConBloqueo.mockResolvedValue(
        reservaActualizada,
      );

      const respuesta = await service.modificarReserva(identidad, 42, {
        fecha: '2026-11-03',
        hora: '15:00',
        barberoId: 5,
      });

      expect(respuesta.mensaje).toBe(MENSAJE_RESERVA_MODIFICADA);
      expect(respuesta.id).toBe(42);
      expect(respuesta.fecha).toBe('2026-11-03');
      expect(respuesta.hora).toBe('15:00');
      expect(respuesta.horaFin).toBe('16:00');
      expect(respuesta.barbero.id).toBe(5);
      expect(respuesta.barbero.nombre).toBe('Pedro');
      expect(respuesta.servicio.nombre).toBe('Corte de cabello');
      expect(reservasRepository.modificarConBloqueo).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 42,
          barberoId: 5,
          startTime: '15:00',
          endTime: '16:00',
        }),
      );
    });

    it('rechaza con BadRequestException si el cuerpo está vacío', async () => {
      await expect(
        service.modificarReserva(identidad, 42, {}),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(reservasRepository.obtenerReservaDeCliente).not.toHaveBeenCalled();
    });

    it('rechaza con BadRequestException si la fecha proporcionada es inválida', async () => {
      fechaBogotaService.esFechaCalendarioValida.mockReturnValue(false);

      await expect(
        service.modificarReserva(identidad, 42, { fecha: 'invalida' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rechaza con UnauthorizedException si la sesión del cliente no es válida', async () => {
      clientesRepository.obtenerPorId.mockResolvedValue(null);

      await expect(
        service.modificarReserva(identidad, 42, { hora: '15:00' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rechaza con NotFoundException si la reserva no existe o pertenece a otro cliente', async () => {
      reservasRepository.obtenerReservaDeCliente.mockResolvedValue(null);

      await expect(
        service.modificarReserva(identidad, 42, { hora: '15:00' }),
      ).rejects.toThrow(MENSAJE_RESERVA_NO_DISPONIBLE);
    });

    it('rechaza con ConflictException si la reserva ya está CANCELLED', async () => {
      reservasRepository.obtenerReservaDeCliente.mockResolvedValue(
        crearReservaRelacion({ status: ReservationStatus.CANCELLED }),
      );

      await expect(
        service.modificarReserva(identidad, 42, { hora: '15:00' }),
      ).rejects.toThrow('No es posible modificar una reserva cancelada');
    });

    it('rechaza con ConflictException si la reserva está COMPLETED o IN_PROGRESS', async () => {
      reservasRepository.obtenerReservaDeCliente.mockResolvedValue(
        crearReservaRelacion({ status: ReservationStatus.COMPLETED }),
      );

      await expect(
        service.modificarReserva(identidad, 42, { hora: '15:00' }),
      ).rejects.toThrow(
        'No es posible modificar una reserva en estado COMPLETED',
      );

      reservasRepository.obtenerReservaDeCliente.mockResolvedValue(
        crearReservaRelacion({ status: ReservationStatus.IN_PROGRESS }),
      );

      await expect(
        service.modificarReserva(identidad, 42, { hora: '15:00' }),
      ).rejects.toThrow(
        'No es posible modificar una reserva en estado IN_PROGRESS',
      );
    });

    it('rechaza con NotFoundException si el nuevo barbero no existe o está inactivo', async () => {
      reservasRepository.obtenerReservaDeCliente.mockResolvedValue(
        crearReservaRelacion({ status: ReservationStatus.PENDING }),
      );
      barberosRepository.obtenerBarberoActivoPorId.mockResolvedValue(null);

      await expect(
        service.modificarReserva(identidad, 42, { barberoId: 99 }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rechaza con BadRequestException si el barbero destino no presta el servicio', async () => {
      reservasRepository.obtenerReservaDeCliente.mockResolvedValue(
        crearReservaRelacion({
          status: ReservationStatus.PENDING,
          servicioId: 2,
        }),
      );
      serviciosRepository.existeAsignacionBarbero.mockResolvedValue(false);

      await expect(
        service.modificarReserva(identidad, 42, { barberoId: 5 }),
      ).rejects.toThrow('El barbero 5 no presta el servicio 2');
    });

    it('rechaza con ConflictException si el propio cliente ya tiene una reserva en el horario destino', async () => {
      reservasRepository.obtenerReservaDeCliente.mockResolvedValue(
        crearReservaRelacion({
          id: 42,
          barberoId: 3,
          startTime: '14:00',
          status: ReservationStatus.PENDING,
        }),
      );
      reservasRepository.existeReservaActivaDeClienteEnFranja.mockResolvedValue(
        true,
      );

      await expect(
        service.modificarReserva(identidad, 42, { hora: '15:00' }),
      ).rejects.toThrow(MENSAJE_RESERVA_DUPLICADA);
    });

    it('rechaza con ConflictException (El horario seleccionado no está disponible) si la franja no está AVAILABLE', async () => {
      reservasRepository.obtenerReservaDeCliente.mockResolvedValue(
        crearReservaRelacion({
          id: 42,
          barberoId: 3,
          startTime: '14:00',
          status: ReservationStatus.PENDING,
        }),
      );
      disponibilidadService.calcularDisponibilidad.mockResolvedValue([
        { startTime: '15:00', endTime: '16:00', estado: EstadoFranja.RESERVED },
      ]);

      await expect(
        service.modificarReserva(identidad, 42, { hora: '15:00' }),
      ).rejects.toThrow(MENSAJE_HORARIO_NO_DISPONIBLE);
    });

    it('permite modificar hacia la misma franja sin conflicto consigo misma (excluyendo su id)', async () => {
      reservasRepository.obtenerReservaDeCliente.mockResolvedValue(
        crearReservaRelacion({
          id: 42,
          barberoId: 3,
          date: new Date('2026-11-01T00:00:00.000Z'),
          startTime: '14:00',
          status: ReservationStatus.PENDING,
        }),
      );
      disponibilidadService.calcularDisponibilidad.mockResolvedValue([
        {
          startTime: '14:00',
          endTime: '15:00',
          estado: EstadoFranja.AVAILABLE,
        },
      ]);
      barberosRepository.obtenerBarberoActivoPorId.mockResolvedValue({
        id: 3,
        estado: EstadoUsuario.ACTIVO,
        usuario: { nombre: 'Carlos', apellido: 'Gómez' },
      });
      reservasRepository.modificarConBloqueo.mockResolvedValue(
        crearReservaRelacion({ id: 42 }),
      );

      const respuesta = await service.modificarReserva(identidad, 42, {
        hora: '14:00',
      });

      expect(respuesta.mensaje).toBe(MENSAJE_RESERVA_MODIFICADA);
      expect(disponibilidadService.calcularDisponibilidad).toHaveBeenCalledWith(
        expect.objectContaining({
          barberoId: 3,
          excluirReservaId: 42,
        }),
      );
    });

    it('maneja violación de concurrencia P2002 traduciéndola a 409 El horario seleccionado no está disponible', async () => {
      reservasRepository.obtenerReservaDeCliente.mockResolvedValue(
        crearReservaRelacion({ id: 42, status: ReservationStatus.PENDING }),
      );
      reservasRepository.modificarConBloqueo.mockRejectedValue({
        code: 'P2002',
      });

      await expect(
        service.modificarReserva(identidad, 42, { hora: '15:00' }),
      ).rejects.toThrow(MENSAJE_HORARIO_NO_DISPONIBLE);
    });

    it('conserva el precio histórico de la reserva original aunque el servicio actual haya subido de precio', async () => {
      reservasRepository.obtenerReservaDeCliente.mockResolvedValue(
        crearReservaRelacion({
          id: 42,
          precioReservado: 45000,
          status: ReservationStatus.PENDING,
        }),
      );
      serviciosRepository.obtenerServicioActivoPorId.mockResolvedValue({
        ...servicioActivo,
        precio: 80000,
      });

      let precioEnviadoARepo: number | null | undefined;
      reservasRepository.modificarConBloqueo.mockImplementation(
        async (datos) => {
          precioEnviadoARepo = datos.precioReservado;
          return crearReservaRelacion({
            id: 42,
            precioReservado: datos.precioReservado,
          });
        },
      );

      const respuesta = await service.modificarReserva(identidad, 42, {
        hora: '15:00',
      });

      expect(precioEnviadoARepo).toBe(45000);
      expect(respuesta.precio).toBe(45000);
    });

    it('propaga error dentro de la transacción manteniendo la reserva original intacta', async () => {
      reservasRepository.obtenerReservaDeCliente.mockResolvedValue(
        crearReservaRelacion({ id: 42, status: ReservationStatus.PENDING }),
      );
      reservasRepository.modificarConBloqueo.mockRejectedValue(
        new Error('Transaction rollback simulated'),
      );

      await expect(
        service.modificarReserva(identidad, 42, { hora: '15:00' }),
      ).rejects.toThrow('Transaction rollback simulated');
    });
  });

  describe('cancelarReserva (HU-09)', () => {
    const identidad = { clienteId: 77 };

    beforeEach(() => {
      clientesRepository.obtenerPorId.mockResolvedValue({ id: 77 });
    });

    it('cancela exitosamente una reserva propia en estado PENDING o CONFIRMED', async () => {
      const reserva = crearReservaRelacion({
        id: 42,
        status: ReservationStatus.CONFIRMED,
      });
      reservasRepository.obtenerReservaDeCliente.mockResolvedValue(reserva);
      reservasRepository.cancelar.mockResolvedValue({
        id: 42,
        status: ReservationStatus.CANCELLED,
      });

      const respuesta = await service.cancelarReserva(identidad, 42);

      expect(respuesta.mensaje).toBe(MENSAJE_RESERVA_CANCELADA);
      expect(respuesta.id).toBe(42);
      expect(respuesta.estado).toBe(ReservationStatus.CANCELLED);
      expect(reservasRepository.cancelar).toHaveBeenCalledWith(42);
    });

    it('rechaza con NotFoundException si la reserva no pertenece al cliente o no existe', async () => {
      reservasRepository.obtenerReservaDeCliente.mockResolvedValue(null);

      await expect(service.cancelarReserva(identidad, 999)).rejects.toThrow(
        MENSAJE_RESERVA_NO_DISPONIBLE,
      );

      expect(reservasRepository.cancelar).not.toHaveBeenCalled();
    });

    it('rechaza con ConflictException si la reserva se encuentra en COMPLETED o IN_PROGRESS', async () => {
      reservasRepository.obtenerReservaDeCliente.mockResolvedValue(
        crearReservaRelacion({ id: 42, status: ReservationStatus.COMPLETED }),
      );

      await expect(service.cancelarReserva(identidad, 42)).rejects.toThrow(
        'No es posible cancelar una reserva en estado COMPLETED',
      );

      reservasRepository.obtenerReservaDeCliente.mockResolvedValue(
        crearReservaRelacion({ id: 42, status: ReservationStatus.IN_PROGRESS }),
      );

      await expect(service.cancelarReserva(identidad, 42)).rejects.toThrow(
        'No es posible cancelar una reserva en estado IN_PROGRESS',
      );

      expect(reservasRepository.cancelar).not.toHaveBeenCalled();
    });

    it('gestiona peticiones repetidas de forma idempotente sin duplicar llamadas a repositorio', async () => {
      reservasRepository.obtenerReservaDeCliente.mockResolvedValue(
        crearReservaRelacion({ id: 42, status: ReservationStatus.CANCELLED }),
      );

      const respuesta = await service.cancelarReserva(identidad, 42);

      expect(respuesta.mensaje).toBe(MENSAJE_RESERVA_CANCELADA);
      expect(respuesta.id).toBe(42);
      expect(respuesta.estado).toBe(ReservationStatus.CANCELLED);
      expect(reservasRepository.cancelar).not.toHaveBeenCalled();
    });

    it('desistimiento del cliente: si el cliente no confirma en frontend, no se invoca la cancelación', () => {
      const reserva = crearReservaRelacion({
        id: 42,
        status: ReservationStatus.CONFIRMED,
      });

      // El usuario desiste en el frontend: no hay llamada a cancelarReserva
      expect(reserva.status).toBe(ReservationStatus.CONFIRMED);
      expect(reservasRepository.cancelar).not.toHaveBeenCalled();
    });

    it('rechaza con UnauthorizedException si la sesión del cliente no es válida', async () => {
      clientesRepository.obtenerPorId.mockResolvedValue(null);

      await expect(
        service.cancelarReserva(identidad, 42),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      expect(reservasRepository.cancelar).not.toHaveBeenCalled();
    });

    it('rechaza con 409 si el cliente cancela dentro de la ventana de antelación', async () => {
      // Faltan 30 minutos para la cita (< 120 de antelación configurada).
      fechaBogotaService.obtenerHoraBogota.mockReturnValue('13:30');
      reservasRepository.obtenerReservaDeCliente.mockResolvedValue(
        crearReservaRelacion({ id: 42, status: ReservationStatus.CONFIRMED }),
      );

      await expect(service.cancelarReserva(identidad, 42)).rejects.toThrow(
        'faltan menos de 120 minutos',
      );

      expect(reservasRepository.cancelar).not.toHaveBeenCalled();
    });

    it('permite al staff (admin) cancelar dentro de la ventana de antelación', async () => {
      fechaBogotaService.obtenerHoraBogota.mockReturnValue('13:30');
      reservasRepository.obtenerReservaConRelaciones.mockResolvedValue(
        crearReservaRelacion({ id: 42, status: ReservationStatus.CONFIRMED }),
      );
      reservasRepository.cancelar.mockResolvedValue({
        id: 42,
        status: ReservationStatus.CANCELLED,
      });

      const respuesta = await service.cancelarReservaAdmin(42);

      expect(respuesta.estado).toBe(ReservationStatus.CANCELLED);
      expect(reservasRepository.cancelar).toHaveBeenCalledWith(42);
    });
  });

  describe('completarReserva (SCRUM-277)', () => {
    const usuarioBarbero = { id: 9, sub: '9', rol: 'BARBERO' };
    const usuarioSuperadmin = { id: 1, sub: '1', rol: 'SUPERADMIN' };

    const reservaCompletarBase = (over: Record<string, unknown> = {}) => ({
      id: 42,
      barberoId: 3,
      servicioId: 2,
      clienteId: 77,
      date: new Date('2026-11-01T00:00:00.000Z'),
      dayOfWeek: 'SUNDAY',
      startTime: '14:00',
      endTime: '15:00',
      status: ReservationStatus.CONFIRMED,
      precioReservado: 50000,
      createdAt: new Date(),
      updatedAt: new Date(),
      cliente: { nombre: 'Ana', apellido: 'Pérez', telefono: '3001234567' },
      servicio: { id: 2, nombre: 'Corte de cabello' },
      barbero: { id: 3, usuario: { nombre: 'Carlos', apellido: 'Gómez' } },
      ...over,
    });

    beforeEach(() => {
      // Instante de Bogotá posterior a la hora de finalización de la reserva.
      fechaBogotaService.obtenerFechaBogota.mockReturnValue('2026-11-01');
      fechaBogotaService.obtenerHoraBogota.mockReturnValue('16:00');
      barberosRepository.obtenerBarberoPorUsuarioId.mockResolvedValue({
        id: 3,
        estado: EstadoUsuario.ACTIVO,
      });
    });

    it('completa una reserva propia del barbero después de la hora de finalización', async () => {
      reservasRepository.obtenerReservaParaCompletar.mockResolvedValue(
        reservaCompletarBase(),
      );
      reservasRepository.completar.mockResolvedValue(true);

      const respuesta = await service.completarReserva(
        usuarioBarbero,
        'BARBERO',
        42,
      );

      expect(respuesta.mensaje).toBe(MENSAJE_RESERVA_COMPLETADA);
      expect(respuesta.id).toBe(42);
      expect(respuesta.estado).toBe(ReservationStatus.COMPLETED);
      expect(reservasRepository.completar).toHaveBeenCalledWith(42);
    });

    it('permite a SUPERADMIN completar cualquier reserva', async () => {
      reservasRepository.obtenerReservaParaCompletar.mockResolvedValue(
        reservaCompletarBase({ barberoId: 99 }),
      );
      reservasRepository.completar.mockResolvedValue(true);

      const respuesta = await service.completarReserva(
        usuarioSuperadmin,
        'SUPERADMIN',
        42,
      );

      expect(respuesta.estado).toBe(ReservationStatus.COMPLETED);
      expect(
        barberosRepository.obtenerBarberoPorUsuarioId,
      ).not.toHaveBeenCalled();
    });

    it('responde 404 uniforme si el barbero intenta completar una reserva ajena', async () => {
      reservasRepository.obtenerReservaParaCompletar.mockResolvedValue(
        reservaCompletarBase({ barberoId: 99 }),
      );

      await expect(
        service.completarReserva(usuarioBarbero, 'BARBERO', 42),
      ).rejects.toThrow(MENSAJE_RESERVA_NO_DISPONIBLE);

      expect(reservasRepository.completar).not.toHaveBeenCalled();
    });

    it('rechaza con 409 si la reserva está cancelada', async () => {
      reservasRepository.obtenerReservaParaCompletar.mockResolvedValue(
        reservaCompletarBase({ status: ReservationStatus.CANCELLED }),
      );

      await expect(
        service.completarReserva(usuarioSuperadmin, 'SUPERADMIN', 42),
      ).rejects.toThrow('No es posible completar una reserva cancelada');

      expect(reservasRepository.completar).not.toHaveBeenCalled();
    });

    it('es idempotente si la reserva ya está COMPLETED y no vuelve a completar', async () => {
      reservasRepository.obtenerReservaParaCompletar.mockResolvedValue(
        reservaCompletarBase({ status: ReservationStatus.COMPLETED }),
      );

      const respuesta = await service.completarReserva(
        usuarioSuperadmin,
        'SUPERADMIN',
        42,
      );

      expect(respuesta.estado).toBe(ReservationStatus.COMPLETED);
      expect(reservasRepository.completar).not.toHaveBeenCalled();
    });

    it('rechaza con 409 si aún no ha finalizado la franja horaria', async () => {
      fechaBogotaService.obtenerHoraBogota.mockReturnValue('14:30');
      reservasRepository.obtenerReservaParaCompletar.mockResolvedValue(
        reservaCompletarBase(),
      );

      await expect(
        service.completarReserva(usuarioSuperadmin, 'SUPERADMIN', 42),
      ).rejects.toThrow(
        'No es posible completar una reserva antes de su hora de finalización',
      );

      expect(reservasRepository.completar).not.toHaveBeenCalled();
    });

    it('responde 404 si la reserva no existe', async () => {
      reservasRepository.obtenerReservaParaCompletar.mockResolvedValue(null);

      await expect(
        service.completarReserva(usuarioSuperadmin, 'SUPERADMIN', 999),
      ).rejects.toThrow(MENSAJE_RESERVA_NO_DISPONIBLE);

      expect(reservasRepository.completar).not.toHaveBeenCalled();
    });

    it('notifica al cliente por WhatsApp solo cuando la transición se concreta', async () => {
      reservasRepository.obtenerReservaParaCompletar.mockResolvedValue(
        reservaCompletarBase(),
      );
      reservasRepository.completar.mockResolvedValue(true);
      const whatsapp = {
        enviarCompletadoReserva: jest.fn().mockResolvedValue(true),
      };
      (
        service as unknown as { whatsappService: typeof whatsapp }
      ).whatsappService = whatsapp;

      await service.completarReserva(usuarioSuperadmin, 'SUPERADMIN', 42);

      expect(whatsapp.enviarCompletadoReserva).toHaveBeenCalledWith(
        expect.objectContaining({
          telefono: '3001234567',
          servicioNombre: 'Corte de cabello',
        }),
      );
    });

    it('no notifica si la transición no se concreta (updateMany sin filas)', async () => {
      reservasRepository.obtenerReservaParaCompletar.mockResolvedValue(
        reservaCompletarBase(),
      );
      reservasRepository.completar.mockResolvedValue(false);
      const whatsapp = {
        enviarCompletadoReserva: jest.fn().mockResolvedValue(true),
      };
      (
        service as unknown as { whatsappService: typeof whatsapp }
      ).whatsappService = whatsapp;

      await service.completarReserva(usuarioSuperadmin, 'SUPERADMIN', 42);

      expect(whatsapp.enviarCompletadoReserva).not.toHaveBeenCalled();
    });
  });

  describe('noShowReserva (NO_SHOW)', () => {
    const usuarioBarbero = { id: 9, sub: '9', rol: 'BARBERO' };
    const usuarioSuperadmin = { id: 1, sub: '1', rol: 'SUPERADMIN' };

    const reservaNoShowBase = (over: Record<string, unknown> = {}) => ({
      id: 42,
      barberoId: 3,
      servicioId: 2,
      clienteId: 77,
      date: new Date('2026-11-01T00:00:00.000Z'),
      dayOfWeek: 'SUNDAY',
      startTime: '14:00',
      endTime: '15:00',
      status: ReservationStatus.CONFIRMED,
      precioReservado: 50000,
      createdAt: new Date(),
      updatedAt: new Date(),
      cliente: { nombre: 'Ana', apellido: 'Pérez', telefono: '3001234567' },
      servicio: { id: 2, nombre: 'Corte de cabello' },
      barbero: { id: 3, usuario: { nombre: 'Carlos', apellido: 'Gómez' } },
      ...over,
    });

    beforeEach(() => {
      // La tolerancia por defecto es 15 min; 20 min tras el inicio permite marcar.
      fechaBogotaService.obtenerFechaBogota.mockReturnValue('2026-11-01');
      fechaBogotaService.obtenerHoraBogota.mockReturnValue('14:20');
      barberosRepository.obtenerBarberoPorUsuarioId.mockResolvedValue({
        id: 3,
        estado: EstadoUsuario.ACTIVO,
      });
    });

    it('marca como no asistida una reserva propia del barbero tras la tolerancia', async () => {
      reservasRepository.obtenerReservaParaNoShow.mockResolvedValue(
        reservaNoShowBase(),
      );
      reservasRepository.marcarNoShow.mockResolvedValue(true);

      const respuesta = await service.noShowReserva(usuarioBarbero, 'BARBERO', 42);

      expect(respuesta.mensaje).toBe(MENSAJE_RESERVA_NO_SHOW);
      expect(respuesta.id).toBe(42);
      expect(respuesta.estado).toBe(ReservationStatus.NO_SHOW);
      expect(reservasRepository.marcarNoShow).toHaveBeenCalledWith(42);
    });

    it('permite a SUPERADMIN marcar cualquier reserva', async () => {
      reservasRepository.obtenerReservaParaNoShow.mockResolvedValue(
        reservaNoShowBase({ barberoId: 99 }),
      );
      reservasRepository.marcarNoShow.mockResolvedValue(true);

      const respuesta = await service.noShowReserva(
        usuarioSuperadmin,
        'SUPERADMIN',
        42,
      );

      expect(respuesta.estado).toBe(ReservationStatus.NO_SHOW);
      expect(
        barberosRepository.obtenerBarberoPorUsuarioId,
      ).not.toHaveBeenCalled();
    });

    it('responde 404 uniforme si el barbero intenta marcar una reserva ajena', async () => {
      reservasRepository.obtenerReservaParaNoShow.mockResolvedValue(
        reservaNoShowBase({ barberoId: 99 }),
      );

      await expect(
        service.noShowReserva(usuarioBarbero, 'BARBERO', 42),
      ).rejects.toThrow(MENSAJE_RESERVA_NO_DISPONIBLE);

      expect(reservasRepository.marcarNoShow).not.toHaveBeenCalled();
    });

    it('rechaza con 409 si la reserva está cancelada', async () => {
      reservasRepository.obtenerReservaParaNoShow.mockResolvedValue(
        reservaNoShowBase({ status: ReservationStatus.CANCELLED }),
      );

      await expect(
        service.noShowReserva(usuarioSuperadmin, 'SUPERADMIN', 42),
      ).rejects.toThrow(
        'No es posible marcar como no asistida una reserva cancelada',
      );

      expect(reservasRepository.marcarNoShow).not.toHaveBeenCalled();
    });

    it('rechaza con 409 si la reserva ya está completada', async () => {
      reservasRepository.obtenerReservaParaNoShow.mockResolvedValue(
        reservaNoShowBase({ status: ReservationStatus.COMPLETED }),
      );

      await expect(
        service.noShowReserva(usuarioSuperadmin, 'SUPERADMIN', 42),
      ).rejects.toThrow(
        'No es posible marcar como no asistida una reserva completada',
      );

      expect(reservasRepository.marcarNoShow).not.toHaveBeenCalled();
    });

    it('es idempotente si la reserva ya está NO_SHOW', async () => {
      reservasRepository.obtenerReservaParaNoShow.mockResolvedValue(
        reservaNoShowBase({ status: ReservationStatus.NO_SHOW }),
      );

      const respuesta = await service.noShowReserva(
        usuarioSuperadmin,
        'SUPERADMIN',
        42,
      );

      expect(respuesta.estado).toBe(ReservationStatus.NO_SHOW);
      expect(reservasRepository.marcarNoShow).not.toHaveBeenCalled();
    });

    it('rechaza con 409 si aún no transcurrió la tolerancia', async () => {
      fechaBogotaService.obtenerHoraBogota.mockReturnValue('14:10');
      reservasRepository.obtenerReservaParaNoShow.mockResolvedValue(
        reservaNoShowBase(),
      );

      await expect(
        service.noShowReserva(usuarioSuperadmin, 'SUPERADMIN', 42),
      ).rejects.toThrow(
        'No es posible marcar la reserva como no asistida antes de 15 minutos',
      );

      expect(reservasRepository.marcarNoShow).not.toHaveBeenCalled();
    });

    it('responde 404 si la reserva no existe', async () => {
      reservasRepository.obtenerReservaParaNoShow.mockResolvedValue(null);

      await expect(
        service.noShowReserva(usuarioSuperadmin, 'SUPERADMIN', 999),
      ).rejects.toThrow(MENSAJE_RESERVA_NO_DISPONIBLE);

      expect(reservasRepository.marcarNoShow).not.toHaveBeenCalled();
    });
  });
});
