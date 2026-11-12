import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { NegociosPlataformaController } from './negocios-plataforma.controller';
import { NegociosPlataformaService } from './service/negocios-plataforma.service';
import { JwtSesionGuard } from '../../auth/guards/jwt-sesion.guard';
import { PersonalJwtService } from '../../auth/sesion/personal-jwt.service';
import { PlataformaAdminGuard } from './guards/plataforma-admin.guard';
import { EstadoNegocio } from '../../../generated/prisma/enums';

describe('NegociosPlataformaController', () => {
  let controller: NegociosPlataformaController;
  let service: {
    listarBarberiasPublicas: jest.Mock;
    listarBarberias: jest.Mock;
    crearBarberia: jest.Mock;
    cambiarEstado: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      listarBarberiasPublicas: jest.fn(),
      listarBarberias: jest.fn(),
      crearBarberia: jest.fn(),
      cambiarEstado: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [NegociosPlataformaController],
      providers: [
        {
          provide: NegociosPlataformaService,
          useValue: service,
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
    it('delega la consulta al servicio y retorna el resultado', async () => {
      const mockPublico = [
        {
          id: 1,
          nombre: 'Barberia Centro',
          slug: 'barberia-centro',
          ciudad: 'Popayán',
          logoBlancoUrl: 'https://logo.png',
          bannerUrl: 'https://banner.png',
          frasePrincipal: 'Estilo y calidad',
        },
      ];
      service.listarBarberiasPublicas.mockResolvedValue(mockPublico);

      const resultado = await controller.listarBarberiasPublicas();

      expect(service.listarBarberiasPublicas).toHaveBeenCalledTimes(1);
      expect(resultado).toEqual(mockPublico);
    });
  });

  describe('listarBarberias (GET /plataforma/negocios - admin full)', () => {
    it('delega al servicio y retorna el detalle completo con estadísticas', async () => {
      const mockAdmin = [
        {
          id: 1,
          nombre: 'Barberia Centro',
          slug: 'barberia-centro',
          estado: EstadoNegocio.ACTIVO,
          zonaHoraria: 'America/Bogota',
          creadoEn: new Date(),
          perfil: {
            direccion: 'Calle 5 # 4-20',
            ciudad: 'Popayán',
            logoBlancoUrl: 'https://logo.png',
            bannerUrl: 'https://banner.png',
            frasePrincipal: 'Estilo',
          },
          estadisticas: {
            totalBarberos: 3,
            totalServicios: 8,
            totalReservas: 45,
            totalClientes: 30,
          },
        },
      ];
      service.listarBarberias.mockResolvedValue(mockAdmin);

      const resultado = await controller.listarBarberias();

      expect(service.listarBarberias).toHaveBeenCalledTimes(1);
      expect(resultado).toEqual(mockAdmin);
    });
  });

  describe('crearBarberia (POST /plataforma/negocios)', () => {
    it('delega la creación al servicio con el DTO recibido', async () => {
      const dto = {
        nombre: 'Nueva Barberia',
        slug: 'nueva-barberia',
      };
      const mockCreado = {
        mensaje: 'Barbería registrada exitosamente en la plataforma.',
        negocio: {
          id: 2,
          nombre: 'Nueva Barberia',
          slug: 'nueva-barberia',
          estado: EstadoNegocio.ACTIVO,
          perfil: null,
          dueno: null,
        },
      };
      service.crearBarberia.mockResolvedValue(mockCreado);

      const resultado = await controller.crearBarberia(dto);

      expect(service.crearBarberia).toHaveBeenCalledWith(dto);
      expect(resultado).toEqual(mockCreado);
    });
  });

  describe('cambiarEstado (PATCH /plataforma/negocios/:id/estado)', () => {
    it('delega la actualización de estado al servicio', async () => {
      const dto = { estado: EstadoNegocio.INACTIVO };
      const mockActualizado = {
        mensaje: "La barbería 'Barberia' ahora está INACTIVO.",
        negocio: {
          id: 1,
          nombre: 'Barberia',
          slug: 'barberia',
          estado: EstadoNegocio.INACTIVO,
        },
      };
      service.cambiarEstado.mockResolvedValue(mockActualizado);

      const resultado = await controller.cambiarEstado(1, dto);

      expect(service.cambiarEstado).toHaveBeenCalledWith(1, dto);
      expect(resultado).toEqual(mockActualizado);
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

      expect(guardsListar).toBeUndefined();
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
