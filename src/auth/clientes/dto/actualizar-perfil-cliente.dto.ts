import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ActualizarPerfilClienteDto {
  @ApiPropertyOptional({ description: 'Teléfono de contacto o WhatsApp del cliente', example: '3001234567' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  telefono?: string;

  @ApiPropertyOptional({ description: 'Nombre del cliente', example: 'Felipe' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  nombre?: string;

  @ApiPropertyOptional({ description: 'Apellido del cliente', example: 'Romero' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  apellido?: string;
}
