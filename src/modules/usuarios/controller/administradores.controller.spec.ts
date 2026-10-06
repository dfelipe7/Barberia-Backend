import { Test, TestingModule } from '@nestjs/testing';
import { AdministradoresController } from './administradores.controller';
import { AdministradoresService } from '../service/administradores.service';
import { CrearAdministradorDto } from '../dto/dto-peticion/crear-administrador.dto';
import { CambiarEstadoUsuarioDto } from '../dto/dto-peticion/cambiar-estado-usuario.dto';
import { KeycloakAuthGuard } from '../../../auth/keycloak-auth/keycloak-auth.guard';
import { RolesGuard } from '../../../auth/roles/roles.guard';

const mockAdministradoresService = {
  crearAdministrador: jest.fn(),
  obtenerAdministradores: jest.fn(),
  cambiarEstadoAdministrador: jest.fn(),
};

describe('AdministradoresController', () => {
  let controller: AdministradoresController;
  let service: AdministradoresService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdministradoresController],
      providers: [
        {
          provide: AdministradoresService,
          useValue: mockAdministradoresService,
        },
      ],
    })
    .overrideGuard(KeycloakAuthGuard)
    .useValue({ canActivate: jest.fn(() => true) })
    .overrideGuard(RolesGuard)
    .useValue({ canActivate: jest.fn(() => true) })
    .compile();

    controller = module.get<AdministradoresController>(AdministradoresController);
    service = module.get<AdministradoresService>(AdministradoresService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('crearAdministrador', () => {
    it('should create an administrator', async () => {
      const dto: CrearAdministradorDto = { email: 'test@test.com', nombre: 'Test', apellido: 'User', password: '123' };
      const expectedResult = { mensaje: 'Administrador creado correctamente' };
      mockAdministradoresService.crearAdministrador.mockResolvedValue(expectedResult);

      const result = await controller.crearAdministrador(dto);
      expect(result).toEqual(expectedResult);
      expect(service.crearAdministrador).toHaveBeenCalledWith(dto);
    });
  });

  describe('obtenerAdministradores', () => {
    it('should return a list of administrators', async () => {
      const filtro = { nombre: 'Test' };
      const expectedResult = [{ id: 1, nombre: 'Test' }];
      mockAdministradoresService.obtenerAdministradores.mockResolvedValue(expectedResult);

      const result = await controller.obtenerAdministradores(filtro);
      expect(result).toEqual(expectedResult);
      expect(service.obtenerAdministradores).toHaveBeenCalledWith(filtro);
    });
  });

  describe('cambiarEstadoAdministrador', () => {
    it('should update administrator state', async () => {
      const dto: CambiarEstadoUsuarioDto = { estado: 'INACTIVO' as any };
      const expectedResult = { usuarioId: 1, estado: 'INACTIVO' };
      mockAdministradoresService.cambiarEstadoAdministrador.mockResolvedValue(expectedResult);

      const result = await controller.cambiarEstadoAdministrador(1, dto);
      expect(result).toEqual(expectedResult);
      expect(service.cambiarEstadoAdministrador).toHaveBeenCalledWith(1, dto.estado);
    });
  });
});
