import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ReservasController } from './reservas.controller';
import { ReservasService } from '../service/reservas.service';
import { ROLES_KEY } from '../../../auth/roles/roles.decorator';
import { Reflector } from '@nestjs/core';
import { CrearReservaAdminDto } from '../dto/dto-peticion/crear-reserva-admin.dto';
import { FiltroReservasAdminDto } from '../dto/dto-peticion/filtro-reservas-admin.dto';
import { ModificarReservaDto } from '../dto/dto-peticion/modificar-reserva.dto';
import { ReservationStatus } from '../../../../generated/prisma/enums';
import { ClienteOpcionalJwtAuthGuard } from '../../../auth/clientes/guards/cliente-opcional-jwt-auth.guard';
import { ClienteJwtAuthGuard } from '../../../auth/clientes/guards/cliente-jwt-auth.guard';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../auth/roles/roles.guard';

describe('ReservasController - Endpoints Administrativos (HU-13 y SUPERADMIN)', () => {
  let controller: ReservasController;
  let service: jest.Mocked<Partial<ReservasService>>;
  let reflector: Reflector;

  beforeEach(async () => {
    service = {
      crearReservaAdmin: jest.fn(),
      listarReservasAdmin: jest.fn(),
      obtenerReservaAdmin: jest.fn(),
      modificarReservaAdmin: jest.fn(),
      cancelarReservaAdmin: jest.fn(),
      buscarClientesAdmin: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReservasController],
      providers: [
        {
          provide: ReservasService,
          useValue: service,
        },
      ],
    })
      .overrideGuard(ClienteOpcionalJwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ClienteJwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<ReservasController>(ReservasController);
    reflector = new Reflector();
  });

  describe('Metadatos de Roles (RBAC)', () => {
    it('crearReservaAdmin debe permitir ADMINISTRADOR y SUPERADMIN', () => {
      const roles = reflector.get<string[]>(
        ROLES_KEY,
        controller.crearReservaAdmin,
      );
      expect(roles).toEqual(
        expect.arrayContaining(['ADMINISTRADOR', 'SUPERADMIN']),
      );
      expect(roles).toHaveLength(2);
    });

    it('listarReservasAdmin debe requerir exclusivamente SUPERADMIN', () => {
      const roles = reflector.get<string[]>(
        ROLES_KEY,
        controller.listarReservasAdmin,
      );
      expect(roles).toEqual(['SUPERADMIN']);
    });

    it('buscarClientesAdmin debe permitir ADMINISTRADOR y SUPERADMIN', () => {
      const roles = reflector.get<string[]>(
        ROLES_KEY,
        controller.buscarClientesAdmin,
      );
      expect(roles).toEqual(
        expect.arrayContaining(['ADMINISTRADOR', 'SUPERADMIN']),
      );
      expect(roles).toHaveLength(2);
    });

    it('obtenerReservaAdmin debe requerir SUPERADMIN', () => {
      const roles = reflector.get<string[]>(
        ROLES_KEY,
        controller.obtenerReservaAdmin,
      );
      expect(roles).toEqual(['SUPERADMIN']);
    });

    it('modificarReservaAdmin debe requerir SUPERADMIN', () => {
      const roles = reflector.get<string[]>(
        ROLES_KEY,
        controller.modificarReservaAdmin,
      );
      expect(roles).toEqual(['SUPERADMIN']);
    });

    it('cancelarReservaAdmin debe requerir SUPERADMIN', () => {
      const roles = reflector.get<string[]>(
        ROLES_KEY,
        controller.cancelarReservaAdmin,
      );
      expect(roles).toEqual(['SUPERADMIN']);
    });
  });

  describe('Ejecución de métodos', () => {
    it('crearReservaAdmin delega en service.crearReservaAdmin', async () => {
      const dto: CrearReservaAdminDto = {
        servicioId: 1,
        barberoId: 2,
        fecha: '2026-11-20',
        hora: '14:00',
        clienteId: 5,
      };
      const mockRespuesta = {
        id: 10,
        mensaje: 'Reserva creada exitosamente',
        fecha: '2026-11-20',
        hora: '14:00',
        duracionMinutos: 60,
        precio: '25000',
        estado: 'CONFIRMED',
        barbero: { id: 2, nombre: 'Duvan', apellido: 'Armero' },
        servicio: {
          id: 1,
          nombre: 'Corte',
          duracionMinutos: 60,
          precio: '25000',
        },
      };
      (service.crearReservaAdmin as jest.Mock).mockResolvedValue(mockRespuesta);

      const res = await controller.crearReservaAdmin(dto);
      expect(res).toBe(mockRespuesta);
      expect(service.crearReservaAdmin).toHaveBeenCalledWith(dto);
    });

    it('listarReservasAdmin delega en service.listarReservasAdmin con filtros', async () => {
      const filtro: FiltroReservasAdminDto = {
        barberoId: 2,
        estado: ReservationStatus.CONFIRMED,
      };
      const mockLista = { total: 1, reservas: [] };
      (service.listarReservasAdmin as jest.Mock).mockResolvedValue(mockLista);

      const res = await controller.listarReservasAdmin(filtro);
      expect(res).toBe(mockLista);
      expect(service.listarReservasAdmin).toHaveBeenCalledWith(filtro);
    });

    it('obtenerReservaAdmin delega con ID numérico parseado', async () => {
      const mockDetalle = { id: 15 } as any;
      (service.obtenerReservaAdmin as jest.Mock).mockResolvedValue(mockDetalle);

      const res = await controller.obtenerReservaAdmin(15);
      expect(res).toBe(mockDetalle);
      expect(service.obtenerReservaAdmin).toHaveBeenCalledWith(15);
    });

    it('obtenerReservaAdmin lanza BadRequestException si reservaId <= 0', async () => {
      await expect(controller.obtenerReservaAdmin(0)).rejects.toThrow(
        BadRequestException,
      );
      await expect(controller.obtenerReservaAdmin(-5)).rejects.toThrow(
        'El identificador de la reserva debe ser un entero positivo',
      );
      expect(service.obtenerReservaAdmin).not.toHaveBeenCalled();
    });

    it('modificarReservaAdmin delega con ID y DTO', async () => {
      const dto: ModificarReservaDto = { hora: '16:00' };
      const mockResp = { id: 15, hora: '16:00' } as any;
      (service.modificarReservaAdmin as jest.Mock).mockResolvedValue(mockResp);

      const res = await controller.modificarReservaAdmin(15, dto);
      expect(res).toBe(mockResp);
      expect(service.modificarReservaAdmin).toHaveBeenCalledWith(15, dto);
    });

    it('modificarReservaAdmin lanza BadRequestException si reservaId <= 0', async () => {
      const dto: ModificarReservaDto = { hora: '16:00' };
      await expect(controller.modificarReservaAdmin(0, dto)).rejects.toThrow(
        BadRequestException,
      );
      await expect(controller.modificarReservaAdmin(-1, dto)).rejects.toThrow(
        'El identificador de la reserva debe ser un entero positivo',
      );
      expect(service.modificarReservaAdmin).not.toHaveBeenCalled();
    });

    it('cancelarReservaAdmin delega con ID numérico', async () => {
      const mockResp = { id: 15, estado: ReservationStatus.CANCELLED } as any;
      (service.cancelarReservaAdmin as jest.Mock).mockResolvedValue(mockResp);

      const res = await controller.cancelarReservaAdmin(15);
      expect(res).toBe(mockResp);
      expect(service.cancelarReservaAdmin).toHaveBeenCalledWith(15);
    });

    it('cancelarReservaAdmin lanza BadRequestException si reservaId <= 0', async () => {
      await expect(controller.cancelarReservaAdmin(0)).rejects.toThrow(
        BadRequestException,
      );
      await expect(controller.cancelarReservaAdmin(-2)).rejects.toThrow(
        'El identificador de la reserva debe ser un entero positivo',
      );
      expect(service.cancelarReservaAdmin).not.toHaveBeenCalled();
    });

    it('buscarClientesAdmin delega término de búsqueda', async () => {
      const mockClientes = [
        { id: 1, nombre: 'Ana', apellido: 'López', telefono: '300123' },
      ];
      (service.buscarClientesAdmin as jest.Mock).mockResolvedValue(
        mockClientes,
      );

      const res = await controller.buscarClientesAdmin('Ana');
      expect(res).toBe(mockClientes);
      expect(service.buscarClientesAdmin).toHaveBeenCalledWith('Ana');
    });
  });
});
