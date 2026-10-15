import { ApiProperty } from '@nestjs/swagger';

/** Datos públicos del cliente autenticado (sin información sensible). */
export class ClienteSesionDto {
  @ApiProperty({ example: 7, description: 'ID del cliente (Cliente.id)' })
  id: number;

  @ApiProperty({ example: 'Ana' })
  nombre: string;

  @ApiProperty({ example: 'Pérez', nullable: true })
  apellido: string | null;

  @ApiProperty({ example: 'ana@gmail.com', nullable: true })
  email: string | null;
}

/** Respuesta del inicio de sesión de un cliente con Google (HE-04, Modalidad B). */
export class ClienteSesionResponseDto {
  @ApiProperty({
    description: 'JWT de sesión de cliente (audiencia propia de clientes)',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  accessToken: string;

  @ApiProperty({ type: ClienteSesionDto })
  cliente: ClienteSesionDto;
}
