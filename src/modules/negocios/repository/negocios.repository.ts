import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { EstadoNegocio } from '../../../../generated/prisma/enums';

/**
 * Acceso a la tabla `negocios` (tenants de la plataforma).
 *
 * Se limita a las consultas NECESARIAS para la resolución del negocio. El
 * resto del acceso a datos por negocio (servicios, clientes, barberos,
 * reservas) corresponde a los repositorios de cada módulo, que incorporarán
 * el filtro por `negocioId` explícito y la extensión de Prisma.
 */
@Injectable()
export class NegociosRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Busca un negocio por su slug PÚBLICO y estable.
   *
   * Solo devuelve negocios `ACTIVO`: un negocio desactivado no debe poder
   * recibir peticiones. La ausencia de un negocio inactivo y la de uno
   * inexistente son indistinguibles para quien consulta.
   */
  async buscarActivoPorSlug(slug: string) {
    return this.prisma.negocio.findFirst({
      where: { slug, estado: EstadoNegocio.ACTIVO },
      select: { id: true, slug: true },
    });
  }
}
