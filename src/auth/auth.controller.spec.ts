import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { GoogleAuthService } from './google/google-auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

describe('AuthController', () => {
  let controller: AuthController;
  let googleAuthService: jest.Mocked<GoogleAuthService>;

  beforeEach(async () => {
    const mockGoogleAuthService = {
      loginConGoogle: jest.fn(),
      refrescarSesion: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: GoogleAuthService,
          useValue: mockGoogleAuthService,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

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

    const result = await controller.loginConGoogle({
      idToken: 'google-test-token',
    });

    expect(googleAuthService.loginConGoogle).toHaveBeenCalledWith(
      'google-test-token',
    );
    expect(result).toEqual(mockResponse);
  });

  it('debe llamar a googleAuthService.refrescarSesion con el ID de usuario del token', async () => {
    const mockResponse = {
      accessToken: 'new-refreshed-jwt',
      usuario: {
        id: 5,
        email: 'barbero@gmail.com',
        nombre: 'Carlos',
        apellido: 'Perez',
        rol: 'ADMINISTRADOR',
        roles: ['ADMINISTRADOR', 'BARBERO'],
        estado: 'ACTIVO',
        fotoUrl: null,
      },
    };

    googleAuthService.refrescarSesion.mockResolvedValue(mockResponse);

    const result = await controller.refrescarToken({
      user: { id: 5, fotoUrl: 'https://lh3.google.com/avatar.jpg' },
    });

    expect(googleAuthService.refrescarSesion).toHaveBeenCalledWith(
      5,
      'https://lh3.google.com/avatar.jpg',
    );
    expect(result).toEqual(mockResponse);
  });
});
