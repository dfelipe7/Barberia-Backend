import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '../../generated/prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { crearExtensionAislamientoNegocio } from '../modules/negocios/prisma-extension-aislamiento';

/**
 * Cliente de Prisma con la extensión de aislamiento por negocio.
 *
 * La extensión se aplica SOBRE la instancia (con `Object.assign` sobre el
 * resultado de `$extends`), de modo que `this.prisma.<modelo>` sigue siendo
 * el delegate extendido: los repositorios no necesitan saber que la extensión
 * existe.
 *
 * Motivo de aplicar la extensión aquí y no en los repositorios: es la
 * DEFENSA ADICIONAL que exige el plan. La capa principal son los filtros
 * explícitos de cada repositorio (`NegocioAislamientoService`); la extensión
 * actúa si alguno se olvida.
 *
 * La extensión lee el negocio del contexto validado del servidor
 * (`ContextoNegocioAlmacenamiento`), nunca de la petición.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(private readonly configService: ConfigService) {
    const databaseUrl = configService.getOrThrow<string>('DATABASE_URL');

    const url = new URL(databaseUrl);

    const adapter = new PrismaMariaDb({
      host: url.hostname,
      port: Number(url.port),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: url.pathname.substring(1),
      connectionLimit: 5,
    });

    super({ adapter });

    // Se aplica la extensión sobre esta misma instancia para que los
    // repositorios reciban los delegates extendidos.
    Object.assign(this, this.$extends(crearExtensionAislamientoNegocio()));
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
