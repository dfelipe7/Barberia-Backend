import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { GoogleAuthService } from './google/google-auth.service';
import { SesionPersonalService } from './sesion/sesion-personal.service';
import { JwtSesionGuard } from './guards/jwt-sesion.guard';

describe('AuthController', () => {
  let controller: AuthController;
  let googleAuthService: jest.Mocked<GoogleAuthService>;
  let sesionService: jest.Mocked<SesionPersonalService>;

  const sesionToken = {
    sub: '5',
    id: 5,
    email: 'barbero@gmail.com',
    nombre: 'Carlos',
    apellido: 'Perez',
    tipo: 'PERSONAL',
    rol: 'PERSONAL',
    roles: ['BARBERO'],
    superadmin: false,
    ambito: 'NEGOCIO' as const,
    negocioId: 10,
    negocioSlug: 'kyrios-studio',
    estado: 'ACTIVO',
    fotoUrl: null,
  };

  beforeEach(async () => {
    const mockGoogleAuthService = {
      loginConGoogle: jest.fn(),
    };

    const mockSesionService = {
      cargarUsuario: jest.fn(),
      renovar: jest.fn(),
      cambiarNegocio: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: GoogleAuthService,
          useValue: mockGoogleAuthService,
        },
        {
          provide: SesionPersonalService,
          useValue: mockSesionService,
        },
      ],
    })
      .overrideGuard(JwtSesionGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AuthController>(AuthController);
    googleAuthService = module.get(GoogleAuthService);
    sesionService = module.get(SesionPersonalService);
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
        roles: ['SUPERADMIN'],
        estado: 'ACTIVO',
        fotoUrl: 'https://lh3.googleusercontent.com/a/photo.jpg',
      },
      negocio: null,
    };

    googleAuthService.loginConGoogle.mockResolvedValue(mockResponse);

    const result = await controller.loginConGoogle({
      idToken: 'google-test-token',
    });

    expect(googleAuthService.loginConGoogle).toHaveBeenCalledWith(
      'google-test-token',
    );
    expect(result).toEqual(mockResponse);
  });

  it('debe renovar la sesión conservando su ámbito', async () => {
    const usuario = {
      id: 5,
      email: 'barbero@gmail.com',
      nombre: 'Carlos',
      apellido: 'Perez',
      rol: 'PERSONAL',
      estado: 'ACTIVO',
    };
    const mockResponse = {
      accessToken: 'new-refreshed-jwt',
      usuario: { ...usuario, roles: ['BARBERO'], fotoUrl: null },
      negocio: { id: 10, slug: 'kyrios-studio' },
    };

    sesionService.cargarUsuario.mockResolvedValue(usuario);
    sesionService.renovar.mockResolvedValue(mockResponse);

    const result = await controller.refrescarToken({ user: sesionToken });

    expect(sesionService.cargarUsuario).toHaveBeenCalledWith(5);
    expect(sesionService.renovar).toHaveBeenCalled();
    expect(result).toEqual(mockResponse);
  });

  it('debe cambiar de negocio usando el slug de la ruta', async () => {
    const mockResponse = {
      accessToken: 'jwt-token-otro-negocio',
      usuario: { id: 5, roles: ['ADMINISTRADOR'] },
      negocio: { id: 20, slug: 'otro-negocio' },
    };

    sesionService.cambiarNegocio.mockResolvedValue(mockResponse as any);

    const result = await controller.cambiarNegocio(
      { user: sesionToken },
      'otro-negocio',
    );

    expect(sesionService.cambiarNegocio).toHaveBeenCalledWith(
      expect.objectContaining({ id: 5, negocioId: 10 }),
      'otro-negocio',
    );
    expect(result).toEqual(mockResponse);
  });
});
