import { ApiProperty } from '@nestjs/swagger';
import { DescuentoAplicableResponseDto } from './descuento-aplicable-response.dto';

export class DescuentosBatchResponseDto {
  @ApiProperty({
    type: [DescuentoAplicableResponseDto],
    description: 'Evaluaciones de descuento para los productos solicitados',
  })
  productos: DescuentoAplicableResponseDto[];

  @ApiProperty({
    type: [DescuentoAplicableResponseDto],
    description: 'Evaluaciones de descuento para los servicios solicitados',
  })
  servicios: DescuentoAplicableResponseDto[];
}
