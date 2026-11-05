import { Test, TestingModule } from '@nestjs/testing';
import { PerfilNegocioRepository } from './perfil-negocio.repository';
import { PrismaService } from '../../../prisma/prisma.service';

describe('PerfilNegocioRepository', () => {
  let repository: PerfilNegocioRepository;
  let prisma: jest.Mocked<PrismaService>;

  const mockDbPerfil = {
    id: 1,
    negocioId: 1,
    frasePrincipal: 'Frase',
    temaKey: 'clasico-azul',
    faviconUrl: '/fav.svg',
    bannerUrl: '/banner.png',
    logoBlancoUrl: null,
    logoNegroUrl: null,
    direccion: 'Calle 10',
    ciudad: 'Popayán',
    departamento: 'Cauca',
    referencia: 'Parque',
    latitud: { toString: () => '2.4419' } as any,
    longitud: { toString: () => '-76.6063' } as any,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-02'),
  };

  beforeEach(async () => {
    const mockPrisma = {
      perfilNegocio: {
        findUnique: jest.fn(),
        upsert: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PerfilNegocioRepository,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    repository = module.get<PerfilNegocioRepository>(PerfilNegocioRepository);
    prisma = module.get(PrismaService);
  });

  it('debe estar definido', () => {
    expect(repository).toBeDefined();
  });

  describe('buscarPorNegocio', () => {
    it('devuelve el perfil mapeado cuando existe', async () => {
      (prisma.perfilNegocio.findUnique as jest.Mock).mockResolvedValue(mockDbPerfil);

      const res = await repository.buscarPorNegocio(1);
      expect(prisma.perfilNegocio.findUnique).toHaveBeenCalledWith({
        where: { negocioId: 1 },
        select: expect.any(Object),
      });
      expect(res).not.toBeNull();
      expect(res?.frasePrincipal).toBe('Frase');
      expect(res?.latitud).toBe('2.4419');
      expect(res?.longitud).toBe('-76.6063');
    });

    it('devuelve null si no existe perfil', async () => {
      (prisma.perfilNegocio.findUnique as jest.Mock).mockResolvedValue(null);

      const res = await repository.buscarPorNegocio(2);
      expect(res).toBeNull();
    });
  });

  describe('guardarReferencia', () => {
    it('hace upsert de un único campo de referencia y mapea el resultado', async () => {
      (prisma.perfilNegocio.upsert as jest.Mock).mockResolvedValue({
        ...mockDbPerfil,
        faviconUrl: '/nuevo-fav.svg',
      });

      const res = await repository.guardarReferencia(1, 'faviconUrl', '/nuevo-fav.svg');
      expect(prisma.perfilNegocio.upsert).toHaveBeenCalledWith({
        where: { negocioId: 1 },
        update: { faviconUrl: '/nuevo-fav.svg' },
        create: { negocioId: 1, faviconUrl: '/nuevo-fav.svg' },
        select: expect.any(Object),
      });
      expect(res.faviconUrl).toBe('/nuevo-fav.svg');
    });
  });

  describe('guardar', () => {
    it('hace upsert del conjunto de datos y mapea el resultado', async () => {
      const datos = {
        frasePrincipal: 'Nueva Frase',
        direccion: 'Calle Nueva',
      };
      (prisma.perfilNegocio.upsert as jest.Mock).mockResolvedValue({
        ...mockDbPerfil,
        frasePrincipal: 'Nueva Frase',
        direccion: 'Calle Nueva',
      });

      const res = await repository.guardar(1, datos);
      expect(prisma.perfilNegocio.upsert).toHaveBeenCalledWith({
        where: { negocioId: 1 },
        update: datos,
        create: { negocioId: 1, ...datos },
        select: expect.any(Object),
      });
      expect(res.frasePrincipal).toBe('Nueva Frase');
      expect(res.direccion).toBe('Calle Nueva');
    });
  });
});

