import { Test, TestingModule } from '@nestjs/testing';
import {
  UnauthorizedException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ClientesAuthService } from './clientes-auth.service';
import { ClienteJwtService } from './cliente-jwt.service';
import { GoogleTokenVerifier } from '../google/google-token-verifier.service';
import { ClientesRepository } from '../../modules/reservas/repository/clientes.repository';
import { NegocioContextoService } from '../../modules/negocios/negocio-contexto.service';

describe('ClientesAuthService', () => {
  let service: ClientesAuthService;

  const googleTokenVerifier = { verificar: jest.fn() };
  const clientesRepository = {
    buscarOcrearPorGoogle: jest.fn(),
    obtenerPorId: jest.fn(),
    actualizarPerfil: jest.fn(),
  };
  const clienteJwtService = { firmar: jest.fn() };
  const contextoService = {
    obtenerContexto: jest.fn().mockReturnValue({ id: 10, slug: 'kyrios' }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClientesAuthService,
        { provide: GoogleTokenVerifier, useValue: googleTokenVerifier },
        { provide: ClientesRepository, useValue: clientesRepository },
        { provide: ClienteJwtService, useValue: clienteJwtService },
        { provide: NegocioContextoService, useValue: contextoService },
      ],
    }).compile();

    service = module.get<ClientesAuthService>(ClientesAuthService);
    jest.clearAllMocks();
    contextoService.obtenerContexto.mockReturnValue({
      id: 10,
      slug: 'kyrios',
    });
  });

  it('debe estar definido', () => {
    expect(service).toBeDefined();
  });

  it('da de alta (idempotente) al cliente y emite un token de cliente', async () => {
    googleTokenVerifier.verificar.mockResolvedValue({
      sub: 'google-sub',
      email: 'Ana@Gmail.com',
      email_verified: true,
      given_name: 'Ana',
      family_name: 'Pérez',
    });
    clientesRepository.buscarOcrearPorGoogle.mockResolvedValue({
      id: 7,
      nombre: 'Ana',
      apellido: 'Pérez',
      email: 'ana@gmail.com',
    });
    clienteJwtService.firmar.mockReturnValue('token-cliente');

    const resultado = await service.loginConGoogle('id-token');

    expect(clientesRepository.buscarOcrearPorGoogle).toHaveBeenCalledWith({
      googleId: 'google-sub',
      email: 'ana@gmail.com',
      nombre: 'Ana',
      apellido: 'Pérez',
    });
    expect(clienteJwtService.firmar).toHaveBeenCalledWith({
      clienteId: 7,
      email: 'ana@gmail.com',
      nombre: 'Ana',
      negocioId: 10,
    });
    expect(resultado).toEqual({
      accessToken: 'token-cliente',
      cliente: {
        id: 7,
        nombre: 'Ana',
        apellido: 'Pérez',
        email: 'ana@gmail.com',
      },
    });
  });

  it('rechaza si la cuenta ya está registrada en otra barbería (unicidad global de googleId)', async () => {
    googleTokenVerifier.verificar.mockResolvedValue({
      sub: 'google-sub',
      email: 'ana@gmail.com',
      email_verified: true,
      given_name: 'Ana',
    });
    clientesRepository.buscarOcrearPorGoogle.mockRejectedValue({
      code: 'P2002',
    });

    await expect(service.loginConGoogle('id-token')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('rechaza si el correo de Google no está verificado', async () => {
    googleTokenVerifier.verificar.mockResolvedValue({
      sub: 'google-sub',
      email: 'ana@gmail.com',
      email_verified: false,
    });

    await expect(service.loginConGoogle('id-token')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(clientesRepository.buscarOcrearPorGoogle).not.toHaveBeenCalled();
  });

  it('rechaza si el token no aporta correo', async () => {
    googleTokenVerifier.verificar.mockResolvedValue({ sub: 'google-sub' });

    await expect(service.loginConGoogle('id-token')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('propaga el 401 del verificador si el token de Google es inválido', async () => {
    googleTokenVerifier.verificar.mockRejectedValue(
      new UnauthorizedException('inválido'),
    );

    await expect(service.loginConGoogle('id-token')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  describe('obtenerPerfil', () => {
    it('devuelve el perfil del cliente si existe', async () => {
      clientesRepository.obtenerPorId.mockResolvedValue({
        id: 7,
        nombre: 'Ana',
        apellido: 'Pérez',
        email: 'ana@gmail.com',
        telefono: '3001234567',
      });

      const perfil = await service.obtenerPerfil(7);
      expect(perfil).toEqual({
        id: 7,
        nombre: 'Ana',
        apellido: 'Pérez',
        email: 'ana@gmail.com',
        telefono: '3001234567',
      });
    });

    it('lanza NotFoundException si el cliente no existe', async () => {
      clientesRepository.obtenerPorId.mockResolvedValue(null);

      await expect(service.obtenerPerfil(999)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('actualizarPerfil', () => {
    it('lanza NotFoundException si el cliente no existe al actualizar', async () => {
      clientesRepository.obtenerPorId.mockResolvedValue(null);

      await expect(
        service.actualizarPerfil(999, { nombre: 'Nuevo' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('actualiza perfil limpiando espacios y manejando valores nulos/vacíos', async () => {
      clientesRepository.obtenerPorId.mockResolvedValue({ id: 7 });
      clientesRepository.actualizarPerfil.mockResolvedValue({
        id: 7,
        nombre: 'Ana María',
        apellido: 'Gómez',
        telefono: '3119876543',
      });

      const resultado = await service.actualizarPerfil(7, {
        nombre: '  Ana María  ',
        apellido: '  Gómez  ',
        telefono: '  3119876543  ',
      });

      expect(clientesRepository.actualizarPerfil).toHaveBeenCalledWith(7, {
        nombre: 'Ana María',
        apellido: 'Gómez',
        telefono: '3119876543',
      });
      expect(resultado).toBeDefined();
    });

    it('asigna null a telefono y apellido si vienen vacíos', async () => {
      clientesRepository.obtenerPorId.mockResolvedValue({ id: 7 });
      clientesRepository.actualizarPerfil.mockResolvedValue({ id: 7 });

      await service.actualizarPerfil(7, {
        telefono: '',
        apellido: '',
      });

      expect(clientesRepository.actualizarPerfil).toHaveBeenCalledWith(7, {
        telefono: null,
        apellido: null,
        nombre: undefined,
      });
    });
  });
});
