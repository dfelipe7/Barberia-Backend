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
   * @remarks
   * Solo devuelve negocios `ACTIVO`: un negocio desactivado no debe poder
   * recibir peticiones. La ausencia de un negocio inactivo y la de uno
   * inexistente son indistinguibles para quien consulta.
   *
   * @param slug - Cadena identificadora única de la barbería (ej. 'kyrios-studio').
   * @returns Datos mínimos del negocio activo ({ id, slug }) o `null` si no existe o está inactivo.
   */
  async buscarActivoPorSlug(slug: string) {
    return this.prisma.negocio.findFirst({
      where: { slug, estado: EstadoNegocio.ACTIVO },
      select: { id: true, slug: true },
    });
  }

  /**
   * Busca un negocio por su identificador interno, sea cual sea su estado.
   *
   * @remarks
   * Se usa para las operaciones de plataforma (inicialización de su
   * configuración operativa), donde el negocio es el objetivo de la operación
   * y no el contexto de una petición.
   *
   * @param id - Identificador numérico primario del negocio.
   * @returns Registro básico del negocio o `null`.
   */
  async buscarPorId(id: number) {
    return this.prisma.negocio.findUnique({
      where: { id },
      select: { id: true, slug: true, nombre: true },
    });
  }

  /**
   * Devuelve todos los negocios registrados en la plataforma junto con su estado.
   *
   * @returns Lista de negocios ordenados por ID de forma ascendente.
   */
  async listar() {
    return this.prisma.negocio.findMany({
      select: { id: true, slug: true, nombre: true, estado: true },
      orderBy: { id: 'asc' },
    });
  }
}
