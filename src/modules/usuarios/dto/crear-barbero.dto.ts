import {
  IsEmail,
  IsNotEmpty,
  IsNumber,
  IsString,
  Min,
  Max,
  MinLength,
  IsOptional,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CrearBarberoDto {
  @ApiProperty({ example: 'barbero@barberia.com', description: 'Correo electrónico del barbero' })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ example: 'password123', description: 'Contraseña de acceso', minLength: 8 })
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  password: string;

  @ApiProperty({ example: 'Pedro', description: 'Nombre del barbero' })
  @IsString()
  @IsNotEmpty()
  nombre: string;

  @ApiProperty({ example: 'Gómez', description: 'Apellido del barbero' })
  @IsString()
  @IsNotEmpty()
  apellido: string;

  @ApiProperty({ example: '+573001234567', description: 'Teléfono de contacto' })
  @IsString()
  @IsNotEmpty()
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