import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import { NegocioContextoService } from '../negocio-contexto.service';
import { NegociosRepository } from '../repository/negocios.repository';
import { NegocioResolucionService } from '../service/negocio-resolucion.service';

const crearServicio = (
  config: Record<string, string | undefined> = {},
  negocios: Array<{ id: number; slug: string }> = [],
) => {
  const configService = {
    get: jest.fn((clave: string) => config[clave]),
  } as unknown as ConfigService;

  const buscarActivoPorSlug = jest.fn((slug: string) =>
    Promise.resolve(negocios.find((negocio) => negocio.slug === slug) ?? null),
  );

  const repository = {
    buscarActivoPorSlug,
  } as unknown as NegociosRepository;

  const contextoService = new NegocioContextoService();

  const service = new NegocioResolucionService(
    configService,
    repository,
    contextoService,
  );

  return {
    service,
    repository,
    contextoService,
    configService,
    buscarActivoPorSlug,
  };
};

describe('NegocioResolucionService', () => {
  it('debe estar definido', () => {
    const { service } = crearServicio();
    expect(service).toBeDefined();
  });

  describe('extracción del slug desde el subdominio', () => {
    it('resuelve el slug cuando el host pertenece al dominio base', () => {
      const { service } = crearServicio({
        NEGOCIO_DOMINIO_BASE: 'barberia.com',
      });

      expect(
        service.extraerSlugCandidato({ hostname: 'acme.barberia.com' }),
      ).toEqual({ slug: 'acme', origen: 'SUBDOMINIO' });
    });

    it('no resuelve nada si el dominio base no está configurado', () => {
      const { service } = crearServicio();

      expect(
        service.extraerSlugCandidato({ hostname: 'acme.barberia.com' }),
      ).toBeNull();
    });

    it('no resuelve nada si el host no pertenece al dominio base', () => {
      const { service } = crearServicio({
        NEGOCIO_DOMINIO_BASE: 'barberia.com',
      });

      expect(
        service.extraerSlugCandidato({ hostname: 'acme.otrodominio.com' }),
      ).toBeNull();
    });

    it('descarta subdominios con varios niveles', () => {
      const { service } = crearServicio({
        NEGOCIO_DOMINIO_BASE: 'barberia.com',
      });

      expect(
        service.extraerSlugCandidato({ hostname: 'a.b.barberia.com' }),
      ).toBeNull();
    });

    it('descarta subdominios con formato inválido', () => {
      const { service } = crearServicio({
        NEGOCIO_DOMINIO_BASE: 'barberia.com',
      });

      expect(
        service.extraerSlugCandidato({ hostname: 'ACME!.barberia.com' }),
      ).toBeNull();
    });

    it('normaliza a minúsculas el slug del subdominio', () => {
      const { service } = crearServicio({
        NEGOCIO_DOMINIO_BASE: 'barberia.com',
      });

      expect(
        service.extraerSlugCandidato({ hostname: 'Acme.Barberia.Com' }),
      ).toEqual({ slug: 'acme', origen: 'SUBDOMINIO' });
    });
  });

  describe('extracción del slug desde la cabecera', () => {
    it('resuelve el slug desde X-Negocio-Slug', () => {
      const { service } = crearServicio();

      expect(
        service.extraerSlugCandidato({
          headers: { 'x-negocio-slug': 'acme' },
        }),
      ).toEqual({ slug: 'acme', origen: 'CABECERA' });
    });

    it('normaliza a minúsculas y recorta espacios', () => {
      const { service } = crearServicio();

      expect(
        service.extraerSlugCandidato({
          headers: { 'x-negocio-slug': '  Acme  ' },
        }),
      ).toEqual({ slug: 'acme', origen: 'CABECERA' });
    });

    it('descarta un slug con formato inválido', () => {
      const { service } = crearServicio();

      expect(
        service.extraerSlugCandidato({
          headers: { 'x-negocio-slug': 'no valido' },
        }),
      ).toBeNull();
    });

    it('ignora la cabecera cuando está deshabilitada por configuración', () => {
      const { service } = crearServicio({
        NEGOCIO_PERMITIR_HEADER_SLUG: 'false',
      });

      expect(
        service.extraerSlugCandidato({
          headers: { 'x-negocio-slug': 'acme' },
        }),
      ).toBeNull();
    });

    it('acepta la cabecera cuando está habilitada explícitamente', () => {
      const { service } = crearServicio({
        NEGOCIO_PERMITIR_HEADER_SLUG: 'true',
      });

      expect(
        service.extraerSlugCandidato({
          headers: { 'x-negocio-slug': 'acme' },
        }),
      ).toEqual({ slug: 'acme', origen: 'CABECERA' });
    });

    it('el subdominio tiene prioridad sobre la cabecera', () => {
      const { service } = crearServicio({
        NEGOCIO_DOMINIO_BASE: 'barberia.com',
      });

      expect(
        service.extraerSlugCandidato({
          hostname: 'acme.barberia.com',
          headers: { 'x-negocio-slug': 'otro' },
        }),
      ).toEqual({ slug: 'acme', origen: 'SUBDOMINIO' });
    });

    it('usa el primer valor si la cabecera llega repetida', () => {
      const { service } = crearServicio();

      expect(
        service.extraerSlugCandidato({
          headers: { 'x-negocio-slug': ['acme', 'otro'] },
        }),
      ).toEqual({ slug: 'acme', origen: 'CABECERA' });
    });
  });

  describe('resolverDesdePeticion', () => {
    it('devuelve SIN_NEGOCIO cuando la petición no apunta a ningún negocio', async () => {
      const { service } = crearServicio();

      await expect(
        service.resolverDesdePeticion({ hostname: 'localhost' }),
      ).resolves.toEqual({ estado: 'SIN_NEGOCIO' });
    });

    it('devuelve RESUELTO con los datos del negocio activo', async () => {
      const { service } = crearServicio({}, [{ id: 4, slug: 'acme' }]);

      await expect(
        service.resolverDesdePeticion({
          headers: { 'x-negocio-slug': 'acme' },
        }),
      ).resolves.toEqual({
        estado: 'RESUELTO',
        negocioId: 4,
        slug: 'acme',
      });
    });

    it('devuelve RECHAZADO si el negocio no existe', async () => {
      const { service } = crearServicio();

      await expect(
        service.resolverDesdePeticion({
          headers: { 'x-negocio-slug': 'acme' },
        }),
      ).resolves.toEqual({ estado: 'RECHAZADO' });
    });

    it('no consulta la base de datos si no hay slug candidato', async () => {
      const { service, buscarActivoPorSlug } = crearServicio();

      await service.resolverDesdePeticion({ hostname: 'localhost' });

      expect(buscarActivoPorSlug).not.toHaveBeenCalled();
    });
  });

  describe('lanzarRechazoPorNegocioInvalido', () => {
    it('produce 404 con un mensaje que no revela el motivo', () => {
      const { service } = crearServicio();

      expect(() => service.lanzarRechazoPorNegocioInvalido()).toThrow(
        NotFoundException,
      );
      expect(() => service.lanzarRechazoPorNegocioInvalido()).toThrow(
        'El negocio solicitado no está disponible',
      );
    });
  });

  describe('ejecutarConContexto', () => {
    it('establece el contexto durante la operación', () => {
      const { service, contextoService } = crearServicio();

      const resultado = service.ejecutarConContexto(9, 'acme', () =>
        contextoService.obtenerContexto(),
      );

      expect(resultado).toEqual({ id: 9, slug: 'acme' });
    });
  });
});
