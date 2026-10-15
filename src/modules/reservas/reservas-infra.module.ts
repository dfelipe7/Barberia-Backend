import { Module } from '@nestjs/common';
import { ReservasRepository } from './repository/reservas.repository';
import { PrismaProveedorReservasActivas } from './adapters/prisma-proveedor-reservas-activas.adapter';
import { PROVEEDOR_RESERVAS_ACTIVAS } from '../horarios/ports/proveedor-reservas-activas.port';

/**
 * Infraestructura de reservas de HE-04 (sin HTTP).
 *
 * Expone dos cosas y nada más:
 * - `ReservasRepository`: acceso Prisma a `Reservation` (lo consumirá la futura
 *   fachada/servicio de reservas).
 * - `PROVEEDOR_RESERVAS_ACTIVAS`: el contrato de HE-08 resuelto por el adaptador
 *   real, para que `HorariosModule` deje de usar el proveedor provisional que
 *   fallaba de forma cerrada.
 *
 * Dirección de dependencias acíclica:
 *   ReservasInfraModule → PrismaModule (global)
 *   HorariosModule      → ReservasInfraModule
 *
 * No importa `HorariosModule` (solo referencia el archivo del puerto, que no es
 * un módulo NestJS), por lo que no hay ciclo. La futura `ReservasModule` (HTTP)
 * importará ambos para orquestar.
 */
@Module({
  providers: [
    ReservasRepository,
    PrismaProveedorReservasActivas,
    {
      provide: PROVEEDOR_RESERVAS_ACTIVAS,
      useExisting: PrismaProveedorReservasActivas,
    },
  ],
  exports: [ReservasRepository, PROVEEDOR_RESERVAS_ACTIVAS],
})
export class ReservasInfraModule {}
