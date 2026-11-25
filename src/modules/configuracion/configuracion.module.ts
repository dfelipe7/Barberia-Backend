import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { ConfiguracionRepository } from './repository/configuracion.repository';
import { ConfiguracionService } from './service/configuracion.service';
import { ConfiguracionPoliticasController } from './controller/configuracion-politicas.controller';

/**
 * Configuración funcional centralizada (parámetros en base de datos).
 *
 * Es global para que cualquier módulo pueda inyectar `ConfiguracionService`
 * sin volver a cablear la persistencia, del mismo modo que `PrismaModule`.
 * Expone únicamente el servicio; el repositorio es un detalle interno.
 */
@Global()
@Module({
  imports: [AuthModule],
  controllers: [ConfiguracionPoliticasController],
  providers: [ConfiguracionRepository, ConfiguracionService],
  exports: [ConfiguracionService],
})
export class ConfiguracionModule {}
