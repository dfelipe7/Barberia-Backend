import {
  IsNumber,
  IsString,
  IsNotEmpty,
  Min,
  Max,
} from 'class-validator';

export class ConfigurarBarberoDto {
  @IsString()
  @IsNotEmpty()
  telefono: string;

  @IsNumber()
  @Min(0)
  @Max(100)
  porcentajeComision: number;
}