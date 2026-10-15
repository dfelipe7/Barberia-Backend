import { Test, TestingModule } from '@nestjs/testing';
import { DisponibilidadBarberoController } from './disponibilidad-barbero.controller';
import { DisponibilidadService } from '../service/disponibilidad.service';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../auth/roles/roles.guard';

describe('DisponibilidadBarberoController', () => {
  let controller: DisponibilidadBarberoController;
  let disponibilidadServiceMock: any;

  const respuesta = {
    fecha: '2026-10-20',
    timeZone: 'America/Bogota',
    barberoId: 7,
    servicioId: null,
    slots: [{ startTime: '09:00', endTime: '10:00', status: 'AVAILABLE' }],
  };

  beforeEach(async () => {
    disponibilidadServiceMock = {
      obtenerDisponibilidadDetalladaDelBarberoAutenticado: jest
        .fn()
        .mockResolvedValue(respuesta),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DisponibilidadBarberoController],
      providers: [
        {
          provide: DisponibilidadService,
          useValue: disponibilidadServiceMock,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<DisponibilidadBarberoController>(
      DisponibilidadBarberoController,
    );
  });

  it('debe estar definido', () => {
    expect(controller).toBeDefined();
  });

  it('debe delegar la consulta del barbero autenticado en la fachada', async () => {
    const request = { user: { id: 10 } };
    const consulta = { fecha: '2026-10-20' };

    const resultado = await controller.consultarMiDisponibilidad(
      request,
      consulta,
    );

    expect(
      disponibilidadServiceMock.obtenerDisponibilidadDetalladaDelBarberoAutenticado,
    ).toHaveBeenCalledWith(request.user, {
      servicioId: undefined,
      fecha: '2026-10-20',
    });
    expect(resultado).toEqual(respuesta);
  });
});
