import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';

import { EstadoUsuario } from '../../../../../generated/prisma/enums';

export enum TipoMembresiaEstado {
  ADMINISTRADOR = 'administrador',
  BARBERO = 'barbero',
  AMBOS = 'ambos',
}

export class CambiarEstadoUsuarioGestionDto {
  @ApiProperty({
    enum: EstadoUsuario,
    example: 'ACTIVO',
    description: 'El nuevo estado de la membresía en esta barbería',
  })
  @IsEnum(EstadoUsuario)
  estado: EstadoUsuario;

  @ApiProperty({
    enum: TipoMembresiaEstado,
    example: TipoMembresiaEstado.BARBERO,
    description: 'Membresía de esta barbería que se va a actualizar',
  })
  @IsEnum(TipoMembresiaEstado)
  tipo: TipoMembresiaEstado;
}
