import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class GoogleLoginDto {
  @ApiProperty({
    description: 'ID Token emitido por Google OAuth 2.0 al iniciar sesión',
    example: 'eyJhbGciOiJSUzI1NiIsImtpZCI6Ij...',
  })
  @IsString()
  @IsNotEmpty({ message: 'El ID Token de Google es obligatorio' })
  idToken: string;
}
