import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Min,
} from 'class-validator';

export class EvaluarDescuentosBatchDto {
  @ApiPropertyOptional({
    type: [Number],
    example: [1, 2],
    description: 'Arreglo de identificadores de productos a evaluar',
  })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Transform(({ value }: { value: unknown }): unknown =>
    Array.isArray(value) ? value.map((item: unknown) => Number(item)) : value,
  )
  productoIds?: number[];

  @ApiPropertyOptional({
    type: [Number],
    example: [3, 4],
    description: 'Arreglo de identificadores de servicios a evaluar',
  })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Transform(({ value }: { value: unknown }): unknown =>
    Array.isArray(value) ? value.map((item: unknown) => Number(item)) : value,
  )
  servicioIds?: number[];

  @ApiPropertyOptional({
    example: '2026-11-20',
    description: 'Fecha de la cita (YYYY-MM-DD) para evaluar servicios',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'La fecha debe tener formato YYYY-MM-DD',
  })
  fecha?: string;
}
