import { Test, TestingModule } from '@nestjs/testing';
import { NegocioRolesService } from './negocio-roles.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { NegocioAislamientoService } from '../negocio-aislamiento.service';
import { EstadoUsuario } from '../../../../generated/prisma/enums';

/**
 * Roles EFECTIVOS de una persona en un negocio (Fase 10).
 *
 * El carácter SUPERADMIN es de la MEMBRESÍA (`Administrador.superadmin`) y su
 * alcance es ese negocio: `Usuario.rol` no interviene en el cálculo.
 */
describe('NegocioRolesService', () => {
  let service: NegocioRolesService;

  const NEGOCIO = { id: 7, slug: 'kyrios-studio' };

  const mockPrisma = {
    administrador: { findFirst: jest.fn() },
    barbero: { findFirst: jest.fn() },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    mockPrisma.administrador.findFirst.mockResolvedValue(null);
    mockPrisma.barbero.findFirst.mockResolvedValue(null);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NegocioRolesService,
        { provide: PrismaService, useValue: mockPrisma },
        {
          provide: NegocioAislamientoService,
          useValue: {
            ejecutarEnNegocio: (_negocio: unknown, operacion: () => unknown) =>
              operacion(),
          },
        },
      ],
    }).compile();

    service = module.get<NegocioRolesService>(NegocioRolesService);
  });

  it('debe estar definido', () => {
    expect(service).toBeDefined();
  });

  it('sin membresías NO hay roles (nadie opera sin relación con el negocio)', async () => {
    const perfil = await service.perfilOperativo(1, NEGOCIO);

    expect(perfil.roles).toEqual([]);
  });

  it('una membresía de administrador con superadmin=false da el rol ADMINISTRADOR', async () => {
    mockPrisma.administrador.findFirst.mockResolvedValue({
      id: 1,
      superadmin: false,
    });

    const perfil = await service.perfilOperativo(1, NEGOCIO);

    expect(perfil.roles).toEqual(['ADMINISTRADOR']);
  });

  it('una membresía de administrador con superadmin=true da el rol SUPERADMIN de ESE negocio', async () => {
    mockPrisma.administrador.findFirst.mockResolvedValue({
      id: 1,
      superadmin: true,
    });

    const perfil = await service.perfilOperativo(1, NEGOCIO);

    expect(perfil.roles).toEqual(['SUPERADMIN']);
  });

  it('la consulta de la membresía está acotada al negocio evaluado', async () => {
    mockPrisma.administrador.findFirst.mockResolvedValue({
      id: 1,
      superadmin: true,
    });

    await service.perfilOperativo(1, NEGOCIO);

    expect(mockPrisma.administrador.findFirst).toHaveBeenCalledWith({
      where: { usuarioId: 1, estado: EstadoUsuario.ACTIVO },
      select: { id: true, superadmin: true },
    });
  });

  it('una persona puede tener los dos roles: SUPERADMIN del negocio y barbero', async () => {
    mockPrisma.administrador.findFirst.mockResolvedValue({
      id: 1,
      superadmin: true,
    });
    mockPrisma.barbero.findFirst.mockResolvedValue({
      id: 2,
      fotoUrl: 'https://foto.url',
    });

    const perfil = await service.perfilOperativo(1, NEGOCIO);

    expect(perfil.roles).toEqual(['SUPERADMIN', 'BARBERO']);
    expect(perfil.fotoUrl).toBe('https://foto.url');
  });

  it('la foto del perfil de barbero es null si no tiene membresía de barbero', async () => {
    mockPrisma.administrador.findFirst.mockResolvedValue({
      id: 1,
      superadmin: false,
    });

    const perfil = await service.perfilOperativo(1, NEGOCIO);

    expect(perfil.fotoUrl).toBeNull();
  });

  it('perteneceActivo es true solo si hay roles efectivos en ESE negocio', async () => {
    mockPrisma.administrador.findFirst.mockResolvedValue({
      id: 1,
      superadmin: true,
    });

    await expect(service.perteneceActivo(1, NEGOCIO)).resolves.toBe(true);

    mockPrisma.administrador.findFirst.mockResolvedValue(null);
    mockPrisma.barbero.findFirst.mockResolvedValue(null);

    await expect(
      service.perteneceActivo(1, { id: 99, slug: 'barberia-demo-2' }),
    ).resolves.toBe(false);
  });
});
