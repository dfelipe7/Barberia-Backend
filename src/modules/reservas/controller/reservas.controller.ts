import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CrearReservaDto } from '../dto/dto-peticion/crear-reserva.dto';
import { ModificarReservaDto } from '../dto/dto-peticion/modificar-reserva.dto';
import { ConsultaAgendaBarberoDto } from '../dto/dto-peticion/consulta-agenda-barbero.dto';
import { ConsultaAgendaSemanalDto } from '../dto/dto-peticion/consulta-agenda-semanal.dto';
import { ReservaCreadaResponseDto } from '../dto/dto-respuesta/reserva-creada-response.dto';
import { ReservaModificadaResponseDto } from '../dto/dto-respuesta/reserva-modificada-response.dto';
import { ReservaCanceladaResponseDto } from '../dto/dto-respuesta/reserva-cancelada-response.dto';
import { ReservaClienteDto } from '../dto/dto-respuesta/reserva-cliente.dto';
import { MisReservasResponseDto } from '../dto/dto-respuesta/mis-reservas-response.dto';
import {
  AgendaBarberoResponseDto,
  AgendaSemanalBarberoResponseDto,
} from '../dto/dto-respuesta/agenda-barbero-response.dto';
import {
  IdentidadClienteAutenticado,
  ReservasService,
} from '../service/reservas.service';
import { ClienteOpcionalJwtAuthGuard } from '../../../auth/clientes/guards/cliente-opcional-jwt-auth.guard';
import { ClienteJwtAuthGuard } from '../../../auth/clientes/guards/cliente-jwt-auth.guard';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../auth/roles/roles.guard';
import { Roles } from '../../../auth/roles/roles.decorator';

/** Petición con la identidad de cliente que publica el guard de cliente. */
interface PeticionConCliente {
  cliente?: { clienteId: number };
}

/**
 * Endpoints de reservas de HE-04.
 *
 * - `POST /reservas`: creación en las dos modalidades de D-01 (invitado sin
 *   token; cliente autenticado con token de cliente).
 * - `GET /reservas/me`: reservas propias (HU-06), próximas primero.
 * - `GET /reservas/me/:reservaId`: detalle de una reserva propia (HU-07).
 * - `GET /reservas/barbero/me`: agenda de reservas del barbero autenticado.
 *
 * Las rutas `/me` exigen un token de CLIENTE; el `clienteId` se toma del token
 * verificado, nunca de parámetros del frontend. La ruta `/barbero/me` exige
 * token de personal con rol BARBERO.
 */
@ApiTags('reservas')
@Controller('reservas')
export class ReservasController {
  constructor(private readonly reservasService: ReservasService) {}

  @Post()
  @UseGuards(ClienteOpcionalJwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Crear una reserva para un cliente invitado o autenticado',
    description:
      'Endpoint que acepta ambas modalidades: sin token crea una reserva de invitado (exige nombre y teléfono); con un token de cliente válido asocia la reserva al cliente autenticado. Valida servicio, barbero, fecha y hora (400), servicio/barbero inexistentes o no asignados (404), franja ocupada o duplicada (409) y devuelve el identificador de la reserva (201).',
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
  @ApiUnauthorizedResponse({
    description: 'Token de cliente presente pero inválido o expirado',
  })
  @ApiNotFoundResponse({
    description:
      'El servicio o el barbero no existen, o el barbero no presta el servicio',
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
    @Req() request: PeticionConCliente,
  ): Promise<ReservaCreadaResponseDto> {
    return this.reservasService.crearReserva(
      dto,
      this.extraerIdentidad(request.cliente),
    );
  }

  @Get('barbero/me/agenda')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('BARBERO')
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Consultar la agenda de reservas del barbero en un rango de fechas (vista semanal)',
    description:
      'Devuelve las citas activas del barbero autenticado en un rango de hasta 7 días consecutivos (desde/hasta en formato YYYY-MM-DD), ordenadas cronológicamente por fecha y hora de inicio.',
  })
  @ApiOkResponse({
    description: 'Agenda de reservas para el rango solicitado',
    type: AgendaSemanalBarberoResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'Parámetros desde/hasta inválidos, invertidos o rango superior a 7 días',
  })
  @ApiUnauthorizedResponse({
    description: 'No autenticado o token de personal inválido/expirado',
  })
  @ApiForbiddenResponse({
    description:
      'El usuario no tiene rol BARBERO, carece de perfil de barbero o se encuentra inactivo',
  })
  async obtenerMiAgendaSemanal(
    @Req() request: any,
    @Query() consulta: ConsultaAgendaSemanalDto,
  ): Promise<AgendaSemanalBarberoResponseDto> {
    return this.reservasService.obtenerAgendaSemanalBarbero(
      request.user,
      consulta,
    );
  }

  @Get('barbero/me')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('BARBERO')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Consultar la agenda de reservas del barbero autenticado',
    description:
      'Devuelve las citas activas del barbero autenticado para una fecha dada (YYYY-MM-DD), ordenadas cronológicamente por hora de inicio, con los datos de contacto del cliente y del servicio.',
  })
  @ApiOkResponse({
    description: 'Agenda de reservas para la fecha solicitada',
    type: AgendaBarberoResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'Fecha obligatoria ausente o inválida (se espera formato YYYY-MM-DD de calendario)',
  })
  @ApiUnauthorizedResponse({
    description: 'No autenticado o token de personal inválido/expirado',
  })
  @ApiForbiddenResponse({
    description:
      'El usuario no tiene rol BARBERO, carece de perfil de barbero o se encuentra inactivo',
  })
  async obtenerMiAgenda(
    @Req() request: any,
    @Query() consulta: ConsultaAgendaBarberoDto,
  ): Promise<AgendaBarberoResponseDto> {
    return this.reservasService.obtenerAgendaBarbero(
      request.user,
      consulta,
    );
  }

  @Get('me')
  @UseGuards(ClienteJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Listar mis reservas (cliente autenticado)',
    description:
      'Devuelve las reservas del cliente autenticado con su servicio, barbero, fecha, hora y estado, ordenadas próximas primero. Sin reservas responde una lista vacía con el mensaje "No tienes reservas registradas".',
  })
  @ApiOkResponse({ type: MisReservasResponseDto })
  @ApiUnauthorizedResponse({
    description: 'Token de cliente ausente, inválido o expirado',
  })
  async listarMisReservas(
    @Req() request: PeticionConCliente,
  ): Promise<MisReservasResponseDto> {
    return this.reservasService.listarMisReservas(
      this.extraerIdentidadRequerida(request.cliente),
    );
  }

  @Get('me/:reservaId')
  @UseGuards(ClienteJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Consultar el detalle de una reserva propia (cliente autenticado)',
    description:
      'Devuelve servicio, barbero, fecha, hora, precio aplicado y estado de una reserva del cliente autenticado. Si la reserva no existe o pertenece a otro cliente, responde 404 con "La reserva no se encuentra disponible".',
  })
  @ApiParam({
    name: 'reservaId',
    example: 42,
    description: 'Identificador de la reserva',
  })
  @ApiOkResponse({ type: ReservaClienteDto })
  @ApiBadRequestResponse({ description: 'Identificador de reserva inválido' })
  @ApiUnauthorizedResponse({
    description: 'Token de cliente ausente, inválido o expirado',
  })
  @ApiNotFoundResponse({ description: 'La reserva no se encuentra disponible' })
  async obtenerMiReserva(
    @Req() request: PeticionConCliente,
    @Param('reservaId', ParseIntPipe) reservaId: number,
  ): Promise<ReservaClienteDto> {
    if (reservaId <= 0) {
      throw new BadRequestException(
        'El identificador de la reserva debe ser un entero positivo',
      );
    }

    return this.reservasService.obtenerMiReserva(
      this.extraerIdentidadRequerida(request.cliente),
      reservaId,
    );
  }

  @Patch('me/:reservaId')
  @UseGuards(ClienteJwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Modificar una reserva propia (cliente autenticado)',
    description:
      'Permite cambiar de forma parcial la fecha, hora o barbero de una reserva del cliente autenticado. Valida la disponibilidad mediante HE-08 y garantiza atómicamente la reserva sin riesgo de dobles reservas. Si el nuevo horario no está disponible, responde 409 con "El horario seleccionado no está disponible".',
  })
  @ApiParam({
    name: 'reservaId',
    example: 42,
    description: 'Identificador de la reserva a modificar',
  })
  @ApiBody({ type: ModificarReservaDto })
  @ApiOkResponse({
    description: 'Reserva modificada correctamente',
    type: ReservaModificadaResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'Parámetros o cuerpo inválidos, solicitud vacía o servicio no prestado por el barbero destino',
  })
  @ApiUnauthorizedResponse({
    description: 'Token de cliente ausente, inválido o expirado',
  })
  @ApiNotFoundResponse({
    description: 'La reserva no se encuentra disponible',
  })
  @ApiConflictResponse({
    description:
      'El horario seleccionado no está disponible o el estado actual de la reserva no permite modificarla',
  })
  async modificarMiReserva(
    @Req() request: PeticionConCliente,
    @Param('reservaId', ParseIntPipe) reservaId: number,
    @Body() dto: ModificarReservaDto,
  ): Promise<ReservaModificadaResponseDto> {
    if (reservaId <= 0) {
      throw new BadRequestException(
        'El identificador de la reserva debe ser un entero positivo',
      );
    }

    return this.reservasService.modificarReserva(
      this.extraerIdentidadRequerida(request.cliente),
      reservaId,
      dto,
    );
  }

  @Patch('me/:reservaId/cancelar')
  @UseGuards(ClienteJwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Cancelar una reserva propia (cliente autenticado)',
    description:
      'Transiciona la reserva al estado CANCELLED, liberando la franja de agenda para nuevas reservas. Si la petición se repite para una reserva ya cancelada, se responde de forma idempotente sin duplicar efectos secundarios.',
  })
  @ApiParam({
    name: 'reservaId',
    example: 42,
    description: 'Identificador de la reserva a cancelar',
  })
  @ApiOkResponse({
    description: 'Reserva cancelada correctamente',
    type: ReservaCanceladaResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Identificador de reserva inválido',
  })
  @ApiUnauthorizedResponse({
    description: 'Token de cliente ausente, inválido o expirado',
  })
  @ApiNotFoundResponse({
    description: 'La reserva no se encuentra disponible',
  })
  @ApiConflictResponse({
    description:
      'El estado actual de la reserva no permite cancelarla (por ejemplo, COMPLETED o IN_PROGRESS)',
  })
  async cancelarMiReserva(
    @Req() request: PeticionConCliente,
    @Param('reservaId', ParseIntPipe) reservaId: number,
  ): Promise<ReservaCanceladaResponseDto> {
    if (reservaId <= 0) {
      throw new BadRequestException(
        'El identificador de la reserva debe ser un entero positivo',
      );
    }

    return this.reservasService.cancelarReserva(
      this.extraerIdentidadRequerida(request.cliente),
      reservaId,
    );
  }

  /**
   * Traduce la identidad publicada por el guard a la del servicio. Devuelve
   * `undefined` cuando la petición es de invitado (sin token).
   */
  private extraerIdentidad(
    cliente: unknown,
  ): IdentidadClienteAutenticado | undefined {
    if (!cliente || typeof cliente !== 'object') {
      return undefined;
    }

    const clienteId = Number((cliente as { clienteId?: unknown }).clienteId);

    if (!Number.isInteger(clienteId) || clienteId <= 0) {
      return undefined;
    }

    return { clienteId };
  }

  /**
   * Variante para rutas que exigen cliente: el guard ya garantiza la identidad,
   * pero se revalida como defensa en profundidad.
   */
  private extraerIdentidadRequerida(
    cliente: unknown,
  ): IdentidadClienteAutenticado {
    const identidad = this.extraerIdentidad(cliente);

    if (!identidad) {
      throw new UnauthorizedException('Token de cliente requerido');
    }

    return identidad;
  }
}
