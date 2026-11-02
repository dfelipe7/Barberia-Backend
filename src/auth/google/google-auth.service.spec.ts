import { Test, TestingModule } from '@nestjs/testing';
import { GoogleAuthService } from './google-auth.service';
import { GoogleTokenVerifier } from './google-token-verifier.service';
import { PrismaService } from '../../prisma/prisma.service';
import { UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { SesionPersonalService } from '../sesion/sesion-personal.service';
import { NegocioRolesService } from '../../modules/negocios/service/negocio-roles.service';
import { NegocioContextoService } from '../../modules/negocios/negocio-contexto.service';

describe('GoogleAuthService', () => {
  let service: GoogleAuthService;
  let googleTokenVerifier: { verificar: jest.Mock };
  let prisma: any;
  let sesionService: jest.Mocked<SesionPersonalService>;
  let rolesService: jest.Mocked<NegocioRolesService>;
  let contextoService: jest.Mocked<NegocioContextoService>;

  const contexto = { id: 10, slug: 'kyrios-studio' };

  beforeEach(async () => {
    const mockVerifier = { verificar: jest.fn() };

    const mockPrisma = {
      usuario: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
    };

    const mockSesionService = {
      emitirParaPlataforma: jest.fn(),
      emitirParaNegocio: jest.fn(),
    };

    const mockRolesService = {
      perfilOperativo: jest.fn(),
    };

    const mockContextoService = {
      obtenerContexto: jest.fn().mockReturnValue(contexto),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GoogleAuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: GoogleTokenVerifier, useValue: mockVerifier },
        { provide: SesionPersonalService, useValue: mockSesionService },
        { provide: NegocioRolesService, useValue: mockRolesService },
        { provide: NegocioContextoService, useValue: mockContextoService },
      ],
    }).compile();

    service = module.get<GoogleAuthService>(GoogleAuthService);
    googleTokenVerifier = module.get(GoogleTokenVerifier);
    prisma = module.get(PrismaService);
    sesionService = module.get(SesionPersonalService);
    rolesService = module.get(NegocioRolesService);
    contextoService = module.get(NegocioContextoService);
  });

  it('debe estar definido', () => {
    expect(service).toBeDefined();
  });

  it('debe lanzar UnauthorizedException si verifyIdToken falla', async () => {
    googleTokenVerifier.verificar.mockRejectedValue(
      new UnauthorizedException('invalid'),
    );

    await expect(service.loginConGoogle('invalid-token')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('debe lanzar UnauthorizedException si el payload de Google no contiene email', async () => {
    googleTokenVerifier.verificar.mockResolvedValue({ sub: '123' });

    await expect(service.loginConGoogle('token-sin-email')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('debe lanzar UnauthorizedException si el correo de Google no está verificado', async () => {
    googleTokenVerifier.verificar.mockResolvedValue({
      email: 'no-verificado@gmail.com',
      sub: '123',
      email_verified: false,
    });

    await expect(service.loginConGoogle('token-no-verificado')).rejects.toThrow(
      UnauthorizedException,
    );
    expect(prisma.usuario.findUnique).not.toHaveBeenCalled();
  });

  it('debe lanzar UnauthorizedException si el usuario no existe en la base de datos', async () => {
    googleTokenVerifier.verificar.mockResolvedValue({
      email: 'desconocido@gmail.com',
      sub: '123',
      email_verified: true,
    });

    prisma.usuario.findUnique.mockResolvedValue(null);

    await expect(service.loginConGoogle('valid-token')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('debe lanzar ForbiddenException si el usuario está INACTIVO', async () => {
    googleTokenVerifier.verificar.mockResolvedValue({
      email: 'inactivo@gmail.com',
      sub: '123',
      email_verified: true,
    });

    // 1ª llamada (por googleId): no encontrado. 2ª llamada (por email): encontrado.
    prisma.usuario.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 2,
        email: 'inactivo@gmail.com',
        estado: 'INACTIVO',
        rol: 'PERSONAL',
        nombre: 'Juan',
        apellido: 'Perez',
      } as any);

    await expect(service.loginConGoogle('valid-token')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('NO emite sesión de plataforma: un Usuario.rol SUPERADMIN sin membresía es rechazado', async () => {
    googleTokenVerifier.verificar.mockResolvedValue({
      email: 'admin@gmail.com',
      sub: '12345',
      email_verified: true,
      picture: 'https://photo.url',
    });

    // googleId: null → primera búsqueda (por googleId) no lo encuentra
    prisma.usuario.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 1,
        email: 'admin@gmail.com',
        estado: 'ACTIVO',
        rol: 'SUPERADMIN',
        nombre: 'Felipe',
        apellido: 'Armero',
        googleId: null,
      } as any);

    // Sin contexto de negocio, `Usuario.rol` no abre la puerta: se rechaza.
    contextoService.obtenerContexto.mockReturnValue(undefined);

    await expect(service.loginConGoogle('valid-token')).rejects.toThrow(
      ForbiddenException,
    );

    expect(sesionService.emitirParaNegocio).not.toHaveBeenCalled();
  });

  it('un Usuario.rol SUPERADMIN con membresía entra con los roles de SU negocio', async () => {
    googleTokenVerifier.verificar.mockResolvedValue({
      email: 'admin@gmail.com',
      sub: '12345',
      email_verified: true,
      picture: 'https://photo.url',
    });

    // googleId: null → primera búsqueda no lo encuentra, segunda sí
    prisma.usuario.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 1,
        email: 'admin@gmail.com',
        estado: 'ACTIVO',
        rol: 'SUPERADMIN',
        nombre: 'Felipe',
        apellido: 'Armero',
        googleId: null,
      } as any);

    rolesService.perfilOperativo.mockResolvedValue({
      roles: ['SUPERADMIN'],
      fotoUrl: null,
    });

    sesionService.emitirParaNegocio.mockReturnValue({
      accessToken: 'token-negocio',
      usuario: { id: 1, roles: ['SUPERADMIN'] },
      negocio: { id: 7, slug: 'kyrios-studio' },
    } as any);

    const result = await service.loginConGoogle('valid-token');

    expect(sesionService.emitirParaNegocio).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, rol: 'SUPERADMIN' }),
      expect.objectContaining({ slug: 'kyrios-studio' }),
      ['SUPERADMIN'],
      'https://photo.url',
    );
    expect(result.negocio).toEqual({ id: 7, slug: 'kyrios-studio' });
    expect(prisma.usuario.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { googleId: '12345' },
    });
  });

  it('debe rechazar el login del personal si la petición no tiene contexto de negocio', async () => {
    googleTokenVerifier.verificar.mockResolvedValue({
      email: 'barbero@gmail.com',
      sub: '123',
      email_verified: true,
    });

    // googleId coincide → primera búsqueda lo encuentra directamente
    prisma.usuario.findUnique.mockResolvedValue({
      id: 3,
      email: 'barbero@gmail.com',
      estado: 'ACTIVO',
      rol: 'PERSONAL',
      nombre: 'Beto',
      apellido: 'Perez',
      googleId: '123',
    } as any);

    contextoService.obtenerContexto.mockReturnValue(undefined);

    await expect(service.loginConGoogle('valid-token')).rejects.toThrow(
      ForbiddenException,
    );
    expect(sesionService.emitirParaNegocio).not.toHaveBeenCalled();
  });

  it('debe rechazar el login si la persona no tiene perfil activo en ese negocio', async () => {
    googleTokenVerifier.verificar.mockResolvedValue({
      email: 'barbero@gmail.com',
      sub: '123',
      email_verified: true,
    });

    // googleId coincide → primera búsqueda lo encuentra directamente
    prisma.usuario.findUnique.mockResolvedValue({
      id: 3,
      email: 'barbero@gmail.com',
      estado: 'ACTIVO',
      rol: 'PERSONAL',
      nombre: 'Beto',
      apellido: 'Perez',
      googleId: '123',
    } as any);

    rolesService.perfilOperativo.mockResolvedValue({
      roles: [],
      fotoUrl: null,
    });

    await expect(service.loginConGoogle('valid-token')).rejects.toThrow(
      ForbiddenException,
    );
    expect(sesionService.emitirParaNegocio).not.toHaveBeenCalled();
  });

  it('debe emitir una sesión VINCULADA al negocio con los roles efectivos', async () => {
    googleTokenVerifier.verificar.mockResolvedValue({
      email: 'adminbarbero@gmail.com',
      sub: '99999',
      email_verified: true,
    });

    // googleId coincide → primera búsqueda lo encuentra directamente
    prisma.usuario.findUnique.mockResolvedValue({
      id: 10,
      email: 'adminbarbero@gmail.com',
      estado: 'ACTIVO',
      rol: 'PERSONAL',
      nombre: 'Carlos',
      apellido: 'Perez',
      googleId: '99999',
    } as any);

    rolesService.perfilOperativo.mockResolvedValue({
      roles: ['ADMINISTRADOR', 'BARBERO'],
      fotoUrl: '/foto.jpg',
    });

    sesionService.emitirParaNegocio.mockReturnValue({
      accessToken: 'token-negocio',
      usuario: { id: 10, roles: ['ADMINISTRADOR', 'BARBERO'] },
      negocio: { id: 10, slug: 'kyrios-studio' },
    } as any);

    const result = await service.loginConGoogle('valid-token');

    expect(rolesService.perfilOperativo).toHaveBeenCalledWith(10, contexto);
    expect(sesionService.emitirParaNegocio).toHaveBeenCalledWith(
      expect.objectContaining({ id: 10 }),
      contexto,
      ['ADMINISTRADOR', 'BARBERO'],
      '/foto.jpg',
    );
    expect(result.negocio).toEqual({ id: 10, slug: 'kyrios-studio' });
  });

  // --- A4: Tests de anti-takeover ---

  it('rechaza el login si el googleId del token no coincide con el registrado', async () => {
    googleTokenVerifier.verificar.mockResolvedValue({
      email: 'victima@gmail.com',
      sub: 'google-nuevo',
      email_verified: true,
    });

    // 1ª búsqueda (por googleId 'google-nuevo'): no encontrado
    // 2ª búsqueda (por email): encuentra al usuario con googleId distinto
    prisma.usuario.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 1,
        email: 'victima@gmail.com',
        estado: 'ACTIVO',
        rol: 'PERSONAL',
        googleId: 'google-original',
      } as any);

    await expect(service.loginConGoogle('valid-token')).rejects.toThrow(
      UnauthorizedException,
    );
    // No se emite sesión
    expect(sesionService.emitirParaNegocio).not.toHaveBeenCalled();
  });

  it('resuelve primero por googleId antes que por email', async () => {
    googleTokenVerifier.verificar.mockResolvedValue({
      email: 'nuevo@correo.com',
      sub: 'google-sub-123',
      email_verified: true,
    });

    // La primera llamada (por googleId) encuentra al usuario directamente.
    prisma.usuario.findUnique.mockResolvedValueOnce({
      id: 1,
      email: 'viejo@correo.com',
      estado: 'ACTIVO',
      rol: 'PERSONAL',
      nombre: 'Felipe',
      apellido: 'Armero',
      googleId: 'google-sub-123',
    } as any);

    rolesService.perfilOperativo.mockResolvedValue({
      roles: ['ADMINISTRADOR'],
      fotoUrl: null,
    });

    sesionService.emitirParaNegocio.mockReturnValue({
      accessToken: 'x',
      usuario: { id: 1, roles: ['ADMINISTRADOR'] },
      negocio: { id: 10, slug: 'kyrios-studio' },
    } as any);

    await service.loginConGoogle('valid-token');

    // La segunda búsqueda (por email) no debe haberse ejecutado.
    expect(prisma.usuario.findUnique).toHaveBeenCalledTimes(1);
    expect(prisma.usuario.findUnique).toHaveBeenCalledWith({
      where: { googleId: 'google-sub-123' },
    });
  });
});
