import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { SesionPersonalService } from './sesion-personal.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NegocioRolesService } from '../../modules/negocios/service/negocio-roles.service';
import { NegociosRepository } from '../../modules/negocios/repository/negocios.repository';
import { NegocioContextoService } from '../../modules/negocios/negocio-contexto.service';
import { PersonalJwtService } from './personal-jwt.service';
import {
  SesionPersonal,
  extraerSesionPersonal,
  construirActorSesion,
} from './sesion-personal';

/**
 * Sesión de personal en el modelo MULTI-tenant (Fase 10).
 *
 * No existe sesión de plataforma: toda sesión está ligada a una barbería y sus
 * roles vienen de las MEMBRESÍAS de la persona en ese negocio.
 */
describe('SesionPersonalService', () => {
  let service: SesionPersonalService;

  const NEGOCIO = { id: 7, slug: 'kyrios-studio' };
  const OTRO_NEGOCIO = { id: 8, slug: 'barberia-demo-2' };

  const usuario = {
    id: 1,
    email: 'duvan@correo.com',
    nombre: 'Duvan',
    apellido: 'Pérez',
    // Valor global heredado: NO concede ningún privilegio.
    rol: 'PERSONAL',
    estado: 'ACTIVO',
  };

  const mockPersonalJwt = {
    firmar: jest.fn((_claims: Record<string, unknown>) => 'token-firmado'),
  };
  const mockRoles = { perfilOperativo: jest.fn() };
  const mockNegocios = {
    buscarActivoPorSlug: jest.fn(),
    listar: jest.fn(),
  };
  const mockPrisma = {
    usuario: { findUnique: jest.fn() },
  };
  const mockContexto = { obtenerContexto: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();

    mockPersonalJwt.firmar.mockReturnValue('token-firmado');
    mockRoles.perfilOperativo.mockResolvedValue({
      roles: ['SUPERADMIN'],
      fotoUrl: null,
    });
    mockNegocios.buscarActivoPorSlug.mockImplementation(async (slug: string) =>
      slug === NEGOCIO.slug ? NEGOCIO : OTRO_NEGOCIO,
    );
    mockPrisma.usuario.findUnique.mockResolvedValue(usuario);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SesionPersonalService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: NegocioRolesService, useValue: mockRoles },
        { provide: NegociosRepository, useValue: mockNegocios },
        { provide: NegocioContextoService, useValue: mockContexto },
        { provide: PersonalJwtService, useValue: mockPersonalJwt },
      ],
    }).compile();

    service = module.get<SesionPersonalService>(SesionPersonalService);
  });

  it('debe estar definido', () => {
    expect(service).toBeDefined();
  });

  describe('emitirParaNegocio', () => {
    it('emite una sesión ligada al negocio con los roles efectivos', () => {
      const resultado = service.emitirParaNegocio(
        usuario,
        NEGOCIO,
        ['SUPERADMIN'],
        null,
      );

      expect(resultado.negocio).toEqual(NEGOCIO);
      expect(resultado.usuario.roles).toEqual(['SUPERADMIN']);

      const claims = mockPersonalJwt.firmar.mock.calls[0][0] as Record<
        string,
        unknown
      >;
      expect(claims.negocioId).toBe(NEGOCIO.id);
      expect(claims.ambito).toBe('NEGOCIO');
      expect(claims.superadmin).toBe(true);
    });

    it('NO marca superadmin si el rol efectivo no lo es', () => {
      service.emitirParaNegocio(usuario, NEGOCIO, ['ADMINISTRADOR'], null);

      const claims = mockPersonalJwt.firmar.mock.calls[0][0] as Record<
        string,
        unknown
      >;
      expect(claims.superadmin).toBe(false);
    });

    it('el rol global de la persona NO añade SUPERADMIN a la sesión', () => {
      const globalSuperadmin = { ...usuario, rol: 'SUPERADMIN' };

      service.emitirParaNegocio(
        globalSuperadmin,
        NEGOCIO,
        ['ADMINISTRADOR'],
        null,
      );

      const claims = mockPersonalJwt.firmar.mock.calls[0][0] as Record<
        string,
        unknown
      >;
      expect(claims.roles).toEqual(['ADMINISTRADOR']);
      expect(claims.superadmin).toBe(false);
    });
  });

  describe('cambiarNegocio', () => {
    const sesion: SesionPersonal = {
      id: 1,
      email: usuario.email,
      roles: ['SUPERADMIN'],
      negocioId: NEGOCIO.id,
      negocioSlug: NEGOCIO.slug,
      ambito: 'NEGOCIO',
      superadmin: true,
      estado: 'ACTIVO',
      fotoUrl: null,
    };

    it('cambia de negocio si la persona tiene membresía en el destino', async () => {
      mockRoles.perfilOperativo.mockResolvedValue({
        roles: ['SUPERADMIN'],
        fotoUrl: null,
      });

      const resultado = await service.cambiarNegocio(sesion, OTRO_NEGOCIO.slug);

      expect(resultado.negocio).toEqual(OTRO_NEGOCIO);
    });

    it('un SUPERADMIN SIN membresía en el destino NO puede cambiar de negocio', async () => {
      mockRoles.perfilOperativo.mockResolvedValue({ roles: [], fotoUrl: null });

      await expect(
        service.cambiarNegocio(sesion, OTRO_NEGOCIO.slug),
      ).rejects.toThrow(ForbiddenException);
    });

    it('el cambio se registra en la auditoría', async () => {
      mockRoles.perfilOperativo.mockResolvedValue({
        roles: ['ADMINISTRADOR'],
        fotoUrl: null,
      });

      const spy = jest.spyOn(service, 'auditarCambioNegocio');

      await service.cambiarNegocio(sesion, OTRO_NEGOCIO.slug);

      expect(spy).toHaveBeenCalledWith(usuario.id, OTRO_NEGOCIO);
    });
  });

  describe('renovar', () => {
    it('recalcula los roles: revocar la membresía invalida la renovación', async () => {
      mockRoles.perfilOperativo.mockResolvedValue({ roles: [], fotoUrl: null });

      await expect(
        service.renovar(
          {
            id: 1,
            email: usuario.email,
            roles: ['SUPERADMIN'],
            negocioId: NEGOCIO.id,
            negocioSlug: NEGOCIO.slug,
            ambito: 'NEGOCIO',
            superadmin: true,
            estado: 'ACTIVO',
            fotoUrl: null,
          },
          usuario,
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('claims (extraerSesionPersonal / construirActorSesion)', () => {
    it('el carácter superadmin se DERIVA de los roles, no del claim recibido', () => {
      const sesion = extraerSesionPersonal({
        id: 1,
        roles: ['ADMINISTRADOR'],
        superadmin: true,
        negocioId: 7,
        negocioSlug: 'kyrios-studio',
        ambito: 'PLATAFORMA',
      });

      expect(sesion.superadmin).toBe(false);
      expect(sesion.ambito).toBe('NEGOCIO');
    });

    it('una sesión con el rol SUPERADMIN se reconoce como tal', () => {
      const sesion = extraerSesionPersonal({
        id: 1,
        roles: ['SUPERADMIN'],
        negocioId: 7,
        negocioSlug: 'kyrios-studio',
      });

      expect(sesion.superadmin).toBe(true);
    });

    it('el actor también deriva el carácter superadmin de los roles', () => {
      const actor = construirActorSesion({
        id: 1,
        roles: ['ADMINISTRADOR'],
        superadmin: true,
        negocioId: 7,
      });

      expect(actor.superadmin).toBe(false);
      expect(actor.negocioId).toBe(7);
    });
  });
});
