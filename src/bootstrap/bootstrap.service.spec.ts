import { Test, TestingModule } from '@nestjs/testing';
import { BootstrapService } from './bootstrap.service';
import { UsuariosRepository } from '../modules/usuarios/repository/usuarios.repository';
import { NegociosRepository } from '../modules/negocios/repository/negocios.repository';
import { ConfiguracionService } from '../modules/configuracion/service/configuracion.service';

const mockUsuariosRepository = {
  obtenerUsuarioPorEmail: jest.fn(),
  actualizarRol: jest.fn(),
  actualizarEstadoUsuario: jest.fn(),
  crearUsuario: jest.fn(),
};

const mockNegociosRepository = {
  listar: jest.fn(),
};

const mockConfiguracionService = {
  inicializarValoresOperativos: jest.fn(),
};

describe('BootstrapService', () => {
  let service: BootstrapService;

  beforeEach(async () => {
    mockNegociosRepository.listar.mockResolvedValue([]);
    mockConfiguracionService.inicializarValoresOperativos.mockResolvedValue({
      creadas: [],
      conservadas: [],
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BootstrapService,
        { provide: UsuariosRepository, useValue: mockUsuariosRepository },
        { provide: NegociosRepository, useValue: mockNegociosRepository },
        { provide: ConfiguracionService, useValue: mockConfiguracionService },
      ],
    }).compile();

    service = module.get<BootstrapService>(BootstrapService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('onModuleInit', () => {
    it('NO crea superadministradores (ni de plataforma ni de negocio)', async () => {
      mockUsuariosRepository.obtenerUsuarioPorEmail.mockResolvedValue(null);

      await service.onModuleInit();

      // El arranque NO crea personas ni promueve a nadie: las membresías se
      // configuran con el comando explícito `multitenant:fundadores`.
      expect(mockUsuariosRepository.crearUsuario).not.toHaveBeenCalled();
      expect(mockUsuariosRepository.actualizarRol).not.toHaveBeenCalled();
      expect(
        mockUsuariosRepository.actualizarEstadoUsuario,
      ).not.toHaveBeenCalled();
      expect(
        mockUsuariosRepository.obtenerUsuarioPorEmail,
      ).not.toHaveBeenCalled();
    });

    it('no consulta ni modifica ninguna cuenta de usuario al arrancar', async () => {
      mockUsuariosRepository.obtenerUsuarioPorEmail.mockResolvedValue({
        id: 1,
        email: 'armeroduvan8@gmail.com',
        nombre: 'Felipe',
        rol: 'SUPERADMIN',
        estado: 'ACTIVO',
      });

      await service.onModuleInit();

      expect(mockUsuariosRepository.crearUsuario).not.toHaveBeenCalled();
      expect(mockUsuariosRepository.actualizarRol).not.toHaveBeenCalled();
      expect(
        mockUsuariosRepository.actualizarEstadoUsuario,
      ).not.toHaveBeenCalled();
    });

    it('debe manejar errores de base de datos sin lanzar excepción no controlada', async () => {
      mockNegociosRepository.listar.mockRejectedValue(
        new Error('DB connection lost'),
      );

      await expect(service.onModuleInit()).resolves.not.toThrow();
    });
  });

  describe('configuración operativa por negocio', () => {
    it('inicializa la configuración operativa de cada negocio', async () => {
      mockNegociosRepository.listar.mockResolvedValue([
        { id: 1, slug: 'kyrios-studio', nombre: 'KYRIOS STUDIO' },
        { id: 2, slug: 'barberia-demo-2', nombre: 'Barbería Demo 2' },
      ]);

      await service.onModuleInit();

      expect(
        mockConfiguracionService.inicializarValoresOperativos,
      ).toHaveBeenCalledTimes(2);
      expect(
        mockConfiguracionService.inicializarValoresOperativos,
      ).toHaveBeenCalledWith(1);
      expect(
        mockConfiguracionService.inicializarValoresOperativos,
      ).toHaveBeenCalledWith(2);
    });

    it('un fallo al inicializar un negocio no detiene el arranque', async () => {
      mockNegociosRepository.listar.mockResolvedValue([
        { id: 1, slug: 'kyrios-studio', nombre: 'KYRIOS STUDIO' },
      ]);
      mockConfiguracionService.inicializarValoresOperativos.mockRejectedValue(
        new Error('tabla no disponible'),
      );

      await expect(service.onModuleInit()).resolves.not.toThrow();
    });

    it('un fallo al listar los negocios no detiene el arranque', async () => {
      mockNegociosRepository.listar.mockRejectedValue(
        new Error('DB connection lost'),
      );

      await expect(service.onModuleInit()).resolves.not.toThrow();
    });
  });
});
