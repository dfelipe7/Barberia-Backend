import { Module } from '@nestjs/common';
import { ReservasRepository } from './repository/reservas.repository';
import { ClientesRepository } from './repository/clientes.repository';
import { PrismaProveedorReservasActivas } from './adapters/prisma-proveedor-reservas-activas.adapter';
import { PROVEEDOR_RESERVAS_ACTIVAS } from '../horarios/ports/proveedor-reservas-activas.port';

/**
 * Infraestructura de reservas de HE-04 (sin HTTP).
 *
 * Expone:
 * - `ReservasRepository`: acceso Prisma a `Reservation`.
 * - `ClientesRepository`: acceso Prisma a `Cliente` (identidad de Google del
 *   cliente autenticado y vínculo heredado con `Usuario`).
 * - `PROVEEDOR_RESERVAS_ACTIVAS`: el contrato de HE-08 resuelto por el adaptador
 *   real, para que `HorariosModule` deje de usar el proveedor provisional que
 *   fallaba de forma cerrada.
 *
 * Dirección de dependencias acíclica:
 *   ReservasInfraModule → PrismaModule (global)
 *   HorariosModule      → ReservasInfraModule
 *   ClientesAuthModule  → ReservasInfraModule
 *
 * No importa módulos HTTP ni `HorariosModule` (solo referencia el archivo del
 * puerto, que no es un módulo NestJS), por lo que no hay ciclo.
 */
@Module({
  providers: [
    ReservasRepository,
    ClientesRepository,
    PrismaProveedorReservasActivas,
    {
      provide: PROVEEDOR_RESERVAS_ACTIVAS,
      useExisting: PrismaProveedorReservasActivas,
    },
  ],
  exports: [ReservasRepository, ClientesRepository, PROVEEDOR_RESERVAS_ACTIVAS],
})
export class ReservasInfraModule {}
