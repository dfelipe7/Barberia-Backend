import { Test, TestingModule } from '@nestjs/testing';
import { AdminHorariosController } from './admin-horarios.controller';
import { HorarioSemanalService } from '../service/horario-semanal.service';
import { BloqueosHorarioService } from '../service/bloqueos-horario.service';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../../../auth/roles/roles.decorator';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../auth/roles/roles.guard';

describe('AdminHorariosController (SUPERADMIN)', () => {
  let controller: AdminHorariosController;
  let horarioSemanalService: jest.Mocked<Partial<HorarioSemanalService>>;
  let bloqueosHorarioService: jest.Mocked<Partial<BloqueosHorarioService>>;
  let reflector: Reflector;

  beforeEach(async () => {
    horarioSemanalService = {
      obtenerHorarioSemanalDeBarbero: jest.fn(),
      reemplazarHorarioSemanalDeBarbero: jest.fn(),
    };

    bloqueosHorarioService = {
      crearBloqueoDeBarbero: jest.fn(),
      listarBloqueosDeBarbero: jest.fn(),
      actualizarBloqueoDeBarbero: jest.fn(),
      cancelarBloqueoDeBarbero: jest.fn(),
      reactivarBloqueoDeBarbero: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminHorariosController],
      providers: [
        { provide: HorarioSemanalService, useValue: horarioSemanalService },
        { provide: BloqueosHorarioService, useValue: bloqueosHorarioService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AdminHorariosController>(AdminHorariosController);
    reflector = new Reflector();
  });

  describe('Metadatos de Roles (RBAC)', () => {
    it('el controlador completo debe exigir exclusivamente SUPERADMIN', () => {
      const roles = reflector.get<string[]>(ROLES_KEY, AdminHorariosController);
      expect(roles).toEqual(['SUPERADMIN']);
    });
  });

  describe('Horario Semanal de Cualquier Barbero', () => {
    it('obtenerHorarioSemanal delega a horarioSemanalService con barberoId', async () => {
      const mockResult = [
        { dayOfWeek: 'MONDAY', startTime: '08:00', endTime: '18:00' },
      ];
      (
        horarioSemanalService.obtenerHorarioSemanalDeBarbero as jest.Mock
      ).mockResolvedValue(mockResult);

      const res = await controller.obtenerHorarioSemanal(5);
      expect(res).toBe(mockResult);
      expect(
        horarioSemanalService.obtenerHorarioSemanalDeBarbero,
      ).toHaveBeenCalledWith(5);
    });

    it('reemplazarHorarioSemanal delega a horarioSemanalService con barberoId y DTO', async () => {
      const dto = { franjas: [] } as any;
      const mockResult = { count: 0 };
      (
        horarioSemanalService.reemplazarHorarioSemanalDeBarbero as jest.Mock
      ).mockResolvedValue(mockResult);

      const res = await controller.reemplazarHorarioSemanal(5, dto);
      expect(res).toBe(mockResult);
      expect(
        horarioSemanalService.reemplazarHorarioSemanalDeBarbero,
      ).toHaveBeenCalledWith(5, dto);
    });
  });

  describe('Bloqueos de Horario de Cualquier Barbero', () => {
    it('crearBloqueo delega con barberoId y DTO', async () => {
      const dto = {
        fechaInicio: '2026-11-20',
        horaInicio: '10:00',
        horaFin: '12:00',
      } as any;
      const mockResult = { id: 1, ...dto };
      (
        bloqueosHorarioService.crearBloqueoDeBarbero as jest.Mock
      ).mockResolvedValue(mockResult);

      const res = await controller.crearBloqueo(5, dto);
      expect(res).toBe(mockResult);
      expect(bloqueosHorarioService.crearBloqueoDeBarbero).toHaveBeenCalledWith(
        5,
        dto,
      );
    });

    it('listarBloqueos delega con barberoId y filtros query', async () => {
      const query = { fechaDesde: '2026-11-01' } as any;
      const mockResult = { total: 0, bloqueos: [] };
      (
        bloqueosHorarioService.listarBloqueosDeBarbero as jest.Mock
      ).mockResolvedValue(mockResult);

      const res = await controller.listarBloqueos(5, query);
      expect(res).toBe(mockResult);
      expect(
        bloqueosHorarioService.listarBloqueosDeBarbero,
      ).toHaveBeenCalledWith(5, query);
    });

    it('actualizarBloqueo delega con barberoId, bloqueoId y DTO', async () => {
      const dto = { motivo: 'Cita médica' } as any;
      const mockResult = { id: 10, motivo: 'Cita médica' };
      (
        bloqueosHorarioService.actualizarBloqueoDeBarbero as jest.Mock
      ).mockResolvedValue(mockResult);

      const res = await controller.actualizarBloqueo(5, 10, dto);
      expect(res).toBe(mockResult);
      expect(
        bloqueosHorarioService.actualizarBloqueoDeBarbero,
      ).toHaveBeenCalledWith(5, 10, dto);
    });

    it('cancelarBloqueo delega con barberoId y bloqueoId', async () => {
      const mockResult = { id: 10, status: 'CANCELLED' };
      (
        bloqueosHorarioService.cancelarBloqueoDeBarbero as jest.Mock
      ).mockResolvedValue(mockResult);

      const res = await controller.cancelarBloqueo(5, 10);
      expect(res).toBe(mockResult);
      expect(
        bloqueosHorarioService.cancelarBloqueoDeBarbero,
      ).toHaveBeenCalledWith(5, 10);
    });

    it('reactivarBloqueo delega con barberoId, bloqueoId y usuario de la request', async () => {
      const mockResult = { id: 10, status: 'ACTIVE' };
      (
        bloqueosHorarioService.reactivarBloqueoDeBarbero as jest.Mock
      ).mockResolvedValue(mockResult);

      const mockRequest = { user: { id: 1, rol: 'SUPERADMIN' } };
      const res = await controller.reactivarBloqueo(5, 10, mockRequest);
      expect(res).toBe(mockResult);
      expect(
        bloqueosHorarioService.reactivarBloqueoDeBarbero,
      ).toHaveBeenCalledWith(5, 10, mockRequest.user);
    });

    it('debe manejar request sin user al reactivar un bloqueo', async () => {
      const mockResult = { mensaje: 'Bloqueo reactivado' } as any;
      (
        bloqueosHorarioService.reactivarBloqueoDeBarbero as jest.Mock
      ).mockResolvedValue(mockResult);

      const res = await controller.reactivarBloqueo(5, 10, {});
      expect(res).toBe(mockResult);
      expect(
        bloqueosHorarioService.reactivarBloqueoDeBarbero,
      ).toHaveBeenCalledWith(5, 10, undefined);
    });
  });
});
