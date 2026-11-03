import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TipoRedSocial } from '../../../../generated/prisma/enums';
import { NegocioContextoService } from '../../negocios/negocio-contexto.service';
import { RedesSocialesRepository } from '../repository/redes-sociales.repository';
import { RedesSocialesService } from './redes-sociales.service';

// ---------------------------------------------------------------------------
// Helpers de mocks
// ---------------------------------------------------------------------------

function crearContexto(id = 1) {
  return { id, slug: `negocio-${id}`, nombre: `Negocio ${id}` };
}

function crearFila(
  overrides: Partial<{
    id: number;
    tipo: TipoRedSocial;
    nombre: string;
    url: string;
    orden: number;
    activo: boolean;
  }> = {},
) {
  return {
    id: 1,
    tipo: TipoRedSocial.INSTAGRAM,
    nombre: 'Instagram',
    url: 'https://www.instagram.com/kyrios',
    orden: 0,
    activo: true,
    ...overrides,
  };
}

describe('RedesSocialesService', () => {
  let service: RedesSocialesService;
  let redesRepo: jest.Mocked<RedesSocialesRepository>;
  let contextoService: jest.Mocked<NegocioContextoService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RedesSocialesService,
        {
          provide: RedesSocialesRepository,
          useValue: {
            listarPorNegocio: jest.fn(),
            reemplazar: jest.fn(),
            obtenerPorId: jest.fn(),
            actualizar: jest.fn(),
            desactivar: jest.fn(),
            activar: jest.fn(),
            existeOtraActivaConMismaClave: jest.fn(),
          },
        },
        {
          provide: NegocioContextoService,
          useValue: {
            obtenerContexto: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(RedesSocialesService);
    redesRepo = module.get(RedesSocialesRepository);
    contextoService = module.get(NegocioContextoService);
  });

  // -------------------------------------------------------------------------
  // contextoRequerido
  // -------------------------------------------------------------------------

  describe('cuando no hay contexto de negocio', () => {
    beforeEach(() => {
      contextoService.obtenerContexto.mockReturnValue(undefined);
    });

    it('listar lanza ForbiddenException', async () => {
      await expect(service.listar()).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('reemplazar lanza ForbiddenException', async () => {
      await expect(service.reemplazar([])).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('actualizar lanza ForbiddenException', async () => {
      await expect(service.actualizar(1, {})).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('desactivar lanza ForbiddenException', async () => {
      await expect(service.desactivar(1)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('activar lanza ForbiddenException', async () => {
      await expect(service.activar(1)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  // -------------------------------------------------------------------------
  // listar
  // -------------------------------------------------------------------------

  describe('listar', () => {
    beforeEach(() => {
      contextoService.obtenerContexto.mockReturnValue(crearContexto());
    });

    it('devuelve el listado mapeado al DTO', async () => {
      const fila = crearFila();
      redesRepo.listarPorNegocio.mockResolvedValue([fila]);

      const resultado = await service.listar();

      expect(resultado).toHaveLength(1);
      expect(resultado[0]).toMatchObject({
        id: fila.id,
        tipo: fila.tipo,
        nombre: fila.nombre,
        url: fila.url,
        orden: fila.orden,
        activo: fila.activo,
      });
      expect(redesRepo.listarPorNegocio).toHaveBeenCalledWith(1);
    });

    it('devuelve array vacío si no hay redes', async () => {
      redesRepo.listarPorNegocio.mockResolvedValue([]);
      const resultado = await service.listar();
      expect(resultado).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // reemplazar
  // -------------------------------------------------------------------------

  describe('reemplazar', () => {
    beforeEach(() => {
      contextoService.obtenerContexto.mockReturnValue(crearContexto());
      redesRepo.reemplazar.mockResolvedValue([]);
    });

    it('lanza BadRequestException si tipo OTRO no trae nombre', async () => {
      await expect(
        service.reemplazar([
          { tipo: TipoRedSocial.OTRO, url: 'https://otro.com', orden: 0 },
        ]),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('lanza BadRequestException si hay dos redes del mismo tipo predefinido', async () => {
      await expect(
        service.reemplazar([
          {
            tipo: TipoRedSocial.INSTAGRAM,
            url: 'https://instagram.com/a',
            orden: 0,
          },
          {
            tipo: TipoRedSocial.INSTAGRAM,
            url: 'https://instagram.com/b',
            orden: 1,
          },
        ]),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('fuerza el nombre canónico para redes predefinidas', async () => {
      await service.reemplazar([
        {
          tipo: TipoRedSocial.INSTAGRAM,
          url: 'https://instagram.com/kyrios',
          nombre: 'otro-nombre',
          orden: 0,
        },
      ]);

      expect(redesRepo.reemplazar).toHaveBeenCalledWith(
        1,
        expect.arrayContaining([
          expect.objectContaining({ nombre: 'Instagram' }),
        ]),
      );
    });

    it('usa el nombre enviado para tipo OTRO', async () => {
      await service.reemplazar([
        {
          tipo: TipoRedSocial.OTRO,
          nombre: 'Mi blog',
          url: 'https://blog.com',
          orden: 0,
        },
      ]);

      expect(redesRepo.reemplazar).toHaveBeenCalledWith(
        1,
        expect.arrayContaining([
          expect.objectContaining({ nombre: 'Mi blog' }),
        ]),
      );
    });

    it('usa orden 0 si no se envía', async () => {
      await service.reemplazar([
        { tipo: TipoRedSocial.TIKTOK, url: 'https://tiktok.com/@kyrios' },
      ]);

      expect(redesRepo.reemplazar).toHaveBeenCalledWith(
        1,
        expect.arrayContaining([expect.objectContaining({ orden: 0 })]),
      );
    });

    it('reemplazar con una red ya desactivada y mismo (tipo, nombre) → se reactiva, mismo id', async () => {
      const redReactivada = crearFila({
        id: 42,
        tipo: TipoRedSocial.TIKTOK,
        nombre: 'TikTok',
        activo: true,
      });
      redesRepo.reemplazar.mockResolvedValue([redReactivada]);

      const resultado = await service.reemplazar([
        { tipo: TipoRedSocial.TIKTOK, url: 'https://tiktok.com/@kyrios' },
      ]);

      expect(resultado).toHaveLength(1);
      expect(resultado[0].id).toBe(42);
      expect(resultado[0].activo).toBe(true);
    });

    it('reemplazar desactiva las ausentes delegando en el repositorio', async () => {
      redesRepo.reemplazar.mockResolvedValue([]);

      await service.reemplazar([
        { tipo: TipoRedSocial.FACEBOOK, url: 'https://facebook.com/kyrios' },
      ]);

      expect(redesRepo.reemplazar).toHaveBeenCalledWith(1, [
        {
          tipo: TipoRedSocial.FACEBOOK,
          nombre: 'Facebook',
          url: 'https://facebook.com/kyrios',
          orden: 0,
        },
      ]);
    });
  });

  // -------------------------------------------------------------------------
  // actualizar (Casos 1 al 7)
  // -------------------------------------------------------------------------

  describe('actualizar', () => {
    beforeEach(() => {
      contextoService.obtenerContexto.mockReturnValue(crearContexto());
    });

    it('actualizar cambia url de una red predefinida → OK, nombre no se toca', async () => {
      const fila = crearFila({
        tipo: TipoRedSocial.INSTAGRAM,
        nombre: 'Instagram',
      });
      const filaActualizada = {
        ...fila,
        url: 'https://instagram.com/kyrios_nuevo',
      };
      redesRepo.obtenerPorId.mockResolvedValue(fila);
      redesRepo.actualizar.mockResolvedValue(filaActualizada);

      const res = await service.actualizar(1, {
        url: 'https://instagram.com/kyrios_nuevo',
      });
      expect(res.url).toBe('https://instagram.com/kyrios_nuevo');
      expect(res.nombre).toBe('Instagram');
      expect(redesRepo.actualizar).toHaveBeenCalledWith(1, 1, {
        url: 'https://instagram.com/kyrios_nuevo',
      });
    });

    it('actualizar intenta cambiar nombre de una predefinida → 400 con mensaje "Solo las redes de tipo OTRO"', async () => {
      redesRepo.obtenerPorId.mockResolvedValue(
        crearFila({ tipo: TipoRedSocial.INSTAGRAM }),
      );
      await expect(
        service.actualizar(1, { nombre: 'Nuevo Nombre' }),
      ).rejects.toThrow('Solo las redes de tipo OTRO pueden cambiar de nombre.');
    });

    it('actualizar cambia nombre de una OTRO sin colisión → OK', async () => {
      const fila = crearFila({ tipo: TipoRedSocial.OTRO, nombre: 'Mi Canal' });
      const filaActualizada = { ...fila, nombre: 'Canal Oficial' };
      redesRepo.obtenerPorId.mockResolvedValue(fila);
      redesRepo.existeOtraActivaConMismaClave.mockResolvedValue(false);
      redesRepo.actualizar.mockResolvedValue(filaActualizada);

      const res = await service.actualizar(1, { nombre: 'Canal Oficial' });
      expect(res.nombre).toBe('Canal Oficial');
    });

    it('actualizar cambia nombre de una OTRO con colisión → 409', async () => {
      const fila = crearFila({ tipo: TipoRedSocial.OTRO, nombre: 'Blog' });
      redesRepo.obtenerPorId.mockResolvedValue(fila);
      redesRepo.existeOtraActivaConMismaClave.mockResolvedValue(true);

      await expect(
        service.actualizar(1, { nombre: 'Blog Colision' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('actualizar con id inexistente → 404', async () => {
      redesRepo.obtenerPorId.mockResolvedValue(null);
      await expect(
        service.actualizar(99, { url: 'https://nuevo.com' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('actualizar con body vacío → 400', async () => {
      redesRepo.obtenerPorId.mockResolvedValue(crearFila());
      await expect(service.actualizar(1, {})).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('actualizar con orden → OK', async () => {
      const fila = crearFila({ orden: 0 });
      const filaActualizada = { ...fila, orden: 5 };
      redesRepo.obtenerPorId.mockResolvedValue(fila);
      redesRepo.actualizar.mockResolvedValue(filaActualizada);

      const res = await service.actualizar(1, { orden: 5 });
      expect(res.orden).toBe(5);
      expect(redesRepo.actualizar).toHaveBeenCalledWith(1, 1, { orden: 5 });
    });
  });

  // -------------------------------------------------------------------------
  // desactivar (Casos 8 al 10)
  // -------------------------------------------------------------------------

  describe('desactivar', () => {
    beforeEach(() => {
      contextoService.obtenerContexto.mockReturnValue(crearContexto());
    });

    it('desactivar de una activa → activo: false', async () => {
      const fila = crearFila({ activo: true });
      const filaDesactivada = { ...fila, activo: false };
      redesRepo.obtenerPorId.mockResolvedValue(fila);
      redesRepo.desactivar.mockResolvedValue(filaDesactivada);

      const res = await service.desactivar(1);
      expect(res.activo).toBe(false);
      expect(redesRepo.desactivar).toHaveBeenCalledWith(1, 1);
    });

    it('desactivar de una ya desactivada → idempotente, devuelve la fila tal cual sin llamar a desactivar del repo', async () => {
      const fila = crearFila({ activo: false });
      redesRepo.obtenerPorId.mockResolvedValue(fila);

      const res = await service.desactivar(1);
      expect(res.activo).toBe(false);
      expect(redesRepo.desactivar).not.toHaveBeenCalled();
    });

    it('desactivar con id inexistente → 404', async () => {
      redesRepo.obtenerPorId.mockResolvedValue(null);
      await expect(service.desactivar(999)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  // -------------------------------------------------------------------------
  // activar (Casos 11 al 14)
  // -------------------------------------------------------------------------

  describe('activar', () => {
    beforeEach(() => {
      contextoService.obtenerContexto.mockReturnValue(crearContexto());
    });

    it('activar de una desactivada sin colisión → activo: true', async () => {
      const fila = crearFila({ activo: false });
      const filaActiva = { ...fila, activo: true };
      redesRepo.obtenerPorId.mockResolvedValue(fila);
      redesRepo.existeOtraActivaConMismaClave.mockResolvedValue(false);
      redesRepo.activar.mockResolvedValue(filaActiva);

      const res = await service.activar(1);
      expect(res.activo).toBe(true);
      expect(redesRepo.activar).toHaveBeenCalledWith(1, 1);
    });

    it('activar de una ya activa → idempotente', async () => {
      const fila = crearFila({ activo: true });
      redesRepo.obtenerPorId.mockResolvedValue(fila);

      const res = await service.activar(1);
      expect(res.activo).toBe(true);
      expect(redesRepo.activar).not.toHaveBeenCalled();
    });

    it('activar de una desactivada con colisión → 409', async () => {
      const fila = crearFila({
        tipo: TipoRedSocial.OTRO,
        nombre: 'Blog',
        activo: false,
      });
      redesRepo.obtenerPorId.mockResolvedValue(fila);
      redesRepo.existeOtraActivaConMismaClave.mockResolvedValue(true);

      await expect(service.activar(1)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('activar con id inexistente → 404', async () => {
      redesRepo.obtenerPorId.mockResolvedValue(null);
      await expect(service.activar(99)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
