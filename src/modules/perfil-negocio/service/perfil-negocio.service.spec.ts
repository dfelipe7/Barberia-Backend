import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { PerfilNegocioService } from './perfil-negocio.service';
import { PerfilNegocioRepository } from '../repository/perfil-negocio.repository';
import { NegocioContextoService } from '../../negocios/negocio-contexto.service';
import { NegocioAislamientoService } from '../../negocios/negocio-aislamiento.service';
import { NegociosRepository } from '../../negocios/repository/negocios.repository';
import { AlmacenamientoPerfilService } from './almacenamiento-perfil.service';
import { RECURSOS_PERFIL } from '../perfil-negocio.constants';

describe('PerfilNegocioService', () => {
  let service: PerfilNegocioService;
  let repository: jest.Mocked<PerfilNegocioRepository>;
  let contextoService: jest.Mocked<NegocioContextoService>;
  let aislamientoService: jest.Mocked<NegocioAislamientoService>;
  let negociosRepository: jest.Mocked<NegociosRepository>;
  let almacenamiento: jest.Mocked<AlmacenamientoPerfilService>;

  const mockContexto = { id: 1, slug: 'kyrios', nombre: 'Kyrios' };
  const mockNegocio = { id: 1, slug: 'kyrios', nombre: 'Kyrios Barber' } as any;

  const mockPerfil = {
    id: 1,
    negocioId: 1,
    frasePrincipal: 'La mejor barbería',
    temaKey: 'clasico-azul',
    faviconUrl: '/uploads/negocios/1/perfil/fav.svg',
    bannerUrl: '/uploads/negocios/1/perfil/banner.png',
    logoBlancoUrl: null,
    logoNegroUrl: null,
    direccion: 'Calle 10 # 5-20',
    ciudad: 'Popayán',
    departamento: 'Cauca',
    referencia: 'Frente al parque',
    latitud: '2.4419',
    longitud: '-76.6063',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-02'),
  };

  beforeEach(async () => {
    const mockRepo = {
      buscarPorNegocio: jest.fn().mockResolvedValue(mockPerfil),
      guardar: jest.fn().mockResolvedValue(mockPerfil),
    };

    const mockCtx = {
      obtenerContexto: jest.fn().mockReturnValue(mockContexto),
    };

    const mockAislamiento = {
      ejecutarEnNegocio: jest.fn().mockImplementation((_, fn) => fn()),
    };

    const mockNegociosRepo = {
      buscarPorId: jest.fn().mockResolvedValue(mockNegocio),
    };

    const mockAlm = {
      guardar: jest.fn().mockResolvedValue('/uploads/negocios/1/perfil/nuevo.png'),
      eliminar: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PerfilNegocioService,
        { provide: PerfilNegocioRepository, useValue: mockRepo },
        { provide: NegocioContextoService, useValue: mockCtx },
        { provide: NegocioAislamientoService, useValue: mockAislamiento },
        { provide: NegociosRepository, useValue: mockNegociosRepo },
        { provide: AlmacenamientoPerfilService, useValue: mockAlm },
      ],
    }).compile();

    service = module.get<PerfilNegocioService>(PerfilNegocioService);
    repository = module.get(PerfilNegocioRepository);
    contextoService = module.get(NegocioContextoService);
    aislamientoService = module.get(NegocioAislamientoService);
    negociosRepository = module.get(NegociosRepository);
    almacenamiento = module.get(AlmacenamientoPerfilService);
  });

  it('debe estar definido', () => {
    expect(service).toBeDefined();
  });

  describe('contexto y datosNegocio', () => {
    it('lanza ForbiddenException si no hay contexto de negocio', async () => {
      contextoService.obtenerContexto.mockReturnValue(undefined);
      await expect(service.obtenerPerfilPublico()).rejects.toThrow(ForbiddenException);
    });

    it('lanza NotFoundException si el negocio no existe en la BD', async () => {
      negociosRepository.buscarPorId.mockResolvedValue(null);
      await expect(service.obtenerPerfilPublico()).rejects.toThrow(NotFoundException);
    });
  });

  describe('obtenerPerfilPublico', () => {
    it('devuelve el perfil mapeado cuando existe', async () => {
      const res = await service.obtenerPerfilPublico();
      expect(res.configurado).toBe(true);
      expect(res.negocio).toEqual({ nombre: 'Kyrios Barber', slug: 'kyrios' });
      expect(res.frasePrincipal).toBe('La mejor barbería');
      expect(res.latitud).toBe(2.4419);
      expect(res.longitud).toBe(-76.6063);
      expect(res.mapsUrl).toContain('2.4419,-76.6063');
    });

    it('devuelve configurado=false y campos nulos si no existe perfil', async () => {
      repository.buscarPorNegocio.mockResolvedValue(null);
      const res = await service.obtenerPerfilPublico();
      expect(res.configurado).toBe(false);
      expect(res.frasePrincipal).toBeNull();
      expect(res.mapsUrl).toBeNull();
    });

    it('maneja coordenadas no numéricas correctamente', async () => {
      repository.buscarPorNegocio.mockResolvedValue({
        ...mockPerfil,
        latitud: 'invalido',
        longitud: null,
      });
      const res = await service.obtenerPerfilPublico();
      expect(res.latitud).toBeNull();
      expect(res.longitud).toBeNull();
      expect(res.mapsUrl).toBeNull();
    });
  });

  describe('obtenerPerfilGestion', () => {
    it('devuelve la vista administrativa con auditoria y bloques', async () => {
      const res = await service.obtenerPerfilGestion();
      expect(res.configurado).toBe(true);
      expect(res.contenido.frasePrincipal).toBe('La mejor barbería');
      expect(res.ubicacion.ciudad).toBe('Popayán');
      expect(res.referenciasArchivo.faviconUrl).toBe('/uploads/negocios/1/perfil/fav.svg');
      expect(res.creadoEn).toEqual(mockPerfil.createdAt);
    });

    it('devuelve fechas por defecto si el perfil es nulo', async () => {
      repository.buscarPorNegocio.mockResolvedValue(null);
      const res = await service.obtenerPerfilGestion();
      expect(res.configurado).toBe(false);
      expect(res.creadoEn).toEqual(new Date(0));
    });
  });

  describe('obtenerDireccionComercial', () => {
    it('devuelve la direccion recortada si existe', async () => {
      const dir = await service.obtenerDireccionComercial();
      expect(dir).toBe('Calle 10 # 5-20');
    });

    it('devuelve string vacio si perfil o direccion no existen', async () => {
      repository.buscarPorNegocio.mockResolvedValue(null);
      expect(await service.obtenerDireccionComercial()).toBe('');

      repository.buscarPorNegocio.mockResolvedValue({ ...mockPerfil, direccion: null });
      expect(await service.obtenerDireccionComercial()).toBe('');
    });
  });

  describe('actualizarPerfil', () => {
    it('guarda los datos de contenido y ubicacion', async () => {
      const dto = {
        frasePrincipal: 'Cortes premium',
        temaKey: 'clasico-azul',
        direccion: 'Cra 4 # 1-1',
        ciudad: 'Cali',
        departamento: 'Valle',
        referencia: 'Edificio Torre',
        latitud: 3.45,
        longitud: -76.53,
      };

      const res = await service.actualizarPerfil(dto);
      expect(aislamientoService.ejecutarEnNegocio).toHaveBeenCalled();
      expect(repository.guardar).toHaveBeenCalledWith(1, {
        frasePrincipal: 'Cortes premium',
        temaKey: 'clasico-azul',
        direccion: 'Cra 4 # 1-1',
        ciudad: 'Cali',
        departamento: 'Valle',
        referencia: 'Edificio Torre',
        latitud: 3.45,
        longitud: -76.53,
      });
      expect(res.configurado).toBe(true);
    });

    it('establece null en campos omitidos', async () => {
      await service.actualizarPerfil({});
      expect(repository.guardar).toHaveBeenCalledWith(1, {
        frasePrincipal: null,
        direccion: null,
        ciudad: null,
        departamento: null,
        referencia: null,
        latitud: null,
        longitud: null,
      });
    });
  });

  describe('actualizarReferencias', () => {
    it('acepta URLs externas y rutas propias del negocio', async () => {
      const dto = {
        faviconUrl: 'https://cdn.externo.com/fav.ico',
        bannerUrl: '/uploads/negocios/1/perfil/banner-nuevo.png',
      };

      await service.actualizarReferencias(dto);
      expect(repository.guardar).toHaveBeenCalledWith(1, {
        faviconUrl: 'https://cdn.externo.com/fav.ico',
        bannerUrl: '/uploads/negocios/1/perfil/banner-nuevo.png',
        logoBlancoUrl: null,
        logoNegroUrl: null,
      });
    });

    it('rechaza rutas de otro negocio', async () => {
      const dto = {
        faviconUrl: '/uploads/negocios/2/perfil/fav.svg',
      };

      await expect(service.actualizarReferencias(dto)).rejects.toThrow(BadRequestException);
    });

    it('rechaza rutas con dos puntos ..', async () => {
      const dto = {
        faviconUrl: '/uploads/negocios/1/perfil/../secreto.txt',
      };

      await expect(service.actualizarReferencias(dto)).rejects.toThrow(BadRequestException);
    });
  });

  describe('subirRecurso', () => {
    it('rechaza si no se proporciona archivo', async () => {
      await expect(service.subirRecurso(RECURSOS_PERFIL.FAVICON, undefined)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rechaza si el archivo esta vacio', async () => {
      const file = { buffer: Buffer.alloc(0) } as Express.Multer.File;
      await expect(service.subirRecurso(RECURSOS_PERFIL.FAVICON, file)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rechaza si el archivo supera el limite de bytes', async () => {
      const file = { buffer: Buffer.alloc(300 * 1024) } as Express.Multer.File; // Favicon max 256KB
      await expect(service.subirRecurso(RECURSOS_PERFIL.FAVICON, file)).rejects.toThrow(
        PayloadTooLargeException,
      );
    });

    it('rechaza si el tipo de archivo no coincide con el recurso (ej: PNG subido a favicon SVG)', async () => {
      // PNG header: 89 50 4e 47 0d 0a 1a 0a
      const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const file = { buffer: pngHeader } as Express.Multer.File;

      await expect(service.subirRecurso(RECURSOS_PERFIL.FAVICON, file)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('guarda SVG valido, sanea contenido, actualiza BD y elimina archivo previo', async () => {
      const svgBuffer = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><circle r="5"/></svg>');
      const file = { buffer: svgBuffer } as Express.Multer.File;

      const res = await service.subirRecurso(RECURSOS_PERFIL.FAVICON, file);

      expect(almacenamiento.guardar).toHaveBeenCalled();
      expect(repository.guardar).toHaveBeenCalled();
      expect(almacenamiento.eliminar).toHaveBeenCalledWith(1, mockPerfil.faviconUrl);
      expect(res.configurado).toBe(true);
    });

    it('guarda PNG valido para BANNER', async () => {
      const pngBuffer = Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.from([0x00, 0x00, 0x00, 0x0d]),
        Buffer.from('IHDR'),
        Buffer.alloc(16),
      ]);
      const file = { buffer: pngBuffer } as Express.Multer.File;

      await service.subirRecurso(RECURSOS_PERFIL.BANNER, file);
      expect(almacenamiento.guardar).toHaveBeenCalled();
    });

    it('hace rollback del archivo nuevo si la actualizacion en BD falla', async () => {
      const svgBuffer = Buffer.from('<svg><rect/></svg>');
      const file = { buffer: svgBuffer } as Express.Multer.File;

      repository.guardar.mockRejectedValueOnce(new Error('DB Error'));

      await expect(service.subirRecurso(RECURSOS_PERFIL.FAVICON, file)).rejects.toThrow(
        'DB Error',
      );
      expect(almacenamiento.eliminar).toHaveBeenCalledWith(1, '/uploads/negocios/1/perfil/nuevo.png');
    });
  });

  describe('eliminarRecurso', () => {
    it('limpia referencia en BD y elimina archivo fisico', async () => {
      await service.eliminarRecurso(RECURSOS_PERFIL.BANNER);

      expect(repository.guardar).toHaveBeenCalledWith(1, { bannerUrl: null });
      expect(almacenamiento.eliminar).toHaveBeenCalledWith(1, mockPerfil.bannerUrl);
    });
  });
});
