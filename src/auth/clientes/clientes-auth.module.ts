import { Module } from '@nestjs/common';
import { AuthModule } from '../auth.module';
import { ReservasInfraModule } from '../../modules/reservas/reservas-infra.module';
import { ClientesAuthService } from './clientes-auth.service';
import { ClientesAuthController } from './clientes-auth.controller';
import { ClienteJwtService } from './cliente-jwt.service';
import { ClienteJwtAuthGuard } from './guards/cliente-jwt-auth.guard';
import { ClienteOpcionalJwtAuthGuard } from './guards/cliente-opcional-jwt-auth.guard';

/**
 * Autenticación de clientes (HE-04, Modalidad B).
 *
 * Grafo acíclico:
 *   ClientesAuthModule ──▶ AuthModule          (JwtModule + GoogleTokenVerifier)
 *   ClientesAuthModule ──▶ ReservasInfraModule (ClientesRepository)
 *   ReservasModule     ──▶ ClientesAuthModule  (guards de cliente)
 *
 * No redefine verificación de Google ni acceso a datos: reutiliza el verificador
 * compartido y el repositorio de clientes del dominio de reservas.
 */
@Module({
  imports: [AuthModule, ReservasInfraModule],
  controllers: [ClientesAuthController],
  providers: [
    ClienteJwtService,
    ClientesAuthService,
    ClienteJwtAuthGuard,
    ClienteOpcionalJwtAuthGuard,
  ],
  exports: [
    ClienteJwtService,
    ClienteJwtAuthGuard,
    ClienteOpcionalJwtAuthGuard,
  ],
})
export class ClientesAuthModule {}
