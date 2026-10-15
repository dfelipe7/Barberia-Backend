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
      estado: 'ACTIVO',
      fotoUrl: 'https://photo.url',
    });
    expect(prisma.usuario.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { googleId: '12345' },
    });
  });
});
