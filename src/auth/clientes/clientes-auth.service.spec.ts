import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { ClientesAuthService } from './clientes-auth.service';
import { ClienteJwtService } from './cliente-jwt.service';
import { GoogleTokenVerifier } from '../google/google-token-verifier.service';
import { ClientesRepository } from '../../modules/reservas/repository/clientes.repository';

describe('ClientesAuthService', () => {
  let service: ClientesAuthService;

  const googleTokenVerifier = { verificar: jest.fn() };
  const clientesRepository = { buscarOcrearPorGoogle: jest.fn() };
  const clienteJwtService = { firmar: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClientesAuthService,
        { provide: GoogleTokenVerifier, useValue: googleTokenVerifier },
        { provide: ClientesRepository, useValue: clientesRepository },
        { provide: ClienteJwtService, useValue: clienteJwtService },
      ],
    }).compile();

    service = module.get<ClientesAuthService>(ClientesAuthService);
    jest.clearAllMocks();
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
});
