import { Test, TestingModule } from '@nestjs/testing';
import { UsuariosRepository } from './usuarios.repository';
import { PrismaService } from '../../../prisma/prisma.service';

jest.mock('../../../../generated/prisma/enums', () => ({
  EstadoUsuario: { ACTIVO: 'ACTIVO', INACTIVO: 'INACTIVO' },
}));

const mockPrisma = {
  usuario: {
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
};

describe('UsuariosRepository', () => {
  let repository: UsuariosRepository;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsuariosRepository,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    repository = module.get<UsuariosRepository>(UsuariosRepository);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(repository).toBeDefined();
  });

  describe('crearUsuario', () => {
    it('should create a user', async () => {
      const data = { googleId: 'g-1', email: 'a@a.com', nombre: 'Juan', apellido: 'P', rol: 'BARBERO' as const };
      mockPrisma.usuario.create.mockResolvedValue({ id: 1, ...data });
      const result = await repository.crearUsuario(data);
      expect(mockPrisma.usuario.create).toHaveBeenCalledWith({ data });
      expect(result.id).toBe(1);
    });
  });

  describe('obtenerUsuarioPorId', () => {
    it('should find a user by id', async () => {
      mockPrisma.usuario.findUnique.mockResolvedValue({ id: 1 });
      const result = await repository.obtenerUsuarioPorId(1);
      expect(mockPrisma.usuario.findUnique).toHaveBeenCalledWith({
        where: { id: 1 },
        include: { administrador: true, barbero: true },
      });
      expect(result).toEqual({ id: 1 });
    });
  });

  describe('obtenerUsuarioPorGoogleId', () => {
    it('should find a user by googleId', async () => {
      mockPrisma.usuario.findUnique.mockResolvedValue({ id: 2, googleId: 'g-1' });
      const result = await repository.obtenerUsuarioPorGoogleId('g-1');
      expect(mockPrisma.usuario.findUnique).toHaveBeenCalledWith({
        where: { googleId: 'g-1' },
        include: { administrador: true, barbero: true },
      });
      expect(result.googleId).toBe('g-1');
    });
  });

  describe('obtenerUsuarioPorEmail', () => {
    it('should find a user by email', async () => {
      mockPrisma.usuario.findUnique.mockResolvedValue({ id: 3, email: 'test@test.com' });
      const result = await repository.obtenerUsuarioPorEmail('test@test.com');
      expect(mockPrisma.usuario.findUnique).toHaveBeenCalledWith({
        where: { email: 'test@test.com' },
        include: { administrador: true, barbero: true },
      });
      expect(result.email).toBe('test@test.com');
    });
  });

  describe('actualizarUsuario', () => {
    it('should update a user', async () => {
      mockPrisma.usuario.update.mockResolvedValue({ id: 1, nombre: 'Carlos' });
      const result = await repository.actualizarUsuario(1, { nombre: 'Carlos' });
      expect(mockPrisma.usuario.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { nombre: 'Carlos' },
      });
      expect(result.nombre).toBe('Carlos');
    });
  });

  describe('actualizarEstadoUsuario', () => {
    it('should update user status', async () => {
      mockPrisma.usuario.update.mockResolvedValue({ id: 1, estado: 'INACTIVO' });
      const result = await repository.actualizarEstadoUsuario(1, 'INACTIVO' as any);
      expect(mockPrisma.usuario.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { estado: 'INACTIVO' },
      });
      expect(result.estado).toBe('INACTIVO');
    });
  });

  describe('actualizarRol', () => {
    it('should update user rol', async () => {
      mockPrisma.usuario.update.mockResolvedValue({ id: 1, rol: 'ADMINISTRADOR' });
      const result = await repository.actualizarRol(1, 'ADMINISTRADOR');
      expect(mockPrisma.usuario.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { rol: 'ADMINISTRADOR' },
      });
      expect(result.rol).toBe('ADMINISTRADOR');
    });
  });
});
