import {
  IsEmail,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ActualizarUsuarioDto {
  @ApiProperty({ example: 'NuevoNombre', description: 'Nombre del usuario', required: false })
  @IsOptional()
  @IsString()
  @MinLength(1)
  nombre?: string;

  @ApiProperty({ example: 'NuevoApellido', description: 'Apellido del usuario', required: false })
  @IsOptional()
  @IsString()
  @MinLength(1)
  apellido?: string;

  @ApiProperty({ example: 'nuevo@correo.com', description: 'Correo del usuario', required: false })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiProperty({ example: '1234567890', description: 'Teléfono del barbero', required: false })
  @IsOptional()
  @IsString()
  telefono?: string;

  @ApiProperty({ example: 40, description: 'Porcentaje de comisión del barbero', required: false })
  @IsOptional()
  porcentajeComision?: number;
}