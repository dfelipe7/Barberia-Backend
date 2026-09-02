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
}