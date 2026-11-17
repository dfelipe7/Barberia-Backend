import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { ProductoRepository } from './repository/producto.repository';
import { AlmacenamientoProductosService } from './service/almacenamiento-productos.service';

/**
 * Infraestructura de productos (sin HTTP ni casos de uso de negocio).
 *
 * Expone ProductoRepository y AlmacenamientoProductosService para consumo
 * de otros módulos (ej. DescuentosModule) sin provocar dependencias circulares.
 *
 * Grafo acíclico:
 *   ProductosInfraModule ──▶ PrismaModule (global)
 *   DescuentosModule     ──▶ ProductosInfraModule
 *   ProductosModule      ──▶ ProductosInfraModule
 *   ProductosModule      ──▶ DescuentosModule
 */
@Module({
  imports: [AuthModule],
  providers: [ProductoRepository, AlmacenamientoProductosService],
  exports: [ProductoRepository, AlmacenamientoProductosService],
})
export class ProductosInfraModule {}
