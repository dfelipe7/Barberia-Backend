import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CrearNegocioPlataformaDto {
  @ApiProperty({ description: 'Nombre oficial de la barbería', example: 'Kyrios Popayán Norte' })
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(150)
  nombre: string;

  @ApiProperty({
    description: 'Identificador único en URL (slug en minúsculas sin espacios)',
    example: 'kyrios-norte',
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(63)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'El slug solo puede contener letras minúsculas, números y guiones sencillos (ej: barberia-norte)',
  })
  slug: string;

  @ApiPropertyOptional({ description: 'Zona horaria oficial', example: 'America/Bogota' })
  @IsOptional()
  @IsString()
  zonaHoraria?: string;

  @ApiPropertyOptional({ description: 'Dirección o ciudad', example: 'Cra 9 # 15-20, Popayán' })
  @IsOptional()
  @IsString()
  direccion?: string;

  @ApiPropertyOptional({ description: 'Correo del Dueño o Superadmin de la sede', example: 'dueno@gmail.com' })
  @IsOptional()
  @IsEmail({}, { message: 'El correo del administrador debe tener un formato de email válido' })
  adminEmail?: string;

  @ApiPropertyOptional({ description: 'Nombre del Dueño o Superadmin', example: 'Felipe' })
  @IsOptional()
  @IsString()
  adminNombre?: string;

  @ApiPropertyOptional({ description: 'Apellido del Dueño o Superadmin', example: 'Armero' })
  @IsOptional()
  @IsString()
  adminApellido?: string;
}

