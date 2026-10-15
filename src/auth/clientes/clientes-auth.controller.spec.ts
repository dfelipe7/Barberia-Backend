import { Test, TestingModule } from '@nestjs/testing';
import { ClientesAuthController } from './clientes-auth.controller';
import { ClientesAuthService } from './clientes-auth.service';

describe('ClientesAuthController', () => {
  let controller: ClientesAuthController;

  const clientesAuthService = { loginConGoogle: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ClientesAuthController],
      providers: [
        { provide: ClientesAuthService, useValue: clientesAuthService },
      ],
    }).compile();

    controller = module.get<ClientesAuthController>(ClientesAuthController);
    jest.clearAllMocks();
  });

  it('debe estar definido', () => {
    expect(controller).toBeDefined();
  });

  it('delega el idToken en el servicio y devuelve la sesión', async () => {
    const sesion = { accessToken: 'token', cliente: { id: 7 } };
    clientesAuthService.loginConGoogle.mockResolvedValue(sesion as any);

    const resultado = await controller.loginConGoogle({ idToken: 'id-token' });

    expect(clientesAuthService.loginConGoogle).toHaveBeenCalledWith('id-token');
    expect(resultado).toEqual(sesion);
  });
});
