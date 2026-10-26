import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response } from 'express';
import { NegocioResolucionService } from '../service/negocio-resolucion.service';

/**
 * Middleware que establece el contexto de negocio de la petición.
 *
 * POR QUÉ MIDDLEWARE Y NO GUARD: el contexto de negocio se respalda con
 * `AsyncLocalStorage` y debe acompañar a toda la cadena asíncrona de la
 * petición (controlador -> servicio -> repositorio). Un guard se ejecuta
 * DESPUÉS de que el router ya ha encadenado el resto de la petición, de modo
 * que el `run()` de un guard no abarca de forma fiable los tramos asíncronos
 * posteriores. El middleware envuelve la invocación de `next()` y, por tanto,
 * todo el procesamiento que continúa a partir de ahí.
 *
 * COMPORTAMIENTO EN ESTA FASE: el middleware NO es obligatorio todavía. Si la
 * petición no apunta a ningún negocio, la cadena continúa sin contexto
 * (comportamiento de la plataforma mononegocio actual) y sin error. Si la
 * petición APUNTA a un negocio que no existe o está inactivo, se rechaza con
 * 404 de forma segura: nunca se continúa sin contexto cuando el cliente ha
 * solicitado un negocio explícitamente.
 */
@Injectable()
export class NegocioContextoMiddleware implements NestMiddleware {
  constructor(
    private readonly negocioResolucionService: NegocioResolucionService,
  ) {}

  async use(
    req: Request,
    res: Response,
    next: (error?: unknown) => void,
  ): Promise<void> {
    const resultado = await this.negocioResolucionService.resolverDesdePeticion(
      {
        hostname: req.hostname,
        headers: req.headers,
      },
    );

    if (resultado.estado === 'RECHAZADO') {
      // Lanza 404: la petición nunca continúa sin contexto cuando el
      // cliente ha solicitado un negocio explícitamente.
      this.negocioResolucionService.lanzarRechazoPorNegocioInvalido();
    }

    if (resultado.estado === 'SIN_NEGOCIO') {
      next();
      return;
    }

    this.negocioResolucionService.ejecutarConContexto(
      resultado.negocioId,
      resultado.slug,
      () => next(),
    );
  }
}
