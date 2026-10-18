import { Test, TestingModule } from '@nestjs/testing';
import { GoogleAuthService } from './google-auth.service';
import { GoogleTokenVerifier } from './google-token-verifier.service';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { UnauthorizedException, ForbiddenException } from '@nestjs/common';

describe('GoogleAuthService', () => {
  let service: GoogleAuthService;
  let jwtService: jest.Mocked<JwtService>;
  let googleTokenVerifier: { verificar: jest.Mock };
  let prisma: any;

  beforeEach(async () => {
    const mockJwtService = {
      sign: jest.fn().mockReturnValue('signed-jwt-token'),
    };

    const mockVerifier = {
      verificar: jest.fn(),
    };

    const mockPrisma = {
      usuario: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GoogleAuthService,
        { provide: JwtService, useValue: mockJwtService },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: GoogleTokenVerifier, useValue: mockVerifier },
      ],
    }).compile();

    service = module.get<GoogleAuthService>(GoogleAuthService);
    jwtService = module.get(JwtService);
    googleTokenVerifier = module.get(GoogleTokenVerifier);
    prisma = module.get(PrismaService);
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

  it('debe lanzar UnauthorizedException si el usuario no existe en la base de datos', async () => {
    googleTokenVerifier.verificar.mockResolvedValue({
      email: 'desconocido@gmail.com',
      sub: '123',
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
    });

    prisma.usuario.findUnique.mockResolvedValue({
      id: 2,
      email: 'inactivo@gmail.com',
      estado: 'INACTIVO',
      rol: 'BARBERO',
      nombre: 'Juan',
      apellido: 'Perez',
    } as any);

    await expect(service.loginConGoogle('valid-token')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('debe lanzar ForbiddenException si el usuario no tiene roles activos', async () => {
    googleTokenVerifier.verificar.mockResolvedValue({
      email: 'sinrol@gmail.com',
      sub: '123',
    });

    prisma.usuario.findUnique.mockResolvedValue({
      id: 3,
      email: 'sinrol@gmail.com',
      estado: 'ACTIVO',
      rol: 'CLIENTE',
      nombre: 'Sin',
      apellido: 'Rol',
      administrador: null,
      barbero: null,
    } as any);

    await expect(service.loginConGoogle('valid-token')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('debe permitir login a un administrador activo sin foto de Google pero con foto propia de barbero', async () => {
    googleTokenVerifier.verificar.mockResolvedValue({
      email: 'admin@gmail.com',
      sub: '12345',
    });

    prisma.usuario.findUnique.mockResolvedValue({
      id: 4,
      email: 'admin@gmail.com',
      estado: 'ACTIVO',
      rol: 'ADMINISTRADOR',
      nombre: 'Admin',
      apellido: 'Local',
      googleId: '12345',
      administrador: { estado: 'ACTIVO' },
      barbero: { fotoUrl: '/uploads/foto.jpg', estado: 'INACTIVO' },
    } as any);

    const result = await service.loginConGoogle('valid-token');

    expect(result.usuario.fotoUrl).toBe('/uploads/foto.jpg');
    // Como ya tenía googleId no vuelve a hacer update
    expect(prisma.usuario.update).not.toHaveBeenCalled();
  });

  it('debe retornar accessToken y usuario si el login es exitoso para superadmin', async () => {
    googleTokenVerifier.verificar.mockResolvedValue({
      email: 'admin@gmail.com',
      sub: '12345',
      picture: 'https://photo.url',
    });

    prisma.usuario.findUnique.mockResolvedValue({
      id: 1,
      email: 'admin@gmail.com',
      estado: 'ACTIVO',
      rol: 'SUPERADMIN',
      nombre: 'Felipe',
      apellido: 'Armero',
      googleId: null,
      barbero: null,
    } as any);

    const result = await service.loginConGoogle('valid-token');

    expect(result).toHaveProperty('accessToken', 'signed-jwt-token');
    expect(result.usuario).toEqual({
      id: 1,
      email: 'admin@gmail.com',
      nombre: 'Felipe',
      apellido: 'Armero',
      rol: 'SUPERADMIN',
      roles: ['SUPERADMIN'],
      estado: 'ACTIVO',
      fotoUrl: 'https://photo.url',
    });
    expect(prisma.usuario.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { googleId: '12345' },
    });
  });

  it('debe asignar múltiples roles si el usuario es administrador y barbero activos', async () => {
    googleTokenVerifier.verificar.mockResolvedValue({
      email: 'adminbarbero@gmail.com',
      sub: '99999',
    });

    prisma.usuario.findUnique.mockResolvedValue({
      id: 10,
      email: 'adminbarbero@gmail.com',
      estado: 'ACTIVO',
      rol: 'ADMINISTRADOR',
      nombre: 'Carlos',
      apellido: 'Perez',
      googleId: '99999',
      administrador: { estado: 'ACTIVO' },
      barbero: { estado: 'ACTIVO', fotoUrl: '/foto.jpg' },
    } as any);

    const result = await service.loginConGoogle('valid-token');

    expect(result.usuario.roles).toEqual(['ADMINISTRADOR', 'BARBERO']);
    expect(jwtService.sign).toHaveBeenCalledWith(
      expect.objectContaining({
        roles: ['ADMINISTRADOR', 'BARBERO'],
      }),
    );
  });

  describe('refrescarSesion', () => {
    it('debe lanzar UnauthorizedException si el usuario no existe', async () => {
      prisma.usuario.findUnique.mockResolvedValue(null);

      await expect(service.refrescarSesion(999)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('debe lanzar ForbiddenException si el usuario está INACTIVO', async () => {
      prisma.usuario.findUnique.mockResolvedValue({
        id: 999,
        estado: 'INACTIVO',
      });

      await expect(service.refrescarSesion(999)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('debe emitir un nuevo token con roles actualizados de la BD', async () => {
      prisma.usuario.findUnique.mockResolvedValue({
        id: 10,
        email: 'carlos@gmail.com',
        nombre: 'Carlos',
        apellido: 'Perez',
        rol: 'ADMINISTRADOR',
        estado: 'ACTIVO',
        administrador: { estado: 'ACTIVO' },
        barbero: { estado: 'ACTIVO', fotoUrl: '/foto.jpg' },
      });

      const result = await service.refrescarSesion(10);

      expect(result.accessToken).toBe('signed-jwt-token');
      expect(result.usuario.roles).toEqual(['ADMINISTRADOR', 'BARBERO']);
      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({
          sub: '10',
          roles: ['ADMINISTRADOR', 'BARBERO'],
          fotoUrl: '/foto.jpg',
        }),
      );
    });

    it('debe preservar la foto de Google si el usuario no tiene foto propia en la BD', async () => {
      prisma.usuario.findUnique.mockResolvedValue({
        id: 11,
        email: 'admin@gmail.com',
        nombre: 'Admin',
        apellido: 'Puro',
        rol: 'ADMINISTRADOR',
        estado: 'ACTIVO',
        administrador: { estado: 'ACTIVO' },
        barbero: null,
      });

      const googlePhoto =
        'https://lh3.googleusercontent.com/a/google-avatar.jpg';
      const result = await service.refrescarSesion(11, googlePhoto);

      expect(result.usuario.fotoUrl).toBe(googlePhoto);
      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({
          sub: '11',
          fotoUrl: googlePhoto,
        }),
      );
    });
  });
});
