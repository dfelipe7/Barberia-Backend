import {
  IsEmail,
  IsOptional,
  IsString,
  MinLength,
  MaxLength,
  IsNumber,
  Min,
  Max,
  IsBoolean,
  Matches,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ActualizarUsuarioDto {
  @ApiProperty({ example: 'NuevoNombre', description: 'Nombre del usuario', required: false })
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'El nombre debe tener al menos 2 caracteres' })
  @MaxLength(50, { message: 'El nombre no puede tener más de 50 caracteres' })
  @Matches(/^[a-zA-ZáéíóúÁÉÍÓÚñÑ\s]+$/, { message: 'El nombre solo puede contener letras y espacios' })
  nombre?: string;

  @ApiProperty({ example: 'NuevoApellido', description: 'Apellido del usuario', required: false })
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'El apellido debe tener al menos 2 caracteres' })
  @MaxLength(50, { message: 'El apellido no puede tener más de 50 caracteres' })
  @Matches(/^[a-zA-ZáéíóúÁÉÍÓÚñÑ\s]+$/, { message: 'El apellido solo puede contener letras y espacios' })
  apellido?: string;

  @ApiProperty({ example: 'nuevo@correo.com', description: 'Correo del usuario', required: false })
  @IsOptional()
  @IsEmail()
  @MaxLength(255, { message: 'El correo no puede tener más de 255 caracteres' })
  email?: string;

  @ApiProperty({ example: '1234567890', description: 'Teléfono del barbero', required: false })
  @IsOptional()
  @IsString()
  @Matches(/^\+?[0-9]{7,15}$/, { message: 'El teléfono solo debe contener números (mínimo 7) y opcionalmente un signo + al inicio' })
  telefono?: string;

  @ApiProperty({ example: 40, description: 'Porcentaje de comisión del barbero', required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  porcentajeComision?: number;

  @ApiProperty({ example: true, description: 'Indica si el usuario tiene rol de Administrador', required: false })
  @IsOptional()
  @IsBoolean()
  esAdministrador?: boolean;

  @ApiProperty({ example: true, description: 'Indica si el usuario tiene rol de Barbero', required: false })
  @IsOptional()
  @IsBoolean()
  esBarbero?: boolean;

  @ApiProperty({ example: '/uploads/barberos/barbero-1.jpg', description: 'URL de la foto de perfil del barbero', required: false })
  @IsOptional()
  @IsString()
  fotoUrl?: string;
}