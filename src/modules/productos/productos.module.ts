import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { DescuentosModule } from '../descuentos/descuentos.module';
import { ProductosInfraModule } from './productos-infra.module';
import { ProductosController } from './controller/productos.controller';
import { ProductosFacade } from './facade/productos.facade';
import { ProductoService } from './service/producto.service';

@Module({
  imports: [AuthModule, ProductosInfraModule, DescuentosModule],
  controllers: [ProductosController],
  providers: [ProductosFacade, ProductoService],
  exports: [ProductosFacade, ProductosInfraModule],
})
export class ProductosModule {}
