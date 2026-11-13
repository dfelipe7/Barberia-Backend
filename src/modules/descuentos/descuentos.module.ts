import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { ProductosInfraModule } from '../productos/productos-infra.module';
import { ServiciosModule } from '../servicios/servicios.module';
import { DescuentosController } from './controller/descuentos.controller';
import { DescuentosFacade } from './facade/descuentos.facade';
import { DescuentoRepository } from './repository/descuento.repository';
import { DescuentoEvaluadorService } from './service/descuento-evaluador.service';
import { DescuentoService } from './service/descuento.service';

@Module({
  imports: [AuthModule, ProductosInfraModule, ServiciosModule],
  controllers: [DescuentosController],
  providers: [
    DescuentosFacade,
    DescuentoService,
    DescuentoEvaluadorService,
    DescuentoRepository,
  ],
  exports: [DescuentosFacade, DescuentoEvaluadorService, DescuentoService],
})
export class DescuentosModule {}
