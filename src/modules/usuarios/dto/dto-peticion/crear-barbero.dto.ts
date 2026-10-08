import {
  IsEmail,
  IsNotEmpty,
  IsNumber,
  IsString,
  Min,
  Max,
  MinLength,
  MaxLength,
  IsOptional,
  Matches,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CrearBarberoDto {
  @ApiProperty({ example: 'barbero@barberia.com', description: 'Correo electrónico del barbero' })
  @IsEmail()
  @IsNotEmpty()
  @MaxLength(255, { message: 'El correo no puede tener más de 255 caracteres' })
  email: string;

  @ApiProperty({ example: 'password123', description: 'Contraseña de acceso', minLength: 8 })
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  password: string;

  @ApiProperty({ example: 'Pedro', description: 'Nombre del barbero' })
  @IsString()
  @IsNotEmpty()
  @MinLength(2, { message: 'El nombre debe tener al menos 2 caracteres' })
  @MaxLength(50, { message: 'El nombre no puede tener más de 50 caracteres' })
  @Matches(/^[a-zA-ZáéíóúÁÉÍÓÚñÑ\s]+$/, { message: 'El nombre solo puede contener letras y espacios' })
  nombre: string;

  @ApiProperty({ example: 'Gómez', description: 'Apellido del barbero' })
  @IsString()
  @IsNotEmpty()
  @MinLength(2, { message: 'El apellido debe tener al menos 2 caracteres' })
  @MaxLength(50, { message: 'El apellido no puede tener más de 50 caracteres' })
  @Matches(/^[a-zA-ZáéíóúÁÉÍÓÚñÑ\s]+$/, { message: 'El apellido solo puede contener letras y espacios' })
  apellido: string;

  @ApiProperty({ example: '+573001234567', description: 'Teléfono de contacto' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\+?\d{7,15}$/, { message: 'El teléfono solo debe contener números (mínimo 7) y opcionalmente un signo + al inicio' })
  telefono: string;

  @ApiProperty({ example: 50, description: 'Porcentaje de comisión por servicio', minimum: 0, maximum: 100 })
  @IsNumber()
  @Min(0)
  @Max(100)
  porcentajeComision: number;

  @ApiProperty({ example: '/uploads/barberos/barbero-1.jpg', description: 'URL de la foto de perfil del barbero', required: false })
  @IsOptional()
  @IsString()
  fotoUrl?: string;
}