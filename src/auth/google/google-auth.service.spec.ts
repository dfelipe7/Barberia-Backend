import { Test, TestingModule } from '@nestjs/testing';
import { GoogleAuthService } from './google-auth.service';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { UnauthorizedException, ForbiddenException } from '@nestjs/common';

describe('GoogleAuthService', () => {
  let service: GoogleAuthService;
  let jwtService: jest.Mocked<JwtService>;
  let prisma: any;

  beforeEach(async () => {
    const mockConfigService = {
      getOrThrow: jest.fn().mockReturnValue('test-google-client-id'),
    };

    const mockJwtService = {
      sign: jest.fn().mockReturnValue('signed-jwt-token'),
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
        { provide: ConfigService, useValue: mockConfigService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<GoogleAuthService>(GoogleAuthService);
    jwtService = module.get(JwtService);
    prisma = module.get(PrismaService);
  });

  it('debe estar definido', () => {
    expect(service).toBeDefined();
  });

  it('debe lanzar UnauthorizedException si verifyIdToken falla', async () => {
    jest.spyOn((service as any).oauthClient, 'verifyIdToken').mockRejectedValue(new Error('Invalid token'));

    await expect(service.loginConGoogle('invalid-token')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('debe lanzar UnauthorizedException si el usuario no existe en la base de datos', async () => {
    jest.spyOn((service as any).oauthClient, 'verifyIdToken').mockResolvedValue({
      getPayload: () => ({ email: 'desconocido@gmail.com', sub: '123' }),
    } as any);

    prisma.usuario.findUnique.mockResolvedValue(null);

    await expect(service.loginConGoogle('valid-token')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('debe lanzar ForbiddenException si el usuario está INACTIVO', async () => {
    jest.spyOn((service as any).oauthClient, 'verifyIdToken').mockResolvedValue({
      getPayload: () => ({ email: 'inactivo@gmail.com', sub: '123' }),
    } as any);

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

  it('debe retornar accessToken y usuario si el login es exitoso', async () => {
    jest.spyOn((service as any).oauthClient, 'verifyIdToken').mockResolvedValue({
      getPayload: () => ({
        email: 'admin@gmail.com',
        sub: '12345',
        picture: 'https://photo.url',
      }),
    } as any);

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
