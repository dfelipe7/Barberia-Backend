import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { ProductosController } from './controller/productos.controller';
import { ProductosFacade } from './facade/productos.facade';
import { ProductoRepository } from './repository/producto.repository';
import { AlmacenamientoProductosService } from './service/almacenamiento-productos.service';
import { ProductoService } from './service/producto.service';

@Module({
  imports: [AuthModule],
  controllers: [ProductosController],
  providers: [
    ProductosFacade,
    ProductoService,
    AlmacenamientoProductosService,
    ProductoRepository,
  ],
  exports: [ProductosFacade],
})
export class ProductosModule {}
