import { Test, TestingModule } from '@nestjs/testing';
import { ReservasController } from './reservas.controller';
import { ReservasService } from '../service/reservas.service';
import { OpcionalJwtAuthGuard } from '../guards/opcional-jwt-auth.guard';

describe('ReservasController', () => {
  let controller: ReservasController;

  const reservasService = {
    crearReserva: jest.fn(),
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
      .overrideGuard(OpcionalJwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<ReservasController>(ReservasController);
    jest.clearAllMocks();
    reservasService.crearReserva.mockResolvedValue({ id: 1 });
  });

  it('debe estar definido', () => {
    expect(controller).toBeDefined();
  });

  it('crea una reserva de invitado cuando no hay usuario en la petición', async () => {
    await controller.crearReserva(dto, {});

    expect(reservasService.crearReserva).toHaveBeenCalledWith(dto, undefined);
  });

  it('resuelve la identidad autenticada desde el payload del token', async () => {
    await controller.crearReserva(dto, {
      user: { id: 9, nombre: 'Carlos', apellido: 'Gómez' },
    });

    expect(reservasService.crearReserva).toHaveBeenCalledWith(dto, {
      usuarioId: 9,
      nombre: 'Carlos',
      apellido: 'Gómez',
    });
  });

  it('usa `sub` como respaldo del identificador cuando falta `id`', async () => {
    await controller.crearReserva(dto, {
      user: { sub: '9', nombre: 'Carlos', apellido: 'Gómez' },
    });

    expect(reservasService.crearReserva).toHaveBeenCalledWith(dto, {
      usuarioId: 9,
      nombre: 'Carlos',
      apellido: 'Gómez',
    });
  });

  it('trata como invitado un payload sin identificador válido', async () => {
    await controller.crearReserva(dto, { user: { nombre: 'X' } });

    expect(reservasService.crearReserva).toHaveBeenCalledWith(dto, undefined);
  });
});
