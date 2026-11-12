/**
 * Trazabilidad:
 * - REQ: REQ-009
 * - Modelo ejecutor: minimax-m3.1-flash-free
 * - Propósito: health check público de la API (GET /).
 * - Responsabilidad: comprobar que el proceso responde. No consulta la base de datos ni expone estado interno.
 */
import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

import { ApiTags, ApiOperation, ApiOkResponse } from '@nestjs/swagger';

@ApiTags('Sistema')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @ApiOperation({
    summary: 'Health Check',
    description: 'Verifica que el API esté en línea.',
  })
  @ApiOkResponse({
    description: 'El servidor está respondiendo correctamente.',
    schema: { example: 'Hello World!' },
  })
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health')
  @ApiOperation({
    summary: 'Health Check Endpoint',
    description: 'Verifica el estado de disponibilidad del API.',
  })
  @ApiOkResponse({
    description: 'El servidor está respondiendo correctamente.',
    schema: { example: { status: 'ok' } },
  })
  getHealth(): { status: string } {
    return { status: 'ok' };
  }
}
