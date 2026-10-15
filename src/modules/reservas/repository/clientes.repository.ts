import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * Acceso de lectura a `Cliente` para HE-04 (HU-04).
 *
 * Solo expone la búsqueda por `usuarioId`, que resuelve el vínculo opcional y
 * único `Cliente`↔`Usuario` (D-01/D-02). El alta de clientes ocurre dentro de la
 * transacción de creación de la reserva (`ReservasRepository.crearConBloqueo`)
 * para no dejar clientes huérfanos si la reserva falla.
 */
@Injectable()
export class ClientesRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Devuelve el `Cliente` vinculado a un `Usuario` autenticado, o `null` si el
   * usuario todavía no tiene registro de cliente (primer reserva autenticada).
   */
  async buscarPorUsuarioId(usuarioId: number) {
    return this.prisma.cliente.findUnique({ where: { usuarioId } });
  }
}
