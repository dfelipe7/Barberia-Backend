import { Global, Module } from '@nestjs/common';
import { NegocioAislamientoService } from './negocio-aislamiento.service';
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
 * NOTA DE ACTIVACIÓN: en la Fase 1 el middleware se construyó y se probó, pero
 * NO se registró globalmente en `AppModule`. Con los repositorios ya filtrando
 * por `negocioId` (Fase 3), el middleware sí se registra: es la pieza que
 * establece el contexto que los repositorios y la extensión de Prisma leen.
 */
@Global()
@Module({
  providers: [
    NegocioContextoService,
    NegocioAislamientoService,
    NegocioResolucionService,
    NegociosRepository,
    NegocioContextoMiddleware,
  ],
  exports: [
    NegocioContextoService,
    NegocioAislamientoService,
    NegocioResolucionService,
    NegociosRepository,
    NegocioContextoMiddleware,
  ],
})
export class NegociosModule {}
