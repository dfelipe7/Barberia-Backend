import { PartialType } from '@nestjs/swagger';
import { CrearServicioDto } from './crear-servicio.dto';

export class ActualizarServicioDto extends PartialType(CrearServicioDto) {}
