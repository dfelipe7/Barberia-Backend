import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { WhatsAppService } from './whatsapp.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles/roles.guard';
import { Roles } from '../../auth/roles/roles.decorator';
import { ActualizarPlantillasDto } from './dto/actualizar-plantillas.dto';

@ApiTags('whatsapp')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPERADMIN', 'ADMINISTRADOR')
@Controller('whatsapp')
export class WhatsAppController {
  constructor(private readonly whatsappService: WhatsAppService) {}

  /**
   * Obtiene el estado actual de la conexión de WhatsApp y el QR si está pendiente.
   * Requiere rol ADMINISTRADOR o SUPERADMIN.
   */
  @Get('status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Estado de WhatsApp y QR',
    description: 'Devuelve si el socket está conectado o la imagen Base64 del código QR para vincular.',
  })
  @ApiOkResponse({
    description: 'Estado de conexión obtenido exitosamente.',
    schema: {
      type: 'object',
      properties: {
        conectado: { type: 'boolean', example: false },
        qr: {
          type: 'string',
          nullable: true,
          example: 'data:image/png;base64,iVBORw0KGgo...',
        },
      },
    },
  })
  @ApiUnauthorizedResponse({ description: 'No autorizado o token inválido/expirado.' })
  getStatus() {
    return this.whatsappService.getStatus();
  }

  /**
   * Reactiva el socket bajo demanda para generar un código QR nuevo.
   * Requiere rol ADMINISTRADOR o SUPERADMIN.
   */
  @Post('iniciar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Iniciar / Despertar WhatsApp',
    description: 'Reactiva el socket bajo demanda y comienza la generación de código QR para vincular.',
  })
  @ApiOkResponse({
    description: 'Conexión de WhatsApp iniciada exitosamente.',
    schema: {
      type: 'object',
      properties: {
        mensaje: { type: 'string', example: 'Iniciando WhatsApp...' },
      },
    },
  })
  @ApiUnauthorizedResponse({ description: 'No autorizado o token inválido/expirado.' })
  iniciar() {
    return this.whatsappService.iniciar();
  }

  /**
   * Pone la conexión de WhatsApp en modo reposo si no está conectado ni tiene sesión guardada.
   * Cierra el socket para evitar consumo de recursos.
   * Requiere rol ADMINISTRADOR o SUPERADMIN.
   */
  @Post('pausar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Pausar WhatsApp (Modo Reposo)',
    description: 'Cierra el socket de WhatsApp para no generar códigos QR innecesarios si no se está escaneando.',
  })
  @ApiOkResponse({
    description: 'WhatsApp puesto en modo reposo.',
    schema: {
      type: 'object',
      properties: {
        mensaje: { type: 'string', example: 'WhatsApp en modo reposo.' },
      },
    },
  })
  @ApiUnauthorizedResponse({ description: 'No autorizado o token inválido/expirado.' })
  pausar() {
    return this.whatsappService.pausar();
  }

  /**
   * Obtiene las plantillas de mensajes configuradas para confirmación y recordatorios.
   * Requiere rol ADMINISTRADOR o SUPERADMIN.
   */
  @Get('plantillas')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Obtener plantillas de mensajes',
    description: 'Retorna las plantillas activas de confirmación y recordatorio.',
  })
  @ApiUnauthorizedResponse({ description: 'No autorizado o token inválido/expirado.' })
  async obtenerPlantillas() {
    return await this.whatsappService.obtenerPlantillas();
  }

  /**
   * Actualiza las plantillas de mensajes personalizadas.
   * Requiere rol ADMINISTRADOR o SUPERADMIN.
   */
  @Put('plantillas')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Guardar plantillas de mensajes',
    description: 'Actualiza los textos de las plantillas de confirmación y recordatorio.',
  })
  @ApiUnauthorizedResponse({ description: 'No autorizado o token inválido/expirado.' })
  async guardarPlantillas(@Body() dto: ActualizarPlantillasDto) {
    return await this.whatsappService.guardarPlantillas(dto);
  }

  /**
   * Restablece las plantillas a los textos oficiales por defecto.
   * Requiere rol ADMINISTRADOR o SUPERADMIN.
   */
  @Post('plantillas/reset')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Restablecer plantillas por defecto',
    description: 'Borra las personalizaciones y restaura los mensajes predeterminados.',
  })
  @ApiUnauthorizedResponse({ description: 'No autorizado o token inválido/expirado.' })
  async resetPlantillas() {
    return await this.whatsappService.resetPlantillas();
  }

  /**
   * Desconecta la sesión actual de WhatsApp Web y elimina las credenciales locales.
   * Requiere rol ADMINISTRADOR o SUPERADMIN.
   */
  @Post('desconectar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Desvincular WhatsApp',
    description: 'Cierra sesión activa de WhatsApp y reinicia el servicio para generar un nuevo código QR.',
  })
  @ApiOkResponse({
    description: 'Sesión de WhatsApp desvinculada exitosamente.',
    schema: {
      type: 'object',
      properties: {
        mensaje: { type: 'string', example: 'WhatsApp desvinculado con éxito. Se generará un nuevo QR.' },
      },
    },
  })
  @ApiUnauthorizedResponse({ description: 'No autorizado o token inválido/expirado.' })
  async desconectar() {
    return await this.whatsappService.desconectar();
  }
}

