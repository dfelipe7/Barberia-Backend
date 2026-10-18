import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ReservasController } from './reservas.controller';
import {
  MENSAJE_RESERVA_NO_DISPONIBLE,
  ReservasService,
} from '../service/reservas.service';
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
    modificarReserva: jest.fn(),
    cancelarReserva: jest.fn(),
    modificarReservaInvitado: jest.fn(),
    cancelarReservaInvitado: jest.fn(),
    noShowReserva: jest.fn(),
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

  describe('modificarMiReserva', () => {
    const modDto = { fecha: '2026-11-02', hora: '15:00' };

    it('modifica la reserva delegando al servicio con la identidad autenticada', async () => {
      const mockRespuesta = {
        id: 42,
        mensaje: 'Reserva modificada correctamente',
      };
      reservasService.modificarReserva.mockResolvedValue(mockRespuesta);

      const resultado = await controller.modificarMiReserva(
        { cliente: { clienteId: 9 } },
        42,
        modDto,
      );

      expect(resultado).toBe(mockRespuesta);
      expect(reservasService.modificarReserva).toHaveBeenCalledWith(
        { clienteId: 9 },
        42,
        modDto,
      );
    });

    it('rechaza un reservaId no positivo con 400', async () => {
      await expect(
        controller.modificarMiReserva(
          { cliente: { clienteId: 9 } },
          -1,
          modDto,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(reservasService.modificarReserva).not.toHaveBeenCalled();
    });
  });

  describe('cancelarMiReserva', () => {
    it('cancela la reserva delegando al servicio con la identidad autenticada', async () => {
      const mockRespuesta = {
        id: 42,
        mensaje: 'Reserva cancelada correctamente',
      };
      reservasService.cancelarReserva.mockResolvedValue(mockRespuesta);

      const resultado = await controller.cancelarMiReserva(
        { cliente: { clienteId: 9 } },
        42,
      );

      expect(resultado).toBe(mockRespuesta);
      expect(reservasService.cancelarReserva).toHaveBeenCalledWith(
        { clienteId: 9 },
        42,
      );
    });

    it('rechaza un reservaId no positivo con 400', async () => {
      await expect(
        controller.cancelarMiReserva({ cliente: { clienteId: 9 } }, 0),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(reservasService.cancelarReserva).not.toHaveBeenCalled();
    });
  });

  describe('modificarReservaInvitado', () => {
    const modDto = { hora: '16:00' };
    const tokenValido = 'token-secreto-invitado-123';
    const tokenIncorrecto = 'token-falso-456';

    it('1. Un token válido en el encabezado autoriza la modificación', async () => {
      const mockRespuesta = {
        id: 42,
        mensaje: 'Reserva modificada correctamente',
      };
      reservasService.modificarReservaInvitado.mockResolvedValue(mockRespuesta);

      const resultado = await controller.modificarReservaInvitado(
        42,
        tokenValido,
        modDto,
      );

      expect(resultado).toBe(mockRespuesta);
      expect(reservasService.modificarReservaInvitado).toHaveBeenCalledWith(
        42,
        tokenValido,
        modDto,
      );
    });

    it('2. Sin encabezado, un token enviado en el cuerpo JSON o query NO autoriza (404 genérico)', async () => {
      // El controlador recibe tokenGestion del encabezado; si no se provee encabezado,
      // cualquier token colocado en el cuerpo no es leído y resulta en 404.
      const cuerpoConTokenInyectado = { ...modDto, token: tokenValido } as any;

      await expect(
        controller.modificarReservaInvitado(
          42,
          undefined,
          cuerpoConTokenInyectado,
        ),
      ).rejects.toThrow(new NotFoundException(MENSAJE_RESERVA_NO_DISPONIBLE));

      await expect(
        controller.modificarReservaInvitado(42, '', cuerpoConTokenInyectado),
      ).rejects.toThrow(new NotFoundException(MENSAJE_RESERVA_NO_DISPONIBLE));

      expect(reservasService.modificarReservaInvitado).not.toHaveBeenCalled();
    });

    it('3. Un encabezado incorrecto no autoriza aunque exista un token en el cuerpo (404 genérico)', async () => {
      reservasService.modificarReservaInvitado.mockRejectedValue(
        new NotFoundException(MENSAJE_RESERVA_NO_DISPONIBLE),
      );

      const cuerpoConTokenInyectado = { ...modDto, token: tokenValido } as any;

      await expect(
        controller.modificarReservaInvitado(
          42,
          tokenIncorrecto,
          cuerpoConTokenInyectado,
        ),
      ).rejects.toThrow(new NotFoundException(MENSAJE_RESERVA_NO_DISPONIBLE));

      expect(reservasService.modificarReservaInvitado).toHaveBeenCalledWith(
        42,
        tokenIncorrecto,
        cuerpoConTokenInyectado,
      );
    });

    it('4. Reserva inexistente y credencial inválida devuelven idéntico 404 genérico', async () => {
      reservasService.modificarReservaInvitado.mockRejectedValue(
        new NotFoundException(MENSAJE_RESERVA_NO_DISPONIBLE),
      );

      await expect(
        controller.modificarReservaInvitado(9999, tokenValido, modDto),
      ).rejects.toThrow(new NotFoundException(MENSAJE_RESERVA_NO_DISPONIBLE));
    });

    it('5. Rechaza con 400 si el reservaId es menor o igual a 0', async () => {
      await expect(
        controller.modificarReservaInvitado(0, tokenValido, modDto),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(reservasService.modificarReservaInvitado).not.toHaveBeenCalled();
    });
  });

  describe('cancelarReservaInvitado', () => {
    const tokenValido = 'token-secreto-invitado-123';
    const tokenIncorrecto = 'token-falso-456';

    it('1. Un token válido en el encabezado autoriza la cancelación', async () => {
      const mockRespuesta = {
        id: 42,
        mensaje: 'Reserva cancelada correctamente',
      };
      reservasService.cancelarReservaInvitado.mockResolvedValue(mockRespuesta);

      const resultado = await controller.cancelarReservaInvitado(
        42,
        tokenValido,
      );

      expect(resultado).toBe(mockRespuesta);
      expect(reservasService.cancelarReservaInvitado).toHaveBeenCalledWith(
        42,
        tokenValido,
      );
    });

    it('2. Sin encabezado, la cancelación no se autoriza (404 genérico)', async () => {
      await expect(
        controller.cancelarReservaInvitado(42, undefined),
      ).rejects.toThrow(new NotFoundException(MENSAJE_RESERVA_NO_DISPONIBLE));

      await expect(
        controller.cancelarReservaInvitado(42, '   '),
      ).rejects.toThrow(new NotFoundException(MENSAJE_RESERVA_NO_DISPONIBLE));

      expect(reservasService.cancelarReservaInvitado).not.toHaveBeenCalled();
    });

    it('3. Un encabezado incorrecto no autoriza la cancelación (404 genérico)', async () => {
      reservasService.cancelarReservaInvitado.mockRejectedValue(
        new NotFoundException(MENSAJE_RESERVA_NO_DISPONIBLE),
      );

      await expect(
        controller.cancelarReservaInvitado(42, tokenIncorrecto),
      ).rejects.toThrow(new NotFoundException(MENSAJE_RESERVA_NO_DISPONIBLE));

      expect(reservasService.cancelarReservaInvitado).toHaveBeenCalledWith(
        42,
        tokenIncorrecto,
      );
    });

    it('4. Reserva inexistente y credencial inválida devuelven idéntico 404 genérico en cancelación', async () => {
      reservasService.cancelarReservaInvitado.mockRejectedValue(
        new NotFoundException(MENSAJE_RESERVA_NO_DISPONIBLE),
      );

      await expect(
        controller.cancelarReservaInvitado(9999, tokenValido),
      ).rejects.toThrow(new NotFoundException(MENSAJE_RESERVA_NO_DISPONIBLE));
    });

    it('5. Rechaza con 400 si el reservaId es menor o igual a 0', async () => {
      await expect(
        controller.cancelarReservaInvitado(-5, tokenValido),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(reservasService.cancelarReservaInvitado).not.toHaveBeenCalled();
    });
  });

  describe('marcarNoShow', () => {
    const mockUser = { id: 5, rol: 'BARBERO' };

    it('delega en el servicio con la identidad y el rol del usuario autenticado', async () => {
      const mockRespuesta = {
        id: 42,
        mensaje: 'Reserva marcada como no asistida',
        estado: 'NO_SHOW',
      };
      reservasService.noShowReserva.mockResolvedValue(mockRespuesta);

      const resultado = await controller.marcarNoShow({ user: mockUser }, 42);

      expect(resultado).toBe(mockRespuesta);
      expect(reservasService.noShowReserva).toHaveBeenCalledWith(
        mockUser,
        'BARBERO',
        42,
      );
    });

    it('rechaza un reservaId no positivo con 400', async () => {
      await expect(
        controller.marcarNoShow({ user: mockUser }, 0),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(reservasService.noShowReserva).not.toHaveBeenCalled();
    });
  });
});
