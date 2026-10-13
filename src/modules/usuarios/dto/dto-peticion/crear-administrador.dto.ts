import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CrearAdministradorDto {
  @ApiProperty({ example: 'admin@barberia.com', description: 'Correo electrónico del administrador' })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ example: 'password123', description: 'Contraseña de acceso (opcional si se autentica con Google)', minLength: 8, required: false })
  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;

  @ApiProperty({ example: 'Juan', description: 'Nombre del administrador' })
  @IsString()
  @IsNotEmpty()
  nombre: string;

  @ApiProperty({ example: 'Pérez', description: 'Apellido del administrador', required: false })
  @IsOptional()
  @IsString()
  apellido?: string;
}