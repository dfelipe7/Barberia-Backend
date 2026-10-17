import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ActualizarPlantillasDto {
  @ApiPropertyOptional({
    description: 'Plantilla de mensaje de confirmación de reserva',
    example: '💈 *KYRIOS BARBER STUDIO*\n¡Hola {cliente}! Tu cita ha sido agendada con éxito.\n\n📅 *Fecha:* {fecha}\n⏰ *Hora:* {hora}\n✂️ *Servicio:* {servicio}\n💈 *Barbero:* {barbero}',
  })
  @IsOptional()
  @IsString()
  confirmacion?: string;

  @ApiPropertyOptional({
    description: 'Plantilla de mensaje de recordatorio 2 horas antes de la cita',
    example: '⏰ *RECORDATORIO DE TU CITA - KYRIOS BARBER*\n¡Hola {cliente}! Te recordamos que tienes una cita programada para hoy:\n\n⏰ *Hora:* {hora}\n✂️ *Servicio:* {servicio}\n💈 *Barbero:* {barbero}',
  })
  @IsOptional()
  @IsString()
  recordatorio?: string;
}
