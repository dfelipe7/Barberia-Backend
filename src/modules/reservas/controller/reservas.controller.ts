import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  NotFoundException,
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
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CrearReservaDto } from '../dto/dto-peticion/crear-reserva.dto';
import { CrearReservaAdminDto } from '../dto/dto-peticion/crear-reserva-admin.dto';
import { FiltroReservasAdminDto } from '../dto/dto-peticion/filtro-reservas-admin.dto';
import { ModificarReservaDto } from '../dto/dto-peticion/modificar-reserva.dto';
import { ConsultaAgendaBarberoDto } from '../dto/dto-peticion/consulta-agenda-barbero.dto';
import { ConsultaAgendaSemanalDto } from '../dto/dto-peticion/consulta-agenda-semanal.dto';
import { ReservaCreadaResponseDto } from '../dto/dto-respuesta/reserva-creada-response.dto';
import { ReservaModificadaResponseDto } from '../dto/dto-respuesta/reserva-modificada-response.dto';
import { ReservaCanceladaResponseDto } from '../dto/dto-respuesta/reserva-cancelada-response.dto';
import { ReservaCompletadaResponseDto } from '../dto/dto-respuesta/reserva-completada-response.dto';
import { ReservaNoShowResponseDto } from '../dto/dto-respuesta/reserva-no-show-response.dto';
import { ReservaClienteDto } from '../dto/dto-respuesta/reserva-cliente.dto';
import { ReservaAdminDetalleDto } from '../dto/dto-respuesta/reserva-admin-detalle.dto';
import { MisReservasResponseDto } from '../dto/dto-respuesta/mis-reservas-response.dto';
import {
  AgendaBarberoResponseDto,
  AgendaSemanalBarberoResponseDto,
} from '../dto/dto-respuesta/agenda-barbero-response.dto';
import {
  IdentidadClienteAutenticado,
  MENSAJE_RESERVA_NO_DISPONIBLE,
  ReservasService,
} from '../service/reservas.service';
import { ClienteOpcionalJwtAuthGuard } from '../../../auth/clientes/guards/cliente-opcional-jwt-auth.guard';
import { REGEX_UUID_V4 } from '../common/regex-uuid-v4';
import { ClienteJwtAuthGuard } from '../../../auth/clientes/guards/cliente-jwt-auth.guard';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../auth/roles/roles.guard';
import { Roles } from '../../../auth/roles/roles.decorator';

/** Petición con la identidad de cliente que publica el guard de cliente. */
interface PeticionConCliente {
  cliente?: { clienteId: number };
}

/** Petición con la identidad del personal autenticado (rol e id del token). */
interface PeticionPersonal {
  user?: { id?: number; sub?: string; rol?: string; roles?: string[] };
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
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description:
      'UUID v4 que identifica ESTE intento de reserva. Si la petición se reintenta con la misma clave, se devuelve la reserva original en lugar de crear otra. Reutilizar la clave con una reserva distinta devuelve 409 (IDEMPOTENCY_KEY_CONFLICT).',
  })
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
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<ReservaCreadaResponseDto> {
    return this.reservasService.crearReserva(
      dto,
      this.extraerIdentidad(request.cliente),
      this.validarClaveDeIdempotencia(idempotencyKey),
    );
  }

  /**
   * Valida la cabecera `Idempotency-Key`.
   *
   * Contrato: UUID v4. Si la cabecera no viene, la reserva se crea sin
   * idempotencia (comportamiento histórico). Si viene pero NO es un UUID v4
   * válido, se rechaza con 400: una clave mal formada no puede degradarse
   * silenciosamente a "sin idempotencia".
   */
  private validarClaveDeIdempotencia(clave?: string): string | undefined {
    if (clave === undefined || clave.trim() === '') {
      return undefined;
    }

    const normalizada = clave.trim();

    if (!REGEX_UUID_V4.test(normalizada)) {
      throw new BadRequestException(
        'La cabecera Idempotency-Key debe contener un UUID v4 válido.',
      );
    }

    return normalizada.toLowerCase();
  }

  @Post('admin')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN', 'ADMINISTRADOR')
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Crear una reserva desde administración (HU-13)',
    description:
      'Permite a ADMINISTRADOR y SUPERADMIN agendar una reserva para un cliente registrado (indicando clienteId) o para un cliente ocasional (indicando nombre y teléfono). Valida servicio, barbero, asignación, disponibilidad y duplicados transaccionalmente.',
  })
  @ApiBody({ type: CrearReservaAdminDto })
  @ApiCreatedResponse({
    description: 'Reserva creada exitosamente',
    type: ReservaCreadaResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'Datos obligatorios inválidos o ausentes para cliente ocasional o reserva',
  })
  @ApiUnauthorizedResponse({
    description: 'No autenticado o token de personal inválido',
  })
  @ApiForbiddenResponse({
    description: 'Rol no autorizado (requiere ADMINISTRADOR o SUPERADMIN)',
  })
  @ApiNotFoundResponse({
    description: 'Servicio, barbero o cliente registrado no encontrado',
  })
  @ApiConflictResponse({
    description: 'Horario ocupado o cliente ya cuenta con reserva duplicada',
  })
  async crearReservaAdmin(
    @Body() dto: CrearReservaAdminDto,
  ): Promise<ReservaCreadaResponseDto> {
    return this.reservasService.crearReservaAdmin(dto);
  }

  @Get('admin/clientes')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN', 'ADMINISTRADOR')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Buscar clientes registrados para creación administrativa (HU-13-CA-02)',
    description:
      'Busca clientes por coincidencia en nombre, apellido, teléfono o correo.',
  })
  @ApiOkResponse({ description: 'Lista de clientes coincidentes' })
  async buscarClientesAdmin(@Query('termino') termino?: string) {
    return this.reservasService.buscarClientesAdmin(termino ?? '');
  }

  @Get('admin')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN', 'ADMINISTRADOR')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Consultar reservas de la barbería con filtros (SUPERADMIN / ADMINISTRADOR)',
    description:
      'Permite a SUPERADMIN y ADMINISTRADOR consultar las reservas de todos los barberos con filtros aplicados directamente en la base de datos (fecha puntual, rango desde/hasta, barberoId, estado, clienteId).',
  })
  @ApiOkResponse({
    description: 'Listado de reservas que coinciden con los filtros',
    type: [ReservaAdminDetalleDto],
  })
  @ApiUnauthorizedResponse({ description: 'No autenticado o token inválido' })
  @ApiForbiddenResponse({
    description: 'Acceso restringido a SUPERADMIN y ADMINISTRADOR',
  })
  async listarReservasAdmin(
    @Query() filtro: FiltroReservasAdminDto,
  ): Promise<ReservaAdminDetalleDto[]> {
    return this.reservasService.listarReservasAdmin(filtro);
  }

  @Get('admin/:reservaId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN', 'ADMINISTRADOR')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Consultar el detalle de cualquier reserva de la barbería (SUPERADMIN / ADMINISTRADOR)',
    description:
      'Devuelve la información completa de la reserva, cliente, barbero y servicio sin importar a quién pertenezca.',
  })
  @ApiParam({ name: 'reservaId', example: 42, description: 'ID de la reserva' })
  @ApiOkResponse({
    description: 'Detalle de la reserva obtenido exitosamente',
    type: ReservaAdminDetalleDto,
  })
  @ApiBadRequestResponse({ description: 'Identificador de reserva inválido' })
  @ApiNotFoundResponse({ description: 'La reserva no se encuentra disponible' })
  @ApiForbiddenResponse({
    description: 'Acceso restringido a SUPERADMIN y ADMINISTRADOR',
  })
  async obtenerReservaAdmin(
    @Param('reservaId', ParseIntPipe) reservaId: number,
  ): Promise<ReservaAdminDetalleDto> {
    if (reservaId <= 0) {
      throw new BadRequestException(
        'El identificador de la reserva debe ser un entero positivo',
      );
    }
    return this.reservasService.obtenerReservaAdmin(reservaId);
  }

  @Patch('admin/:reservaId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN', 'ADMINISTRADOR')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Modificar una reserva de cualquier barbero (SUPERADMIN / ADMINISTRADOR)',
    description:
      'Permite a SUPERADMIN y ADMINISTRADOR reasignar barbero, fecha u hora a cualquier reserva activa respetando las reglas de disponibilidad de HE-08.',
  })
  @ApiParam({ name: 'reservaId', example: 42, description: 'ID de la reserva' })
  @ApiBody({ type: ModificarReservaDto })
  @ApiOkResponse({
    description: 'Reserva modificada correctamente',
    type: ReservaModificadaResponseDto,
  })
  @ApiConflictResponse({
    description:
      'El horario seleccionado no está disponible o el estado no es modificable',
  })
  @ApiNotFoundResponse({ description: 'La reserva no se encuentra disponible' })
  @ApiForbiddenResponse({
    description: 'Acceso restringido a SUPERADMIN y ADMINISTRADOR',
  })
  async modificarReservaAdmin(
    @Param('reservaId', ParseIntPipe) reservaId: number,
    @Body() dto: ModificarReservaDto,
  ): Promise<ReservaModificadaResponseDto> {
    if (reservaId <= 0) {
      throw new BadRequestException(
        'El identificador de la reserva debe ser un entero positivo',
      );
    }
    return this.reservasService.modificarReservaAdmin(reservaId, dto);
  }

  @Patch('admin/:reservaId/cancelar')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN', 'ADMINISTRADOR')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Cancelar una reserva de cualquier barbero (SUPERADMIN / ADMINISTRADOR)',
    description:
      'Permite a SUPERADMIN y ADMINISTRADOR cancelar cualquier reserva activa de la barbería liberando la agenda.',
  })
  @ApiParam({ name: 'reservaId', example: 42, description: 'ID de la reserva' })
  @ApiOkResponse({
    description: 'Reserva cancelada correctamente',
    type: ReservaCanceladaResponseDto,
  })
  @ApiNotFoundResponse({ description: 'La reserva no se encuentra disponible' })
  @ApiConflictResponse({
    description: 'El estado actual no permite cancelación',
  })
  @ApiForbiddenResponse({
    description: 'Acceso restringido a SUPERADMIN y ADMINISTRADOR',
  })
  async cancelarReservaAdmin(
    @Param('reservaId', ParseIntPipe) reservaId: number,
  ): Promise<ReservaCanceladaResponseDto> {
    if (reservaId <= 0) {
      throw new BadRequestException(
        'El identificador de la reserva debe ser un entero positivo',
      );
    }
    return this.reservasService.cancelarReservaAdmin(reservaId);
  }

  @Patch(':reservaId/completar')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('BARBERO', 'ADMINISTRADOR', 'SUPERADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Marcar una reserva como completada (SCRUM-277)',
    description:
      'Transiciona la reserva al estado COMPLETED. Disponible para BARBERO (solo sus propias reservas), ADMINISTRADOR y SUPERADMIN. Solo se permite cuando ya pasó la hora de finalización de la cita; es idempotente si la reserva ya está completada y rechaza reservas canceladas. Al completarse, notifica al cliente por WhatsApp.',
  })
  @ApiParam({ name: 'reservaId', example: 42, description: 'ID de la reserva' })
  @ApiOkResponse({
    description: 'Reserva completada correctamente',
    type: ReservaCompletadaResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Identificador de reserva inválido' })
  @ApiUnauthorizedResponse({
    description: 'No autenticado o token de personal inválido/expirado',
  })
  @ApiForbiddenResponse({
    description:
      'El usuario no tiene rol autorizado o no posee perfil de barbero activo',
  })
  @ApiNotFoundResponse({
    description: 'La reserva no se encuentra disponible',
  })
  @ApiConflictResponse({
    description:
      'La reserva está cancelada o aún no ha finalizado su franja horaria',
  })
  async completarReserva(
    @Req() request: PeticionPersonal,
    @Param('reservaId', ParseIntPipe) reservaId: number,
  ): Promise<ReservaCompletadaResponseDto> {
    if (reservaId <= 0) {
      throw new BadRequestException(
        'El identificador de la reserva debe ser un entero positivo',
      );
    }

    return this.reservasService.completarReserva(
      request.user,
      request.user?.roles,
      reservaId,
    );
  }

  @Patch(':reservaId/no-show')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('BARBERO', 'ADMINISTRADOR', 'SUPERADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Marcar una reserva como no asistida (NO_SHOW)',
    description:
      'Transiciona la reserva al estado NO_SHOW cuando el cliente no asistió. Disponible para BARBERO (solo sus propias reservas), ADMINISTRADOR y SUPERADMIN. Solo se permite una vez transcurrida la tolerancia configurada desde la hora de inicio; es idempotente si la reserva ya está en NO_SHOW y rechaza reservas canceladas o completadas.',
  })
  @ApiParam({ name: 'reservaId', example: 42, description: 'ID de la reserva' })
  @ApiOkResponse({
    description: 'Reserva marcada como no asistida correctamente',
    type: ReservaNoShowResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Identificador de reserva inválido' })
  @ApiUnauthorizedResponse({
    description: 'No autenticado o token de personal inválido/expirado',
  })
  @ApiForbiddenResponse({
    description:
      'El usuario no tiene rol autorizado o no posee perfil de barbero activo',
  })
  @ApiNotFoundResponse({
    description: 'La reserva no se encuentra disponible',
  })
  @ApiConflictResponse({
    description:
      'La reserva está cancelada/completada o aún no ha transcurrido la tolerancia desde su hora de inicio',
  })
  async marcarNoShow(
    @Req() request: PeticionPersonal,
    @Param('reservaId', ParseIntPipe) reservaId: number,
  ): Promise<ReservaNoShowResponseDto> {
    if (reservaId <= 0) {
      throw new BadRequestException(
        'El identificador de la reserva debe ser un entero positivo',
      );
    }

    return this.reservasService.noShowReserva(
      request.user,
      request.user?.roles,
      reservaId,
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
    return this.reservasService.obtenerAgendaBarbero(request.user, consulta);
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

  @Get('invitado/:reservaId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Consultar el detalle de una reserva de invitado mediante token de gestión',
    description:
      'Permite a un cliente invitado consultar el estado y datos de su reserva mediante su token de gestión provisto en el encabezado X-Reservation-Management-Token o en el query param "token".',
  })
  @ApiParam({
    name: 'reservaId',
    example: 42,
    description: 'Identificador de la reserva a consultar',
  })
  @ApiHeader({
    name: 'X-Reservation-Management-Token',
    description: 'Token de gestión de la reserva',
    required: false,
  })
  async obtenerReservaInvitado(
    @Param('reservaId', ParseIntPipe) reservaId: number,
    @Headers('x-reservation-management-token') tokenHeader?: string,
    @Query('token') tokenQuery?: string,
  ) {
    if (reservaId <= 0) {
      throw new BadRequestException(
        'El identificador de la reserva debe ser un entero positivo',
      );
    }

    const token = (tokenHeader || tokenQuery || '').trim();
    if (!token) {
      throw new NotFoundException(MENSAJE_RESERVA_NO_DISPONIBLE);
    }

    return this.reservasService.obtenerReservaInvitado(reservaId, token);
  }

  @Patch('invitado/:reservaId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Modificar una reserva de invitado mediante token de gestión',
    description:
      'Permite a un cliente invitado modificar de forma segura su reserva sin iniciar sesión, suministrando el token de gestión exclusivamente en el encabezado HTTP X-Reservation-Management-Token. No se admite el envío de credenciales por URL ni en el cuerpo JSON. Si la reserva no existe o el token es incorrecto, ausente o vacío, responde con 404 ("La reserva no se encuentra disponible") para evitar filtración de existencia de reservas.',
  })
  @ApiParam({
    name: 'reservaId',
    example: 42,
    description: 'Identificador de la reserva a modificar',
  })
  @ApiHeader({
    name: 'X-Reservation-Management-Token',
    description:
      'Token de gestión entregado al crear la reserva de invitado (único canal autorizado de credencial)',
    required: true,
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
  @ApiNotFoundResponse({
    description:
      'La reserva no se encuentra disponible (reserva inexistente o credencial de gestión ausente/inválida)',
  })
  @ApiConflictResponse({
    description:
      'El horario seleccionado no está disponible o el estado actual de la reserva no permite modificarla',
  })
  async modificarReservaInvitado(
    @Param('reservaId', ParseIntPipe) reservaId: number,
    @Headers('x-reservation-management-token') tokenGestion: string | undefined,
    @Query('token') tokenQuery: string | undefined,
    @Body() dto: ModificarReservaDto,
  ): Promise<ReservaModificadaResponseDto> {
    if (reservaId <= 0) {
      throw new BadRequestException(
        'El identificador de la reserva debe ser un entero positivo',
      );
    }

    const token = (tokenGestion || tokenQuery || '').trim();
    if (!token) {
      throw new NotFoundException(MENSAJE_RESERVA_NO_DISPONIBLE);
    }

    return this.reservasService.modificarReservaInvitado(reservaId, token, dto);
  }

  @Patch('invitado/:reservaId/cancelar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancelar una reserva de invitado mediante token de gestión',
    description:
      'Permite a un cliente invitado cancelar su propia reserva sin iniciar sesión, suministrando el token de gestión exclusivamente en el encabezado HTTP X-Reservation-Management-Token. No se admite el envío de credenciales por URL ni en el cuerpo JSON. Si la reserva no existe o el token es incorrecto, ausente o vacío, responde con 404 ("La reserva no se encuentra disponible") para evitar filtración de existencia de reservas.',
  })
  @ApiParam({
    name: 'reservaId',
    example: 42,
    description: 'Identificador de la reserva a cancelar',
  })
  @ApiHeader({
    name: 'X-Reservation-Management-Token',
    description:
      'Token de gestión entregado al crear la reserva de invitado (único canal autorizado de credencial)',
    required: true,
  })
  @ApiOkResponse({
    description: 'Reserva cancelada correctamente',
    type: ReservaCanceladaResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Identificador de reserva inválido',
  })
  @ApiNotFoundResponse({
    description:
      'La reserva no se encuentra disponible (reserva inexistente o credencial de gestión ausente/inválida)',
  })
  @ApiConflictResponse({
    description:
      'El estado actual de la reserva no permite cancelarla (por ejemplo, COMPLETED o IN_PROGRESS)',
  })
  async cancelarReservaInvitado(
    @Param('reservaId', ParseIntPipe) reservaId: number,
    @Headers('x-reservation-management-token') tokenGestion: string | undefined,
    @Query('token') tokenQuery: string | undefined,
  ): Promise<ReservaCanceladaResponseDto> {
    if (reservaId <= 0) {
      throw new BadRequestException(
        'El identificador de la reserva debe ser un entero positivo',
      );
    }

    const token = (tokenGestion || tokenQuery || '').trim();
    if (!token) {
      throw new NotFoundException(MENSAJE_RESERVA_NO_DISPONIBLE);
    }

    return this.reservasService.cancelarReservaInvitado(reservaId, token);
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
