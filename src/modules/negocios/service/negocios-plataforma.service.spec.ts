import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { NegociosPlataformaService } from './negocios-plataforma.service';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  EstadoNegocio,
  EstadoUsuario,
  RolUsuario,
} from '../../../../generated/prisma/enums';

describe('NegociosPlataformaService', () => {
  let service: NegociosPlataformaService;
  let prisma: {
    negocio: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    usuario: {
      findUnique: jest.Mock;
      create: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      negocio: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      usuario: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NegociosPlataformaService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
      ],
    }).compile();

    service = module.get<NegociosPlataformaService>(NegociosPlataformaService);
  });

  it('debe estar definido', () => {
    expect(service).toBeDefined();
  });

  describe('listarBarberiasPublicas', () => {
    it('retorna la lista de barberías activas mapeadas correctamente', async () => {
      prisma.negocio.findMany.mockResolvedValue([
        {
          id: 1,
          nombre: 'Kyrios Barber',
          slug: 'kyrios-barber',
          perfil: {
            ciudad: 'Popayán',
            logoBlancoUrl: 'https://logo.png',
            bannerUrl: 'https://banner.png',
            frasePrincipal: 'Estilo clásico',
          },
        },
        {
          id: 2,
          nombre: 'Barberia Sin Perfil',
          slug: 'barberia-sin-perfil',
          perfil: null,
        },
      ]);

      const resultado = await service.listarBarberiasPublicas();

      expect(prisma.negocio.findMany).toHaveBeenCalledWith({
        where: { estado: EstadoNegocio.ACTIVO },
        select: {
          id: true,
          nombre: true,
          slug: true,
          perfil: {
            select: {
              ciudad: true,
              logoBlancoUrl: true,
              bannerUrl: true,
              frasePrincipal: true,
            },
          },
        },
        orderBy: { id: 'asc' },
      });

      expect(resultado).toHaveLength(2);
      expect(resultado[0]).toEqual({
        id: 1,
        nombre: 'Kyrios Barber',
        slug: 'kyrios-barber',
        ciudad: 'Popayán',
        logoBlancoUrl: 'https://logo.png',
        bannerUrl: 'https://banner.png',
        frasePrincipal: 'Estilo clásico',
      });
      expect(resultado[1]).toEqual({
        id: 2,
        nombre: 'Barberia Sin Perfil',
        slug: 'barberia-sin-perfil',
        ciudad: null,
        logoBlancoUrl: null,
        bannerUrl: null,
        frasePrincipal: null,
      });
    });
  });

  describe('listarBarberias', () => {
    it('retorna las barberías con perfil y estadísticas agregadas', async () => {
      const fecha = new Date();
      prisma.negocio.findMany.mockResolvedValue([
        {
          id: 1,
          nombre: 'Kyrios Barber',
          slug: 'kyrios-barber',
          estado: EstadoNegocio.ACTIVO,
          zonaHoraria: 'America/Bogota',
          creadoEn: fecha,
          perfil: {
            direccion: 'Calle 5 # 4-20',
            ciudad: 'Popayán',
            logoBlancoUrl: 'https://logo.png',
            bannerUrl: 'https://banner.png',
            frasePrincipal: 'Estilo',
          },
          _count: {
            barberos: 3,
            servicios: 8,
            reservas: 45,
            clientes: 30,
          },
        },
      ]);

      const resultado = await service.listarBarberias();

      expect(resultado).toHaveLength(1);
      expect(resultado[0].id).toBe(1);
      expect(resultado[0].estadisticas).toEqual({
        totalBarberos: 3,
        totalServicios: 8,
        totalReservas: 45,
        totalClientes: 30,
      });
    });
  });

  describe('crearBarberia', () => {
    it('lanza ConflictException si el slug ya existe', async () => {
      prisma.negocio.findUnique.mockResolvedValue({ id: 1, slug: 'kyrios' });

      await expect(
        service.crearBarberia({
          nombre: 'Kyrios Nueva',
          slug: 'KYRIOS',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('crea el negocio y el usuario administrador si no existe', async () => {
      prisma.negocio.findUnique.mockResolvedValue(null);
      prisma.usuario.findUnique.mockResolvedValue(null);
      prisma.usuario.create.mockResolvedValue({
        id: 10,
        email: 'admin@kyrios.com',
        nombre: 'Carlos',
        apellido: 'Pérez',
        rol: RolUsuario.PERSONAL,
        estado: EstadoUsuario.ACTIVO,
      });
      prisma.negocio.create.mockResolvedValue({
        id: 1,
        nombre: 'Kyrios',
        slug: 'kyrios',
        estado: EstadoNegocio.ACTIVO,
        perfil: { direccion: 'Carrera 6' },
        administradores: [{ usuarioId: 10, superadmin: true }],
      });

      const resultado = await service.crearBarberia({
        nombre: 'Kyrios',
        slug: 'kyrios',
        adminEmail: 'admin@kyrios.com',
        adminNombre: 'Carlos',
        adminApellido: 'Pérez',
        direccion: 'Carrera 6',
      });

      expect(prisma.usuario.create).toHaveBeenCalledWith({
        data: {
          email: 'admin@kyrios.com',
          nombre: 'Carlos',
          apellido: 'Pérez',
          rol: RolUsuario.PERSONAL,
          estado: EstadoUsuario.ACTIVO,
        },
      });

      expect(prisma.negocio.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            nombre: 'Kyrios',
            slug: 'kyrios',
            perfil: { create: { direccion: 'Carrera 6' } },
            administradores: {
              create: {
                usuarioId: 10,
                superadmin: true,
                estado: EstadoUsuario.ACTIVO,
              },
            },
          }),
        }),
      );

      expect(resultado.negocio.id).toBe(1);
      expect(resultado.negocio.dueno?.usuarioId).toBe(10);
    });

    it('crea el negocio vinculando usuario existente cuando ya está registrado', async () => {
      prisma.negocio.findUnique.mockResolvedValue(null);
      prisma.usuario.findUnique.mockResolvedValue({
        id: 5,
        email: 'existente@barber.com',
        nombre: 'Juan',
        apellido: 'Gómez',
      });
      prisma.negocio.create.mockResolvedValue({
        id: 2,
        nombre: 'Elite Barber',
        slug: 'elite-barber',
        estado: EstadoNegocio.ACTIVO,
        perfil: null,
        administradores: [{ usuarioId: 5, superadmin: true }],
      });

      const resultado = await service.crearBarberia({
        nombre: 'Elite Barber',
        slug: 'elite-barber',
        adminEmail: 'existente@barber.com',
      });

      expect(prisma.usuario.create).not.toHaveBeenCalled();
      expect(resultado.negocio.dueno?.usuarioId).toBe(5);
    });

    it('crea el negocio sin dueño cuando no se proporciona adminEmail', async () => {
      prisma.negocio.findUnique.mockResolvedValue(null);
      prisma.negocio.create.mockResolvedValue({
        id: 3,
        nombre: 'Sola Barber',
        slug: 'sola-barber',
        estado: EstadoNegocio.ACTIVO,
        perfil: null,
      });

      const resultado = await service.crearBarberia({
        nombre: 'Sola Barber',
        slug: 'sola-barber',
      });

      expect(prisma.usuario.findUnique).not.toHaveBeenCalled();
      expect(resultado.negocio.dueno).toBeNull();
    });
  });

  describe('cambiarEstado', () => {
    it('lanza NotFoundException si la barbería no existe', async () => {
      prisma.negocio.findUnique.mockResolvedValue(null);

      await expect(
        service.cambiarEstado(999, { estado: EstadoNegocio.INACTIVO }),
      ).rejects.toThrow(NotFoundException);
    });

    it('actualiza y retorna la barbería con su nuevo estado', async () => {
      prisma.negocio.findUnique.mockResolvedValue({ id: 1, nombre: 'Kyrios' });
      prisma.negocio.update.mockResolvedValue({
        id: 1,
        nombre: 'Kyrios',
        slug: 'kyrios',
        estado: EstadoNegocio.INACTIVO,
      });

      const resultado = await service.cambiarEstado(1, {
        estado: EstadoNegocio.INACTIVO,
      });

      expect(prisma.negocio.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { estado: EstadoNegocio.INACTIVO },
        select: {
          id: true,
          nombre: true,
          slug: true,
          estado: true,
        },
      });

      expect(resultado.mensaje).toContain('INACTIVO');
      expect(resultado.negocio.estado).toBe(EstadoNegocio.INACTIVO);
    });
  });
});
