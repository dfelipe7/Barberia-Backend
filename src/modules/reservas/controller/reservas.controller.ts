import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiBadRequestResponse,
  ApiNotFoundResponse,
} from '@nestjs/swagger';
import { CrearReservaDto } from '../dto/dto-peticion/crear-reserva.dto';
import { ReservaCreadaResponseDto } from '../dto/dto-respuesta/reserva-creada-response.dto';
import {
  IdentidadClienteAutenticado,
  ReservasService,
} from '../service/reservas.service';
import { OpcionalJwtAuthGuard } from '../guards/opcional-jwt-auth.guard';

/**
 * Endpoint de creación de reservas (HE-04-HU-04, HU-10).
 *
 * Un único `POST /reservas` cubre las dos modalidades de D-01 sin duplicar el
 * flujo: sin token actúa como invitado (Modalidad A); con token válido, como
 * cliente autenticado (Modalidad B).
 */
@ApiTags('reservas')
@Controller('reservas')
export class ReservasController {
  constructor(private readonly reservasService: ReservasService) {}

  @Post()
  @UseGuards(OpcionalJwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Crear una reserva para un cliente invitado o autenticado',
    description:
      'Endpoint que acepta ambas modalidades: sin token crea una reserva de invitado (exige nombre y teléfono); con un token Bearer válido asocia la reserva al cliente autenticado. Valida servicio, barbero, fecha y hora (400), servicio/barbero inexistentes o no asignados (404), franja ocupada o duplicada (409) y devuelve el identificador de la reserva (201).',
  })
  @ApiBody({ type: CrearReservaDto })
  @ApiCreatedResponse({
    description: 'Reserva creada exitosamente',
    type: ReservaCreadaResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'Datos obligatorios ausentes o inválidos (servicio/barbero/fecha/hora, o contacto del invitado)',
  })
  @ApiUnauthorizedResponse({ description: 'Token presente pero inválido o expirado' })
  @ApiNotFoundResponse({
    description: 'El servicio o el barbero no existen, o el barbero no presta el servicio',
  })
  @ApiConflictResponse({
    description:
      'La franja ya no está disponible (409) o el cliente ya tiene una reserva en ese horario',
  })
  @ApiResponse({
    status: 503,
    description:
      'La disponibilidad no puede calcularse de forma segura (fail-closed de HE-08)',
  })
  async crearReserva(
    @Body() dto: CrearReservaDto,
    @Req() request: { user?: unknown },
  ): Promise<ReservaCreadaResponseDto> {
    return this.reservasService.crearReserva(
      dto,
      this.extraerIdentidad(request.user),
    );
  }

  /**
   * Traduce el payload JWT a la identidad de cliente. Devuelve `undefined`
   * cuando no hay token (invitado) o cuando el payload no expone un usuario
   * válido, para que el servicio aplique las reglas del invitado.
   */
  private extraerIdentidad(
    usuario: unknown,
  ): IdentidadClienteAutenticado | undefined {
    if (!usuario || typeof usuario !== 'object') {
      return undefined;
    }

    const payload = usuario as Record<string, unknown>;
    const usuarioId = Number(payload.id ?? payload.sub);

    if (!Number.isInteger(usuarioId) || usuarioId <= 0) {
      return undefined;
    }

    return {
      usuarioId,
      nombre: this.aTexto(payload.nombre),
      apellido: this.aTexto(payload.apellido),
    };
  }

  private aTexto(valor: unknown): string {
    return typeof valor === 'string' ? valor : '';
  }
}
