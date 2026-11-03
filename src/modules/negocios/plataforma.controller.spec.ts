import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { NegociosPlataformaController } from './negocios-plataforma.controller';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtSesionGuard } from '../../auth/guards/jwt-sesion.guard';
import { PersonalJwtService } from '../../auth/sesion/personal-jwt.service';
import { PlataformaAdminGuard } from './guards/plataforma-admin.guard';
import { EstadoNegocio } from '../../../generated/prisma/enums';

describe('NegociosPlataformaController', () => {
  let controller: NegociosPlataformaController;
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
      controllers: [NegociosPlataformaController],
      providers: [
        {
          provide: PrismaService,
          useValue: prisma,
        },
        {
          provide: PersonalJwtService,
          useValue: { verificarToken: jest.fn() },
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn() },
        },
      ],
    }).compile();

    controller = module.get<NegociosPlataformaController>(
      NegociosPlataformaController,
    );
  });

  it('debe estar definido', () => {
    expect(controller).toBeDefined();
  });

  describe('listarBarberiasPublicas (GET /plataforma/negocios/publico)', () => {
    it('la respuesta pública contiene exactamente las claves permitidas y ningún campo prohibido', async () => {
      prisma.negocio.findMany.mockResolvedValue([
        {
          id: 1,
          nombre: 'Barberia Centro',
          slug: 'barberia-centro',
          perfil: {
            ciudad: 'Popayán',
            logoBlancoUrl: 'https://logo.png',
            bannerUrl: 'https://banner.png',
            frasePrincipal: 'Estilo y calidad',
            direccion: 'Calle 5 # 4-20',
            departamento: 'Cauca',
          },
          zonaHoraria: 'America/Bogota',
          creadoEn: new Date(),
          _count: {
            barberos: 5,
            servicios: 10,
            reservas: 100,
            clientes: 50,
          },
        },
      ]);

      const resultado = await controller.listarBarberiasPublicas();

      expect(resultado).toHaveLength(1);
      const item = resultado[0];

      // Exact allowed keys
      const allowedKeys = [
        'id',
        'nombre',
        'slug',
        'ciudad',
        'logoBlancoUrl',
        'bannerUrl',
        'frasePrincipal',
      ].sort();
      expect(Object.keys(item).sort()).toEqual(allowedKeys);

      // Must NOT contain forbidden fields or nested objects
      expect(item).not.toHaveProperty('perfil');
      expect(item).not.toHaveProperty('direccion');
      expect(item).not.toHaveProperty('departamento');
      expect(item).not.toHaveProperty('zonaHoraria');
      expect(item).not.toHaveProperty('creadoEn');
      expect(item).not.toHaveProperty('estadisticas');
      expect(item).not.toHaveProperty('totalReservas');
      expect(item).not.toHaveProperty('totalClientes');
      expect(item).not.toHaveProperty('totalBarberos');
      expect(item).not.toHaveProperty('totalServicios');
    });
  });

  describe('listarBarberias (GET /plataforma/negocios - admin full)', () => {
    it('retorna el detalle completo y estadísticas para administradores', async () => {
      const fecha = new Date();
      prisma.negocio.findMany.mockResolvedValue([
        {
          id: 1,
          nombre: 'Barberia Centro',
          slug: 'barberia-centro',
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

      const resultado = await controller.listarBarberias();

      expect(resultado).toHaveLength(1);
      const item = resultado[0];
      expect(item.id).toBe(1);
      expect(item.nombre).toBe('Barberia Centro');
      expect(item.estado).toBe(EstadoNegocio.ACTIVO);
      expect(item.zonaHoraria).toBe('America/Bogota');
      expect(item.creadoEn).toBe(fecha);
      expect(item.perfil?.direccion).toBe('Calle 5 # 4-20');
      expect(item.estadisticas).toEqual({
        totalBarberos: 3,
        totalServicios: 8,
        totalReservas: 45,
        totalClientes: 30,
      });
    });
  });

  describe('Guard metadata en métodos', () => {
    it('los métodos de administración tienen JwtSesionGuard y PlataformaAdminGuard', () => {
      const guardsListar = Reflect.getMetadata(
        '__guards__',
        NegociosPlataformaController.prototype.listarBarberias,
      );
      const guardsCrear = Reflect.getMetadata(
        '__guards__',
        NegociosPlataformaController.prototype.crearBarberia,
      );
      const guardsEstado = Reflect.getMetadata(
        '__guards__',
        NegociosPlataformaController.prototype.cambiarEstado,
      );

      expect(guardsListar).toEqual([JwtSesionGuard, PlataformaAdminGuard]);
      expect(guardsCrear).toEqual([JwtSesionGuard, PlataformaAdminGuard]);
      expect(guardsEstado).toEqual([JwtSesionGuard, PlataformaAdminGuard]);
    });

    it('el endpoint público no tiene guards asociados', () => {
      const guardsPublico = Reflect.getMetadata(
        '__guards__',
        NegociosPlataformaController.prototype.listarBarberiasPublicas,
      );
      expect(guardsPublico).toBeUndefined();
    });
  });
});
