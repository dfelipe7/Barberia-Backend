import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ReservasController } from './reservas.controller';
import { ReservasService } from '../service/reservas.service';
import { ClienteJwtAuthGuard } from '../../../auth/clientes/guards/cliente-jwt-auth.guard';
import { ClienteOpcionalJwtAuthGuard } from '../../../auth/clientes/guards/cliente-opcional-jwt-auth.guard';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../auth/roles/roles.guard';

describe('ReservasController', () => {
  let controller: ReservasController;

  const reservasService = {
    crearReserva: jest.fn(),
    listarMisReservas: jest.fn(),
    obtenerMiReserva: jest.fn(),
    obtenerAgendaBarbero: jest.fn(),
    obtenerAgendaSemanalBarbero: jest.fn(),
  };

  const dto = {
    barberoId: 3,
    servicioId: 2,
    fecha: '2026-11-01',
    hora: '14:00',
    nombre: 'Ana',
    telefono: '3001234567',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReservasController],
      providers: [{ provide: ReservasService, useValue: reservasService }],
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
    jest.clearAllMocks();
    reservasService.crearReserva.mockResolvedValue({ id: 1 });
  });

  it('debe estar definido', () => {
    expect(controller).toBeDefined();
  });

  it('crea una reserva de invitado cuando no hay cliente en la petición', async () => {
    await controller.crearReserva(dto, {});

    expect(reservasService.crearReserva).toHaveBeenCalledWith(dto, undefined);
  });

  it('resuelve la identidad autenticada desde request.cliente', async () => {
    await controller.crearReserva(dto, { cliente: { clienteId: 9 } });

    expect(reservasService.crearReserva).toHaveBeenCalledWith(dto, {
      clienteId: 9,
    });
  });

  it('trata como invitado una identidad de cliente inválida', async () => {
    await controller.crearReserva(dto, { cliente: { clienteId: 0 } });

    expect(reservasService.crearReserva).toHaveBeenCalledWith(dto, undefined);
  });

  it('lista las reservas propias del cliente autenticado', async () => {
    reservasService.listarMisReservas.mockResolvedValue({ reservas: [] });

    await controller.listarMisReservas({ cliente: { clienteId: 9 } });

    expect(reservasService.listarMisReservas).toHaveBeenCalledWith({
      clienteId: 9,
    });
  });

  it('obtiene el detalle de una reserva propia validando el id', async () => {
    reservasService.obtenerMiReserva.mockResolvedValue({ id: 42 });

    await controller.obtenerMiReserva({ cliente: { clienteId: 9 } }, 42);

    expect(reservasService.obtenerMiReserva).toHaveBeenCalledWith(
      { clienteId: 9 },
      42,
    );
  });

  it('rechaza un reservaId no positivo con 400', async () => {
    await expect(
      controller.obtenerMiReserva({ cliente: { clienteId: 9 } }, 0),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(reservasService.obtenerMiReserva).not.toHaveBeenCalled();
  });

  it('obtiene la agenda del barbero autenticado', async () => {
    const mockAgenda = { fecha: '2026-11-01', reservas: [] };
    reservasService.obtenerAgendaBarbero.mockResolvedValue(mockAgenda);

    const mockUser = { id: 5, rol: 'BARBERO' };
    const resultado = await controller.obtenerMiAgenda(
      { user: mockUser },
      { fecha: '2026-11-01' },
    );

    expect(resultado).toBe(mockAgenda);
    expect(reservasService.obtenerAgendaBarbero).toHaveBeenCalledWith(
      mockUser,
      { fecha: '2026-11-01' },
    );
  });

  it('obtiene la agenda semanal del barbero autenticado', async () => {
    const mockAgendaSemanal = {
      desde: '2026-11-02',
      hasta: '2026-11-08',
      reservas: [],
    };
    reservasService.obtenerAgendaSemanalBarbero.mockResolvedValue(
      mockAgendaSemanal,
    );

    const mockUser = { id: 5, rol: 'BARBERO' };
    const consulta = { desde: '2026-11-02', hasta: '2026-11-08' };
    const resultado = await controller.obtenerMiAgendaSemanal(
      { user: mockUser },
      consulta,
    );

    expect(resultado).toBe(mockAgendaSemanal);
    expect(reservasService.obtenerAgendaSemanalBarbero).toHaveBeenCalledWith(
      mockUser,
      consulta,
    );
  });
});
