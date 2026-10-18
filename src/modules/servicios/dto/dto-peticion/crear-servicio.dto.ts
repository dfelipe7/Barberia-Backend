import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsArray,
  IsInt,
  Min,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CrearServicioDto {
  @ApiProperty({
    example: 'Corte de cabello',
    description: 'Nombre del servicio',
    minLength: 3,
    maxLength: 100,
  })
  @IsString()
  @IsNotEmpty()
  nombre: string;

  @ApiProperty({
    example: 'Corte de cabello profesional',
    description: 'Descripción del servicio',
    minLength: 3,
    maxLength: 500,
    required: false,
  })
  @IsString()
  @IsOptional()
  descripcion?: string;

  @ApiProperty({
    example: 50000,
    description: 'Precio del servicio',
    minimum: 0,
  })
  @IsNumber()
  @Min(0)
  @IsNotEmpty()
  precio: number;

  @ApiProperty({
    example: 30,
    description: 'Duración en minutos del servicio',
    minimum: 1,
  })
  @IsInt()
  @Min(1)
  @IsNotEmpty()
  duracionMinutos: number;

  @ApiProperty({
    example: '/uploads/servicios/corte-cabello.jpg',
    description: 'URL de la foto del servicio',
    required: false,
  })
  @IsString()
  @IsOptional()
  fotoUrl?: string;

  @ApiProperty({
    example: [1, 2],
    description: 'IDs de los barberos que realizan este servicio',
    required: false,
    type: [Number],
  })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  barberoIds?: number[];
}
