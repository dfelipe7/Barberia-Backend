import { Test, TestingModule } from '@nestjs/testing';
import { BootstrapService } from './bootstrap.service';
import { UsuariosRepository } from '../modules/usuarios/repository/usuarios.repository';

const mockUsuariosRepository = {
  obtenerUsuarioPorEmail: jest.fn(),
  actualizarRol: jest.fn(),
  actualizarEstadoUsuario: jest.fn(),
  crearUsuario: jest.fn(),
};

describe('BootstrapService', () => {
  let service: BootstrapService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BootstrapService,
        { provide: UsuariosRepository, useValue: mockUsuariosRepository },
      ],
    }).compile();

    service = module.get<BootstrapService>(BootstrapService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('onModuleInit', () => {
    it('debe crear los superadministradores fundadores que no existan en la BD', async () => {
      mockUsuariosRepository.obtenerUsuarioPorEmail.mockResolvedValue(null);
      mockUsuariosRepository.crearUsuario.mockResolvedValue({});

      await service.onModuleInit();

      expect(mockUsuariosRepository.crearUsuario).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'armeroduvan8@gmail.com',
          rol: 'SUPERADMIN',
        }),
      );
      expect(mockUsuariosRepository.crearUsuario).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'csbalcazar@unicauca.edu.co',
          rol: 'SUPERADMIN',
        }),
      );
      expect(mockUsuariosRepository.crearUsuario).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'javieraceron@unicauca.edu.co',
          rol: 'SUPERADMIN',
        }),
      );
      expect(mockUsuariosRepository.crearUsuario).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'rromero@unicauca.edu.co',
          rol: 'SUPERADMIN',
        }),
      );
    });

    it('debe conservar los datos existentes sin sobrescribir cuando los usuarios ya existen', async () => {
      mockUsuariosRepository.obtenerUsuarioPorEmail.mockResolvedValue({
        id: 1,
        email: 'armeroduvan8@gmail.com',
        nombre: 'Felipe',
        rol: 'BARBERO',
        estado: 'INACTIVO',
      });

      await service.onModuleInit();

      expect(mockUsuariosRepository.crearUsuario).not.toHaveBeenCalled();
      expect(mockUsuariosRepository.actualizarRol).not.toHaveBeenCalled();
      expect(mockUsuariosRepository.actualizarEstadoUsuario).not.toHaveBeenCalled();
    });

    it('debe manejar errores de base de datos sin lanzar excepción no controlada', async () => {
      mockUsuariosRepository.obtenerUsuarioPorEmail.mockRejectedValue(new Error('DB connection lost'));

      await expect(service.onModuleInit()).resolves.not.toThrow();
    });
  });
});
