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
@Controller('whatsapp')
export class WhatsAppController {
  constructor(private readonly whatsappService: WhatsAppService) {}

  /**
   * Obtiene el estado actual de la conexión de WhatsApp y el QR si está pendiente.
   * Este endpoint es público para permitir el sondeo (polling) sin interrupciones por expiración de tokens.
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
  getStatus() {
    return this.whatsappService.getStatus();
  }

  /**
   * Obtiene las plantillas de mensajes configuradas para confirmación y recordatorios.
   */
  @Get('plantillas')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Obtener plantillas de mensajes',
    description: 'Retorna las plantillas activas de confirmación y recordatorio.',
  })
  async obtenerPlantillas() {
    return await this.whatsappService.obtenerPlantillas();
  }

  /**
   * Actualiza las plantillas de mensajes personalizadas.
   * Requiere rol ADMINISTRADOR o SUPERADMIN.
   */
  @Put('plantillas')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN', 'ADMINISTRADOR')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Guardar plantillas de mensajes',
    description: 'Actualiza los textos de las plantillas de confirmación y recordatorio.',
  })
  async guardarPlantillas(@Body() dto: ActualizarPlantillasDto) {
    return await this.whatsappService.guardarPlantillas(dto);
  }

  /**
   * Restablece las plantillas a los textos oficiales por defecto.
   * Requiere rol ADMINISTRADOR o SUPERADMIN.
   */
  @Post('plantillas/reset')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN', 'ADMINISTRADOR')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Restablecer plantillas por defecto',
    description: 'Borra las personalizaciones y restaura los mensajes predeterminados.',
  })
  async resetPlantillas() {
    return await this.whatsappService.resetPlantillas();
  }

  /**
   * Desconecta la sesión actual de WhatsApp Web y elimina las credenciales locales.
   * Requiere rol ADMINISTRADOR o SUPERADMIN.
   */
  @Post('desconectar')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN', 'ADMINISTRADOR')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
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

