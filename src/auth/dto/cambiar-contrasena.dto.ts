import { IsString, MinLength, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CambiarContrasenaDto {
  @ApiProperty({ example: 'MiClaveActual123', description: 'Contraseña actual del usuario' })
  @IsString()
  contrasenaActual: string;

  @ApiProperty({ example: 'MiNuevaClave456!', description: 'Nueva contraseña (mínimo 8 caracteres)' })
  @IsString()
  @MinLength(8, { message: 'La nueva contraseña debe tener al menos 8 caracteres' })
  @MaxLength(64, { message: 'La nueva contraseña no puede tener más de 64 caracteres' })
  nuevaContrasena: string;
}
