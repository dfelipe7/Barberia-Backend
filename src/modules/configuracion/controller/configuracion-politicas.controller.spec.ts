import { Test, TestingModule } from '@nestjs/testing';
import { ConfiguracionPoliticasController } from './configuracion-politicas.controller';
import { ConfiguracionService } from '../service/configuracion.service';
import { NegocioContextoService } from '../../negocios/negocio-contexto.service';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../auth/roles/roles.guard';

describe('ConfiguracionPoliticasController', () => {
  let controller: ConfiguracionPoliticasController;
  let configuracionService: {
    obtenerNumero: jest.Mock;
    guardarNumero: jest.Mock;
  };
  let contextoService: {
    obtenerContextoRequerido: jest.Mock;
  };

  beforeEach(async () => {
    configuracionService = {
      obtenerNumero: jest.fn().mockImplementation((clave, def) => {
        if (clave === 'reserva_cancelacion_antelacion_minutos')
          return Promise.resolve(120);
        if (clave === 'reserva_no_show_tolerancia_minutos')
          return Promise.resolve(15);
        if (clave === 'reserva_max_citas_diarias_cliente')
          return Promise.resolve(3);
        return Promise.resolve(def);
      }),
      guardarNumero: jest.fn().mockResolvedValue(undefined),
    };

    contextoService = {
      obtenerContextoRequerido: jest
        .fn()
        .mockReturnValue({ id: 5, slug: 'barberia-test' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ConfiguracionPoliticasController],
      providers: [
        { provide: ConfiguracionService, useValue: configuracionService },
        { provide: NegocioContextoService, useValue: contextoService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<ConfiguracionPoliticasController>(
      ConfiguracionPoliticasController,
    );
  });

  it('debe obtener las políticas operativas actuales de la sede activa', async () => {
    const resultado = await controller.obtenerPoliticas();

    expect(resultado).toEqual({
      reservaCancelacionAntelacionMinutos: 120,
      reservaNoShowToleranciaMinutos: 15,
      reservaMaxCitasDiariasCliente: 3,
    });
    expect(configuracionService.obtenerNumero).toHaveBeenCalledTimes(3);
  });

  it('debe actualizar las políticas operativas de la sede activa', async () => {
    const dto = {
      reservaCancelacionAntelacionMinutos: 60,
      reservaNoShowToleranciaMinutos: 20,
      reservaMaxCitasDiariasCliente: 2,
    };

    const resultado = await controller.actualizarPoliticas(dto);

    expect(contextoService.obtenerContextoRequerido).toHaveBeenCalled();
    expect(configuracionService.guardarNumero).toHaveBeenCalledWith(
      5,
      'reserva_cancelacion_antelacion_minutos',
      60,
    );
    expect(configuracionService.guardarNumero).toHaveBeenCalledWith(
      5,
      'reserva_no_show_tolerancia_minutos',
      20,
    );
    expect(configuracionService.guardarNumero).toHaveBeenCalledWith(
      5,
      'reserva_max_citas_diarias_cliente',
      2,
    );
    expect(resultado).toEqual(dto);
  });
});
