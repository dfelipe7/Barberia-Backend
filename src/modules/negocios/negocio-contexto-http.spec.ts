import {
  Controller,
  Get,
  INestApplication,
  Injectable,
  MiddlewareConsumer,
  Module,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { App } from 'supertest/types';
import request from 'supertest';
import { NegocioContextoMiddleware } from './middleware/negocio-contexto.middleware';
import { NegocioContextoService } from './negocio-contexto.service';
import { NegociosRepository } from './repository/negocios.repository';
import { NegocioResolucionService } from './service/negocio-resolucion.service';

/**
 * PRUEBA DEL REGISTRO DEL CONTEXTO HTTP.
 *
 * Verifica que el middleware establece el contexto de negocio en la petición
 * y que las peticiones sin negocio siguen funcionando (comportamiento
 * mononegocio), mientras que las que apuntan a un negocio inexistente o
 * inactivo se rechazan con 404.
 *
 * El repositorio se SIMULA: aquí se comprueba el mecanismo de resolución, no
 * la persistencia (eso se comprueba en `test/multitenant-*.e2e-spec.ts`).
 */

/** Simula la tabla `negocios`. */
@Injectable()
class RepositorioSimulado {
  buscarActivoPorSlug(slug: string) {
    const negocios: Record<
      string,
      { id: number; slug: string; nombre: string }
    > = {
      kyrios: { id: 1, slug: 'kyrios', nombre: 'KYRIOS STUDIO' },
    };

    return Promise.resolve(negocios[slug] ?? null);
  }
}

@Controller('contexto')
class ContextoController {
  constructor(private readonly contextoService: NegocioContextoService) {}

  @Get('negocio')
  negocio() {
    return this.contextoService.obtenerContexto() ?? null;
  }
}

@Module({
  controllers: [ContextoController],
  providers: [
    NegocioContextoService,
    NegocioResolucionService,
    { provide: NegociosRepository, useClass: RepositorioSimulado },
  ],
})
class ContextoTestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(NegocioContextoMiddleware).forRoutes('*');
  }
}

describe('Registro del contexto de negocio en HTTP', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), ContextoTestModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('establece el contexto cuando la cabecera apunta a un negocio válido', async () => {
    const respuesta = await request(app.getHttpServer())
      .get('/contexto/negocio')
      .set('X-Negocio-Slug', 'kyrios');

    expect(respuesta.status).toBe(200);
    expect(respuesta.body).toEqual({ id: 1, slug: 'kyrios' });
  });

  it('la petición SIN negocio sigue funcionando (comportamiento mononegocio)', async () => {
    const respuesta = await request(app.getHttpServer()).get(
      '/contexto/negocio',
    );

    expect(respuesta.status).toBe(200);
    // Sin contexto, el controlador no devuelve ningún negocio.
    expect(respuesta.body).toEqual({});
  });

  it('rechaza con 404 un negocio inexistente', async () => {
    const respuesta = await request(app.getHttpServer())
      .get('/contexto/negocio')
      .set('X-Negocio-Slug', 'no-existe');

    expect(respuesta.status).toBe(404);
  });
});
