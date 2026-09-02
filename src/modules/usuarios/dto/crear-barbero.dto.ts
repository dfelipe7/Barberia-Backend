import {
  IsEmail,
  IsNotEmpty,
  IsNumber,
  IsString,
  Min,
  Max,
  MinLength,
} from 'class-validator';

export class CrearBarberoDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  password: string;

  @IsString()
  @IsNotEmpty()
  nombre: string;

  @IsString()
  @IsNotEmpty()
  apellido: string;

  @IsString()
  @IsNotEmpty()
  telefono: string;

  @IsNumber()
  @Min(0)
  @Max(100)
  porcentajeComision: number;
}