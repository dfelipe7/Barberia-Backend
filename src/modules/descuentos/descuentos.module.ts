import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { ProductosModule } from '../productos/productos.module';
import { ServiciosModule } from '../servicios/servicios.module';
import { DescuentosController } from './controller/descuentos.controller';
import { DescuentosFacade } from './facade/descuentos.facade';
import { DescuentoRepository } from './repository/descuento.repository';
import { DescuentoService } from './service/descuento.service';

@Module({
  imports: [AuthModule, ProductosModule, ServiciosModule],
  controllers: [DescuentosController],
  providers: [DescuentosFacade, DescuentoService, DescuentoRepository],
})
export class DescuentosModule {}
