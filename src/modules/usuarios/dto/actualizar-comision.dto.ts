import {
  IsNumber,
  Max,
  Min,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ActualizarComisionDto {
  @ApiProperty({ example: 45, description: 'Nuevo porcentaje de comisión', minimum: 0, maximum: 100 })
  @IsNumber()
  @Min(0)
  @Max(100)
  porcentajeComision: number;
}