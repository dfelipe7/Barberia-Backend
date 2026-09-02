import {
  IsNumber,
  Max,
  Min,
} from 'class-validator';

export class ActualizarComisionDto {
  @IsNumber()
  @Min(0)
  @Max(100)
  porcentajeComision: number;
}