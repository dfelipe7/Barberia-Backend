import { Module, Global } from '@nestjs/common';
import { AlertsService } from './alerts.service';

@Global()
@Module({
  providers: [AlertsService],
  exports: [AlertsService],
})
export class AlertsModule {}
