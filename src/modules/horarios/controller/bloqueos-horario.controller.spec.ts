import { Test, TestingModule } from '@nestjs/testing';
import { BloqueosHorarioController } from './bloqueos-horario.controller';
import { BloqueosHorarioService } from '../service/bloqueos-horario.service';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../auth/roles/roles.guard';

jest.mock('../../../../generated/prisma/enums', () => ({
  ScheduleBlockStatus: {
    ACTIVE: 'ACTIVE',
    REACTIVATED: 'REACTIVATED',
    CANCELLED: 'CANCELLED',
  },
  ScheduleBlockReason: {
    PERSONAL: 'PERSONAL',
    MEDICAL: 'MEDICAL',
    VACATION: 'VACATION',
    OTHER: 'OTHER',
  },
}));

describe('BloqueosHorarioController', () => {
  let controller: BloqueosHorarioController;
  let bloqueosHorarioServiceMock: any;

  const respuestaAccion = {
    mensaje: 'ok',
    block: { id: 1, status: 'ACTIVE' },
  };

  beforeEach(async () => {
    bloqueosHorarioServiceMock = {
      crearBloqueo: jest.fn().mockResolvedValue(respuestaAccion),
      listarBloqueos: jest.fn().mockResolvedValue([]),
      actualizarBloqueo: jest.fn().mockResolvedValue(respuestaAccion),
      cancelarBloqueo: jest.fn().mockResolvedValue(respuestaAccion),
      reactivarBloqueo: jest.fn().mockResolvedValue(respuestaAccion),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [BloqueosHorarioController],
      providers: [
        {
          provide: BloqueosHorarioService,
          useValue: bloqueosHorarioServiceMock,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<BloqueosHorarioController>(
      BloqueosHorarioController,
    );
  });

  it('debe estar definido', () => {
    expect(controller).toBeDefined();
  });

  it('debe delegar la creación al servicio con el usuario y el dto', async () => {
    const request = { user: { id: 10 } };
    const dto = {
      date: '2026-10-20',
      startTime: '15:00',
      endTime: '16:00',
    };

    const resultado = await controller.crearBloqueo(request, dto);

    expect(bloqueosHorarioServiceMock.crearBloqueo).toHaveBeenCalledWith(
      request.user,
      dto,
    );
    expect(resultado).toEqual(respuestaAccion);
  });

  it('debe delegar el listado al servicio con el usuario y el filtro', async () => {
    const request = { user: { id: 10 } };
    const filtro = { fecha: '2026-10-20' };

    const resultado = await controller.listarBloqueos(request, filtro);

    expect(bloqueosHorarioServiceMock.listarBloqueos).toHaveBeenCalledWith(
      request.user,
      filtro,
    );
    expect(resultado).toEqual([]);
  });

  it('debe delegar la modificación al servicio con el usuario, id y dto', async () => {
    const request = { user: { id: 10 } };
    const dto = { notes: 'x' };

    const resultado = await controller.actualizarBloqueo(request, 1, dto);

    expect(bloqueosHorarioServiceMock.actualizarBloqueo).toHaveBeenCalledWith(
      request.user,
      1,
      dto,
    );
    expect(resultado).toEqual(respuestaAccion);
  });

  it('debe delegar la cancelación al servicio con el usuario y el id', async () => {
    const request = { user: { id: 10 } };

    const resultado = await controller.cancelarBloqueo(request, 1);

    expect(bloqueosHorarioServiceMock.cancelarBloqueo).toHaveBeenCalledWith(
      request.user,
      1,
    );
    expect(resultado).toEqual(respuestaAccion);
  });

  it('debe delegar la reactivación al servicio con el usuario y el id', async () => {
    const request = { user: { id: 10 } };

    const resultado = await controller.reactivarBloqueo(request, 1);

    expect(bloqueosHorarioServiceMock.reactivarBloqueo).toHaveBeenCalledWith(
      request.user,
      1,
    );
    expect(resultado).toEqual(respuestaAccion);
  });
});
