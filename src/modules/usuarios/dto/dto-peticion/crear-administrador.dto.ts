import { IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CrearAdministradorDto {
  @ApiProperty({
    example: 'admin@barberia.com',
    description: 'Correo electrónico del administrador',
  })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ example: 'Juan', description: 'Nombre del administrador' })
  @IsString()
  @IsNotEmpty()
  nombre: string;

  @ApiProperty({
    example: 'Pérez',
    description: 'Apellido del administrador',
    required: false,
  })
  @IsOptional()
  @IsString()
  apellido?: string;
}
