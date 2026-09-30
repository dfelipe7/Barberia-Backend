import { Test, TestingModule } from '@nestjs/testing';
import { BarberosService } from './barberos.service';
import { KeycloakService } from '../../../auth/keycloak/keycloak.service';
import { UsuariosRepository } from '../repository/usuarios.repository';
import { BarberosRepository } from '../repository/barberos.repository';
import { UsuariosAuthorizationService } from './usuarios-authorization.service';
import { EstadoUsuario } from '../../../../generated/prisma/enums';
import { FiltroBarberosDto } from '../dto/dto-peticion/filtro-barberos.dto';

describe('BarberosService', () => {
  let service: BarberosService;
  let keycloakService: jest.Mocked<KeycloakService>;
  let usuariosRepository: jest.Mocked<UsuariosRepository>;
  let barberosRepository: jest.Mocked<BarberosRepository>;

  beforeEach(async () => {
    const mockKeycloakService = {
      asignarRol: jest.fn(),
      quitarRol: jest.fn(),
      cambiarEstadoUsuario: jest.fn(),
    };

    const mockUsuariosRepository = {
      obtenerUsuarioPorId: jest.fn(),
      obtenerUsuarioPorKeycloakId: jest.fn(),
      actualizarEstadoUsuario: jest.fn(),
    };

    const mockBarberosRepository = {
      actualizarEstadoBarbero: jest.fn(),
    };

    const mockAuthorizationService = {
      verificarPermisosCambioEstadoBarbero: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BarberosService,
        { provide: KeycloakService, useValue: mockKeycloakService },
        { provide: UsuariosRepository, useValue: mockUsuariosRepository },
        { provide: BarberosRepository, useValue: mockBarberosRepository },
        { provide: UsuariosAuthorizationService, useValue: mockAuthorizationService },
      ],
    }).compile();

    service = module.get<BarberosService>(BarberosService);
    keycloakService = module.get(KeycloakService) as any;
    usuariosRepository = module.get(UsuariosRepository) as any;
    barberosRepository = module.get(BarberosRepository) as any;
  });

  describe('cambiarEstadoBarbero (Fail-Closed)', () => {
    it('Debe bloquear la cuenta global (estado INACTIVO) si al quitar el rol de barbero el usuario queda sin ningún otro rol', async () => {
      const usuarioId = 1;
      const usuarioAutenticado = { sub: 'admin-uuid' };
      const dto = { estado: EstadoUsuario.INACTIVO };

      usuariosRepository.obtenerUsuarioPorId.mockResolvedValue({
        id: usuarioId,
        keycloakId: 'barbero-uuid',
        rol: 'BARBERO',
        barbero: { estado: 'ACTIVO' },
        administrador: null,
      } as any);

      usuariosRepository.obtenerUsuarioPorKeycloakId.mockResolvedValue({ id: 2 } as any);
      barberosRepository.actualizarEstadoBarbero.mockResolvedValue({} as any);

      await service.cambiarEstadoBarbero(usuarioId, dto, usuarioAutenticado);

      expect(keycloakService.quitarRol).toHaveBeenCalledWith('barbero-uuid', 'BARBERO');
      expect(keycloakService.cambiarEstadoUsuario).toHaveBeenCalledWith('barbero-uuid', false);
      expect(usuariosRepository.actualizarEstadoUsuario).toHaveBeenCalledWith(usuarioId, EstadoUsuario.INACTIVO);
      expect(barberosRepository.actualizarEstadoBarbero).toHaveBeenCalledWith(usuarioId, EstadoUsuario.INACTIVO);
    });

    it('Debe dejar la cuenta global intacta si el usuario al que se le quita el rol de barbero también tiene el rol de administrador', async () => {
      const usuarioId = 1;
      const usuarioAutenticado = { sub: 'admin-uuid' };
      const dto = { estado: EstadoUsuario.INACTIVO };

      usuariosRepository.obtenerUsuarioPorId.mockResolvedValue({
        id: usuarioId,
        keycloakId: 'barbero-admin-uuid',
        rol: 'BARBERO',
        barbero: { estado: 'ACTIVO' },
        administrador: { estado: 'ACTIVO' },
      } as any);

      usuariosRepository.obtenerUsuarioPorKeycloakId.mockResolvedValue({ id: 2 } as any);
      barberosRepository.actualizarEstadoBarbero.mockResolvedValue({} as any);

      await service.cambiarEstadoBarbero(usuarioId, dto, usuarioAutenticado);

      expect(keycloakService.quitarRol).toHaveBeenCalledWith('barbero-admin-uuid', 'BARBERO');
      expect(keycloakService.cambiarEstadoUsuario).not.toHaveBeenCalled();
      expect(usuariosRepository.actualizarEstadoUsuario).not.toHaveBeenCalled();
      expect(barberosRepository.actualizarEstadoBarbero).toHaveBeenCalledWith(usuarioId, EstadoUsuario.INACTIVO);
    });
  });

  describe('crearBarbero', () => {
    it('Debe crear el usuario barbero en Keycloak y MySQL correctamente', async () => {
      const dto = { email: 'barbero@test.com', password: '123', nombre: 'Barbero', apellido: 'Perez', telefono: '300', porcentajeComision: 50 };
      keycloakService.crearUsuario = jest.fn().mockResolvedValue('keycloak-id');
      usuariosRepository.obtenerUsuarioPorEmail = jest.fn().mockResolvedValue(null);
      usuariosRepository.crearUsuario = jest.fn().mockResolvedValue({ id: 99 } as any);
      barberosRepository.crearBarberoNuevo = jest.fn().mockResolvedValue({ id: 99 } as any);

      const result = await service.crearBarbero(dto);

      expect(keycloakService.crearUsuario).toHaveBeenCalledWith('barbero@test.com', '123', 'Barbero', 'Perez');
      expect(keycloakService.asignarRol).toHaveBeenCalledWith('keycloak-id', 'BARBERO');
      expect(usuariosRepository.crearUsuario).toHaveBeenCalled();
      expect(barberosRepository.crearBarberoNuevo).toHaveBeenCalled();
      expect(result.mensaje).toContain('creado correctamente');
    });
  });

  describe('obtenerBarberosCatalogo', () => {
    it('Debe retornar barberos en formato catálogo aplicando filtros si se especifican', async () => {
      const mockBarberosPrisma = [
        {
          id: 1,
          telefono: '3001234567',
          fotoUrl: '/uploads/foto.jpg',
          usuario: { nombre: 'Juan', apellido: 'Perez' },
        },
      ];
      barberosRepository.obtenerBarberosCatalogo = jest.fn().mockResolvedValue(mockBarberosPrisma as any);

      const filtro: FiltroBarberosDto = { nombre: 'Juan' };
      const resultado = await service.obtenerBarberosCatalogo(filtro);

      expect(barberosRepository.obtenerBarberosCatalogo).toHaveBeenCalledWith(filtro);
      expect(resultado).toHaveLength(1);
      expect(resultado[0]).toEqual({
        id: 1,
        nombre: 'Juan',
        apellido: 'Perez',
        telefono: '3001234567',
        fotoUrl: '/uploads/foto.jpg',
      });
    });
  });

  describe('obtenerBarberosGestion', () => {
    it('Debe retornar la lista completa de barberos para gestión mapeando estados global y de rol', async () => {
      const mockBarberosPrisma = [
        {
          id: 1,
          telefono: '3001234567',
          porcentajeComision: 40,
          estado: 'ACTIVO',
          fotoUrl: '/uploads/foto.jpg',
          usuario: {
            id: 10,
            nombre: 'Carlos',
            apellido: 'Gomez',
            email: 'carlos@barberia.com',
            rol: 'BARBERO',
            estado: 'ACTIVO',
            administrador: { estado: 'INACTIVO' },
          },
        },
      ];
      barberosRepository.obtenerBarberosGestion = jest.fn().mockResolvedValue(mockBarberosPrisma as any);

      const filtro: FiltroBarberosDto = { nombre: 'Carlos', estado: EstadoUsuario.ACTIVO };
      const resultado = await service.obtenerBarberosGestion(filtro);

      expect(barberosRepository.obtenerBarberosGestion).toHaveBeenCalledWith(filtro);
      expect(resultado).toHaveLength(1);
      expect(resultado[0]).toEqual({
        id: 10,
        nombre: 'Carlos',
        apellido: 'Gomez',
        email: 'carlos@barberia.com',
        telefono: '3001234567',
        porcentajeComision: 40,
        estado: 'ACTIVO',
        fotoUrl: '/uploads/foto.jpg',
        esAdministrador: false,
        esSuperAdmin: false,
        estadoAdmin: 'INACTIVO',
        estadoGlobal: 'ACTIVO',
      });
    });
  });
});
