import {
  IsNumber,
  IsString,
  IsNotEmpty,
  Min,
  Max,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ConfigurarBarberoDto {
  @ApiProperty({ example: '+573001234567', description: 'Teléfono de contacto' })
  @IsString()
  @IsNotEmpty()
  telefono: string;

  @ApiProperty({ example: 50, description: 'Porcentaje de comisión', minimum: 0, maximum: 100 })
  @IsNumber()
  @Min(0)
  @Max(100)
  porcentajeComision: number;
}