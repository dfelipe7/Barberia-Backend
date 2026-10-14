import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { GoogleAuthService } from './google/google-auth.service';

describe('AuthController', () => {
  let controller: AuthController;
  let googleAuthService: jest.Mocked<GoogleAuthService>;

  beforeEach(async () => {
    const mockGoogleAuthService = {
      loginConGoogle: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: GoogleAuthService,
          useValue: mockGoogleAuthService,
        },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
    googleAuthService = module.get(GoogleAuthService);
  });

  it('debe estar definido', () => {
    expect(controller).toBeDefined();
  });

  it('debe llamar a googleAuthService.loginConGoogle con el idToken proporcionado', async () => {
    const mockResponse = {
      accessToken: 'jwt-token-123',
      usuario: {
        id: 1,
        email: 'armeroduvan8@gmail.com',
        nombre: 'Felipe',
        apellido: 'Armero',
        rol: 'SUPERADMIN',
        estado: 'ACTIVO',
        fotoUrl: 'https://lh3.googleusercontent.com/a/photo.jpg',
      },
    };

    googleAuthService.loginConGoogle.mockResolvedValue(mockResponse as any);

    const result = await controller.loginConGoogle({ idToken: 'google-test-token' });

    expect(googleAuthService.loginConGoogle).toHaveBeenCalledWith('google-test-token');
    expect(result).toEqual(mockResponse);
  });
});
