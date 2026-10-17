import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ActualizarPlantillasDto {
  @ApiPropertyOptional({
    description: 'Plantilla de mensaje de confirmación de reserva',
    example:
      '💈 *KYRIOS BARBER STUDIO*\n¡Hola {cliente}! Tu cita ha sido agendada con éxito.\n\n📅 *Fecha:* {fecha}\n⏰ *Hora:* {hora}\n✂️ *Servicio:* {servicio}\n💈 *Barbero:* {barbero}',
  })
  @IsOptional()
  @IsString()
  confirmacion?: string;

  @ApiPropertyOptional({
    description: 'Plantilla de mensaje de recordatorio antes de la cita',
    example:
      '⏰ *RECORDATORIO DE TU CITA - KYRIOS BARBER*\n¡Hola {cliente}! Te recordamos que tienes una cita programada para hoy:\n\n⏰ *Hora:* {hora}\n✂️ *Servicio:* {servicio}\n💈 *Barbero:* {barbero}',
  })
  @IsOptional()
  @IsString()
  recordatorio?: string;

  @ApiPropertyOptional({
    description:
      'Minutos de anticipación con los que se enviará el recordatorio automático (ej: 30, 60, 120, 180)',
    example: 120,
  })
  @IsOptional()
  @IsInt()
  @Min(15)
  @Max(720)
  minutosAnticipacion?: number;
}
