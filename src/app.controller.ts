import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

import { ApiTags, ApiOperation, ApiOkResponse } from '@nestjs/swagger';

@ApiTags('Sistema')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @ApiOperation({ summary: 'Health Check', description: 'Verifica que el API esté en línea.' })
  @ApiOkResponse({ description: 'El servidor está respondiendo correctamente.', schema: { example: 'Hello World!' } })
  getHello(): string {
    return this.appService.getHello();
  }
}
