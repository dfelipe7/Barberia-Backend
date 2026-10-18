import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ReservationStatus } from '../../../../generated/prisma/enums';
import { ReservasService, MENSAJE_RESERVA_CREADA } from './reservas.service';
import { CrearReservaAdminDto } from '../dto/dto-peticion/crear-reserva-admin.dto';
import { FiltroReservasAdminDto } from '../dto/dto-peticion/filtro-reservas-admin.dto';

describe('ReservasService - Administración (HU-13 y SUPERADMIN)', () => {
  let service: ReservasService;
  let reservasRepo: any;
  let clientesRepo: any;
  let disponibilidadService: any;
  let serviciosRepo: any;
  let fechaBogotaService: any;
  let barberosRepo: any;
  let whatsappService: any;

  beforeEach(() => {
    reservasRepo = {
      existeReservaActivaDeClienteEnFranja: jest.fn().mockResolvedValue(false),
      crearConBloqueo: jest.fn().mockImplementation((datos) =>
        Promise.resolve({
          id: 101,
          barberoId: datos.barberoId,
          servicioId: datos.servicioId,
          clienteId: 5,
          date: datos.date,
          dayOfWeek: datos.dayOfWeek,
          startTime: datos.startTime,
          endTime: datos.endTime,
          status: datos.status ?? ReservationStatus.CONFIRMED,
          precioReservado: datos.precioReservado,
          gestionTokenHash: datos.gestionTokenHash,
          slotActivo: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      ),
      obtenerReservaAdminPorId: jest.fn(),
      listarReservasAdmin: jest.fn(),
      obtenerReservaConRelaciones: jest.fn(),
      modificarConBloqueo: jest.fn(),
      cancelar: jest.fn(),
    };

    clientesRepo = {
      obtenerPorId: jest.fn(),
      buscarClientes: jest.fn(),
    };

    disponibilidadService = {
      calcularDisponibilidad: jest.fn().mockResolvedValue([
        {
          startTime: '14:00',
          endTime: '15:00',
          estado: 'AVAILABLE',
          motivo: 'HORARIO_HABILITADO',
        },
      ]),
    };

    serviciosRepo = {
      obtenerServicioActivoPorId: jest.fn(),
      existeAsignacionBarbero: jest.fn(),
      listarBarberosActivosPorServicio: jest
        .fn()
        .mockResolvedValue([
          { id: 2, usuario: { nombre: 'Duvan', apellido: 'Armero' } },
        ]),
    };

    fechaBogotaService = {
      esFechaCalendarioValida: jest
        .fn()
        .mockImplementation((f: string) => /^\d{4}-\d{2}-\d{2}$/.test(f)),
      obtenerDiaSemana: jest.fn().mockReturnValue('FRIDAY'),
    };

    barberosRepo = {
      obtenerBarberoActivoPorId: jest.fn(),
    };

    whatsappService = {
      enviarConfirmacionReserva: jest.fn().mockResolvedValue(true),
    };

    service = new ReservasService(
      reservasRepo,
      clientesRepo,
      disponibilidadService,
      serviciosRepo,
      fechaBogotaService,
      barberosRepo,
      whatsappService,
    );
  });

  describe('crearReservaAdmin (HU-13)', () => {
    const dtoBase: CrearReservaAdminDto = {
      servicioId: 1,
      barberoId: 2,
      fecha: '2026-11-20',
      hora: '14:00',
    };

    beforeEach(() => {
      serviciosRepo.obtenerServicioActivoPorId.mockResolvedValue({
        id: 1,
        nombre: 'Corte Clásico',
        precio: '25000',
        duracionMinutos: 60,
      });

      barberosRepo.obtenerBarberoActivoPorId.mockResolvedValue({
        id: 2,
        usuario: { id: 20, nombre: 'Duvan', apellido: 'Armero' },
      });

      serviciosRepo.existeAsignacionBarbero.mockResolvedValue(true);

      disponibilidadService.calcularDisponibilidad.mockResolvedValue([
        {
          startTime: '14:00',
          endTime: '15:00',
          estado: 'AVAILABLE',
          motivo: 'HORARIO_HABILITADO',
        },
      ]);
    });

    it('debe crear una reserva para un cliente registrado existente (HU-13-CA-01, CA-02)', async () => {
      clientesRepo.obtenerPorId.mockResolvedValue({
        id: 5,
        nombre: 'Carlos',
        apellido: 'Gómez',
        telefono: '3119998877',
      });

      const resultado = await service.crearReservaAdmin({
        ...dtoBase,
        clienteId: 5,
      });

      expect(resultado.mensaje).toBe(MENSAJE_RESERVA_CREADA);
      expect(resultado.id).toBe(101);
      expect(resultado.tokenGestion).toBeUndefined(); // Sin token para clientes registrados
      expect(reservasRepo.crearConBloqueo).toHaveBeenCalledWith(
        expect.objectContaining({
          cliente: { clienteId: 5 },
          precioReservado: 25000,
          gestionTokenHash: null,
        }),
      );
      expect(whatsappService.enviarConfirmacionReserva).toHaveBeenCalled();
    });

    it('debe rechazar con 404 si el clienteId especificado no existe en la base de datos', async () => {
      clientesRepo.obtenerPorId.mockResolvedValue(null);

      await expect(
        service.crearReservaAdmin({
          ...dtoBase,
          clienteId: 999,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('debe crear una reserva para un cliente ocasional sin cuenta y generar token de gestión (HU-13-CA-03)', async () => {
      const resultado = await service.crearReservaAdmin({
        ...dtoBase,
        nombre: 'María',
        apellido: 'López',
        telefono: '3001234567',
        email: 'maria@example.com',
      });

      expect(resultado.mensaje).toBe(MENSAJE_RESERVA_CREADA);
      expect(resultado.tokenGestion).toBeDefined();
      expect(typeof resultado.tokenGestion).toBe('string');
      expect(resultado.tokenGestion?.length).toBe(64); // 256 bits hex
      expect(reservasRepo.crearConBloqueo).toHaveBeenCalledWith(
        expect.objectContaining({
          cliente: {
            crear: {
              nombre: 'María',
              apellido: 'López',
              telefono: '3001234567',
              email: 'maria@example.com',
              usuarioId: null,
            },
          },
          gestionTokenHash: expect.any(String),
        }),
      );
    });

    it('debe rechazar con 400 si faltan nombre o teléfono para un cliente ocasional (HU-13-CA-04)', async () => {
      await expect(
        service.crearReservaAdmin({
          ...dtoBase,
          nombre: 'María',
          // sin teléfono
        }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.crearReservaAdmin({
          ...dtoBase,
          telefono: '3001234567',
          // sin nombre
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('debe rechazar con 409 si el cliente registrado ya tiene una reserva en la misma franja', async () => {
      clientesRepo.obtenerPorId.mockResolvedValue({
        id: 5,
        nombre: 'Carlos',
      });
      reservasRepo.existeReservaActivaDeClienteEnFranja.mockResolvedValue(true);

      await expect(
        service.crearReservaAdmin({
          ...dtoBase,
          clienteId: 5,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('debe rechazar con 404 si el servicio o el barbero no existen o no están activos', async () => {
      serviciosRepo.obtenerServicioActivoPorId.mockResolvedValue(null);

      await expect(
        service.crearReservaAdmin({
          ...dtoBase,
          nombre: 'Juan',
          telefono: '3001112233',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('debe rechazar con 400 si el barbero no presta el servicio solicitado (HU-13-CA-05)', async () => {
      serviciosRepo.existeAsignacionBarbero.mockResolvedValue(false);

      await expect(
        service.crearReservaAdmin({
          ...dtoBase,
          nombre: 'Juan',
          telefono: '3001112233',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('debe rechazar con 409 si el horario no está disponible en DisponibilidadService (HU-13-CA-05)', async () => {
      disponibilidadService.calcularDisponibilidad.mockResolvedValue([
        {
          startTime: '14:00',
          endTime: '15:00',
          estado: 'UNAVAILABLE',
          motivo: 'RESERVA_ACTIVA',
        },
      ]);

      await expect(
        service.crearReservaAdmin({
          ...dtoBase,
          nombre: 'Juan',
          telefono: '3001112233',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('SUPERADMIN: listarReservasAdmin y obtenerReservaAdmin', () => {
    const mockReservaAdmin = {
      id: 50,
      barberoId: 2,
      servicioId: 1,
      clienteId: 5,
      date: new Date('2026-11-20T00:00:00.000Z'),
      dayOfWeek: 'FRIDAY',
      startTime: '14:00',
      endTime: '15:00',
      status: ReservationStatus.CONFIRMED,
      precioReservado: 25000,
      createdAt: new Date(),
      updatedAt: new Date(),
      cliente: {
        id: 5,
        nombre: 'Carlos',
        apellido: 'Gómez',
        telefono: '3119998877',
        email: 'carlos@example.com',
        usuarioId: null,
        googleId: 'google-sub-123',
      },
      servicio: {
        id: 1,
        nombre: 'Corte Clásico',
        precio: 25000,
        duracionMinutos: 60,
      },
      barbero: {
        id: 2,
        usuario: {
          id: 20,
          nombre: 'Duvan',
          apellido: 'Armero',
        },
      },
    };

    it('debe listar reservas con filtros en base de datos', async () => {
      reservasRepo.listarReservasAdmin.mockResolvedValue([mockReservaAdmin]);

      const filtro: FiltroReservasAdminDto = {
        fecha: '2026-11-20',
        barberoId: 2,
        estado: ReservationStatus.CONFIRMED,
      };

      const resultado = await service.listarReservasAdmin(filtro);

      expect(resultado).toHaveLength(1);
      expect(resultado[0].id).toBe(50);
      expect(resultado[0].cliente.esRegistrado).toBe(true);
      expect(resultado[0].precio).toBe(25000);
      expect(reservasRepo.listarReservasAdmin).toHaveBeenCalledWith(
        expect.objectContaining({
          barberoId: 2,
          estado: ReservationStatus.CONFIRMED,
        }),
      );
    });

    it('debe rechazar si el rango "desde" > "hasta"', async () => {
      await expect(
        service.listarReservasAdmin({
          desde: '2026-11-25',
          hasta: '2026-11-20',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('debe obtener el detalle de cualquier reserva por ID', async () => {
      reservasRepo.obtenerReservaAdminPorId.mockResolvedValue(mockReservaAdmin);

      const resultado = await service.obtenerReservaAdmin(50);

      expect(resultado.id).toBe(50);
      expect(resultado.barbero.nombre).toBe('Duvan');
      expect(resultado.servicio.nombre).toBe('Corte Clásico');
    });

    it('debe lanzar 404 si la reserva no existe', async () => {
      reservasRepo.obtenerReservaAdminPorId.mockResolvedValue(null);

      await expect(service.obtenerReservaAdmin(999)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('SUPERADMIN: modificarReservaAdmin y cancelarReservaAdmin', () => {
    const mockReservaConRel = {
      id: 50,
      barberoId: 2,
      servicioId: 1,
      clienteId: 5,
      date: new Date('2026-11-20T00:00:00.000Z'),
      dayOfWeek: 'FRIDAY',
      startTime: '14:00',
      endTime: '15:00',
      status: ReservationStatus.CONFIRMED,
      precioReservado: 25000,
      createdAt: new Date(),
      updatedAt: new Date(),
      servicio: { id: 1, nombre: 'Corte Clásico', precio: 25000 },
      barbero: { id: 2, usuario: { nombre: 'Duvan', apellido: 'Armero' } },
    };

    beforeEach(() => {
      serviciosRepo.obtenerServicioActivoPorId.mockResolvedValue({
        id: 1,
        nombre: 'Corte Clásico',
        precio: 25000,
        duracionMinutos: 60,
      });

      barberosRepo.obtenerBarberoActivoPorId.mockResolvedValue({
        id: 2,
        usuario: { id: 20, nombre: 'Duvan', apellido: 'Armero' },
      });

      serviciosRepo.existeAsignacionBarbero.mockResolvedValue(true);

      disponibilidadService.calcularDisponibilidad.mockResolvedValue([
        {
          startTime: '16:00',
          endTime: '17:00',
          estado: 'AVAILABLE',
          motivo: 'HORARIO_HABILITADO',
        },
      ]);
    });

    it('debe modificar la reserva de cualquier barbero respetando disponibilidad', async () => {
      reservasRepo.obtenerReservaConRelaciones.mockResolvedValue(
        mockReservaConRel,
      );
      reservasRepo.modificarConBloqueo.mockResolvedValue({
        ...mockReservaConRel,
        startTime: '16:00',
        endTime: '17:00',
      });

      const resultado = await service.modificarReservaAdmin(50, {
        hora: '16:00',
      });

      expect(resultado.mensaje).toBe('Reserva modificada correctamente');
      expect(resultado.hora).toBe('16:00');
    });

    it('debe cancelar cualquier reserva de forma administrativa', async () => {
      reservasRepo.obtenerReservaConRelaciones.mockResolvedValue(
        mockReservaConRel,
      );
      reservasRepo.cancelar.mockResolvedValue({
        ...mockReservaConRel,
        status: ReservationStatus.CANCELLED,
      });

      const resultado = await service.cancelarReservaAdmin(50);

      expect(resultado.mensaje).toBe('Reserva cancelada correctamente');
      expect(resultado.estado).toBe(ReservationStatus.CANCELLED);
      expect(reservasRepo.cancelar).toHaveBeenCalledWith(50);
    });
  });

  describe('buscarClientesAdmin', () => {
    it('debe delegar en clientesRepository.buscarClientes', async () => {
      clientesRepo.buscarClientes.mockResolvedValue([
        { id: 1, nombre: 'Carlos', telefono: '3001234567' },
      ]);

      const clientes = await service.buscarClientesAdmin('Carlos');
      expect(clientes).toHaveLength(1);
      expect(clientesRepo.buscarClientes).toHaveBeenCalledWith('Carlos');
    });
  });
});
