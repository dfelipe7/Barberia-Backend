import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { PerfilNegocioController } from './controller/perfil-negocio.controller';
import { PerfilNegocioService } from './service/perfil-negocio.service';
import { AlmacenamientoPerfilService } from './service/almacenamiento-perfil.service';
import { PerfilNegocioRepository } from './repository/perfil-negocio.repository';

/**
 * Módulo del perfil de marca y ubicación de un negocio (Fases 14 y 15).
 *
 * El contexto de negocio (`NegocioContextoService`,
 * `NegocioAislamientoService`, `NegociosRepository`) viene de
 * `NegociosModule`, que es GLOBAL: no hace falta cablearlo aquí.
 *
 * `AuthModule` aporta los guards (`JwtAuthGuard`, `RolesGuard`) que exigen
 * sesión y rol efectivo para las rutas administrativas.
 */
@Module({
  imports: [AuthModule],
  controllers: [PerfilNegocioController],
  providers: [
    PerfilNegocioService,
    PerfilNegocioRepository,
    AlmacenamientoPerfilService,
  ],
  exports: [PerfilNegocioService, AlmacenamientoPerfilService],
})
export class PerfilNegocioModule {}
