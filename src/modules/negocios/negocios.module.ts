import { Global, Module } from '@nestjs/common';
import { NegocioContextoService } from './negocio-contexto.service';
import { NegocioContextoMiddleware } from './middleware/negocio-contexto.middleware';
import { NegociosRepository } from './repository/negocios.repository';
import { NegocioResolucionService } from './service/negocio-resolucion.service';

/**
 * Módulo de negocios (tenants) de la plataforma.
 *
 * Es global por la misma razón que `PrismaModule` y `ConfiguracionModule`:
 * el contexto de negocio debe poder inyectarse en cualquier repositorio o
 * servicio sin cablear el grafo de dependencias de cada módulo.
 *
 * NOTA DE ACTIVACIÓN: en esta fase el middleware se construye y se prueba,
 * pero NO se registra globalmente en `AppModule`. Registrarlo antes de que
 * existan negocios en la base de datos y de que los repositorios filtren por
 * `negocioId` rechazaría peticiones legítimas de la plataforma sin aportar
 * aislamiento real. La activación ocurre junto con los filtros por negocio.
 */
@Global()
@Module({
  providers: [
    NegocioContextoService,
    NegocioResolucionService,
    NegociosRepository,
    NegocioContextoMiddleware,
  ],
  exports: [
    NegocioContextoService,
    NegocioResolucionService,
    NegociosRepository,
    NegocioContextoMiddleware,
  ],
})
export class NegociosModule {}
