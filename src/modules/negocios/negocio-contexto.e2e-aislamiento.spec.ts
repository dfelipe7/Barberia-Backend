import {
  Controller,
  Get,
  INestApplication,
  Injectable,
  MiddlewareConsumer,
  Module,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { App } from 'supertest/types';
import request from 'supertest';
import { NegocioContextoService } from './negocio-contexto.service';
import { NegocioContextoMiddleware } from './middleware/negocio-contexto.middleware';
import { NegociosRepository } from './repository/negocios.repository';
import { NegocioResolucionService } from './service/negocio-resolucion.service';

/** Contexto de negocio esperado en las respuestas de prueba. */
interface ContextoEsperado {
  id: number;
  slug: string;
}

interface RespuestaContexto {
  desdeContexto: ContextoEsperado | null;
  desdeServicio: ContextoEsperado | null;
}

/**
 * Prueba de aislamiento del contexto asíncrono de extremo a extremo.
 *
 * Verifica que el contexto de negocio establecido por el middleware alcanza
 * al CONTROLADOR, al SERVICIO y al "repositorio" a través de esperas
 * (`await`), y que dos peticiones CONCURRENTES con negocios distintos no
 * mezclan su contexto.
 *
 * Usa un repositorio simulado en lugar de Prisma: en esta fase no se
 * comprueba la persistencia, sino el aislamiento del contexto.
 */

/** Simula un repositorio que devuelve el negocio resuelto por la petición. */
@Injectable()
class RepositorioSimulado {
  async buscarActivoPorSlug(slug: string) {
    // Latencia artificial: obliga a que las dos peticiones se solapen.
    await new Promise((resolve) => setTimeout(resolve, 15));

    const negocios: Record<string, { id: number; slug: string }> = {
      kyrios: { id: 1, slug: 'kyrios' },
      acme: { id: 2, slug: 'acme' },
    };

    return negocios[slug] ?? null;
  }
}

/** Servicio de negocio: lee el contexto DESPUÉS de un await. */
@Injectable()
class ServicioSimulado {
  constructor(private readonly contextoService: NegocioContextoService) {}

  async leerNegocio() {
    await new Promise((resolve) => setTimeout(resolve, 5));
    return this.contextoService.obtenerContexto();
  }
}

@Controller('contexto')
class ContextoController {
  constructor(
    private readonly contextoService: NegocioContextoService,
    private readonly servicioSimulado: ServicioSimulado,
  ) {}

  @Get('directo')
  directo() {
    return {
      desdeContexto: this.contextoService.obtenerContexto() ?? null,
    };
  }

  @Get('a-traves-de-servicio')
  async aTravesDeServicio() {
    return { desdeServicio: await this.servicioSimulado.leerNegocio() };
  }
}

@Module({
  controllers: [ContextoController],
  providers: [
    RepositorioSimulado,
    ServicioSimulado,
    NegocioContextoService,
    NegocioResolucionService,
    { provide: NegociosRepository, useClass: RepositorioSimulado },
    {
      provide: ConfigService,
      useValue: { get: () => undefined },
    },
  ],
})
class ContextoTestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(NegocioContextoMiddleware).forRoutes('*');
  }
}

describe('Contexto de negocio (aislamiento asíncrono extremo a extremo)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ContextoTestModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app?.close();
  });

  it('el contexto alcanza al controlador y al servicio', async () => {
    const directo = await request(app.getHttpServer())
      .get('/contexto/directo')
      .set('X-Negocio-Slug', 'kyrios');

    expect(directo.status).toBe(200);
    expect((directo.body as RespuestaContexto).desdeContexto).toEqual({
      id: 1,
      slug: 'kyrios',
    });

    const aTravesDeServicio = await request(app.getHttpServer())
      .get('/contexto/a-traves-de-servicio')
      .set('X-Negocio-Slug', 'kyrios');

    expect(aTravesDeServicio.status).toBe(200);
    expect((aTravesDeServicio.body as RespuestaContexto).desdeServicio).toEqual(
      {
        id: 1,
        slug: 'kyrios',
      },
    );
  });

  it('peticiones concurrentes con negocios distintos no mezclan el contexto', async () => {
    const [primero, segundo] = await Promise.all([
      request(app.getHttpServer())
        .get('/contexto/a-traves-de-servicio')
        .set('X-Negocio-Slug', 'kyrios'),
      request(app.getHttpServer())
        .get('/contexto/a-traves-de-servicio')
        .set('X-Negocio-Slug', 'acme'),
    ]);

    expect(primero.status).toBe(200);
    expect(segundo.status).toBe(200);
    expect((primero.body as RespuestaContexto).desdeServicio).toEqual({
      id: 1,
      slug: 'kyrios',
    });
    expect((segundo.body as RespuestaContexto).desdeServicio).toEqual({
      id: 2,
      slug: 'acme',
    });
  });

  it('una petición sin negocio continúa sin contexto y sin error', async () => {
    const respuesta = await request(app.getHttpServer()).get(
      '/contexto/directo',
    );

    expect(respuesta.status).toBe(200);
    expect((respuesta.body as RespuestaContexto).desdeContexto).toBeNull();
  });

  it('una petición a un negocio inexistente se rechaza con 404', async () => {
    const respuesta = await request(app.getHttpServer())
      .get('/contexto/directo')
      .set('X-Negocio-Slug', 'no-existe');

    expect(respuesta.status).toBe(404);
  });
});
