import {
  IsEnum,
} from 'class-validator';

import { EstadoUsuario } from '../../../../generated/prisma/enums';

export class CambiarEstadoUsuarioDto {
  @IsEnum(EstadoUsuario)
  estado: EstadoUsuario;
}