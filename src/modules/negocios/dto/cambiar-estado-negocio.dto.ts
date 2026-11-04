import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { EstadoNegocio } from '../../../../generated/prisma/enums';

export class CambiarEstadoNegocioDto {
  @ApiProperty({
    enum: EstadoNegocio,
    description: 'Nuevo estado de la barbería en la plataforma',
  })
  @IsEnum(EstadoNegocio)
  estado: EstadoNegocio;
}
