import { IsEnum } from 'class-validator';

import { EstadoUsuario } from '../../../../../generated/prisma/enums';
import { ApiProperty } from '@nestjs/swagger';

export class CambiarEstadoUsuarioDto {
  @ApiProperty({
    enum: EstadoUsuario,
    example: 'ACTIVO',
    description: 'El nuevo estado del usuario',
  })
  @IsEnum(EstadoUsuario)
  estado: EstadoUsuario;
}
