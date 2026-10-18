import { Test } from '@nestjs/testing';
import { ReservasInfraModule } from './reservas-infra.module';
import { ReservasRepository } from './repository/reservas.repository';
import { PrismaProveedorReservasActivas } from './adapters/prisma-proveedor-reservas-activas.adapter';
import { PROVEEDOR_RESERVAS_ACTIVAS } from '../horarios/ports/proveedor-reservas-activas.port';
import { PrismaService } from '../../prisma/prisma.service';
import { PrismaModule } from '../../prisma/prisma.module';

/**
 * Verifica el registro de proveedores y la exportación del módulo de
 * infraestructura de reservas: el token de HE-08 debe quedar resuelto por el
 * adaptador real (no por el proveedor provisional que fallaba cerrado).
 */
describe('ReservasInfraModule', () => {
  it('exporta ReservasRepository y resuelve PROVEEDOR_RESERVAS_ACTIVAS con el adaptador Prisma', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, ReservasInfraModule],
    })
      .overrideProvider(PrismaService)
      .useValue({ reservation: {} })
      .compile();

    expect(moduleRef.get(ReservasRepository)).toBeInstanceOf(
      ReservasRepository,
    );
    expect(moduleRef.get(PROVEEDOR_RESERVAS_ACTIVAS)).toBeInstanceOf(
      PrismaProveedorReservasActivas,
    );

    await moduleRef.close();
  });
});
