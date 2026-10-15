import { Test, TestingModule } from '@nestjs/testing';
import { DisponibilidadController } from './disponibilidad.controller';
import { DisponibilidadService } from '../service/disponibilidad.service';

describe('DisponibilidadController', () => {
  let controller: DisponibilidadController;
  let disponibilidadServiceMock: any;

  const respuesta = {
    fecha: '2026-10-20',
    timeZone: 'America/Bogota',
    barberoId: 3,
    servicioId: null,
    slots: [],
  };

  beforeEach(async () => {
    disponibilidadServiceMock = {
      obtenerDisponibilidadPublica: jest.fn().mockResolvedValue(respuesta),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DisponibilidadController],
      providers: [
        {
          provide: DisponibilidadService,
          useValue: disponibilidadServiceMock,
        },
      ],
    }).compile();

    controller = module.get<DisponibilidadController>(DisponibilidadController);
  });

  it('debe estar definido', () => {
    expect(controller).toBeDefined();
  });

  it('debe delegar la consulta pública en la fachada sin aplicar reglas', async () => {
    const consulta = { servicioId: 2, fecha: '2026-10-20' };

    const resultado = await controller.consultarDisponibilidadPublica(
      3,
      consulta,
    );

    expect(
      disponibilidadServiceMock.obtenerDisponibilidadPublica,
    ).toHaveBeenCalledWith({
      barberoId: 3,
      servicioId: 2,
      fecha: '2026-10-20',
    });
    expect(resultado).toEqual(respuesta);
  });
});
