import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../auth/roles/roles.guard';
import { Roles } from '../../../auth/roles/roles.decorator';
import { ConfiguracionService } from '../service/configuracion.service';
import { NegocioContextoService } from '../../negocios/negocio-contexto.service';
import {
  CLAVES_CONFIGURACION,
  LIMITES_CITAS_DIARIAS,
  LIMITES_MINUTOS_OPERATIVOS,
  VALORES_POR_DEFECTO_OPERATIVOS,
} from '../configuracion.constants';
import {
  ActualizarPoliticasReservaDto,
  PoliticasReservaResponseDto,
} from '../dto/politicas-reserva.dto';

/**
 * Controlador de políticas operativas de la barbería.
 *
 * Expone la lectura y actualización de las políticas de reserva (antelación,
 * tolerancia y límite de turnos diarios por cliente) en el ámbito del negocio activo.
 */
@ApiTags('configuracion')
@Controller('configuracion/politicas')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPERADMIN', 'ADMINISTRADOR')
@ApiBearerAuth()
export class ConfiguracionPoliticasController {
  constructor(
    private readonly configuracionService: ConfiguracionService,
    private readonly contextoService: NegocioContextoService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Obtiene las políticas operativas de reserva de la barbería',
    description:
      'Devuelve las políticas efectivas de la barbería activa: antelación mínima para cancelar, tolerancia para No-Show y límite máximo de citas diarias por cliente.',
  })
  @ApiResponse({
    status: 200,
    description: 'Políticas operativas de la barbería',
    type: PoliticasReservaResponseDto,
  })
  async obtenerPoliticas(): Promise<PoliticasReservaResponseDto> {
    const [cancelacion, noShow, maxCitas] = await Promise.all([
      this.configuracionService.obtenerNumero(
        CLAVES_CONFIGURACION.RESERVA_CANCELACION_ANTELACION_MINUTOS,
        VALORES_POR_DEFECTO_OPERATIVOS.RESERVA_CANCELACION_ANTELACION_MINUTOS,
        LIMITES_MINUTOS_OPERATIVOS,
      ),
      this.configuracionService.obtenerNumero(
        CLAVES_CONFIGURACION.RESERVA_NO_SHOW_TOLERANCIA_MINUTOS,
        VALORES_POR_DEFECTO_OPERATIVOS.RESERVA_NO_SHOW_TOLERANCIA_MINUTOS,
        LIMITES_MINUTOS_OPERATIVOS,
      ),
      this.configuracionService.obtenerNumero(
        CLAVES_CONFIGURACION.RESERVA_MAX_CITAS_DIARIAS_CLIENTE,
        VALORES_POR_DEFECTO_OPERATIVOS.RESERVA_MAX_CITAS_DIARIAS_CLIENTE,
        LIMITES_CITAS_DIARIAS,
      ),
    ]);

    return {
      reservaCancelacionAntelacionMinutos: cancelacion,
      reservaNoShowToleranciaMinutos: noShow,
      reservaMaxCitasDiariasCliente: maxCitas,
    };
  }

  @Put()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Actualiza las políticas operativas de reserva de la barbería',
    description:
      'Persiste los nuevos valores de políticas operativas en la configuración del negocio activo e invalida la caché de forma atómica.',
  })
  @ApiBody({ type: ActualizarPoliticasReservaDto })
  @ApiResponse({
    status: 200,
    description: 'Políticas actualizadas correctamente',
    type: PoliticasReservaResponseDto,
  })
  async actualizarPoliticas(
    @Body() dto: ActualizarPoliticasReservaDto,
  ): Promise<PoliticasReservaResponseDto> {
    const contexto = this.contextoService.obtenerContextoRequerido();

    await Promise.all([
      this.configuracionService.guardarNumero(
        contexto.id,
        CLAVES_CONFIGURACION.RESERVA_CANCELACION_ANTELACION_MINUTOS,
        dto.reservaCancelacionAntelacionMinutos,
      ),
      this.configuracionService.guardarNumero(
        contexto.id,
        CLAVES_CONFIGURACION.RESERVA_NO_SHOW_TOLERANCIA_MINUTOS,
        dto.reservaNoShowToleranciaMinutos,
      ),
      this.configuracionService.guardarNumero(
        contexto.id,
        CLAVES_CONFIGURACION.RESERVA_MAX_CITAS_DIARIAS_CLIENTE,
        dto.reservaMaxCitasDiariasCliente,
      ),
    ]);

    return {
      reservaCancelacionAntelacionMinutos:
        dto.reservaCancelacionAntelacionMinutos,
      reservaNoShowToleranciaMinutos: dto.reservaNoShowToleranciaMinutos,
      reservaMaxCitasDiariasCliente: dto.reservaMaxCitasDiariasCliente,
    };
  }
}
